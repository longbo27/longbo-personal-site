// Guards everything under /admin (the dashboard page, its script and its API).
// Sign-in is HTTP Basic auth against the ADMIN_PASSWORD secret set in the Pages project.
// Without that secret the dashboard stays locked for everyone.

const enc = new TextEncoder();
async function same(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

const SECURITY = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY'
};

function deny(msg) {
  return new Response(msg, {
    status: 401,
    headers: { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Basic realm="longbo.cloud analytics", charset="UTF-8"' }
  });
}

export async function onRequest({ request, env, next }) {
  const secret = env.ADMIN_PASSWORD;
  if (!secret || secret.length < 12) return deny('Dashboard locked: set an ADMIN_PASSWORD secret (12+ characters) in the Cloudflare Pages project.');
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Basic ')) return deny('Sign in required.');
  let pass = '';
  try { const raw = atob(h.slice(6)); pass = raw.slice(raw.indexOf(':') + 1); } catch { return deny('Sign in required.'); }
  if (!(await same(pass, secret))) return deny('Wrong password.');
  const res = await next();
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
  return out;
}
