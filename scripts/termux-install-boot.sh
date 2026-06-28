#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_DIR="${WBPAI_REPO_DIR:-$HOME/WBPAI}"
BOOT_DIR="$HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/wbpai-collectors"

mkdir -p "$BOOT_DIR"

cat > "$BOOT_SCRIPT" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
sleep 20
cd "$REPO_DIR"
sh scripts/termux-start.sh >> "$REPO_DIR/logs/boot.log" 2>&1
EOF

chmod +x "$BOOT_SCRIPT"
chmod +x "$REPO_DIR/scripts/termux-start.sh" "$REPO_DIR/scripts/termux-auto-update.sh"

echo "Installed Termux:Boot launcher: $BOOT_SCRIPT"
echo "The boot launcher waits 20 seconds, then starts WBPAI collectors directly in tmux."
echo "Open the Termux:Boot app once, then reboot the tablet to test."
