"""
models.py
SQLAlchemy ORM モデル定義。
要件定義書に基づく4テーブル構成：
  - recordings: 会議単位の基本情報
  - transcripts: 文字起こし結果
  - summaries: 要約結果（Markdown形式）
  - jobs: 非同期処理管理
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


class Recording(Base):
    """
    recordings テーブル
    会議単位の基本情報と処理状態を管理する。
    """
    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(255), nullable=False, comment="会議名")
    meeting_date = Column(Date, nullable=True, comment="会議日")
    audio_path = Column(Text, nullable=True, comment="元音声ファイルパス")
    wav_path = Column(Text, nullable=True, comment="変換後WAVファイルパス")

    # 処理状態: IMPORTED / TRANSCRIBING / TRANSCRIBED / SUMMARIZING / DONE
    state = Column(
        String(20),
        nullable=False,
        default="IMPORTED",
        comment="処理状態"
    )

    # 音声ファイル状態: PENDING / DELETED / RETAINED
    audio_status = Column(
        String(20),
        nullable=False,
        default="PENDING",
        comment="音声ファイル状態"
    )

    created_at = Column(DateTime, default=datetime.utcnow, comment="作成日時")
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        comment="更新日時"
    )

    # リレーション
    transcript = relationship(
        "Transcript", back_populates="recording", uselist=False, cascade="all, delete-orphan"
    )
    summaries = relationship(
        "Summary", back_populates="recording", cascade="all, delete-orphan"
    )
    jobs = relationship(
        "Job", back_populates="recording", cascade="all, delete-orphan"
    )


class Transcript(Base):
    """
    transcripts テーブル
    文字起こし結果（生テキスト・編集済みテキスト・タイムスタンプ付きセグメント）を管理する。
    """
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    recording_id = Column(
        Integer,
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        comment="録音ID（FK）"
    )
    text_raw = Column(Text, nullable=True, comment="生文字起こしテキスト")
    text_edited = Column(Text, nullable=True, comment="ユーザー修正後テキスト")
    segments_json = Column(
        Text, nullable=True, comment="タイムスタンプ付きセグメント（JSON）"
    )

    # リレーション
    recording = relationship("Recording", back_populates="transcript")


class Summary(Base):
    """
    summaries テーブル
    要約結果（Markdown形式の議事録）を管理する。
    テンプレートごとに複数の要約を保持できる設計（拡張性考慮）。
    """
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    recording_id = Column(
        Integer,
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        comment="録音ID（FK）"
    )
    # テンプレート名: general（汎用）/ conference（会議）等（将来拡張用）
    template_name = Column(
        String(50), nullable=False, default="general", comment="テンプレート名"
    )
    content_md = Column(Text, nullable=True, comment="Markdown形式の議事録")

    # リレーション
    recording = relationship("Recording", back_populates="summaries")


class Job(Base):
    """
    jobs テーブル
    非同期処理（文字起こし・要約）の状態管理。
    """
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    recording_id = Column(
        Integer,
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        comment="録音ID（FK）"
    )
    # ジョブ種別: transcribe / summarize
    job_type = Column(String(20), nullable=False, comment="ジョブ種別")
    # ジョブ状態: pending / running / done / error
    status = Column(
        String(20), nullable=False, default="pending", comment="ジョブ状態"
    )
    log = Column(Text, nullable=True, comment="エラーログ等")
    created_at = Column(DateTime, default=datetime.utcnow, comment="作成日時")

    # リレーション
    recording = relationship("Recording", back_populates="jobs")
