"""
services/audio.py
ffmpeg を使用した音声前処理サービス。
対応形式: wav, mp3, m4a, webm, ogg, mp4
変換後: 16kHz / mono / WAV 形式でアプリ専用ディレクトリに保存する。
外部通信は一切行わない（ローカル処理のみ）。
"""

import os
import shutil
import subprocess
import uuid
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

SUPPORTED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".mp4"}
SUPPORTED_AUDIO_FORMATS_TEXT = "wav, mp3, m4a, webm, ogg, mp4"


def get_audio_dir() -> Path:
    """
    音声ファイル保存ディレクトリを返す。
    ~/.local-minutes/audio/ を使用する。
    """
    from ..database import AUDIO_DIR
    return AUDIO_DIR


def get_ffmpeg_executable() -> str:
    """
    ffmpeg 実行ファイルのパスを返す。
    優先順:
    1. LOCAL_MINUTES_FFMPEG_PATH
    2. imageio-ffmpeg が提供する同梱バイナリ
    3. PATH 上の ffmpeg
    """
    configured = os.getenv("LOCAL_MINUTES_FFMPEG_PATH")
    if configured:
        return configured

    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        return get_ffmpeg_exe()
    except Exception as exc:
        logger.debug("imageio-ffmpeg の解決に失敗しました: %s", exc)

    return "ffmpeg"


def get_ffprobe_executable() -> Optional[str]:
    """
    ffprobe 実行ファイルのパスを返す。未解決の場合は None。
    """
    configured = os.getenv("LOCAL_MINUTES_FFPROBE_PATH")
    if configured:
        return configured

    if resolved := shutil.which("ffprobe"):
        return resolved

    ffmpeg_path = os.getenv("LOCAL_MINUTES_FFMPEG_PATH")
    if ffmpeg_path:
        ffmpeg_dir = Path(ffmpeg_path).expanduser().parent
        probe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
        candidate = ffmpeg_dir / probe_name
        if candidate.exists():
            return str(candidate)

    return None


def validate_audio_format(file_path: str) -> bool:
    """
    音声ファイルの形式を検証する。
    対応形式: wav, mp3, m4a, webm, ogg, mp4

    Args:
        file_path: 検証対象のファイルパス

    Returns:
        bool: 対応形式であれば True
    """
    ext = Path(file_path).suffix.lower()
    return ext in SUPPORTED_AUDIO_EXTENSIONS


def convert_to_wav(input_path: str, output_filename: str = None) -> Tuple[str, str]:
    """
    ffmpeg を使用して音声ファイルを 16kHz / mono / WAV に変換する。

    Args:
        input_path: 入力音声ファイルパス
        output_filename: 出力ファイル名（省略時は UUID を使用）

    Returns:
        Tuple[str, str]: (元ファイルパス, 変換後WAVファイルパス)

    Raises:
        ValueError: 非対応形式の場合
        FileNotFoundError: 入力ファイルが存在しない場合
        RuntimeError: ffmpeg 変換失敗の場合
    """
    input_path = str(input_path)

    # ファイル存在確認
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"音声ファイルが見つかりません: {input_path}")

    # 形式検証
    if not validate_audio_format(input_path):
        raise ValueError(
            f"非対応の音声形式です。対応形式: {SUPPORTED_AUDIO_FORMATS_TEXT} / 指定ファイル: {input_path}"
        )

    # 出力ファイルパスの決定
    audio_dir = get_audio_dir()
    if output_filename is None:
        output_filename = f"{uuid.uuid4().hex}.wav"
    elif not output_filename.endswith(".wav"):
        output_filename += ".wav"

    output_path = str(audio_dir / output_filename)

    # ffmpeg コマンド構築
    # -i: 入力ファイル
    # -ar 16000: サンプリングレート 16kHz
    # -ac 1: モノラル（チャンネル数 1）
    # -f wav: WAV 形式で出力
    # -y: 上書き確認なし
    cmd = [
        get_ffmpeg_executable(),
        "-i", input_path,
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        "-y",
        output_path
    ]

    logger.info(f"ffmpeg 変換開始: {input_path} -> {output_path}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5分タイムアウト
        )

        if result.returncode != 0:
            error_msg = result.stderr[:500] if result.stderr else "不明なエラー"
            logger.error(f"ffmpeg 変換失敗: {error_msg}")
            raise RuntimeError(f"ffmpeg 変換に失敗しました: {error_msg}")

        logger.info(f"ffmpeg 変換完了: {output_path}")
        return input_path, output_path

    except subprocess.TimeoutExpired:
        logger.error("ffmpeg 変換タイムアウト（5分超過）")
        raise RuntimeError("ffmpeg 変換がタイムアウトしました（5分超過）")
    except FileNotFoundError:
        logger.error("ffmpeg がインストールされていません")
        raise RuntimeError(
            "ffmpeg 実行ファイルを解決できませんでした。"
            "LOCAL_MINUTES_FFMPEG_PATH を確認してください。"
        )


def delete_audio_file(file_path: str) -> bool:
    """
    音声ファイルを削除する。
    ファイルが存在しない場合もエラーにしない（冪等性の確保）。

    Args:
        file_path: 削除対象のファイルパス

    Returns:
        bool: 削除実行（またはファイル不存在）の場合 True
    """
    if not file_path:
        logger.warning("削除対象のファイルパスが空です")
        return True

    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"音声ファイル削除完了: {file_path}")
        else:
            logger.info(f"音声ファイルは既に存在しません（削除済み扱い）: {file_path}")
        return True
    except OSError as e:
        logger.error(f"音声ファイル削除エラー: {file_path} / {e}")
        return False


def get_audio_duration(file_path: str) -> float:
    """
    ffprobe を使用して音声ファイルの長さ（秒）を取得する。
    （将来の UI 表示用、MVP では任意使用）

    Args:
        file_path: 音声ファイルパス

    Returns:
        float: 音声長さ（秒）、取得失敗時は -1.0
    """
    try:
        ffprobe_path = get_ffprobe_executable()
        if not ffprobe_path:
            return -1.0

        cmd = [
            ffprobe_path,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception as e:
        logger.warning(f"音声長さ取得失敗: {e}")
    return -1.0
