"""
services/summarization.py
ローカル LLM を使用した要約・議事録生成サービス。
長文対策として「分割要約 → 統合要約」の2段階処理を実装する。
外部通信は一切行わない。
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Optional, Union

from ..models import Job, Recording, Summary, Transcript
from .llm_provider import call_llm, check_llm_availability, get_default_llm_model
from .summary_templates import SummaryTemplateDefinition, get_summary_template

logger = logging.getLogger(__name__)

# 使用するモデル
DEFAULT_MODEL = get_default_llm_model()

# チャンク分割の目安トークン数（約1,000トークン ≈ 1,500〜2,000文字）
CHUNK_CHAR_SIZE = 2000

# 要約結果を日本語に固定するためのシステムプロンプト
JAPANESE_ONLY_SYSTEM_PROMPT = """あなたは日本語の議事録作成アシスタントです。
応答は必ず自然な日本語で出力してください。
中国語、韓国語、英語など、日本語以外の本文を出力してはいけません。
入力に他言語が含まれる場合も、日本語に翻訳・要約して返してください。
固有名詞、製品名、API 名、URL、コードは必要に応じて原文のままで構いません。
Markdown が求められている場合は、Markdown の構造を維持してください。
"""

_executor = ThreadPoolExecutor(max_workers=1)


def _require_non_empty_stage_output(text: str, stage_name: str) -> str:
    normalized = text.strip()
    if normalized:
        return normalized
    raise ValueError(f"{stage_name} の結果が空でした。LLM の応答を確認してください。")


def _split_text_into_chunks(text: str, chunk_size: int = CHUNK_CHAR_SIZE) -> list[str]:
    """
    テキストを指定文字数単位でチャンクに分割する。
    文の途中で切らないよう、句点（。）や改行で区切りを探す。
    """
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    current_pos = 0

    while current_pos < len(text):
        end_pos = current_pos + chunk_size

        if end_pos >= len(text):
            chunks.append(text[current_pos:].strip())
            break

        split_pos = -1
        for sep in ["。\n", "。", "\n\n", "\n"]:
            idx = text.rfind(sep, current_pos, end_pos)
            if idx != -1:
                split_pos = idx + len(sep)
                break

        if split_pos == -1:
            split_pos = end_pos

        chunk = text[current_pos:split_pos].strip()
        if chunk:
            chunks.append(chunk)
        current_pos = split_pos

    return chunks


def _format_custom_prompt_block(custom_prompt: Optional[str]) -> str:
    """カスタムプロンプトを追記用ブロックに変換する。"""
    if not custom_prompt:
        return ""
    return f"""

追加指示:
{custom_prompt}
"""


def _build_chunk_prompt(
    chunk: str,
    chunk_index: Union[int, str],
    total_chunks: Union[int, str],
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
) -> str:
    """チャンク要約プロンプトを組み立てる。"""
    return f"""以下は会議の文字起こしテキストの一部（{chunk_index}/{total_chunks}）です。
この会議では「{template.label}」形式の議事録を作成します。
後段の議事録生成で重要情報が落ちないよう、必要な事実を日本語で簡潔に要約してください。
議論された内容、決定事項、保留事項、アクションアイテムがあれば必ず含めてください。

テンプレートの目的:
{template.description}

抽出時の重点:
{template.chunk_guidance}{_format_custom_prompt_block(custom_prompt)}

出力ルール:
- 本文は必ず日本語で書く
- 中国語、韓国語、英語の文章を出力しない
- 固有名詞や製品名は必要に応じて原文のままでよい
- 箇条書き中心で、後段の議事録生成に必要な事実を優先する
- 推測で補完しない

--- テキスト ---
{chunk}
--- ここまで ---

要約（日本語）:"""


def _summarize_chunk(
    chunk: str,
    chunk_index: int,
    total_chunks: int,
    model: str,
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
) -> str:
    """テキストチャンクを個別に要約する（ステップ1）。"""
    prompt = _build_chunk_prompt(
        chunk=chunk,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        template=template,
        custom_prompt=custom_prompt,
    )
    return _require_non_empty_stage_output(
        call_llm(
        prompt=prompt,
        model=model,
        system_prompt=JAPANESE_ONLY_SYSTEM_PROMPT,
        ),
        "チャンク要約",
    )


def _build_final_minutes_prompt(
    summaries_text: str,
    title: str,
    meeting_date_label: str,
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
) -> str:
    """最終議事録生成プロンプトを組み立てる。"""
    markdown_template = template.markdown_template.format(
        title=title,
        meeting_date=meeting_date_label,
    )
    return f"""以下は「{title}」（{meeting_date_label}開催）の会議文字起こしを分割要約した結果です。
これらを統合して、「{template.label}」テンプレートに従った正式な議事録を作成してください。
各セクションを適切に埋めてください。情報がない場合は「（記録なし）」と記載してください。

テンプレートの目的:
{template.description}

最終出力時の重点:
{template.final_guidance}{_format_custom_prompt_block(custom_prompt)}

出力ルール:
- 議事録本文は必ず自然な日本語で記載する
- 中国語、韓国語、英語の文章を出力しない
- Markdown の見出しと箇条書きを維持する
- 推測で補完しない

--- 要約 ---
{summaries_text}
--- ここまで ---

以下の Markdown テンプレートを使用して議事録を作成してください：

{markdown_template}

議事録（Markdown形式）:"""


def _generate_final_minutes(
    chunk_summaries: list[str],
    title: str,
    meeting_date: Optional[date],
    model: str,
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
) -> str:
    """チャンク要約を統合して最終議事録を生成する（ステップ2）。"""
    summaries_text = "\n\n".join(
        [f"【要約 {index + 1}】\n{summary}" for index, summary in enumerate(chunk_summaries)]
    )
    date_str = meeting_date.strftime("%Y年%m月%d日") if meeting_date else "不明"

    prompt = _build_final_minutes_prompt(
        summaries_text=summaries_text,
        title=title,
        meeting_date_label=date_str,
        template=template,
        custom_prompt=custom_prompt,
    )
    return _require_non_empty_stage_output(
        call_llm(
        prompt=prompt,
        model=model,
        system_prompt=JAPANESE_ONLY_SYSTEM_PROMPT,
        ),
        "最終議事録生成",
    )


def _build_normalization_prompt(minutes_markdown: str) -> str:
    """日本語正規化プロンプトを組み立てる。"""
    return f"""以下の議事録を、意味と Markdown 構造を保ったまま自然な日本語に統一してください。

出力ルール:
- 本文は必ず日本語で出力する
- 中国語、韓国語、英語の文章があれば日本語に翻訳する
- 見出し、箇条書き、Markdown 記法は維持する
- セクションの追加・削除・並べ替えはしない
- 固有名詞、製品名、API 名、URL、コードは必要に応じて原文のままでよい
- 余計な前置きや説明は付けず、議事録本文だけを返す

--- 議事録 ---
{minutes_markdown}
--- ここまで ---

日本語に統一した議事録（Markdown形式）:"""


def _normalize_minutes_to_japanese(minutes_markdown: str, model: str) -> str:
    """最終議事録を自然な日本語に統一する。"""
    prompt = _build_normalization_prompt(minutes_markdown)
    return _require_non_empty_stage_output(
        call_llm(
        prompt=prompt,
        model=model,
        system_prompt=JAPANESE_ONLY_SYSTEM_PROMPT,
        ),
        "日本語正規化",
    )


def _build_prompt_snapshot(
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
) -> str:
    """実行時に使用したプロンプト定義を保存用テキストにまとめる。"""
    chunk_prompt = _build_chunk_prompt(
        chunk="{chunk}",
        chunk_index="{chunk_index}",
        total_chunks="{total_chunks}",
        template=template,
        custom_prompt=custom_prompt,
    )
    final_prompt = _build_final_minutes_prompt(
        summaries_text="{summaries_text}",
        title="{title}",
        meeting_date_label="{meeting_date}",
        template=template,
        custom_prompt=custom_prompt,
    )
    normalization_prompt = _build_normalization_prompt("{minutes_markdown}")

    return f"""# 要約プロンプトスナップショット

- テンプレート名: {template.name}
- テンプレート表示名: {template.label}

## テンプレート概要
{template.description}

## カスタムプロンプト
{custom_prompt or "（なし）"}

## システムプロンプト
{JAPANESE_ONLY_SYSTEM_PROMPT.strip()}

## チャンク要約プロンプト
{chunk_prompt}

## 最終議事録生成プロンプト
{final_prompt}

## 日本語正規化プロンプト
{normalization_prompt}
"""


def _run_summarization(
    text: str,
    title: str,
    meeting_date: Optional[date],
    template: SummaryTemplateDefinition,
    custom_prompt: Optional[str],
    model: str = DEFAULT_MODEL,
) -> str:
    """
    分割要約 → 統合要約の2段階処理を実行する（同期）。
    """
    chunks = _split_text_into_chunks(text)
    total_chunks = len(chunks)
    logger.info("テキストを %s チャンクに分割しました", total_chunks)

    if total_chunks == 1:
        chunk_summaries = [
            _summarize_chunk(
                chunks[0],
                1,
                1,
                model,
                template,
                custom_prompt,
            )
        ]
    else:
        chunk_summaries = []
        for index, chunk in enumerate(chunks):
            logger.info("チャンク要約中: %s/%s", index + 1, total_chunks)
            chunk_summaries.append(
                _summarize_chunk(
                    chunk,
                    index + 1,
                    total_chunks,
                    model,
                    template,
                    custom_prompt,
                )
            )

    logger.info("最終議事録を生成中...")
    final_minutes = _generate_final_minutes(
        chunk_summaries,
        title,
        meeting_date,
        model,
        template,
        custom_prompt,
    )
    logger.info("議事録の出力言語を日本語に正規化中...")
    return _normalize_minutes_to_japanese(final_minutes, model)


async def run_summarization_job(
    recording_id: int,
    job_id: int,
    db_session_factory,
    template_name: str = "general",
    custom_prompt: Optional[str] = None,
    model: str = DEFAULT_MODEL,
) -> None:
    """
    非同期で要約ジョブを実行する。
    jobs テーブルの状態を更新しながら処理を進める。
    """
    from sqlalchemy.orm import Session

    db: Session = db_session_factory()
    try:
        template = get_summary_template(template_name)
        prompt_snapshot = _build_prompt_snapshot(template, custom_prompt)

        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.error("ジョブが見つかりません: job_id=%s", job_id)
            return

        job.status = "running"
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            logger.info(
                "削除済み録音の要約ジョブを終了します: job_id=%s, recording_id=%s",
                job_id,
                recording_id,
            )
            db.delete(job)
            db.commit()
            return

        recording.state = "SUMMARIZING"
        db.commit()

        transcript = db.query(Transcript).filter(
            Transcript.recording_id == recording_id
        ).first()
        if not transcript or not (transcript.text_edited or transcript.text_raw):
            raise ValueError("文字起こしテキストが存在しません。先に文字起こしを実行してください。")

        text = transcript.text_edited or transcript.text_raw
        title = recording.title
        meeting_date = recording.meeting_date

        loop = asyncio.get_event_loop()
        final_minutes = await loop.run_in_executor(
            _executor,
            _run_summarization,
            text,
            title,
            meeting_date,
            template,
            custom_prompt,
            model,
        )
        final_minutes = _require_non_empty_stage_output(final_minutes, "議事録保存前チェック")

        db.expire_all()
        job = db.query(Job).filter(Job.id == job_id).first()
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            logger.info(
                "削除済み録音の要約結果を破棄します: job_id=%s, recording_id=%s",
                job_id,
                recording_id,
            )
            if job:
                db.delete(job)
                db.commit()
            return

        if not job:
            logger.info(
                "要約ジョブが削除済みのため結果保存をスキップします: job_id=%s, recording_id=%s",
                job_id,
                recording_id,
            )
            return

        existing_summary = db.query(Summary).filter(
            Summary.recording_id == recording_id,
            Summary.template_name == template_name,
        ).first()

        if existing_summary:
            existing_summary.content_md = final_minutes
            existing_summary.prompt_snapshot = prompt_snapshot
        else:
            db.add(
                Summary(
                    recording_id=recording_id,
                    template_name=template_name,
                    content_md=final_minutes,
                    prompt_snapshot=prompt_snapshot,
                )
            )

        job.status = "done"
        recording.state = "DONE"
        recording.last_summary_template_name = template_name
        db.commit()

        logger.info(
            "要約ジョブ完了: job_id=%s, recording_id=%s, template=%s",
            job_id,
            recording_id,
            template_name,
        )

    except Exception as exc:
        logger.error("要約ジョブエラー: job_id=%s / %s", job_id, exc, exc_info=True)
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = "error"
                job.log = str(exc)[:1000]
            recording = db.query(Recording).filter(Recording.id == recording_id).first()
            if recording:
                recording.state = "TRANSCRIBED"
            db.commit()
        except Exception as db_err:
            logger.error("DB 更新エラー: %s", db_err)
    finally:
        db.close()


async def check_ollama_availability(model: str = DEFAULT_MODEL) -> dict:
    """
    後方互換のために残す Ollama ステータス関数。
    実際には設定済み LLM プロバイダのステータスを返す。
    """
    return await check_llm_availability(model)
