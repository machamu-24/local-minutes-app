#!/bin/bash
# ローカル AI 議事録作成アプリ 起動スクリプト
# macOS / Linux 対応

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_VENV="$SCRIPT_DIR/backend/.venv"
BACKEND_PORT="8000"
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

backend_app_imports_ok() {
  python3 - <<'PY'
import traceback

try:
    import backend.main
except Exception:
    traceback.print_exc()
    raise SystemExit(1)
PY
}

backend_port_in_use() {
  lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN > /dev/null 2>&1
}

print_backend_port_usage() {
  lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN || true
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

if ! backend_app_imports_ok; then
  echo "      バックエンドの起動前チェックに失敗しました"
  exit 1
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

if backend_port_in_use; then
  echo "      127.0.0.1:$BACKEND_PORT は別プロセスが使用中です"
  print_backend_port_usage
  echo "      このアプリのバックエンドが既に起動しているか、別アプリが 8000 番ポートを使っています"
  echo "      既存プロセスを停止するか、ポート競合を解消してから再実行してください"
  exit 1
fi

echo ""
echo "  API サーバー: http://127.0.0.1:8000"
echo "  API ドキュメント: http://127.0.0.1:8000/docs"
echo ""
echo "  フロントエンドは別ターミナルで以下を実行してください:"
echo "  cd frontend && pnpm dev"
echo ""
echo "  Tauri アプリまで一括で起動する場合:"
echo "  ./start-tauri.sh"
echo ""
echo "  またはバックエンド起動後に別ターミナルで:"
echo "  pnpm tauri dev"
echo ""
echo "  Ctrl+C で終了"
echo "=========================================="

exec python3 -m uvicorn backend.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --log-level info
