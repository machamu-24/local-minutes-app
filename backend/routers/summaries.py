"""
routers/summaries.py
要約関連 API エンドポイント。
- 要約テンプレート一覧取得
- 要約生成開始（非同期ジョブ登録）
- 要約結果取得
- LLM ランタイム稼働状況確認
"""

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import Job, Recording, Summary
from ..schemas import (
    JobResponse,
    SummarizeRequest,
    SummaryResponse,
    SummaryTemplateResponse,
)
from ..services.summarization import check_ollama_availability, run_summarization_job
from ..services.llm_provider import check_llm_availability
from ..services.summary_templates import get_summary_template, list_summary_templates

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recordings", tags=["summaries"])


@router.get("/summary-templates", response_model=list[SummaryTemplateResponse])
def get_summary_templates():
    """利用可能な要約テンプレート一覧を返す。"""
    return list_summary_templates()


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
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    if recording.state not in {"TRANSCRIBED", "DONE"}:
        raise HTTPException(
            status_code=400,
            detail=f"文字起こしが完了していません。現在の状態: {recording.state}"
        )

    if recording.state == "SUMMARIZING":
        raise HTTPException(
            status_code=409,
            detail="要約処理が既に実行中です"
        )

    try:
        get_summary_template(request.template_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    custom_prompt = (request.custom_prompt or "").strip() or None

    job = Job(
        recording_id=recording_id,
        job_type="summarize",
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        run_summarization_job,
        recording_id=recording_id,
        job_id=job.id,
        db_session_factory=SessionLocal,
        template_name=request.template_name,
        custom_prompt=custom_prompt,
    )

    logger.info(
        "要約ジョブ登録: job_id=%s, recording_id=%s, template=%s, custom_prompt=%s",
        job.id,
        recording_id,
        request.template_name,
        "あり" if custom_prompt else "なし",
    )
    return job


@router.get("/{recording_id}/summary", response_model=SummaryResponse)
def get_summary(
    recording_id: int,
    template_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """要約結果を取得する。"""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail=f"録音 ID={recording_id} が見つかりません")

    summary = None
    if template_name:
        summary = db.query(Summary).filter(
            Summary.recording_id == recording_id,
            Summary.template_name == template_name,
        ).first()
    else:
        preferred_template_name = recording.last_summary_template_name or "general"
        summary = db.query(Summary).filter(
            Summary.recording_id == recording_id,
            Summary.template_name == preferred_template_name,
        ).first()
        if not summary:
            summary = (
                db.query(Summary)
                .filter(Summary.recording_id == recording_id)
                .order_by(Summary.id.desc())
                .first()
            )

    if not summary:
        raise HTTPException(
            status_code=404,
            detail="要約結果がありません。先に要約生成を実行してください。"
        )

    return summary


status_router = APIRouter(prefix="/api", tags=["status"])


@status_router.get("/ollama/status")
async def get_ollama_status():
    """互換性維持のための旧エンドポイント。"""
    return await check_ollama_availability()


@status_router.get("/llm/status")
async def get_llm_status():
    """設定済み LLM ランタイムの稼働状況とモデル利用可否を返す。"""
    return await check_llm_availability()
