#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${HOME}/WBPAI"
ENV_FILE="${REPO_DIR}/backend/.env"

set_env() {
  key="$1"
  value="$2"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

cd "$REPO_DIR"
git pull origin main

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create backend/.env with Supabase and Glow credentials first."
  exit 1
fi

set_env "BUILDING_ID" "home"
set_env "COLLECTOR_INSTANCE" "home-tablet"
set_env "COLLECTOR_PROCESSES" "glow-api"
set_env "GLOW_API_RESOURCES" "home:electricity:042517ae-601f-4928-b3d2-e49b1de0e695,home:gas:a2130979-fb09-48bf-89f9-5703c30037b8,museum:electricity:12e31e6d-11dc-4bc3-a70b-dab6f76fc73c"

tmux kill-session -t wbpai 2>/dev/null || true
"${REPO_DIR}/scripts/termux-start.sh"

echo "Home tablet configured and WBPAI collectors restarted."
