"""
main.py
FastAPI アプリケーションのエントリーポイント。
セキュリティ要件: 127.0.0.1 のみでリッスンし、外部ネットワークへの通信を一切行わない。
"""

import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─────────────────────────────────────────────
# Windows 用の安全な標準出力・エラー出力ラッパー
# (Tauri sidecar 実行時の OSError: [Errno 22] 対策)
# ─────────────────────────────────────────────
class SafeStream:
    def __init__(self, stream):
        self.stream = stream

    def write(self, data):
        try:
            if self.stream is not None:
                self.stream.write(data)
        except Exception:
            pass

    def flush(self):
        try:
            if self.stream is not None:
                self.stream.flush()
        except Exception:
            pass

    def isatty(self):
        try:
            if getattr(self.stream, "isatty", None):
                return self.stream.isatty()
        except Exception:
            pass
        return False

    def fileno(self):
        try:
            if getattr(self.stream, "fileno", None):
                return self.stream.fileno()
        except Exception:
            pass
        raise OSError("SafeStream has no fileno")

    def __getattr__(self, attr):
        if self.stream is not None:
            return getattr(self.stream, attr)
        raise AttributeError(f"'SafeStream' object has no attribute '{attr}'")

if sys.platform == "win32":
    sys.stdout = SafeStream(sys.stdout)
    sys.stderr = SafeStream(sys.stderr)

# ─────────────────────────────────────────────
# ログ設定
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stderr),
    ],
)
logger = logging.getLogger(__name__)


def runtime_host() -> str:
    return os.getenv("LOCAL_MINUTES_API_HOST", "127.0.0.1")


def runtime_port() -> str:
    return os.getenv("LOCAL_MINUTES_API_PORT", "8000")


# ─────────────────────────────────────────────
# アプリケーションライフサイクル
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリ起動・終了時の処理"""
    import sys
    logger.info(
        "バックエンド起動中: host=%s port=%s platform=%s python=%s",
        runtime_host(),
        runtime_port(),
        sys.platform,
        sys.version,
    )
    # 起動時: データベース初期化
    from .database import init_db, APP_DATA_DIR, DATABASE_PATH
    logger.info("アプリデータディレクトリ: %s", APP_DATA_DIR)
    logger.info("データベースパス: %s", DATABASE_PATH)
    init_db()
    logger.info("ローカル AI 議事録作成アプリ バックエンドが起動しました")
    logger.info("API ドキュメント: http://%s:%s/docs", runtime_host(), runtime_port())

    yield

    # 終了時の処理（必要に応じて追加）
    logger.info("バックエンドを終了します")


# ─────────────────────────────────────────────
# FastAPI アプリケーション
# ─────────────────────────────────────────────

app = FastAPI(
    title="ローカル AI 議事録作成アプリ",
    description=(
        "医療現場など個人情報保護が厳しい環境向けに、"
        "完全ローカルで動作する議事録作成 API。"
        "外部通信は一切行わない。"
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─────────────────────────────────────────────
# CORS 設定（Tauri / ローカル開発用）
# localhost のみ許可、外部オリジンは拒否
# ─────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",   # Tauri デフォルトポート
        "http://localhost:5173",   # Vite 開発サーバー
        "http://127.0.0.1:1420",
        "http://127.0.0.1:5173",
        "tauri://localhost",       # Tauri プロダクションビルド (macOS / Linux)
        "http://tauri.localhost",  # Tauri プロダクションビルド (Windows)
        "https://tauri.localhost", # Tauri プロダクションビルド (Windows HTTPS モード)
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# ルーター登録
# ─────────────────────────────────────────────
from .routers.recordings import router as recordings_router
from .routers.transcripts import router as transcripts_router
from .routers.summaries import router as summaries_router, status_router
from .routers.jobs import router as jobs_router
from .routers.runtime import router as runtime_router

app.include_router(summaries_router)
app.include_router(transcripts_router)
app.include_router(recordings_router)
app.include_router(status_router)
app.include_router(jobs_router)
app.include_router(runtime_router)


# ─────────────────────────────────────────────
# ヘルスチェック
# ─────────────────────────────────────────────

@app.get("/api/health", tags=["health"])
async def health_check():
    """API サーバーの稼働確認エンドポイント。"""
    return {
        "status": "ok",
        "message": "ローカル AI 議事録作成アプリ バックエンドが正常に動作しています",
        "version": "1.0.0",
    }


# ─────────────────────────────────────────────
# 起動スクリプト（直接実行時）
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=runtime_host(),  # セキュリティ: ローカルホストのみバインド
        port=int(runtime_port()),
        reload=True,
        log_level="info",
    )
