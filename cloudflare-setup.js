#!/usr/bin/env node
// cloudflare-setup.js
// Uses Cloudflare API to create a named tunnel, configure ingress,
// and optionally set up a custom DNS record — all without interactive login.
//
// Usage:
//   CF_API_TOKEN=your_token node cloudflare-setup.js
//   CF_API_TOKEN=your_token CF_DOMAIN=tv.example.com node cloudflare-setup.js
//
// Required:
//   CF_API_TOKEN  — Cloudflare API token with Tunnel:Edit + DNS:Edit permissions
//
// Optional:
//   CF_DOMAIN     — custom hostname, e.g. "tv.yourdomain.com"
//                   the root domain must already be in your Cloudflare account

'use strict';
const fs   = require('fs');
const path = require('path');

const CF_API = 'https://api.cloudflare.com/client/v4';
const TOKEN  = process.env.CF_API_TOKEN || '';
const DOMAIN = (process.env.CF_DOMAIN  || '').trim();
const PORT   = 8765;

// ── Require Node 18+ for global fetch ───────────────
if (!globalThis.fetch) {
  console.error('Node.js 18 or newer is required (for built-in fetch).');
  console.error('Current version:', process.version);
  process.exit(1);
}

if (!TOKEN) {
  console.error('');
  console.error('  CF_API_TOKEN environment variable is required.');
  console.error('');
  console.error('  Usage:');
  console.error('    CF_API_TOKEN=your_token node cloudflare-setup.js');
  console.error('    CF_API_TOKEN=your_token CF_DOMAIN=tv.example.com node cloudflare-setup.js');
  console.error('');
  process.exit(1);
}

// ── Cloudflare API helper ────────────────────────────
async function api(method, endpoint, body) {
  const res = await fetch(`${CF_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!data.success) {
    const msg = data.errors?.map((e) => `[${e.code}] ${e.message}`).join('; ')
      || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API: ${msg}`);
  }

  return data.result;
}

// ── Main ─────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' TV Launcher — Cloudflare Tunnel Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // 1. Verify token
  const verify = await api('GET', '/user/tokens/verify');
  console.log(`✓  Token verified (${verify.status})`);

  // 2. Get account
  const accounts = await api('GET', '/accounts?per_page=1');
  if (!accounts.length) throw new Error('No Cloudflare accounts found for this token.');
  const account = accounts[0];
  console.log(`✓  Account: ${account.name}  (${account.id})`);

  // 3. Create or reuse tunnel named "tv-launcher"
  const existing = await api(
    'GET',
    `/accounts/${account.id}/cfd_tunnel?name=tv-launcher&is_deleted=false`,
  );
  let tunnel;
  if (existing.length > 0) {
    tunnel = existing[0];
    console.log(`✓  Reusing existing tunnel: ${tunnel.name}  (${tunnel.id})`);
  } else {
    tunnel = await api('POST', `/accounts/${account.id}/cfd_tunnel`, {
      name: 'tv-launcher',
      config_src: 'cloudflare',
    });
    console.log(`✓  Created tunnel: ${tunnel.name}  (${tunnel.id})`);
  }

  // 4. Configure ingress rules
  const ingress = [];
  if (DOMAIN) {
    ingress.push({ hostname: DOMAIN, service: `http://localhost:${PORT}` });
  }
  ingress.push({ service: `http://localhost:${PORT}` }); // catch-all

  await api('PUT', `/accounts/${account.id}/cfd_tunnel/${tunnel.id}/configurations`, {
    config: { ingress },
  });
  console.log(`✓  Ingress configured → localhost:${PORT}`);

  // 5. Get tunnel token (used to run cloudflared without login)
  const tunnelToken = await api(
    'GET',
    `/accounts/${account.id}/cfd_tunnel/${tunnel.id}/token`,
  );
  console.log(`✓  Tunnel token retrieved`);

  // 6. Optional DNS setup
  let tunnelUrl = null;

  if (DOMAIN) {
    const parts   = DOMAIN.split('.');
    const root    = parts.slice(-2).join('.'); // last two labels
    try {
      const zones = await api('GET', `/zones?name=${root}&per_page=1`);
      if (!zones.length) {
        console.warn(`⚠  Zone "${root}" not found in your account — skipping DNS.`);
        console.warn(`   Add ${root} to Cloudflare first, then re-run.`);
      } else {
        const zone = zones[0];

        // Check for existing CNAME
        const existing_records = await api(
          'GET',
          `/zones/${zone.id}/dns_records?type=CNAME&name=${DOMAIN}&per_page=1`,
        );

        if (existing_records.length > 0) {
          console.log(`✓  DNS CNAME already exists: ${DOMAIN}`);
          // Update to point to this tunnel just in case
          await api('PUT', `/zones/${zone.id}/dns_records/${existing_records[0].id}`, {
            type: 'CNAME',
            name: DOMAIN,
            content: `${tunnel.id}.cfargotunnel.com`,
            proxied: true,
          });
        } else {
          await api('POST', `/zones/${zone.id}/dns_records`, {
            type: 'CNAME',
            name: DOMAIN,
            content: `${tunnel.id}.cfargotunnel.com`,
            proxied: true,
          });
          console.log(`✓  DNS CNAME created: ${DOMAIN} → tunnel`);
        }
        tunnelUrl = `https://${DOMAIN}`;
      }
    } catch (e) {
      console.warn(`⚠  DNS setup failed: ${e.message}`);
    }
  } else {
    console.log(`   No CF_DOMAIN set — skipping DNS (remote will work on local network only).`);
    console.log(`   Re-run with CF_DOMAIN=tv.yourdomain.com to add a public domain.`);
  }

  // 7. Write .env (never committed to git)
  const envPath  = path.join(__dirname, '.env');
  const envLines = [
    '# Auto-generated by cloudflare-setup.js — DO NOT COMMIT',
    tunnelUrl ? `TUNNEL_URL=${tunnelUrl}` : '# TUNNEL_URL= (no domain configured)',
    `TUNNEL_TOKEN=${tunnelToken}`,
    `CF_ACCOUNT_ID=${account.id}`,
    `CF_TUNNEL_ID=${tunnel.id}`,
  ];
  fs.writeFileSync(envPath, envLines.join('\n') + '\n');
  console.log(`✓  Saved .env`);

  // 8. Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (tunnelUrl) {
    console.log(` Public URL  : ${tunnelUrl}`);
    console.log(` Remote      : ${tunnelUrl}/remote.html`);
    console.log(` TV UI       : ${tunnelUrl}/tv.html`);
  } else {
    console.log(` Tunnel ID   : ${tunnel.id}`);
    console.log(` No public domain — LAN-only until CF_DOMAIN is set.`);
  }
  console.log('');
  console.log(' Next step — start the server + tunnel:');
  console.log('   bash start-tunnel.sh --token');
  console.log('');
  console.log(' For auto-start at boot, load the LaunchAgents:');
  console.log('   bash setup.sh');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error(`✗  ${err.message}`);
  console.error('');
  process.exit(1);
});
