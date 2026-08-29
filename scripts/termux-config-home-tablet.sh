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
set_env "DYSON_BUILDING_ID" "home"
set_env "THINGSBOARD_BUILDING_ID" "museum"
set_env "COLLECTOR_INSTANCE" "home-tablet"
set_env "COLLECTOR_PROCESSES" "glow-api,dyson,carbon-savings,dashboard-summary,thingsboard,weather"
set_env "GLOW_API_POLL_INTERVAL_MS" "60000"
set_env "GLOW_API_DAILY_TOTAL_INTERVAL_MS" "1800000"
set_env "GLOW_API_INTERVAL_TOTAL_INTERVAL_MS" "1800000"
set_env "GLOW_API_INTERVAL_LOOKBACK_HOURS" "72"
set_env "GLOW_API_INTERVAL_FUELS" "electricity"
set_env "GLOW_API_INSTANT_POWER_INTERVAL_MS" "1800000"
set_env "GLOW_API_STORE_RAW_PAYLOAD" "false"
set_env "CARBON_SAVINGS_CRON" "0 * * * *"
set_env "CARBON_SAVINGS_AFTER_GLOW_INTERVAL_MS" "0"
set_env "DASHBOARD_SUMMARY_BUILDING_IDS" "home,museum"
set_env "DASHBOARD_SUMMARY_CRON" "*/30 * * * *"
set_env "DASHBOARD_SUMMARY_ENERGY_DAYS" "120"
set_env "DASHBOARD_SUMMARY_SENSOR_DAYS" "35"
set_env "DASHBOARD_SUMMARY_RAIN_HUMIDITY_DAYS" "180"
set_env "DASHBOARD_SUMMARY_MAX_RAIN_HUMIDITY_ROWS" "10000"
set_env "DYSON_POLL_INTERVAL_MS" "60000"
set_env "DYSON_SAVE_INTERVAL_MS" "300000"
set_env "GLOW_API_RESOURCES" "home:electricity:042517ae-601f-4928-b3d2-e49b1de0e695,home:gas:a2130979-fb09-48bf-89f9-5703c30037b8,museum:electricity:12e31e6d-11dc-4bc3-a70b-dab6f76fc73c"
set_env "WEATHER_LOCATIONS" "museum:52.0901:-1.3210,home:52.0945:1.30488"

if ! grep -q "^DYSON_DEVICES=" "$ENV_FILE"; then
  echo "Warning: DYSON_DEVICES is not set in backend/.env."
  echo "Dyson IAQ will not run until the local Dyson device credentials are added."
fi

if ! grep -q "^THINGSBOARD_PUBLIC_ID=" "$ENV_FILE" && ! grep -q "^THINGSBOARD_TOKEN=" "$ENV_FILE"; then
  echo "Warning: THINGSBOARD_PUBLIC_ID or THINGSBOARD_TOKEN is not set in backend/.env."
  echo "Museum IAQ will not run until ThingsBoard auth is added."
fi

if ! grep -q "^WBP=" "$ENV_FILE"; then
  echo "Warning: WBP OpenWeather API key is not set in backend/.env."
  echo "External temperature will not run until the weather API key is added."
fi

tmux kill-session -t wbpai 2>/dev/null || true
"${REPO_DIR}/scripts/termux-start.sh"

echo "Home tablet configured and WBPAI collectors restarted."
