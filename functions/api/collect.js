// POST /api/collect: receives page views and engagement events from /assets/a.js.
// Stores the IP address and device details (disclosed in the privacy note); sets no cookie. Always answers 204 so the page never waits on it.
import { ensureSchema, localParts, clip, dailySalt, visitorHash, parseUA, BOT_RE, refHost, prune } from '../_shared/analytics.js';

const done = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
// Device details from the page plus connection details from Cloudflare, kept as a small JSON blob.
function info(src, cf) {
  const out = {};
  if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src).slice(0, 40)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string' && v) out[k] = v.slice(0, 200);
    }
  }
  if (cf.httpProtocol) out.http = String(cf.httpProtocol);
  if (cf.tlsVersion) out.tls = String(cf.tlsVersion);
  if (cf.regionCode) out.regionCode = String(cf.regionCode);
  if (cf.metroCode) out.metro = String(cf.metroCode);
  if (cf.isEUCountry) out.eu = true;
  return JSON.stringify(out).slice(0, 3000);
}

const ALLOWED_KINDS = new Set(['section', 'click']);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

export async function onRequestPost({ request, env, waitUntil }) {
  const db = env.DB;
  if (!db) return done();

  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== url.host) return done();
  const ua = request.headers.get('User-Agent') || '';
  if (request.cf && request.cf.botManagement && request.cf.botManagement.verifiedBot) return done();

  let body;
  try {
    const text = await request.text();
    if (text.length > 16000) return done();
    body = JSON.parse(text);
  } catch { return done(); }
  if (!body || typeof body.pid !== 'string' || !/^[0-9a-f]{8,32}$/.test(body.pid)) return done();

  try {
    await ensureSchema(db);
    const now = Date.now();

    if (body.t === 'pv') {
      // Bots are filtered on the page view; later beacons only update a page view that passed.
      if (!ua || BOT_RE.test(ua)) return done();
      const { day, hour } = localParts(now);
      const ip = request.headers.get('CF-Connecting-IP') || '';
      const salt = await dailySalt(db, day);
      const vid = await visitorHash(salt, ip, ua, url.host);
      const cf = request.cf || {};
      let { device, os, browser } = parseUA(ua);
      const pi = body.info && typeof body.info === 'object' ? body.info : {};
      if (os === 'Windows' && pi.platformVersion) os = parseInt(pi.platformVersion, 10) >= 13 ? 'Windows 11' : 'Windows 10';
      const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};
      const ref = clip(body.ref, 300);
      // A visitor who chose "anonymous only" in the notice: no IP, network, precise location, UA or device details.
      const anon = body.consent === 'anon';
      const selfHost = url.hostname.replace(/^www\./, '');
      await db.prepare(`INSERT OR IGNORE INTO pageviews
        (pid, ts, day, hour, vid, ip, asn, postal, lat, lon, ua, info, path, hash, ref, ref_host, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
         country, region, city, tz, asorg, colo, device, browser, os, screen, viewport, dpr, touch, dark, lang, site_lang, theme, consent)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        body.pid, now, day, hour, vid,
        anon ? null : clip(ip, 64), anon ? null : Number(cf.asn) || null, anon ? null : clip(cf.postalCode, 16),
        !anon && cf.latitude !== undefined && Number.isFinite(Number(cf.latitude)) ? Number(cf.latitude) : null,
        !anon && cf.longitude !== undefined && Number.isFinite(Number(cf.longitude)) ? Number(cf.longitude) : null,
        anon ? null : clip(ua, 400), anon ? null : info(body.info, cf),
        clip(body.path, 200) || '/', clip(body.hash, 40),
        ref && refHost(ref, selfHost) ? ref : null, ref ? refHost(ref, selfHost) : null,
        clip(utm.source, 100), clip(utm.medium, 100), clip(utm.campaign, 100), clip(utm.term, 100), clip(utm.content, 100),
        clip(cf.country, 4), clip(cf.region, 80), clip(cf.city, 80), clip(cf.timezone || body.tz, 60), anon ? null : clip(cf.asOrganization, 120), clip(cf.colo, 8),
        device, browser, os,
        `${int(body.sw, 0, 20000)}×${int(body.sh, 0, 20000)}`, `${int(body.vw, 0, 20000)}×${int(body.vh, 0, 20000)}`,
        Math.min(8, Math.max(0, Number(body.dpr) || 1)), body.touch ? 1 : 0, body.dark ? 1 : 0,
        clip(body.lang, 20), body.sitelang === 'zh' ? 'zh' : 'en', clip(body.theme, 20),
        body.consent === 'yes' ? 'yes' : anon ? 'anon' : 'none'
      ).run();
      if (Math.random() < 0.02) waitUntil(prune(db));
      return done();
    }

    if (body.t === 'ev') {
      const pv = await db.prepare('SELECT ts, sections FROM pageviews WHERE pid = ?').bind(body.pid).first();
      if (!pv || now - pv.ts > 6 * 3600000) return done();
      const evs = Array.isArray(body.ev) ? body.ev.slice(0, 60) : [];
      const stmts = [];
      const secs = new Set((pv.sections || '').split(',').filter(Boolean));
      let clicks = 0;
      for (const e of evs) {
        if (!e || !ALLOWED_KINDS.has(e.k)) continue;
        const name = clip(e.n, 80);
        if (e.k === 'section') { if (!name || secs.has(name)) continue; secs.add(name); }
        if (e.k === 'click') clicks++;
        stmts.push(db.prepare('INSERT INTO events (pid, ts, at_ms, kind, name, href, section) VALUES (?,?,?,?,?,?,?)')
          .bind(body.pid, pv.ts + int(e.at, 0, 6 * 3600000), int(e.at, 0, 6 * 3600000), e.k, name, clip(e.h, 200), clip(e.s, 40)));
      }
      stmts.push(db.prepare(`UPDATE pageviews SET
          max_scroll = MAX(max_scroll, ?), active_ms = MAX(active_ms, ?), total_ms = MAX(total_ms, ?),
          clicks = clicks + ?, sections = ? WHERE pid = ?`)
        .bind(int(body.scroll, 0, 100), int(body.active, 0, 6 * 3600000), int(body.total, 0, 6 * 3600000), clicks, [...secs].join(','), body.pid));
      await db.batch(stmts);
      return done();
    }
  } catch (e) {
    console.error('collect failed', e && e.message);
  }
  return done();
}

export const onRequest = () => new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
