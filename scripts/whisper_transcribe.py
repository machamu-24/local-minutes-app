#!/usr/bin/env python3
"""
faster-whisper を使った音声文字起こしスクリプト

使用方法:
    python3 whisper_transcribe.py <audio_file_path> [--model base] [--language ja]

出力 (stdout):
    JSON形式 { "text": "...", "segments": [{start, end, text}], "language": "ja" }

エラー時:
    stderr にエラーメッセージを出力して exit(1)

モデルサイズの目安:
    tiny   - 最速・低精度（RAM: ~1GB）
    base   - バランス型（RAM: ~1GB）  ← デフォルト
    small  - 高精度（RAM: ~2GB）
    medium - より高精度（RAM: ~5GB）
    large-v3 - 最高精度（RAM: ~10GB）
"""

import sys
import json
import argparse
import os


def transcribe(audio_path: str, model_size: str = "base", language: str = "ja") -> dict:
    """
    faster-whisper で音声ファイルを文字起こしする。

    Parameters
    ----------
    audio_path : str
        音声ファイルのパス（wav, mp3, m4a, webm など）
    model_size : str
        Whisperモデルサイズ（tiny/base/small/medium/large-v3）
    language : str
        言語コード（ja=日本語, en=英語, None=自動検出）

    Returns
    -------
    dict
        { text: str, segments: list[{start, end, text}], language: str }
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError(
            "faster-whisper がインストールされていません。\n"
            "インストール方法: pip install faster-whisper"
        )

    # デバイス選択（GPU利用可能な場合は自動的に使用）
    device = "cpu"
    compute_type = "int8"

    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
    except ImportError:
        pass

    # Apple Silicon (MPS) の場合
    try:
        import torch
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            # faster-whisper は MPS 未対応のため CPU を使用
            device = "cpu"
            compute_type = "int8"
    except ImportError:
        pass

    print(f"[whisper] モデル: {model_size}, デバイス: {device}, 言語: {language}", file=sys.stderr)

    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    transcribe_kwargs = {
        "beam_size": 5,
        "vad_filter": True,
        "vad_parameters": {
            "min_silence_duration_ms": 500,
        },
    }
    if language and language != "auto":
        transcribe_kwargs["language"] = language

    segments_iter, info = model.transcribe(audio_path, **transcribe_kwargs)

    result_segments = []
    full_text_parts = []

    for seg in segments_iter:
        text = seg.text.strip()
        if text:
            result_segments.append({
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": text,
            })
            full_text_parts.append(text)

    return {
        "text": " ".join(full_text_parts),
        "segments": result_segments,
        "language": info.language,
    }


def main():
    parser = argparse.ArgumentParser(description="faster-whisper 文字起こしスクリプト")
    parser.add_argument("audio_path", help="音声ファイルのパス")
    parser.add_argument("--model", default="base", help="モデルサイズ (tiny/base/small/medium/large-v3)")
    parser.add_argument("--language", default="ja", help="言語コード (ja/en/auto)")
    args = parser.parse_args()

    if not os.path.exists(args.audio_path):
        print(json.dumps({"error": f"ファイルが見つかりません: {args.audio_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        result = transcribe(args.audio_path, args.model, args.language)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
