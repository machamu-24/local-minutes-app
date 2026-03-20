#!/bin/bash
# ローカル AI 議事録作成アプリ 起動スクリプト
# macOS / Linux 対応

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_VENV="$SCRIPT_DIR/backend/.venv"
cd "$SCRIPT_DIR"

install_backend_requirements() {
  pip install --upgrade pip -q
  pip install -r backend/requirements.txt -q
}

backend_imports_ok() {
  python3 - <<'PY' > /dev/null 2>&1
import importlib

for name in ("fastapi", "uvicorn", "sqlalchemy", "httpx", "requests", "faster_whisper"):
    importlib.import_module(name)
PY
}

echo "=========================================="
echo "  ローカル AI 議事録作成アプリ"
echo "=========================================="
echo ""

if [ -n "${VIRTUAL_ENV:-}" ] && [ "$VIRTUAL_ENV" != "$BACKEND_VENV" ]; then
  echo "別の仮想環境が有効です: $VIRTUAL_ENV"
  echo "deactivate してから ./start.sh を実行してください。"
  exit 1
fi

# Python 仮想環境の確認・作成
if [ ! -d "backend/.venv" ]; then
  echo "[1/3] Python 仮想環境を作成しています..."
  python3 -m venv backend/.venv
  source backend/.venv/bin/activate
  install_backend_requirements
  echo "      完了"
else
  source backend/.venv/bin/activate
  if ! backend_imports_ok; then
    echo "[1/3] Python 仮想環境の依存関係を修復しています..."
    install_backend_requirements
    if ! backend_imports_ok; then
      echo "      backend/.venv の修復に失敗しました"
      echo "      backend/.venv を削除して、別の仮想環境を無効化した状態で ./start.sh を実行してください"
      exit 1
    fi
    echo "      修復完了"
  fi
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
