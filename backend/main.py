"""
main.py
FastAPI アプリケーションのエントリーポイント。
セキュリティ要件: 127.0.0.1 のみでリッスンし、外部ネットワークへの通信を一切行わない。
"""

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ─────────────────────────────────────────────
# ログ設定
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# アプリケーションライフサイクル
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """アプリ起動・終了時の処理"""
    # 起動時: データベース初期化
    logger.info("データベースを初期化しています...")
    from .database import init_db
    init_db()
    logger.info("データベース初期化完了")
    logger.info("ローカル AI 議事録作成アプリ バックエンドが起動しました")
    logger.info("API ドキュメント: http://127.0.0.1:8000/docs")

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
        "tauri://localhost",       # Tauri プロダクションビルド
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

app.include_router(recordings_router)
app.include_router(transcripts_router)
app.include_router(summaries_router)
app.include_router(status_router)
app.include_router(jobs_router)


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
        host="127.0.0.1",  # セキュリティ: ローカルホストのみバインド
        port=8000,
        reload=True,
        log_level="info",
    )
