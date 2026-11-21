// Shared helpers for the first-party analytics (Cloudflare Pages Functions + D1).
// The D1 database must be bound to the Pages project as `DB`.

export const RETENTION_DAYS = 90;
export const SITE_TZ = 'America/Toronto';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pageviews (
    pid TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    hour INTEGER,
    vid TEXT,
    ip TEXT, asn INTEGER, postal TEXT, lat REAL, lon REAL, ua TEXT, info TEXT,
    path TEXT, hash TEXT,
    ref TEXT, ref_host TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
    country TEXT, region TEXT, city TEXT, tz TEXT, asorg TEXT, colo TEXT,
    device TEXT, browser TEXT, os TEXT,
    screen TEXT, viewport TEXT, dpr REAL, touch INTEGER, dark INTEGER,
    lang TEXT, site_lang TEXT, theme TEXT,
    max_scroll INTEGER DEFAULT 0,
    active_ms INTEGER DEFAULT 0,
    total_ms INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    sections TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS pv_ts ON pageviews(ts)`,
  `CREATE INDEX IF NOT EXISTS pv_day ON pageviews(day)`,
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pid TEXT NOT NULL,
    ts INTEGER NOT NULL,
    at_ms INTEGER,
    kind TEXT NOT NULL,
    name TEXT, href TEXT, section TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS ev_pid ON events(pid)`,
  `CREATE INDEX IF NOT EXISTS ev_ts ON events(ts)`,
  `CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)`
];

let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready = null; throw e; });
  return ready;
}

export function localParts(ts) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: SITE_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function clip(v, n) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, n) : null;
}

function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

// A salt per local day, kept only for today. Yesterday's salt is deleted, so a hash can never
// be linked back to an IP or across days.
export async function dailySalt(db, day) {
  const row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  if (row) return row.salt;
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  const salt = hex(b);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, salt),
    db.prepare('DELETE FROM salts WHERE day < ?').bind(day)
  ]);
  const again = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
  return again ? again.salt : salt;
}

export async function visitorHash(salt, ip, ua, host) {
  const data = new TextEncoder().encode(`${salt}|${ip}|${ua}|${host}`);
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
}

export function parseUA(ua) {
  ua = ua || '';
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile|Opera Mini/i.test(ua)) device = 'mobile';
  let os = 'Other';
  if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/HarmonyOS/i.test(ua)) os = 'HarmonyOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = 'Other';
  const rules = [
    [/MicroMessenger/i, 'WeChat'], [/LinkedInApp/i, 'LinkedIn app'], [/FBAN|FBAV|Instagram/i, 'Meta app'],
    [/Edg\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser/, 'Samsung Internet'],
    [/UCBrowser/, 'UC'], [/QQBrowser/, 'QQ'], [/Quark/i, 'Quark'], [/Firefox\/|FxiOS/, 'Firefox'],
    [/CriOS|Chrome\//, 'Chrome'], [/Safari\//, 'Safari']
  ];
  for (const [re, name] of rules) if (re.test(ua)) { browser = name; break; }
  return { device, os, browser };
}

export const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|go-http|java\/|axios|node-fetch|httpclient|scrapy/i;

export function refHost(ref, selfHost) {
  try {
    const u = new URL(ref);
    const h = u.hostname.replace(/^www\./, '');
    if (h === selfHost || h.endsWith('.' + selfHost)) return null;
    return h;
  } catch { return null; }
}

export async function prune(db) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  await db.batch([
    db.prepare('DELETE FROM events WHERE ts < ?').bind(cutoff),
    db.prepare('DELETE FROM pageviews WHERE ts < ?').bind(cutoff)
  ]);
}
