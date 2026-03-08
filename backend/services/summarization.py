"""
services/summarization.py
Ollama を使用した要約・議事録生成サービス。
長文対策として「分割要約 → 統合要約」の2段階処理を実装する。
外部通信は一切行わない（Ollama は localhost:11434 で動作）。
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Optional
import httpx

from ..models import Recording, Summary, Job, Transcript

logger = logging.getLogger(__name__)

# Ollama API エンドポイント（ローカルのみ）
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_GENERATE_URL = f"{OLLAMA_BASE_URL}/api/generate"

# 使用するモデル（llama3 または mistral）
DEFAULT_MODEL = "llama3"

# チャンク分割の目安トークン数（約1,000トークン ≈ 1,500〜2,000文字）
CHUNK_CHAR_SIZE = 2000

# ThreadPoolExecutor（Ollama 呼び出し用）
_executor = ThreadPoolExecutor(max_workers=1)


# ─────────────────────────────────────────────
# Markdown テンプレート
# ─────────────────────────────────────────────

MINUTES_TEMPLATE = """# 議事録

## 基本情報
- 会議名: {title}
- 日付: {meeting_date}

## 議題・目的

## 主な議論内容

## 決定事項

## 次のアクション・TODO

## その他・備考
"""


def _split_text_into_chunks(text: str, chunk_size: int = CHUNK_CHAR_SIZE) -> list[str]:
    """
    テキストを指定文字数単位でチャンクに分割する。
    文の途中で切らないよう、句点（。）や改行で区切りを探す。

    Args:
        text: 分割対象テキスト
        chunk_size: チャンクの目安文字数

    Returns:
        list[str]: チャンクリスト
    """
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    current_pos = 0

    while current_pos < len(text):
        end_pos = current_pos + chunk_size

        if end_pos >= len(text):
            # 残りのテキストをすべて追加
            chunks.append(text[current_pos:].strip())
            break

        # 句点または改行で自然な区切りを探す（後方検索）
        split_pos = -1
        for sep in ["。\n", "。", "\n\n", "\n"]:
            idx = text.rfind(sep, current_pos, end_pos)
            if idx != -1:
                split_pos = idx + len(sep)
                break

        if split_pos == -1:
            # 自然な区切りが見つからない場合は強制分割
            split_pos = end_pos

        chunk = text[current_pos:split_pos].strip()
        if chunk:
            chunks.append(chunk)
        current_pos = split_pos

    return chunks


def _call_ollama(prompt: str, model: str = DEFAULT_MODEL) -> str:
    """
    Ollama API を同期呼び出しする（ThreadPoolExecutor から実行）。

    Args:
        prompt: プロンプトテキスト
        model: 使用モデル名

    Returns:
        str: 生成テキスト

    Raises:
        RuntimeError: Ollama 接続失敗または生成エラー
    """
    import json

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,   # 議事録向けに低温度（確定的な出力）
            "num_predict": 2048,  # 最大生成トークン数
        },
    }

    try:
        with httpx.Client(timeout=300.0) as client:
            response = client.post(OLLAMA_GENERATE_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            return data.get("response", "").strip()
    except httpx.ConnectError:
        raise RuntimeError(
            "Ollama に接続できません。"
            "Ollama が起動しているか確認してください: ollama serve"
        )
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Ollama API エラー: {e.response.status_code} / {e.response.text[:200]}")
    except Exception as e:
        raise RuntimeError(f"Ollama 呼び出しエラー: {e}")


def _summarize_chunk(chunk: str, chunk_index: int, total_chunks: int, model: str) -> str:
    """
    テキストチャンクを個別に要約する（ステップ1）。

    Args:
        chunk: 要約対象テキスト
        chunk_index: チャンクインデックス（1始まり）
        total_chunks: 総チャンク数
        model: 使用モデル名

    Returns:
        str: チャンク要約テキスト
    """
    prompt = f"""以下は会議の文字起こしテキストの一部（{chunk_index}/{total_chunks}）です。
このテキストの重要な内容を日本語で簡潔に要約してください。
議論された内容、決定事項、アクションアイテムがあれば必ず含めてください。

--- テキスト ---
{chunk}
--- ここまで ---

要約（日本語）:"""

    return _call_ollama(prompt, model)


def _generate_final_minutes(
    chunk_summaries: list[str],
    title: str,
    meeting_date: Optional[date],
    model: str,
) -> str:
    """
    チャンク要約を統合して最終議事録を生成する（ステップ2）。

    Args:
        chunk_summaries: 各チャンクの要約リスト
        title: 会議名
        meeting_date: 会議日
        model: 使用モデル名

    Returns:
        str: Markdown 形式の最終議事録
    """
    summaries_text = "\n\n".join(
        [f"【要約 {i+1}】\n{s}" for i, s in enumerate(chunk_summaries)]
    )

    date_str = meeting_date.strftime("%Y年%m月%d日") if meeting_date else "不明"

    prompt = f"""以下は「{title}」（{date_str}開催）の会議文字起こしの要約です。
これらの要約を統合して、以下の Markdown テンプレートに従った正式な議事録を作成してください。
各セクションを適切に埋めてください。情報がない場合は「（記録なし）」と記載してください。

--- 要約 ---
{summaries_text}
--- ここまで ---

以下の Markdown テンプレートを使用して議事録を作成してください：

# 議事録

## 基本情報
- 会議名: {title}
- 日付: {date_str}

## 議題・目的

## 主な議論内容

## 決定事項

## 次のアクション・TODO

## その他・備考

議事録（Markdown形式）:"""

    return _call_ollama(prompt, model)


def _run_summarization(
    text: str,
    title: str,
    meeting_date: Optional[date],
    model: str = DEFAULT_MODEL,
) -> str:
    """
    分割要約 → 統合要約の2段階処理を実行する（同期）。

    Args:
        text: 文字起こしテキスト（全文）
        title: 会議名
        meeting_date: 会議日
        model: 使用モデル名

    Returns:
        str: Markdown 形式の最終議事録
    """
    # テキストをチャンクに分割
    chunks = _split_text_into_chunks(text)
    total_chunks = len(chunks)
    logger.info(f"テキストを {total_chunks} チャンクに分割しました")

    if total_chunks == 1:
        # 短いテキストは直接最終議事録を生成
        chunk_summaries = [_summarize_chunk(chunks[0], 1, 1, model)]
    else:
        # ステップ1: 各チャンクを個別に要約
        chunk_summaries = []
        for i, chunk in enumerate(chunks):
            logger.info(f"チャンク要約中: {i+1}/{total_chunks}")
            summary = _summarize_chunk(chunk, i + 1, total_chunks, model)
            chunk_summaries.append(summary)

    # ステップ2: 統合要約 → 最終議事録生成
    logger.info("最終議事録を生成中...")
    final_minutes = _generate_final_minutes(chunk_summaries, title, meeting_date, model)

    return final_minutes


async def run_summarization_job(
    recording_id: int,
    job_id: int,
    db_session_factory,
    template_name: str = "general",
    model: str = DEFAULT_MODEL,
) -> None:
    """
    非同期で要約ジョブを実行する。
    jobs テーブルの状態を更新しながら処理を進める。

    Args:
        recording_id: 録音 ID
        job_id: ジョブ ID
        db_session_factory: SQLAlchemy セッションファクトリ
        template_name: テンプレート名
        model: 使用 Ollama モデル名
    """
    from sqlalchemy.orm import Session

    db: Session = db_session_factory()
    try:
        # ジョブ状態を running に更新
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.error(f"ジョブが見つかりません: job_id={job_id}")
            return

        job.status = "running"
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            logger.error(f"録音が見つかりません: recording_id={recording_id}")
            return

        recording.state = "SUMMARIZING"
        db.commit()

        # 文字起こしテキストを取得（修正済みを優先）
        transcript = db.query(Transcript).filter(
            Transcript.recording_id == recording_id
        ).first()

        if not transcript or not (transcript.text_edited or transcript.text_raw):
            raise ValueError("文字起こしテキストが存在しません。先に文字起こしを実行してください。")

        # 修正済みテキストを優先使用
        text = transcript.text_edited or transcript.text_raw

        title = recording.title
        meeting_date = recording.meeting_date

        # ThreadPoolExecutor で同期処理を非同期実行
        loop = asyncio.get_event_loop()
        final_minutes = await loop.run_in_executor(
            _executor,
            _run_summarization,
            text,
            title,
            meeting_date,
            model,
        )

        # 要約結果を DB に保存（既存レコードは上書き）
        existing_summary = db.query(Summary).filter(
            Summary.recording_id == recording_id,
            Summary.template_name == template_name,
        ).first()

        if existing_summary:
            existing_summary.content_md = final_minutes
        else:
            new_summary = Summary(
                recording_id=recording_id,
                template_name=template_name,
                content_md=final_minutes,
            )
            db.add(new_summary)

        # 状態更新
        job.status = "done"
        recording.state = "DONE"
        db.commit()

        logger.info(f"要約ジョブ完了: job_id={job_id}, recording_id={recording_id}")

    except Exception as e:
        logger.error(f"要約ジョブエラー: job_id={job_id} / {e}", exc_info=True)
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = "error"
                job.log = str(e)[:1000]
            recording = db.query(Recording).filter(Recording.id == recording_id).first()
            if recording:
                recording.state = "TRANSCRIBED"  # エラー時は TRANSCRIBED に戻す
            db.commit()
        except Exception as db_err:
            logger.error(f"DB 更新エラー: {db_err}")
    finally:
        db.close()


async def check_ollama_availability(model: str = DEFAULT_MODEL) -> dict:
    """
    Ollama の稼働状況とモデルの利用可能性を確認する。

    Returns:
        dict: {"available": bool, "model": str, "message": str}
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Ollama の稼働確認
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                models = [m["name"] for m in data.get("models", [])]
                model_available = any(model in m for m in models)
                return {
                    "available": True,
                    "model_loaded": model_available,
                    "available_models": models,
                    "message": "Ollama は正常に動作しています" if model_available
                               else f"モデル '{model}' が見つかりません。ollama pull {model} を実行してください。",
                }
    except Exception as e:
        return {
            "available": False,
            "model_loaded": False,
            "available_models": [],
            "message": f"Ollama に接続できません: {e}",
        }
