#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
DOWNLOADS="$HOME/storage/downloads"
if [ ! -d "$DOWNLOADS" ]; then
  echo "Run termux-setup-storage once and allow file access, then retry."
  exit 1
fi

cd "$REPO_DIR/backend"
node device-discovery.js --scan-lan
cp logs/device-discovery.json "$DOWNLOADS/WBP-device-scan.json"
echo "Open Connect in WBP and import Downloads/WBP-device-scan.json."
