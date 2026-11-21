// GET /api/config: public site settings read by /assets/a.js (currently only whether to show the tracking notice).
import { ensureSchema, getSetting } from '../_shared/analytics.js';

export async function onRequestGet({ env }) {
  let consent = false;
  if (env.DB) {
    try { await ensureSchema(env.DB); consent = (await getSetting(env.DB, 'consent_popup', '0')) === '1'; } catch {}
  }
  return new Response(JSON.stringify({ consent }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }
  });
}
