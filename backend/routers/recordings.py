"""
routers/recordings.py
録音関連 API エンドポイント。
- 音声ファイル取り込み・前処理
- 録音一覧・詳細取得
- 音声ファイル削除・保持
"""

import asyncio
import shutil
import uuid
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal, AUDIO_DIR
from ..models import Recording, Job
from ..schemas import (
    RecordingResponse,
    RecordingListResponse,
    AudioDeleteRequest,
    AudioRetainRequest,
    MessageResponse,
)
from ..services.audio import convert_to_wav, delete_audio_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


# ─────────────────────────────────────────────
# 録音一覧・詳細取得
# ─────────────────────────────────────────────

@router.get("", response_model=RecordingListResponse)
def list_recordings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """
    録音一覧を取得する。
    作成日時の降順（新しい順）で返す。
    """
    recordings = (
        db.query(Recording)
        .order_by(Recording.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    total = db.query(Recording).count()
    return RecordingListResponse(recordings=recordings, total=total)


@router.get("/{recording_id}", response_model=RecordingResponse)
def get_recording(recording_id: int, db: Session = Depends(get_db)):
    """録音詳細を取得する。"""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")
    return recording


# ─────────────────────────────────────────────
# 音声ファイル取り込み
# ─────────────────────────────────────────────

@router.post("/import", response_model=RecordingResponse, status_code=201)
async def import_recording(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="音声ファイル（wav/mp3/m4a）"),
    title: str = Form(..., description="会議名"),
    meeting_date: Optional[str] = Form(None, description="会議日（YYYY-MM-DD）"),
    db: Session = Depends(get_db),
):
    """
    音声ファイルを取り込み、ffmpeg で 16kHz/mono/WAV に変換する。
    変換後のファイルは ~/.local-minutes/audio/ に保存する。
    """
    # ファイル形式チェック
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext not in {".wav", ".mp3", ".m4a"}:
        raise HTTPException(
            status_code=400,
            detail=f"非対応の音声形式です。対応形式: wav, mp3, m4a / 受信: {ext}"
        )

    # 会議日のパース
    parsed_date = None
    if meeting_date:
        try:
            parsed_date = date.fromisoformat(meeting_date)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"会議日の形式が不正です。YYYY-MM-DD 形式で指定してください: {meeting_date}"
            )

    # アップロードファイルを一時保存
    temp_filename = f"upload_{uuid.uuid4().hex}{ext}"
    temp_path = str(AUDIO_DIR / temp_filename)

    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # ffmpeg で WAV 変換
        wav_filename = f"{uuid.uuid4().hex}.wav"
        audio_path, wav_path = convert_to_wav(temp_path, wav_filename)

    except Exception as e:
        # 一時ファイルのクリーンアップ
        import os
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"音声変換エラー: {str(e)}")

    # 元ファイルを保持（audio_path として記録）
    # 一時ファイルをそのまま元ファイルとして使用
    audio_path = temp_path

    # DB に録音レコードを作成
    recording = Recording(
        title=title,
        meeting_date=parsed_date,
        audio_path=audio_path,
        wav_path=wav_path,
        state="IMPORTED",
        audio_status="PENDING",
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)

    logger.info(f"録音取り込み完了: recording_id={recording.id}, title={title}")
    return recording


# ─────────────────────────────────────────────
# 音声ファイル削除・保持
# ─────────────────────────────────────────────

@router.post("/{recording_id}/audio/delete", response_model=MessageResponse)
def delete_audio(
    recording_id: int,
    request: AudioDeleteRequest,
    db: Session = Depends(get_db),
):
    """
    音声ファイルを削除する。
    confirmed=True が必須（誤操作防止）。
    ファイルが存在しない場合もエラーにしない。
    """
    if not request.confirmed:
        raise HTTPException(
            status_code=400,
            detail="削除確認フラグ（confirmed=true）が必要です"
        )

    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    # 音声ファイル削除（wav_path と audio_path の両方を削除）
    deleted_files = []
    for path in [recording.wav_path, recording.audio_path]:
        if path and delete_audio_file(path):
            deleted_files.append(path)

    # DB の audio_status を更新
    recording.audio_status = "DELETED"
    db.commit()

    logger.info(f"音声ファイル削除完了: recording_id={recording_id}, files={deleted_files}")
    return MessageResponse(
        message="音声ファイルを削除しました",
        detail=f"削除ファイル数: {len(deleted_files)}"
    )


@router.post("/{recording_id}/audio/retain", response_model=MessageResponse)
def retain_audio(
    recording_id: int,
    request: AudioRetainRequest,
    db: Session = Depends(get_db),
):
    """音声ファイルの保持を記録する。"""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    recording.audio_status = "RETAINED"
    db.commit()

    logger.info(f"音声ファイル保持記録: recording_id={recording_id}")
    return MessageResponse(message="音声ファイルの保持を記録しました")
