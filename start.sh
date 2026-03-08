#!/bin/bash
# ローカル AI 議事録作成アプリ 起動スクリプト
# macOS / Linux 対応

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "  ローカル AI 議事録作成アプリ"
echo "=========================================="
echo ""

# Python 仮想環境の確認・作成
if [ ! -d "backend/.venv" ]; then
  echo "[1/3] Python 仮想環境を作成しています..."
  python3 -m venv backend/.venv
  source backend/.venv/bin/activate
  pip install --upgrade pip -q
  pip install -r backend/requirements.txt -q
  echo "      完了"
else
  source backend/.venv/bin/activate
fi

# Ollama の起動確認
echo "[2/3] Ollama の起動を確認しています..."
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "      Ollama が起動していません。バックグラウンドで起動します..."
  ollama serve &
  sleep 3
  echo "      Ollama 起動完了"
else
  echo "      Ollama は既に起動しています"
fi

# FastAPI バックエンドを起動
echo "[3/3] バックエンドを起動しています..."
echo ""
echo "  API サーバー: http://127.0.0.1:8000"
echo "  API ドキュメント: http://127.0.0.1:8000/docs"
echo ""
echo "  フロントエンドは別ターミナルで以下を実行してください:"
echo "  cd frontend && pnpm dev"
echo ""
echo "  または Tauri アプリとして起動する場合:"
echo "  pnpm tauri dev"
echo ""
echo "  Ctrl+C で終了"
echo "=========================================="

python3 -m uvicorn backend.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --log-level info
