#!/data/data/com.termux/files/usr/bin/sh
set -u

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
SESSION_NAME="${WBPAI_TMUX_SESSION:-wbpai}"
LOG_DIR="$REPO_DIR/logs"
HEARTBEAT_FILE="$LOG_DIR/dyson-heartbeat"
STARTED_FILE="$LOG_DIR/collectors-started"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
STALE_MINUTES="${WBPAI_IAQ_STALE_MINUTES:-20}"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$WATCHDOG_LOG"
}

is_stale() {
  file="$1"
  [ -f "$file" ] && find "$file" -mmin "+$STALE_MINUTES" -print -quit | grep -q .
}

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  log "Collector session missing; starting it"
  sh "$REPO_DIR/scripts/termux-start.sh" >> "$WATCHDOG_LOG" 2>&1
  exit $?
fi

if is_stale "$HEARTBEAT_FILE" || { [ ! -f "$HEARTBEAT_FILE" ] && is_stale "$STARTED_FILE"; }; then
  log "Dyson IAQ heartbeat is older than ${STALE_MINUTES} minutes; restarting collectors"
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  rm -f "$STARTED_FILE"
  sh "$REPO_DIR/scripts/termux-start.sh" >> "$WATCHDOG_LOG" 2>&1
  exit $?
fi

log "Collector session and Dyson IAQ heartbeat are healthy"
