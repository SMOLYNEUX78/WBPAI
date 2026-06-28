#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
SESSION_NAME="${WBPAI_TMUX_SESSION:-wbpai}"

mkdir -p "$REPO_DIR/logs"
cd "$REPO_DIR"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Run: pkg install tmux"
  exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "WBPAI tmux session already exists."
  echo "Attach with: tmux attach -t $SESSION_NAME"
  exit 0
fi

tmux new-session -d -s "$SESSION_NAME" "
  cd '$REPO_DIR/backend' || exit 1
  while true; do
    printf '[%s] Starting WBPAI collectors\n' \"\$(date -Iseconds)\"
    npm run start:collectors 2>&1
    status=\$?
    printf '[%s] WBPAI collectors exited with code %s; restarting in 10s\n' \"\$(date -Iseconds)\" \"\$status\"
    sleep 10
  done | tee -a '$REPO_DIR/logs/collectors.log'
"

echo "WBPAI collectors started directly in tmux."
echo "Attach with: tmux attach -t $SESSION_NAME"
echo "Detach with: Ctrl+b then d"
