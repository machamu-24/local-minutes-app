"""
launcher.py
配布用バックエンド実行ファイルのエントリーポイント。
uvicorn をリロードなしで起動する。
"""

import os
import logging

import uvicorn

from backend.main import app
from backend.services.transcription import assert_faster_whisper_importable


logger = logging.getLogger(__name__)


def main() -> None:
    host = os.getenv("LOCAL_MINUTES_API_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_MINUTES_API_PORT", "8000"))
    log_level = os.getenv("LOCAL_MINUTES_API_LOG_LEVEL", "info")
    if os.getenv("LOCAL_MINUTES_CHECK_FAST_WHISPER_IMPORT") == "1":
        logger.info("faster-whisper import を事前検証します")
        assert_faster_whisper_importable()
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
