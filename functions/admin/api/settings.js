// GET/POST /admin/api/settings: dashboard switches. Protected by functions/admin/_middleware.js.
import { ensureSchema, getSetting, setSetting } from '../../_shared/analytics.js';

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function read(db) {
  return { consent: (await getSetting(db, 'consent_popup', '0')) === '1' };
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  await ensureSchema(env.DB);
  return json(await read(env.DB));
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'no_db' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'bad_origin' }, 403);
  let body = {};
  try { body = await request.json(); } catch {}
  await ensureSchema(env.DB);
  if (typeof body.consent === 'boolean') await setSetting(env.DB, 'consent_popup', body.consent ? '1' : '0');
  return json(await read(env.DB));
}
