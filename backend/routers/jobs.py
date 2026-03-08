"""
routers/jobs.py
ジョブ状態ポーリング API エンドポイント。
フロントエンドから非同期ジョブの状態を確認するために使用する。
"""

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Job
from ..schemas import JobResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    """
    ジョブ状態を取得する。
    フロントエンドはこのエンドポイントをポーリングして処理完了を検知する。
    ステータス: pending / running / done / error
    """
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"ジョブ ID={job_id} が見つかりません")
    return job


@router.get("/recording/{recording_id}", response_model=List[JobResponse])
def get_jobs_by_recording(recording_id: int, db: Session = Depends(get_db)):
    """
    録音 ID に紐づくジョブ一覧を取得する。
    最新のジョブを先頭に返す。
    """
    jobs = (
        db.query(Job)
        .filter(Job.recording_id == recording_id)
        .order_by(Job.created_at.desc())
        .all()
    )
    return jobs
