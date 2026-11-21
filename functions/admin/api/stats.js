// GET /admin/api/stats?days=7            aggregates for the dashboard
// GET /admin/api/stats?visit=<pid>       full timeline of one visit
// Protected by functions/admin/_middleware.js.
import { ensureSchema } from '../../_shared/analytics.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: 'no_db', message: 'D1 database is not bound to this Pages project as DB.' }, 503);
  await ensureSchema(db);
  const url = new URL(request.url);

  const visit = url.searchParams.get('visit');
  if (visit) {
    const pv = await db.prepare('SELECT * FROM pageviews WHERE pid = ?').bind(visit).first();
    const ev = await db.prepare('SELECT at_ms, kind, name, href, section FROM events WHERE pid = ? ORDER BY at_ms, id').bind(visit).all();
    const same = pv && pv.vid ? await db.prepare('SELECT pid, ts, path, active_ms, max_scroll FROM pageviews WHERE vid = ? AND day = ? ORDER BY ts').bind(pv.vid, pv.day).all() : { results: [] };
    return json({ visit: pv, events: ev.results, sameVisitorToday: same.results });
  }

  if (url.searchParams.has('devices') || url.searchParams.has('device')) return devices(db, url);

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const now = Date.now();
  const from = now - days * 86400000;
  const prevFrom = from - days * 86400000;
  // A view counts as opened once anything happened on screen; app link previews and browser preloads never get there.
  const OPEN = "(sections != '' OR total_ms > 0 OR active_ms > 0)";
  const W = `ts >= ?1 AND ${OPEN}`;

  const q = (sql, ...b) => db.prepare(sql).bind(...b);
  const top = (col, limit = 12) => q(`SELECT COALESCE(${col}, '') AS k, COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM pageviews WHERE ${W} GROUP BY k ORDER BY n DESC LIMIT ${limit}`, from);
  const kpiSql = `SELECT COUNT(*) AS pv, COUNT(DISTINCT vid) AS uv, COALESCE(AVG(active_ms),0) AS avg_active, COALESCE(AVG(max_scroll),0) AS avg_scroll,
      COALESCE(AVG(CASE WHEN active_ms >= 10000 OR max_scroll >= 50 OR clicks > 0 THEN 1.0 ELSE 0 END),0) AS engaged,
      COALESCE(SUM(clicks),0) AS clicks FROM pageviews WHERE ts >= ?1 AND ts < ?2 AND ${OPEN}`;

  const stmts = {
    kpi: q(kpiSql, from, now + 1),
    prev: q(kpiSql, prevFrom, from),
    preloads: q(`SELECT COUNT(*) AS n FROM pageviews WHERE ts >= ?1 AND NOT ${OPEN}`, from),
    live: q('SELECT COUNT(*) AS pv, COUNT(DISTINCT vid) AS uv FROM pageviews WHERE ts >= ?1', now - 30 * 60000),
    daily: q(`SELECT day AS k, COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM pageviews WHERE ${W} GROUP BY day ORDER BY day`, from),
    hours: q(`SELECT hour AS k, COUNT(*) AS n FROM pageviews WHERE ${W} GROUP BY hour ORDER BY hour`, from),
    sections: q(`SELECT e.name AS k, COUNT(DISTINCT e.pid) AS n, CAST(AVG(e.at_ms) AS INTEGER) AS at FROM events e WHERE e.kind = 'section' AND e.ts >= ?1 GROUP BY e.name ORDER BY n DESC`, from),
    clicks: q(`SELECT name AS k, COALESCE(href,'') AS href, COALESCE(section,'') AS section, COUNT(*) AS n, COUNT(DISTINCT pid) AS u FROM events WHERE kind = 'click' AND ts >= ?1 GROUP BY name, href, section ORDER BY n DESC LIMIT 20`, from),
    scroll: q(`SELECT CASE WHEN max_scroll >= 100 THEN '100%' WHEN max_scroll >= 75 THEN '75%' WHEN max_scroll >= 50 THEN '50%' WHEN max_scroll >= 25 THEN '25%' ELSE '0–24%' END AS k, COUNT(*) AS n FROM pageviews WHERE ${W} GROUP BY k`, from),
    time: q(`SELECT CASE WHEN active_ms < 5000 THEN '<5s' WHEN active_ms < 15000 THEN '5–15s' WHEN active_ms < 30000 THEN '15–30s' WHEN active_ms < 60000 THEN '30–60s' WHEN active_ms < 180000 THEN '1–3m' ELSE '3m+' END AS k, COUNT(*) AS n FROM pageviews WHERE ${W} GROUP BY k`, from),
    referrers: top("CASE WHEN ref_host IS NULL THEN '(direct)' ELSE ref_host END"),
    utm: q(`SELECT utm_source || ' / ' || COALESCE(utm_medium,'-') || ' / ' || COALESCE(utm_campaign,'-') AS k, COUNT(*) AS n, COUNT(DISTINCT vid) AS u FROM pageviews WHERE ${W} AND utm_source IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 12`, from),
    countries: top('country'),
    cities: top("COALESCE(city,'?') || ', ' || COALESCE(region,'') || ', ' || COALESCE(country,'')", 15),
    networks: top('asorg', 12),
    devices: top('device'),
    browsers: top('browser'),
    os: top('os'),
    screens: top('screen', 10),
    langs: top('lang', 10),
    siteLang: top('site_lang'),
    theme: top("theme || CASE WHEN dark = 1 THEN ' (device dark)' ELSE ' (device light)' END"),
    paths: top('path', 10),
    ips: top('ip', 15),
    consent: top("COALESCE(consent,'none')"),
    visits: q(`SELECT pid, ts, vid, ip, info, path, ref_host, utm_source, utm_campaign, country, region, city, asorg, device, browser, os, screen, lang, site_lang, theme,
      max_scroll, active_ms, total_ms, clicks, sections, consent FROM pageviews WHERE ts >= ?1 ORDER BY ts DESC LIMIT 150`, from)
  };

  const keys = Object.keys(stmts);
  const results = await db.batch(keys.map((k) => stmts[k]));
  const out = { days, from, now, tz: 'America/Toronto' };
  keys.forEach((k, i) => { out[k] = results[i].results; });
  out.preloads = out.preloads[0].n; out.kpi = out.kpi[0]; out.prev = out.prev[0]; out.live = out.live[0];
  return json(out);
}

// Devices: views from the same network (IPv4 address, or IPv6 /64, which phones rotate within) and the
// same browser identity are grouped as one device. Anonymous views fall back to the daily visitor id.
function deviceKey(r) {
  if (!r.ip) return 'v:' + (r.vid || r.pid);
  const ip = r.ip.includes(':') ? r.ip.split(':').slice(0, 4).join(':') + '::/64' : r.ip;
  return ip + '|' + (r.ua || '');
}
const opened = (r) => !!(r.sections || r.total_ms > 0 || r.active_ms > 0);

async function devices(db, url) {
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const from = Date.now() - days * 86400000;
  const rows = (await db.prepare(`SELECT * FROM pageviews WHERE ts >= ? ORDER BY ts DESC LIMIT 5000`).bind(from).all()).results;
  const wanted = url.searchParams.get('device');
  if (wanted) {
    const mine = rows.filter((r) => deviceKey(r) === wanted);
    const pids = mine.slice(0, 90).map((r) => r.pid);
    let events = [];
    if (pids.length) {
      events = (await db.prepare(`SELECT pid, at_ms, kind, name, href, section FROM events WHERE pid IN (${pids.map(() => '?').join(',')}) ORDER BY pid, at_ms, id`).bind(...pids).all()).results;
    }
    return json({ key: wanted, visits: mine, events });
  }
  const map = new Map();
  for (const r of rows) {
    const k = deviceKey(r);
    let d = map.get(k);
    if (!d) {
      d = { key: k, last: r.ts, first: r.ts, views: 0, opened: 0, active_ms: 0, max_scroll: 0, clicks: 0, ips: new Set(), days: new Set(),
        latest: { ip: r.ip, country: r.country, region: r.region, city: r.city, postal: r.postal, asorg: r.asorg, device: r.device, os: r.os, browser: r.browser,
          screen: r.screen, dpr: r.dpr, lang: r.lang, tz: r.tz, info: r.info, ua: r.ua, consent: r.consent } };
      map.set(k, d);
    }
    d.first = Math.min(d.first, r.ts);
    d.views++; if (opened(r)) d.opened++;
    d.active_ms += r.active_ms || 0; d.max_scroll = Math.max(d.max_scroll, r.max_scroll || 0); d.clicks += r.clicks || 0;
    if (r.ip) d.ips.add(r.ip); d.days.add(r.day);
  }
  const list = [...map.values()].map((d) => ({ ...d, ips: [...d.ips].slice(0, 10), days: d.days.size })).sort((a, b) => b.last - a.last).slice(0, 300);
  return json({ days, devices: list });
}
