#!/usr/bin/env bash
# setup.sh — one-time installation for TV Launcher on Mac mini
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/tv-launcher"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
NODE_BIN="$(which node 2>/dev/null || echo '')"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " TV Launcher — Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Check Node.js ─────────────────────
if [ -z "$NODE_BIN" ]; then
  echo "✗  Node.js not found. Install from https://nodejs.org/ then re-run."
  exit 1
fi
echo "✓  Node.js: $NODE_BIN ($(node --version))"

# ── 2. Copy project files ─────────────────
if [ "$REPO_DIR" != "$INSTALL_DIR" ]; then
  echo "→  Copying project to $INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  rsync -a --exclude='.git' --exclude='node_modules' --exclude='setup.sh' \
    "$REPO_DIR/" "$INSTALL_DIR/"
else
  echo "→  Running in-place at $INSTALL_DIR"
fi

# ── 3. Install npm dependencies ──────────
echo "→  Installing npm packages"
cd "$INSTALL_DIR"
npm install --silent

# ── 4. Detect local IP ───────────────────
LOCAL_IP=$(node -e "
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) { process.stdout.write(i.address); process.exit(); }
    }
  }
  process.stdout.write('127.0.0.1');
")
echo "✓  Local IP: $LOCAL_IP"
echo "   Remote URL will be: http://$LOCAL_IP:8765/remote.html"

# ── 5. Install LaunchAgents ──────────────
mkdir -p "$LAUNCH_AGENTS"

for plist in server chrome; do
  SRC="$REPO_DIR/launchagents/com.tvlauncher.$plist.plist"
  DEST="$LAUNCH_AGENTS/com.tvlauncher.$plist.plist"

  # Substitute placeholders
  sed \
    -e "s|YOUR_USERNAME|$(whoami)|g" \
    -e "s|/usr/local/bin/node|$NODE_BIN|g" \
    -e "s|/Users/$(whoami)/tv-launcher|$INSTALL_DIR|g" \
    "$SRC" > "$DEST"

  # Unload if already loaded (ignore error if not)
  launchctl unload "$DEST" 2>/dev/null || true
  launchctl load   "$DEST"
  echo "✓  LaunchAgent loaded: com.tvlauncher.$plist"
done

# ── 6. Auto-login reminder ───────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo " Server log : tail -f /tmp/tvlauncher-server.log"
echo " Remote URL : http://$LOCAL_IP:8765/remote.html"
echo ""
echo " Recommended: enable auto-login at"
echo "   System Preferences → Users & Groups → Login Options"
echo " so the TV UI starts after a power cut without intervention."
echo ""
echo " Static IP: consider reserving $LOCAL_IP in your router's"
echo " DHCP settings so the QR code URL never changes."
echo ""
