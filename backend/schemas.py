"""
schemas.py
Pydantic スキーマ定義。
API のリクエスト・レスポンスのバリデーションと型安全性を確保する。
"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────
# Recording スキーマ
# ─────────────────────────────────────────────

class RecordingBase(BaseModel):
    """録音基本情報の共通フィールド"""
    title: str = Field(..., description="会議名", min_length=1, max_length=255)
    meeting_date: Optional[date] = Field(None, description="会議日")


class RecordingCreate(RecordingBase):
    """録音作成時のスキーマ（音声ファイルアップロード後に使用）"""
    audio_path: Optional[str] = Field(None, description="元音声ファイルパス")
    wav_path: Optional[str] = Field(None, description="変換後WAVファイルパス")


class RecordingResponse(RecordingBase):
    """録音情報のレスポンススキーマ"""
    id: int
    audio_path: Optional[str]
    wav_path: Optional[str]
    state: str = Field(description="処理状態: IMPORTED/TRANSCRIBING/TRANSCRIBED/SUMMARIZING/DONE")
    audio_status: str = Field(description="音声ファイル状態: PENDING/DELETED/RETAINED")
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    """録音一覧レスポンス"""
    recordings: List[RecordingResponse]
    total: int


# ─────────────────────────────────────────────
# Transcript スキーマ
# ─────────────────────────────────────────────

class TranscriptResponse(BaseModel):
    """文字起こし結果のレスポンススキーマ"""
    id: int
    recording_id: int
    text_raw: Optional[str] = Field(None, description="生文字起こしテキスト")
    text_edited: Optional[str] = Field(None, description="ユーザー修正後テキスト")
    segments_json: Optional[str] = Field(None, description="タイムスタンプ付きセグメント（JSON）")

    class Config:
        from_attributes = True


class TranscriptUpdate(BaseModel):
    """文字起こし修正保存のリクエストスキーマ"""
    text_edited: str = Field(..., description="修正後テキスト", min_length=1)


# ─────────────────────────────────────────────
# Summary スキーマ
# ─────────────────────────────────────────────

class SummaryResponse(BaseModel):
    """要約結果のレスポンススキーマ"""
    id: int
    recording_id: int
    template_name: str = Field(description="テンプレート名")
    content_md: Optional[str] = Field(None, description="Markdown形式の議事録")

    class Config:
        from_attributes = True


class SummarizeRequest(BaseModel):
    """要約生成リクエストスキーマ"""
    template_name: str = Field(
        default="general",
        description="テンプレート名（general / conference 等）"
    )


# ─────────────────────────────────────────────
# Job スキーマ
# ─────────────────────────────────────────────

class JobResponse(BaseModel):
    """ジョブ状態のレスポンススキーマ"""
    id: int
    recording_id: int
    job_type: str = Field(description="ジョブ種別: transcribe / summarize")
    status: str = Field(description="ジョブ状態: pending / running / done / error")
    log: Optional[str] = Field(None, description="エラーログ等")
    created_at: datetime

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────
# 音声削除・保持スキーマ
# ─────────────────────────────────────────────

class AudioDeleteRequest(BaseModel):
    """音声ファイル削除リクエスト（確認済みフラグ必須）"""
    confirmed: bool = Field(..., description="削除確認フラグ（必ず True を送信すること）")


class AudioRetainRequest(BaseModel):
    """音声ファイル保持リクエスト"""
    reason: Optional[str] = Field(None, description="保持理由（任意）")


# ─────────────────────────────────────────────
# 汎用レスポンス
# ─────────────────────────────────────────────

class MessageResponse(BaseModel):
    """汎用メッセージレスポンス"""
    message: str
    detail: Optional[str] = None


class ImportResponse(BaseModel):
    """音声ファイル取り込みレスポンス"""
    recording: RecordingResponse
    job: JobResponse
