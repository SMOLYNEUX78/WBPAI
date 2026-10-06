#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
ENV_FILE="$REPO_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Collector configuration is missing: $ENV_FILE"
  exit 1
fi

printf 'Paste the WBP tablet pairing code: '
IFS= read -r TOKEN
if ! printf '%s' "$TOKEN" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "Pairing code must be 64 lowercase hexadecimal characters."
  exit 1
fi

# This is the public Supabase anon key, not a service-role credential.
ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2dHV2YXBzaHZod2Znbm5oemJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ3MjM4NTMsImV4cCI6MjA2MDI5OTg1M30.rZzCXqkhf93-8o5EYylgaCWxyTxeMzsNvl1lEzeBSpY'
sed -i '/^WBP_SCAN_DEVICE_TOKEN=/d; /^WBP_SCAN_ANON_KEY=/d' "$ENV_FILE"
printf '\nWBP_SCAN_DEVICE_TOKEN=%s\nWBP_SCAN_ANON_KEY=%s\n' "$TOKEN" "$ANON_KEY" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
unset TOKEN
if tmux has-session -t "${WBP_SCAN_TMUX_SESSION:-wbp-scan}" 2>/dev/null; then
  tmux kill-session -t "${WBP_SCAN_TMUX_SESSION:-wbp-scan}"
fi
sh "$REPO_DIR/scripts/termux-start-scan.sh"
echo "Tablet paired for scan requests. Existing collectors were not restarted."
