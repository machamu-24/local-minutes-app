#!/bin/bash
# ローカル AI 議事録作成アプリ Tauri 開発起動スクリプト
# macOS / Linux 対応

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_HEALTH_URL="http://127.0.0.1:8000/api/health"
BACKEND_LOG="/tmp/local-minutes-backend.log"
BACKEND_LOG_INFO="  バックエンドログ: 実行中の既存プロセスを利用"
STARTED_BACKEND=0
BACKEND_PID=""
BACKEND_PORT="8000"

backend_running() {
  curl -sf "$BACKEND_HEALTH_URL" > /dev/null 2>&1
}

backend_failed() {
  [ -f "$BACKEND_LOG" ] && grep -Eq "Traceback|Application startup failed|Error loading ASGI app" "$BACKEND_LOG"
}

backend_port_in_use() {
  lsof -tiTCP:"$BACKEND_PORT" -sTCP:LISTEN > /dev/null 2>&1
}

print_backend_port_usage() {
  lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN || true
}

cleanup() {
  if [ "$STARTED_BACKEND" -eq 1 ] && [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" > /dev/null 2>&1; then
    echo ""
    echo "バックエンドを停止しています..."
    kill "$BACKEND_PID" > /dev/null 2>&1 || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

wait_for_backend() {
  local attempt=0

  while [ "$attempt" -lt 60 ]; do
    if backend_running; then
      return 0
    fi

    if [ "$STARTED_BACKEND" -eq 1 ] && backend_failed; then
      return 1
    fi

    if [ -n "$BACKEND_PID" ] && ! kill -0 "$BACKEND_PID" > /dev/null 2>&1; then
      return 1
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  return 1
}

trap cleanup EXIT INT TERM

echo "=========================================="
echo "  ローカル AI 議事録作成アプリ"
echo "  Tauri 開発モード起動"
echo "=========================================="
echo ""

if backend_running; then
  echo "[1/2] バックエンドは既に起動しています"
elif backend_port_in_use; then
  echo "[1/2] 127.0.0.1:$BACKEND_PORT は別プロセスが使用中です"
  print_backend_port_usage
  echo "      このアプリのバックエンドが既に起動しているか、別アプリが 8000 番ポートを使っています"
  echo "      既存プロセスを停止するか、ポート競合を解消してから再実行してください"
  exit 1
else
  echo "[1/2] バックエンドをバックグラウンドで起動しています..."
  echo "      ログ: $BACKEND_LOG"
  : > "$BACKEND_LOG"
  /bin/bash "$SCRIPT_DIR/start.sh" > "$BACKEND_LOG" 2>&1 &
  BACKEND_PID=$!
  STARTED_BACKEND=1
  BACKEND_LOG_INFO="  バックエンドログ: $BACKEND_LOG"

  if ! wait_for_backend; then
    echo ""
    echo "      バックエンドの起動に失敗しました。直近のログを確認してください:"
    tail -n 40 "$BACKEND_LOG" || true
    exit 1
  fi

  echo "      バックエンド起動完了"
fi

echo "[2/2] Tauri アプリを起動しています..."
echo "      フロントエンドは Tauri 側で自動起動されます"
echo ""
echo "  API サーバー: http://127.0.0.1:8000"
echo "  API ドキュメント: http://127.0.0.1:8000/docs"
echo "$BACKEND_LOG_INFO"
echo ""
echo "  Ctrl+C で終了"
echo "=========================================="

cd "$SCRIPT_DIR"
set +e
pnpm tauri dev
TAURI_EXIT_CODE=$?
set -e

if [ "$TAURI_EXIT_CODE" -eq 130 ] || [ "$TAURI_EXIT_CODE" -eq 143 ]; then
  exit 0
fi

exit "$TAURI_EXIT_CODE"
