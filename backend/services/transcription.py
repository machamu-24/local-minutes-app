"""
services/transcription.py
faster-whisper を使用した音声文字起こしサービス。
GPU なし環境（macOS）向けに CPU / int8 量子化で動作する。
処理は ThreadPoolExecutor で非同期実行し、jobs テーブルで状態管理する。
"""

import json
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from sqlalchemy.orm import Session

from ..models import Recording, Transcript, Job

logger = logging.getLogger(__name__)

# ThreadPoolExecutor（CPU バウンド処理用）
# max_workers=1 で同時実行数を制限（メモリ節約）
_executor = ThreadPoolExecutor(max_workers=1)

# Whisper モデルのシングルトン（初回ロード後はキャッシュ）
_whisper_model = None


def get_whisper_model():
    """
    faster-whisper モデルを取得する（遅延初期化・シングルトン）。
    モデル: medium（精度と速度のバランス）
    デバイス: cpu（GPU なし環境）
    量子化: int8（メモリ節約・速度向上）

    Returns:
        WhisperModel インスタンス
    """
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
        except ModuleNotFoundError as exc:
            missing_pkg = exc.name or "unknown"
            if missing_pkg == "faster_whisper":
                raise RuntimeError(
                    "faster-whisper がインストールされていません。"
                    "pip install -r backend/requirements.txt を実行してください。"
                ) from exc
            raise RuntimeError(
                f"faster-whisper の依存パッケージ '{missing_pkg}' が不足しています。"
                "仮想環境を再作成するか、"
                "pip install -r backend/requirements.txt を実行してください。"
            ) from exc
        except ImportError as exc:
            raise RuntimeError(
                f"faster-whisper の読み込みに失敗しました: {exc}. "
                "仮想環境を再作成するか、"
                "pip install -r backend/requirements.txt を実行してください。"
            ) from exc

        logger.info("Whisper モデルをロード中（初回は数分かかる場合があります）...")
        _whisper_model = WhisperModel(
            "medium",
            device="cpu",
            compute_type="int8",
        )
        logger.info("Whisper モデルのロード完了")
    return _whisper_model


def _run_transcription(wav_path: str) -> dict:
    """
    faster-whisper による文字起こし処理（同期実行）。
    ThreadPoolExecutor から呼び出される。

    Args:
        wav_path: WAV ファイルパス

    Returns:
        dict: {
            "text_raw": str,  # 全文テキスト
            "segments": list  # タイムスタンプ付きセグメントリスト
        }
    """
    model = get_whisper_model()

    logger.info(f"文字起こし開始: {wav_path}")

    segments_iter, info = model.transcribe(
        wav_path,
        beam_size=5,
        language="ja",          # 日本語を明示指定（精度向上）
        vad_filter=True,        # 無音区間をスキップ（処理高速化）
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    # セグメントをリストに変換（ジェネレーターを消費）
    segments_list = []
    full_text_parts = []

    for seg in segments_iter:
        segments_list.append({
            "id": seg.id,
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip(),
        })
        full_text_parts.append(seg.text.strip())

    full_text = "\n".join(full_text_parts)
    logger.info(f"文字起こし完了: {len(segments_list)} セグメント, {len(full_text)} 文字")

    return {
        "text_raw": full_text,
        "segments": segments_list,
    }


async def run_transcription_job(
    recording_id: int,
    job_id: int,
    wav_path: str,
    db_session_factory,
) -> None:
    """
    非同期で文字起こしジョブを実行する。
    jobs テーブルの状態を更新しながら処理を進める。

    Args:
        recording_id: 録音 ID
        job_id: ジョブ ID
        wav_path: WAV ファイルパス
        db_session_factory: SQLAlchemy セッションファクトリ
    """
    db: Session = db_session_factory()
    try:
        # ジョブ状態を running に更新
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.error(f"ジョブが見つかりません: job_id={job_id}")
            return

        job.status = "running"
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if recording:
            recording.state = "TRANSCRIBING"
        db.commit()

        # ThreadPoolExecutor で同期処理を非同期実行
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor,
            _run_transcription,
            wav_path,
        )

        # 文字起こし結果を DB に保存
        transcript = db.query(Transcript).filter(
            Transcript.recording_id == recording_id
        ).first()

        if transcript:
            transcript.text_raw = result["text_raw"]
            transcript.segments_json = json.dumps(result["segments"], ensure_ascii=False)
        else:
            transcript = Transcript(
                recording_id=recording_id,
                text_raw=result["text_raw"],
                segments_json=json.dumps(result["segments"], ensure_ascii=False),
            )
            db.add(transcript)

        # 状態更新
        job.status = "done"
        if recording:
            recording.state = "TRANSCRIBED"
        db.commit()

        logger.info(f"文字起こしジョブ完了: job_id={job_id}, recording_id={recording_id}")

    except Exception as e:
        logger.error(f"文字起こしジョブエラー: job_id={job_id} / {e}", exc_info=True)
        try:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job:
                job.status = "error"
                job.log = str(e)[:1000]
            recording = db.query(Recording).filter(Recording.id == recording_id).first()
            if recording:
                recording.state = "IMPORTED"  # エラー時は IMPORTED に戻す
            db.commit()
        except Exception as db_err:
            logger.error(f"DB 更新エラー: {db_err}")
    finally:
        db.close()
