"""
routers/transcripts.py
文字起こし関連 API エンドポイント。
- 文字起こし開始（非同期ジョブ登録）
- 文字起こし結果取得
- 文字起こし修正保存
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import Recording, Transcript, Job
from ..schemas import TranscriptResponse, TranscriptUpdate, JobResponse, MessageResponse
from ..services.transcription import run_transcription_job

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recordings", tags=["transcripts"])


@router.post("/{recording_id}/transcribe", response_model=JobResponse, status_code=202)
async def start_transcription(
    recording_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    文字起こしジョブを登録し、バックグラウンドで処理を開始する。
    HTTP 202 Accepted を返し、ジョブ ID でポーリング可能にする。
    """
    # 録音の存在確認
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    # WAV ファイルの存在確認
    if not recording.wav_path:
        raise HTTPException(
            status_code=400,
            detail="WAV ファイルが存在しません。先に音声ファイルを取り込んでください。"
        )

    # 処理中の場合は重複実行を防止
    if recording.state == "TRANSCRIBING":
        raise HTTPException(
            status_code=409,
            detail="文字起こし処理が既に実行中です"
        )

    # ジョブレコードを作成
    job = Job(
        recording_id=recording_id,
        job_type="transcribe",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # バックグラウンドタスクとして文字起こしを実行
    background_tasks.add_task(
        run_transcription_job,
        recording_id=recording_id,
        job_id=job.id,
        wav_path=recording.wav_path,
        db_session_factory=SessionLocal,
    )

    logger.info(f"文字起こしジョブ登録: job_id={job.id}, recording_id={recording_id}")
    return job


@router.get("/{recording_id}/transcript", response_model=TranscriptResponse)
def get_transcript(recording_id: int, db: Session = Depends(get_db)):
    """文字起こし結果を取得する。"""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    transcript = db.query(Transcript).filter(
        Transcript.recording_id == recording_id
    ).first()

    if not transcript:
        raise HTTPException(
            status_code=404,
            detail="文字起こし結果がありません。先に文字起こしを実行してください。"
        )

    return transcript


@router.put("/{recording_id}/transcript", response_model=TranscriptResponse)
def update_transcript(
    recording_id: int,
    request: TranscriptUpdate,
    db: Session = Depends(get_db),
):
    """
    文字起こし修正テキストを保存する。
    text_edited フィールドを更新する（text_raw は変更しない）。
    """
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    transcript = db.query(Transcript).filter(
        Transcript.recording_id == recording_id
    ).first()

    if not transcript:
        raise HTTPException(
            status_code=404,
            detail="文字起こし結果がありません。先に文字起こしを実行してください。"
        )

    transcript.text_edited = request.text_edited
    db.commit()
    db.refresh(transcript)

    logger.info(f"文字起こし修正保存: recording_id={recording_id}, 文字数={len(request.text_edited)}")
    return transcript
