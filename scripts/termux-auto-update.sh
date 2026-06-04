#!/data/data/com.termux/files/usr/bin/bash
set -u

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
BRANCH="${WBPAI_BRANCH:-main}"
CHECK_INTERVAL="${WBPAI_UPDATE_INTERVAL:-60}"
LOG_DIR="$REPO_DIR/logs"
COLLECTOR_LOG="$LOG_DIR/collectors.log"
AUTOUPDATE_LOG="$LOG_DIR/auto-update.log"
COLLECTOR_PID_FILE="$LOG_DIR/collectors.pid"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*" | tee -a "$AUTOUPDATE_LOG"
}

start_collectors() {
  cd "$REPO_DIR/backend"

  if [ ! -f ".env" ]; then
    log "backend/.env is missing. Create it before starting collectors."
    return 1
  fi

  if [ -f "$COLLECTOR_PID_FILE" ]; then
    OLD_PID="$(cat "$COLLECTOR_PID_FILE" 2>/dev/null || true)"
    if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      return 0
    fi
  fi

  log "Starting WBPAI collectors"
  nohup npm run start:collectors >> "$COLLECTOR_LOG" 2>&1 &
  echo "$!" > "$COLLECTOR_PID_FILE"
}

stop_collectors() {
  if [ ! -f "$COLLECTOR_PID_FILE" ]; then
    return 0
  fi

  OLD_PID="$(cat "$COLLECTOR_PID_FILE" 2>/dev/null || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    log "Stopping WBPAI collectors"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 3
  fi

  rm -f "$COLLECTOR_PID_FILE"
}

install_dependencies_if_needed() {
  cd "$REPO_DIR/backend"

  if [ ! -d "node_modules" ]; then
    log "Installing backend dependencies"
    npm install >> "$AUTOUPDATE_LOG" 2>&1
    return
  fi

  if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -Eq '^backend/package(-lock)?\.json$'; then
    log "Package files changed; refreshing backend dependencies"
    npm install >> "$AUTOUPDATE_LOG" 2>&1
  fi
}

pull_latest() {
  cd "$REPO_DIR"

  git fetch origin "$BRANCH" >> "$AUTOUPDATE_LOG" 2>&1

  LOCAL_SHA="$(git rev-parse HEAD)"
  REMOTE_SHA="$(git rev-parse "origin/$BRANCH")"

  if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
    return 1
  fi

  log "Updating from $LOCAL_SHA to $REMOTE_SHA"
  git pull --ff-only origin "$BRANCH" >> "$AUTOUPDATE_LOG" 2>&1
  return 0
}

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

log "WBPAI auto-updater started for $REPO_DIR on $BRANCH"

install_dependencies_if_needed
start_collectors

while true; do
  if pull_latest; then
    install_dependencies_if_needed
    stop_collectors
    start_collectors
  else
    start_collectors
  fi

  sleep "$CHECK_INTERVAL"
done
