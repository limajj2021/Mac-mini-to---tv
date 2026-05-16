#!/usr/bin/env bash
# start-tunnel.sh
# Starts the TV Launcher server + a Cloudflare Tunnel (quick tunnel, no account needed).
#
# Usage:
#   bash start-tunnel.sh              # quick tunnel (random URL, good for testing)
#   TUNNEL_URL=https://tv.my.domain bash start-tunnel.sh   # skip tunnel, use env URL
#
# For a permanent URL (recommended for daily use):
#   1. cloudflared tunnel login
#   2. cloudflared tunnel create tv-launcher
#   3. cloudflared tunnel route dns tv-launcher tv.yourdomain.com
#   4. Create ~/.cloudflared/config.yml  (see below)
#   5. Run:  cloudflared tunnel run tv-launcher   (alongside this server)
#
# config.yml template:
#   tunnel: <YOUR_TUNNEL_ID>
#   credentials-file: /Users/YOU/.cloudflared/<TUNNEL_ID>.json
#   ingress:
#     - hostname: tv.yourdomain.com
#       service: http://localhost:8765
#     - service: http_status:404

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_LOG="/tmp/tvlauncher-tunnel.log"
PORT=8765

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " TV Launcher + Cloudflare Tunnel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── If TUNNEL_URL already set, just run the server ────
if [ -n "${TUNNEL_URL:-}" ]; then
  echo "✓  Using preset tunnel: $TUNNEL_URL"
  echo "   Remote: $TUNNEL_URL/remote.html"
  exec node "$SCRIPT_DIR/server.js"
fi

# ── Check cloudflared ─────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "→  cloudflared not found. Attempting install via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install cloudflared
  else
    cat <<'EOF'

  Install cloudflared manually, then re-run:
    macOS (Homebrew): brew install cloudflared
    macOS (pkg):      https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

EOF
    exit 1
  fi
fi
echo "✓  cloudflared: $(cloudflared --version 2>&1 | head -1)"

# ── Start quick tunnel ────────────────────────────────
> "$TUNNEL_LOG"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate 2>&1 \
  | tee -a "$TUNNEL_LOG" &
TUNNEL_PID=$!

# ── Wait for URL (up to 40 s) ─────────────────────────
echo -n "→  Waiting for tunnel URL"
TUNNEL_URL=""
for _ in $(seq 1 40); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' \
    "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  [ -n "$TUNNEL_URL" ] && break
  sleep 1
  echo -n "."
done
echo ""

if [ -z "$TUNNEL_URL" ]; then
  echo "✗  Tunnel URL not detected after 40 s."
  echo "   Check log: tail -f $TUNNEL_LOG"
  echo "   Starting server without tunnel URL..."
  node "$SCRIPT_DIR/server.js" &
  SERVER_PID=$!
  trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true" EXIT INT TERM
  wait $SERVER_PID
  exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Tunnel active!"
echo ""
echo " TV UI    → $TUNNEL_URL/tv.html"
echo " Remote   → $TUNNEL_URL/remote.html"
echo ""
echo " Share the Remote URL with any phone on any network."
echo " QR code on the TV will update automatically."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Start server with tunnel URL ──────────────────────
TUNNEL_URL="$TUNNEL_URL" node "$SCRIPT_DIR/server.js" &
SERVER_PID=$!

trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true" EXIT INT TERM

wait $SERVER_PID $TUNNEL_PID
