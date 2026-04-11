"""
database.py
SQLAlchemy を使用したデータベース接続設定。
SQLite をローカルファイルとして使用し、外部通信を一切行わない。
"""

import logging
import os
import sys
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


def _make_sqlite_url(db_path: Path) -> str:
    """
    SQLite 接続 URL をクロスプラットフォームで安全に生成する。

    Windows では Path.as_posix() が 'C:/path/to/db' を返すため
    sqlite:///C:/path/to/db という正しい形式になる。
    Linux/macOS では '/path/to/db' を返すため
    sqlite:////path/to/db という正しい絶対パス形式になる。
    """
    posix_path = db_path.as_posix()
    # Windows の絶対パス (例: C:/...) は sqlite:///C:/... と 3 スラッシュ
    # Unix の絶対パス (例: /home/...) は sqlite:////home/... と 4 スラッシュ
    # as_posix() の結果をそのまま連結すると両方正しく処理される
    return f"sqlite:///{posix_path}"


APP_DATA_DIR = _resolve_app_data_dir()
try:
    APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    logger.error(
        "アプリデータディレクトリの作成に失敗しました: %s (%s)",
        APP_DATA_DIR,
        exc,
    )
    raise

# 音声ファイル保存ディレクトリ
AUDIO_DIR = Path(
    os.getenv("LOCAL_MINUTES_AUDIO_DIR", str(APP_DATA_DIR / "audio"))
).expanduser()
try:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    logger.warning("音声ディレクトリの作成に失敗しました: %s (%s)", AUDIO_DIR, exc)

# Whisper モデルキャッシュ
WHISPER_MODELS_DIR = Path(
    os.getenv("LOCAL_MINUTES_WHISPER_MODELS_DIR", str(APP_DATA_DIR / "models" / "whisper"))
).expanduser()
try:
    WHISPER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    logger.warning("Whisper モデルディレクトリの作成に失敗しました: %s (%s)", WHISPER_MODELS_DIR, exc)

# SQLite データベースファイルパス
DATABASE_PATH = Path(
    os.getenv("LOCAL_MINUTES_DATABASE_PATH", str(APP_DATA_DIR / "minutes.db"))
).expanduser()
try:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    logger.error(
        "データベースディレクトリの作成に失敗しました: %s (%s)",
        DATABASE_PATH.parent,
        exc,
    )
    raise

DATABASE_URL = os.getenv(
    "LOCAL_MINUTES_DATABASE_URL",
    _make_sqlite_url(DATABASE_PATH),
)

logger.debug(
    "データベース設定: path=%s url=%s platform=%s",
    DATABASE_PATH,
    DATABASE_URL,
    sys.platform,
)

# SQLAlchemy エンジン作成
# check_same_thread=False は SQLite の非同期利用に必要
# timeout=30: 他のプロセスがロックを保持している場合、最大30秒待機する
#   (バックエンド再起動時の "database is locked" エラーを防ぐ)
engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,  # SQLite busy timeout (秒)
    },
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


def _cleanup_stale_wal_files() -> None:
    """
    前回のプロセスが異常終了した際に残存する WAL / SHM ファイルを削除する。
    プロセスが存在しない状態で WAL ファイルが残っていると
    次回起動時に "database is locked" エラーが発生する場合がある。
    """
    for suffix in ("-wal", "-shm", "-journal"):
        stale = DATABASE_PATH.parent / (DATABASE_PATH.name + suffix)
        if stale.exists():
            try:
                stale.unlink()
                logger.info("古い WAL/SHM ファイルを削除しました: %s", stale)
            except OSError as exc:
                logger.warning("古い WAL/SHM ファイルの削除に失敗しました: %s (%s)", stale, exc)


def init_db():
    """
    データベースの初期化（テーブル作成）。
    アプリ起動時に呼び出す。
    """
    logger.info(
        "データベースを初期化しています: %s (platform=%s)",
        DATABASE_PATH,
        sys.platform,
    )
    # 前回起動時の残存 WAL ファイルをクリーンアップ
    _cleanup_stale_wal_files()
    # models をインポートしてテーブル定義を登録
    from . import models  # noqa: F401
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        logger.error(
            "データベーステーブルの作成に失敗しました: %s\n"
            "  DATABASE_PATH: %s\n"
            "  DATABASE_URL: %s\n"
            "  APP_DATA_DIR exists: %s\n"
            "  platform: %s",
            exc,
            DATABASE_PATH,
            DATABASE_URL,
            APP_DATA_DIR.exists(),
            sys.platform,
        )
        raise
    # WAL モードを有効化する（複数プロセスからの同時アクセスを安全に処理）
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))
        conn.execute(text("PRAGMA busy_timeout=30000"))  # 30秒
        conn.commit()
    _ensure_column_exists("recordings", "last_summary_template_name", "VARCHAR(50)")
    _ensure_column_exists("summaries", "prompt_snapshot", "TEXT")
    logger.info("データベース初期化完了: %s", DATABASE_PATH)


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
