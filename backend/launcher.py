"""
launcher.py
配布用バックエンド実行ファイルのエントリーポイント。
uvicorn をリロードなしで起動する。
"""

import os
import logging
import traceback
from datetime import datetime

import uvicorn

logger = logging.getLogger(__name__)


def _emit_startup_log(message: str) -> None:
    log_path = os.getenv("LOCAL_MINUTES_STARTUP_LOG_PATH")
    if not log_path:
        return

    timestamp = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    try:
        with open(log_path, "a", encoding="utf-8") as fp:
            fp.write(f"{timestamp} {message}\n")
    except Exception:
        pass


def main() -> None:
    host = os.getenv("LOCAL_MINUTES_API_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_MINUTES_API_PORT", "8000"))
    log_level = os.getenv("LOCAL_MINUTES_API_LOG_LEVEL", "info")

    try:
        _emit_startup_log(f"launcher:start host={host} port={port} log_level={log_level}")

        if os.getenv("LOCAL_MINUTES_CHECK_FAST_WHISPER_IMPORT") == "1":
            from backend.services.transcription import assert_faster_whisper_importable

            logger.info("faster-whisper import を事前検証します")
            _emit_startup_log("launcher:faster-whisper-import:start")
            assert_faster_whisper_importable()
            _emit_startup_log("launcher:faster-whisper-import:ok")

        from backend.main import app

        _emit_startup_log("launcher:app-import:ok")
        _emit_startup_log("launcher:uvicorn:start")
        uvicorn.run(app, host=host, port=port, log_level=log_level)
    except Exception:
        _emit_startup_log("launcher:error")
        _emit_startup_log(traceback.format_exc().rstrip())
        raise


if __name__ == "__main__":
    main()
