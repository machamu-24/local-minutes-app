"""
routers/summaries.py
要約関連 API エンドポイント。
- 要約生成開始（非同期ジョブ登録）
- 要約結果取得
- Ollama 稼働状況確認
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import Recording, Summary, Job
from ..schemas import SummaryResponse, SummarizeRequest, JobResponse, MessageResponse
from ..services.summarization import run_summarization_job, check_ollama_availability

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recordings", tags=["summaries"])


@router.post("/{recording_id}/summarize", response_model=JobResponse, status_code=202)
async def start_summarization(
    recording_id: int,
    request: SummarizeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    要約生成ジョブを登録し、バックグラウンドで処理を開始する。
    HTTP 202 Accepted を返し、ジョブ ID でポーリング可能にする。
    文字起こし完了（TRANSCRIBED）状態でのみ実行可能。
    """
    # 録音の存在確認
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    # 文字起こし完了確認
    if recording.state not in {"TRANSCRIBED", "DONE"}:
        raise HTTPException(
            status_code=400,
            detail=f"文字起こしが完了していません。現在の状態: {recording.state}"
        )

    # 処理中の場合は重複実行を防止
    if recording.state == "SUMMARIZING":
        raise HTTPException(
            status_code=409,
            detail="要約処理が既に実行中です"
        )

    # ジョブレコードを作成
    job = Job(
        recording_id=recording_id,
        job_type="summarize",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # バックグラウンドタスクとして要約を実行
    background_tasks.add_task(
        run_summarization_job,
        recording_id=recording_id,
        job_id=job.id,
        db_session_factory=SessionLocal,
        template_name=request.template_name,
    )

    logger.info(
        f"要約ジョブ登録: job_id={job.id}, recording_id={recording_id}, "
        f"template={request.template_name}"
    )
    return job


@router.get("/{recording_id}/summary", response_model=SummaryResponse)
def get_summary(
    recording_id: int,
    template_name: str = "general",
    db: Session = Depends(get_db),
):
    """要約結果を取得する。"""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    summary = db.query(Summary).filter(
        Summary.recording_id == recording_id,
        Summary.template_name == template_name,
    ).first()

    if not summary:
        raise HTTPException(
            status_code=404,
            detail="要約結果がありません。先に要約生成を実行してください。"
        )

    return summary


# ─────────────────────────────────────────────
# Ollama 稼働確認（別ルーター）
# ─────────────────────────────────────────────

status_router = APIRouter(prefix="/api", tags=["status"])


@status_router.get("/ollama/status")
async def get_ollama_status():
    """Ollama の稼働状況とモデルの利用可能性を確認する。"""
    result = await check_ollama_availability()
    return result
