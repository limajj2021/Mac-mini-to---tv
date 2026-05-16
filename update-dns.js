#!/usr/bin/env node
// update-dns.js
// Updates the DNS CNAME record for CF_DOMAIN to point to a new quick tunnel URL.
// Called automatically by start-tunnel.sh in quick-tunnel mode.
//
// Env vars (loaded from .env by start-tunnel.sh):
//   CF_API_TOKEN  — Cloudflare API token with DNS:Edit
//   CF_ZONE_ID    — Cloudflare zone ID
//   CF_DOMAIN     — hostname to update (e.g. tv.snakesponsor.com)
//   QUICK_TUNNEL_URL — new tunnel URL (e.g. https://abc.trycloudflare.com)

'use strict';

const CF_API     = 'https://api.cloudflare.com/client/v4';
const TOKEN      = process.env.CF_API_TOKEN       || '';
const ZONE_ID    = process.env.CF_ZONE_ID         || '';
const DOMAIN     = process.env.CF_DOMAIN          || '';
const TUNNEL_URL = process.env.QUICK_TUNNEL_URL   || '';

if (!TOKEN || !ZONE_ID || !DOMAIN || !TUNNEL_URL) {
  console.error('update-dns.js: missing required env vars (CF_API_TOKEN, CF_ZONE_ID, CF_DOMAIN, QUICK_TUNNEL_URL)');
  process.exit(1);
}

async function api(method, endpoint, body) {
  const res = await fetch(`${CF_API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}`);
  }
  return data.result;
}

async function main() {
  const tunnelHost = TUNNEL_URL.replace('https://', '');

  // Find existing CNAME for this domain
  const records = await api('GET', `/zones/${ZONE_ID}/dns_records?type=CNAME&name=${DOMAIN}&per_page=1`);

  if (records.length > 0) {
    await api('PATCH', `/zones/${ZONE_ID}/dns_records/${records[0].id}`, {
      content: tunnelHost,
      proxied: true,
    });
  } else {
    await api('POST', `/zones/${ZONE_ID}/dns_records`, {
      type: 'CNAME',
      name: DOMAIN,
      content: tunnelHost,
      proxied: true,
    });
  }

  console.log(`✓  DNS updated: ${DOMAIN} → ${tunnelHost}`);
}

main().catch((e) => {
  console.error(`✗  DNS update failed: ${e.message}`);
  process.exit(1);
});
