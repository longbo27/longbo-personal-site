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
    sections TEXT DEFAULT '',
    consent TEXT
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
  `CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`
];

// Columns added after the first release; ALTER fails harmlessly when they already exist.
const MIGRATIONS = [`ALTER TABLE pageviews ADD COLUMN consent TEXT`];

let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s)))
    .then(() => Promise.all(MIGRATIONS.map((m) => db.prepare(m).run().catch(() => null))))
    .catch((e) => { ready = null; throw e; });
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

  let os = 'Other', m;
  if ((m = ua.match(/(?:iPhone|iPod)[^)]*?OS (\d+)[_.](\d+)/))) os = `iOS ${m[1]}.${m[2]}`;
  else if (/iPhone|iPod/.test(ua)) os = 'iOS';
  else if ((m = ua.match(/iPad[^)]*?OS (\d+)[_.](\d+)/))) os = `iPadOS ${m[1]}.${m[2]}`;
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if (/HarmonyOS|OpenHarmony/i.test(ua)) os = 'HarmonyOS';
  else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) os = `Android ${m[1]}`;
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  // Since iOS 26, Safari freezes the OS in the UA at 18.x; the real version is in Version/.
  if (/^iOS 18\.[67]$/.test(os) && (m = ua.match(/Version\/(\d+)\.(\d+)/)) && +m[1] >= 26) os = `iOS ${m[1]}.${m[2]}`;

  // In-app browsers first: they wrap Safari/Chrome and would otherwise be mislabelled.
  let browser = 'Other';
  const rules = [
    [/MicroMessenger|WeChat/i, 'WeChat'], [/\bQQ\/\d/, 'QQ'], [/MQQBrowser/, 'QQ Browser'], [/Weibo/i, 'Weibo'],
    [/aweme|BytedanceWebview|Douyin/i, 'Douyin'], [/musical_ly|TikTok/i, 'TikTok'], [/xhsdiscover|XiaoHongShu/i, 'Xiaohongshu'],
    [/DingTalk/i, 'DingTalk'], [/Lark|Feishu/i, 'Feishu/Lark'], [/AlipayClient/i, 'Alipay'], [/baiduboxapp/i, 'Baidu app'],
    [/LinkedInApp/i, 'LinkedIn app'], [/Instagram/i, 'Instagram app'], [/FBAN|FBAV/i, 'Facebook app'], [/Twitter/i, 'X app'],
    [/Snapchat/i, 'Snapchat'], [/\bLine\//, 'LINE'], [/Telegram/i, 'Telegram'], [/GSA\//, 'Google app'],
    [/Edg[A]?\/|EdgiOS/, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser/, 'Samsung Internet'], [/UCBrowser/, 'UC'],
    [/Quark/i, 'Quark'], [/HuaweiBrowser/i, 'Huawei Browser'], [/MiuiBrowser/i, 'Xiaomi Browser'], [/Firefox\/|FxiOS/, 'Firefox'],
    [/CriOS|Chrome\//, 'Chrome'], [/Version\/[\d.]+.*Safari\//, 'Safari'], [/AppleWebKit/, 'WebView']
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

export async function getSetting(db, key, fallback) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}
export function setSetting(db, key, value) {
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}
