#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"

mkdir -p "$REPO_DIR/logs"
cd "$REPO_DIR"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Run: pkg install tmux"
  exit 1
fi

if tmux has-session -t wbpai 2>/dev/null; then
  echo "WBPAI tmux session already exists."
  echo "Attach with: tmux attach -t wbpai"
  exit 0
fi

tmux new-session -d -s wbpai "bash scripts/termux-auto-update.sh"
echo "WBPAI auto-updater started in tmux."
echo "Attach with: tmux attach -t wbpai"
echo "Detach with: Ctrl+b then d"
