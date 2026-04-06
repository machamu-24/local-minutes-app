"""
runtime.py
配布版アプリ向けのローカル runtime 管理 API。
- 実行環境の確認
- Whisper モデルの事前ダウンロード
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from ..database import APP_DATA_DIR, AUDIO_DIR, WHISPER_MODELS_DIR
from ..schemas import (
    MessageResponse,
    PrepareWhisperModelRequest,
    RuntimeEnvironmentResponse,
)
from ..services.audio import get_ffmpeg_executable, get_ffprobe_executable
from ..services.transcription import (
    DEFAULT_WHISPER_MODEL,
    SUPPORTED_WHISPER_MODELS,
    ensure_whisper_model_available,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runtime", tags=["runtime"])


@router.get("/status", response_model=RuntimeEnvironmentResponse)
def get_runtime_environment():
    """ローカル runtime の配置先と利用モデル設定を返す。"""
    return RuntimeEnvironmentResponse(
        app_data_dir=str(APP_DATA_DIR),
        audio_dir=str(AUDIO_DIR),
        whisper_models_dir=str(WHISPER_MODELS_DIR),
        ffmpeg_path=get_ffmpeg_executable(),
        ffprobe_path=get_ffprobe_executable(),
        default_whisper_model=DEFAULT_WHISPER_MODEL,
        supported_whisper_models=list(SUPPORTED_WHISPER_MODELS),
    )


@router.post("/whisper/prepare", response_model=MessageResponse)
async def prepare_whisper_model(request: PrepareWhisperModelRequest):
    """指定 Whisper モデルを事前ダウンロードしてオフライン利用可能にする。"""
    model_name = request.model
    if model_name not in SUPPORTED_WHISPER_MODELS:
        raise HTTPException(
            status_code=400,
            detail=(
                "未対応の Whisper モデルです。"
                f"指定可能: {', '.join(SUPPORTED_WHISPER_MODELS)}"
            ),
        )

    logger.info("Whisper モデルを事前取得します: %s", model_name)
    loop = asyncio.get_running_loop()
    cache_dir = await loop.run_in_executor(None, ensure_whisper_model_available, model_name)
    logger.info("Whisper モデルの事前取得が完了しました: %s", model_name)

    return MessageResponse(
        message="Whisper モデルを準備しました",
        detail=f"model={model_name} / cache={cache_dir}",
    )
