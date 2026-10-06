#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
SCAN_SESSION="${WBP_SCAN_TMUX_SESSION:-wbp-scan}"
if [ ! -f "$REPO_DIR/backend/.env" ] || ! grep -q '^WBP_SCAN_DEVICE_TOKEN=' "$REPO_DIR/backend/.env"; then
  exit 0
fi
if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Run: pkg install tmux"
  exit 1
fi
if tmux has-session -t "$SCAN_SESSION" 2>/dev/null; then
  echo "WBP device scan worker is already running."
  exit 0
fi

mkdir -p "$REPO_DIR/logs"
tmux new-session -d -s "$SCAN_SESSION" "
  cd '$REPO_DIR/backend' || exit 1
  while true; do
    node collector-scan-worker.js 2>&1
    sleep 10
  done | tee -a '$REPO_DIR/logs/device-scan-worker.log'
"
echo "WBP device scan worker started in $SCAN_SESSION."
