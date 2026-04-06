"""
database.py
SQLAlchemy を使用したデータベース接続設定。
SQLite をローカルファイルとして使用し、外部通信を一切行わない。
"""

import logging
import os
from pathlib import Path
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

# アプリ専用データディレクトリ
def _resolve_app_data_dir() -> Path:
    configured_dir = (
        os.getenv("LOCAL_MINUTES_APP_DATA_DIR")
        or os.getenv("LOCAL_MINUTES_DATA_DIR")
    )
    if configured_dir:
        return Path(configured_dir).expanduser()

    return Path.home() / ".local-minutes"


APP_DATA_DIR = _resolve_app_data_dir()
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

# 音声ファイル保存ディレクトリ
AUDIO_DIR = Path(
    os.getenv("LOCAL_MINUTES_AUDIO_DIR", str(APP_DATA_DIR / "audio"))
).expanduser()
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Whisper モデルキャッシュ
WHISPER_MODELS_DIR = Path(
    os.getenv("LOCAL_MINUTES_WHISPER_MODELS_DIR", str(APP_DATA_DIR / "models" / "whisper"))
).expanduser()
WHISPER_MODELS_DIR.mkdir(parents=True, exist_ok=True)

# SQLite データベースファイルパス
DATABASE_PATH = Path(
    os.getenv("LOCAL_MINUTES_DATABASE_PATH", str(APP_DATA_DIR / "minutes.db"))
).expanduser()
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv(
    "LOCAL_MINUTES_DATABASE_URL",
    f"sqlite:///{DATABASE_PATH.as_posix()}",
)

# SQLAlchemy エンジン作成
# check_same_thread=False は SQLite の非同期利用に必要
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,  # SQLログ出力（デバッグ時は True に変更）
)

# セッションファクトリ
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ORM ベースクラス
Base = declarative_base()


def get_db():
    """
    FastAPI の依存性注入で使用するデータベースセッションジェネレーター。
    リクエスト終了時に自動的にセッションをクローズする。
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    データベースの初期化（テーブル作成）。
    アプリ起動時に呼び出す。
    """
    # models をインポートしてテーブル定義を登録
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _ensure_column_exists("recordings", "last_summary_template_name", "VARCHAR(50)")
    _ensure_column_exists("summaries", "prompt_snapshot", "TEXT")


def _ensure_column_exists(table_name: str, column_name: str, column_definition: str) -> None:
    """
    既存 SQLite に不足カラムがあれば追加する。
    Alembic 未導入のため、起動時に軽量マイグレーションとして補完する。
    """
    inspector = inspect(engine)
    if table_name not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return

    logger.info("DB スキーマ更新: %s.%s を追加します", table_name, column_name)
    with engine.begin() as connection:
        connection.execute(
            text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")
        )
