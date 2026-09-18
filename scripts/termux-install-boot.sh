#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/wbpai-collectors"
WATCHDOG_SCRIPT="$REPO_DIR/scripts/termux-watchdog.sh"
WATCHDOG_JOB_ID="7821"

mkdir -p "$BOOT_DIR"

cat > "$BOOT_SCRIPT" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
sleep 20
cd "$REPO_DIR"
sh scripts/termux-watchdog.sh >> "$REPO_DIR/logs/boot.log" 2>&1
EOF

chmod +x "$BOOT_SCRIPT"
chmod +x "$REPO_DIR/scripts/termux-start.sh" "$REPO_DIR/scripts/termux-auto-update.sh" "$WATCHDOG_SCRIPT"

if command -v termux-job-scheduler >/dev/null 2>&1; then
  if termux-job-scheduler \
      --script "$WATCHDOG_SCRIPT" \
      --job-id "$WATCHDOG_JOB_ID" \
      --period-ms 900000 \
      --network any \
      --battery-not-low false \
      --persisted true; then
    echo "Installed 15-minute Android watchdog job: $WATCHDOG_JOB_ID"
  else
    echo "Warning: Android watchdog scheduling failed; boot recovery is still installed."
    echo "Open the Termux:API app once, then rerun this installer."
  fi
else
  echo "Warning: termux-job-scheduler is unavailable."
  echo "Install the Termux:API app and run: pkg install termux-api"
  echo "Then rerun this installer to enable recovery without a tablet reboot."
fi

echo "Installed Termux:Boot launcher: $BOOT_SCRIPT"
echo "The boot launcher waits 20 seconds, then checks and starts WBPAI collectors in tmux."
echo "Open the Termux:Boot app once, then reboot the tablet to test."
