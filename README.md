# longbo-personal-site
Personal website of Longbo Xian

## Analytics

First-party analytics live in `assets/a.js` (tracker), `functions/api/collect.js` (ingest) and `/admin/` (dashboard).

Cloudflare Pages settings (Production and Preview):
- D1 binding `DB` → database `longbo-analytics` (tables are created automatically).
- Secret `ADMIN_PASSWORD` (12+ characters): HTTP Basic auth for `/admin/`; any username.

Data is kept 90 days. Browsers sending Global Privacy Control or Do Not Track are not recorded.
Any change to the inline `<script>` in `index.html` must update its sha256 hash in `_headers`.
