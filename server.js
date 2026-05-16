const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8765;

const APP_URLS = {
  youtube: 'https://youtube.com/tv',
  netflix: 'https://netflix.com/browse',
  spotify: 'https://open.spotify.com',
};

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function launchApp(appName) {
  const url = APP_URLS[appName];
  if (!url) return;
  // Open in a new Chrome window (full screen) alongside the TV kiosk window
  exec(
    `open -na "Google Chrome" --args --new-window --start-fullscreen "${url}"`,
    (err) => { if (err) exec(`open "${url}"`); }
  );
}

function closeApp() {
  // Close the frontmost Chrome window (the launched app, not the TV kiosk)
  exec(`osascript -e 'tell application "Google Chrome" to close front window'`);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/ip', (_req, res) => {
  const localIP  = getLocalIP();
  const tunnelUrl = (process.env.TUNNEL_URL || '').replace(/\/$/, '') || null;
  const remoteUrl = tunnelUrl
    ? `${tunnelUrl}/remote.html`
    : `http://${localIP}:${PORT}/remote.html`;
  res.json({ ip: localIP, port: PORT, tunnelUrl, remoteUrl });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let tvClient = null;
const phoneClients = new Set();
let appState = { focused: 'youtube', connected: false };

function sendTo(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastPhones(msg) {
  phoneClients.forEach((ws) => sendTo(ws, msg));
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const type = params.get('type');

  if (type === 'tv') {
    tvClient = ws;
    appState.connected = phoneClients.size > 0;
    sendTo(ws, { type: 'state', payload: appState });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        // TV reports focus changes so phones stay in sync
        if (msg.type === 'state' && msg.payload) {
          appState = { ...appState, ...msg.payload };
          broadcastPhones({ type: 'state', payload: appState });
        }
      } catch (_) {}
    });

    ws.on('close', () => { tvClient = null; });
    ws.on('error', () => { tvClient = null; });
    return;
  }

  // Phone client
  phoneClients.add(ws);
  appState.connected = true;
  sendTo(tvClient, { type: 'state', payload: appState });
  sendTo(ws, { type: 'state', payload: appState });

  ws.on('message', (raw) => {
    try {
      handlePhoneMsg(ws, JSON.parse(raw));
    } catch (_) {}
  });

  ws.on('close', () => {
    phoneClients.delete(ws);
    if (phoneClients.size === 0) {
      appState.connected = false;
      sendTo(tvClient, { type: 'state', payload: appState });
    }
  });

  ws.on('error', () => phoneClients.delete(ws));
});

function handlePhoneMsg(_ws, msg) {
  switch (msg.type) {
    case 'focus_left':
    case 'focus_right':
    case 'select':
    case 'back':
      sendTo(tvClient, msg);
      break;

    case 'open_app': {
      const appName = msg.payload?.app;
      sendTo(tvClient, msg);
      // Small delay so the TV overlay animation starts before the OS opens the app
      setTimeout(() => launchApp(appName), 400);
      broadcastPhones({ type: 'launched', payload: { app: appName } });
      break;
    }

    case 'close_app':
      sendTo(tvClient, { type: 'back' });
      closeApp();
      break;

    case 'ping':
      break; // keep-alive for Cloudflare Tunnel idle timeout
  }
}

server.listen(PORT, () => {
  const localIP   = getLocalIP();
  const tunnelUrl = (process.env.TUNNEL_URL || '').replace(/\/$/, '') || null;
  console.log(`TV Launcher → http://localhost:${PORT}/tv.html`);
  console.log(`Network     → http://${localIP}:${PORT}/remote.html`);
  if (tunnelUrl) {
    console.log(`Tunnel      → ${tunnelUrl}/remote.html`);
  }
});
