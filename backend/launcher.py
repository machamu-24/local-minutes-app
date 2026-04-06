"""
launcher.py
配布用バックエンド実行ファイルのエントリーポイント。
uvicorn をリロードなしで起動する。
"""

import os

import uvicorn

from backend.main import app


def main() -> None:
    host = os.getenv("LOCAL_MINUTES_API_HOST", "127.0.0.1")
    port = int(os.getenv("LOCAL_MINUTES_API_PORT", "8000"))
    log_level = os.getenv("LOCAL_MINUTES_API_LOG_LEVEL", "info")
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
