#!/usr/bin/env bash
# start-tunnel.sh
#
# Mode A — Named tunnel (token, permanent URL)   ← recommended
#   After running cloudflare-setup.js:
#     bash start-tunnel.sh --token
#
# Mode B — Quick tunnel (no account, random URL) ← good for testing
#     bash start-tunnel.sh
#
# Mode C — Preset URL (skip tunnel, server only)
#     TUNNEL_URL=https://tv.my.domain bash start-tunnel.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_LOG="/tmp/tvlauncher-tunnel.log"
PORT=8765
USE_TOKEN=false

[ "${1:-}" = "--token" ] && USE_TOKEN=true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " TV Launcher + Cloudflare Tunnel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Load .env if present ──────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  # Export only KEY=VALUE lines (skip comments and blanks)
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    export "$key=$val"
  done < <(grep -v '^#' "$ENV_FILE" | grep -v '^$')
  echo "✓  Loaded .env"
fi

# ── Mode C: preset URL, skip tunnel ──────────────────
if [ -n "${TUNNEL_URL:-}" ] && [ "$USE_TOKEN" = false ]; then
  echo "✓  Tunnel URL: $TUNNEL_URL"
  echo "   Remote: $TUNNEL_URL/remote.html"
  exec TUNNEL_URL="$TUNNEL_URL" node "$SCRIPT_DIR/server.js"
fi

# ── Check cloudflared ─────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "→  cloudflared not found. Attempting install via Homebrew..."
  if command -v brew &>/dev/null; then
    brew install cloudflared
  else
    cat <<'INSTALL'

  Please install cloudflared, then re-run:
    macOS (Homebrew) : brew install cloudflared
    macOS (pkg)      : https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

INSTALL
    exit 1
  fi
fi
echo "✓  cloudflared $(cloudflared --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"

# ╔══════════════════════════════════════╗
# ║  Mode A — Named tunnel via token    ║
# ╚══════════════════════════════════════╝
if [ "$USE_TOKEN" = true ]; then
  TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"
  if [ -z "$TUNNEL_TOKEN" ]; then
    echo "✗  TUNNEL_TOKEN not set."
    echo "   Run: node cloudflare-setup.js  (first time)"
    exit 1
  fi

  echo "→  Starting named tunnel (token mode)..."
  cloudflared tunnel run --token "$TUNNEL_TOKEN" --no-autoupdate 2>&1 \
    | tee "$TUNNEL_LOG" &
  TUNNEL_PID=$!

  EFFECTIVE_URL="${TUNNEL_URL:-}"
  if [ -z "$EFFECTIVE_URL" ]; then
    echo "   (No TUNNEL_URL set — QR code will show LAN IP until a domain is configured)"
    echo "   Re-run: CF_DOMAIN=tv.yourdomain.com node cloudflare-setup.js"
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [ -n "$EFFECTIVE_URL" ]; then
    echo " Tunnel URL : $EFFECTIVE_URL"
    echo " Remote     : $EFFECTIVE_URL/remote.html"
  fi
  echo " TV UI      : http://localhost:$PORT/tv.html"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  TUNNEL_URL="$EFFECTIVE_URL" node "$SCRIPT_DIR/server.js" &
  SERVER_PID=$!
  trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true" EXIT INT TERM
  wait $SERVER_PID $TUNNEL_PID
  exit 0
fi

# ╔══════════════════════════════════════╗
# ║  Mode B — Quick tunnel (no account) ║
# ╚══════════════════════════════════════╝
echo "→  Starting quick tunnel (random URL)..."
> "$TUNNEL_LOG"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate 2>&1 \
  | tee -a "$TUNNEL_LOG" &
TUNNEL_PID=$!

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
  echo "   Starting server on LAN only..."
  node "$SCRIPT_DIR/server.js" &
  SERVER_PID=$!
  trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true" EXIT INT TERM
  wait $SERVER_PID
  exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Quick Tunnel active!"
echo ""
echo " Remote : $TUNNEL_URL/remote.html"
echo " TV UI  : $TUNNEL_URL/tv.html  (local access only)"
echo ""
echo " Note: this URL changes every restart."
echo " Run 'node cloudflare-setup.js' for a permanent URL."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TUNNEL_URL="$TUNNEL_URL" node "$SCRIPT_DIR/server.js" &
SERVER_PID=$!
trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null || true" EXIT INT TERM
wait $SERVER_PID $TUNNEL_PID
