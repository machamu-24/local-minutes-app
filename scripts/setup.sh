#!/bin/bash
# AI議事録アプリ（ローカル版）セットアップスクリプト
# 対応OS: macOS, Linux

set -e

echo "========================================"
echo "  AI議事録アプリ セットアップ"
echo "========================================"
echo ""

# Python確認
echo "▶ Pythonの確認..."
if ! command -v python3 &>/dev/null; then
    echo "❌ Python3 が見つかりません"
    echo "   macOS: brew install python3"
    echo "   Ubuntu: sudo apt install python3 python3-pip"
    exit 1
fi
PYTHON_VERSION=$(python3 --version)
echo "✅ $PYTHON_VERSION"

# pip確認
echo ""
echo "▶ pipの確認..."
if ! command -v pip3 &>/dev/null && ! python3 -m pip --version &>/dev/null; then
    echo "❌ pip が見つかりません"
    echo "   macOS: brew install python3"
    echo "   Ubuntu: sudo apt install python3-pip"
    exit 1
fi
echo "✅ pip OK"

# faster-whisperのインストール
echo ""
echo "▶ faster-whisper のインストール..."
if python3 -c "import faster_whisper" 2>/dev/null; then
    echo "✅ faster-whisper は既にインストール済みです"
else
    echo "   インストール中..."
    pip3 install faster-whisper
    echo "✅ faster-whisper のインストール完了"
fi

# Ollamaの確認
echo ""
echo "▶ Ollama の確認..."
if command -v ollama &>/dev/null; then
    echo "✅ Ollama はインストール済みです"
    
    # モデルの確認
    echo ""
    echo "▶ インストール済みモデルの確認..."
    if ollama list 2>/dev/null | grep -q "llama3"; then
        echo "✅ llama3 モデルが見つかりました"
    else
        echo "⚠️  推奨モデルが見つかりません"
        echo "   以下のコマンドでモデルをダウンロードしてください:"
        echo ""
        echo "   # 軽量モデル（推奨・RAM 8GB以上）"
        echo "   ollama pull llama3.2"
        echo ""
        echo "   # 高精度モデル（RAM 16GB以上）"
        echo "   ollama pull llama3.1:8b"
        echo ""
        echo "   # 日本語特化モデル（RAM 8GB以上）"
        echo "   ollama pull qwen2.5:7b"
    fi
else
    echo "❌ Ollama が見つかりません"
    echo ""
    echo "   インストール方法:"
    echo "   macOS: brew install ollama"
    echo "   または https://ollama.ai からダウンロード"
    echo ""
    echo "   インストール後:"
    echo "   ollama pull llama3.2"
    echo "   ollama serve"
fi

# Whisperスクリプトのコピー
echo ""
echo "▶ Whisperスクリプトのセットアップ..."
SCRIPT_DIR="$HOME/Library/Application Support/minutes-app-local/scripts"
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    SCRIPT_DIR="$HOME/.local/share/minutes-app-local/scripts"
fi
mkdir -p "$SCRIPT_DIR"
SCRIPT_PATH="$(dirname "$0")/whisper_transcribe.py"
if [ -f "$SCRIPT_PATH" ]; then
    cp "$SCRIPT_PATH" "$SCRIPT_DIR/"
    echo "✅ スクリプトをコピーしました: $SCRIPT_DIR/whisper_transcribe.py"
else
    echo "⚠️  スクリプトが見つかりません: $SCRIPT_PATH"
fi

echo ""
echo "========================================"
echo "  セットアップ完了"
echo "========================================"
echo ""
echo "アプリを起動する前に Ollama を起動してください:"
echo "  ollama serve"
echo ""
