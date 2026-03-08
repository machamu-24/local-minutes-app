"""
database.py
SQLAlchemy を使用したデータベース接続設定。
SQLite をローカルファイルとして使用し、外部通信を一切行わない。
"""

import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# アプリ専用データディレクトリ（~/.local-minutes/）
APP_DATA_DIR = Path.home() / ".local-minutes"
APP_DATA_DIR.mkdir(parents=True, exist_ok=True)

# 音声ファイル保存ディレクトリ
AUDIO_DIR = APP_DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# SQLite データベースファイルパス
DATABASE_URL = f"sqlite:///{APP_DATA_DIR / 'minutes.db'}"

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
