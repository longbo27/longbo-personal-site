/* First-party, cookieless analytics for longbo.cloud.
   No cookies, no local or session storage, no canvas/WebGL/audio fingerprinting, no third parties.
   Each page load gets a random id that lives only in memory. The server stores the IP
   address and the device details below for 90 days, as the site's privacy note says.
   Browsers that send Global Privacy Control or Do Not Track are not counted. */
(function () {
  var nav = navigator, doc = document, root = doc.documentElement;
  var optedOut = false;
  try { optedOut = localStorage.getItem('lx-notrack') === '1'; } catch (e) {}
  if (optedOut || nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (nav.webdriver) return;

  var ENDPOINT = '/api/collect';
  var pid = '';
  try {
    var b = new Uint8Array(8); crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) pid += (b[i] + 256).toString(16).slice(1);
  } catch (e) { pid = String(Math.random()).slice(2, 18); }

  var start = Date.now();
  function t() { return Date.now() - start; }

  function send(payload, beacon) {
    var body = JSON.stringify(payload);
    try {
      if (beacon && nav.sendBeacon && nav.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
      fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } });
    } catch (e) {}
  }

  // 1) Page view
  var q = new URLSearchParams(location.search);
  var utm = {};
  ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) { var v = q.get('utm_' + k); if (v) utm[k] = v; });
  if (!utm.source && q.get('ref')) utm.source = q.get('ref');
  var mq = function (s) { try { return window.matchMedia(s).matches; } catch (e) { return false; } };
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var pv = {
    t: 'pv', pid: pid,
    path: location.pathname, hash: location.hash.slice(0, 40),
    ref: doc.referrer || '', utm: utm,
    sw: screen.width, sh: screen.height, vw: innerWidth, vh: innerHeight, dpr: window.devicePixelRatio || 1,
    lang: nav.language || '', tz: tz,
    dark: mq('(prefers-color-scheme: dark)'), touch: mq('(pointer: coarse)'),
    theme: root.getAttribute('data-theme') || '', sitelang: root.getAttribute('data-lang-pending') === 'zh' || root.lang === 'zh-CN' ? 'zh' : 'en'
  };
  // Device details the browser exposes without any prompt.
  var c = nav.connection || {};
  pv.info = {
    langs: (nav.languages || []).slice(0, 6).join(','),
    cores: nav.hardwareConcurrency || null, mem: nav.deviceMemory || null,
    touchPoints: nav.maxTouchPoints || 0, platform: nav.platform || '',
    net: c.effectiveType || '', downlink: c.downlink || null, rtt: c.rtt || null, saveData: !!c.saveData,
    colorDepth: screen.colorDepth || null, orientation: (screen.orientation && screen.orientation.type) || '',
    availW: screen.availWidth, availH: screen.availHeight,
    reducedMotion: mq('(prefers-reduced-motion: reduce)'), hdr: mq('(dynamic-range: high)'), wideGamut: mq('(color-gamut: p3)'),
    standalone: mq('(display-mode: standalone)') || nav.standalone === true,
    pdf: nav.pdfViewerEnabled === true, cookies: nav.cookieEnabled === true
  };
  var pvSent = false;
  function sendPv() { if (pvSent) return; pvSent = true; send(pv, false); }
  if (nav.userAgentData && nav.userAgentData.getHighEntropyValues) {
    var timer = setTimeout(sendPv, 400);
    nav.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'architecture', 'bitness', 'fullVersionList']).then(function (h) {
      pv.info.model = h.model || '';
      pv.info.platformVersion = h.platformVersion || '';
      pv.info.arch = (h.architecture || '') + (h.bitness ? '-' + h.bitness : '');
      pv.info.mobile = !!h.mobile;
      pv.info.brands = (h.fullVersionList || []).filter(function (x) { return !/Not.?A.?Brand/i.test(x.brand); }).map(function (x) { return x.brand + ' ' + x.version; }).join(', ');
      clearTimeout(timer); sendPv();
    }, function () { clearTimeout(timer); sendPv(); });
  } else sendPv();

  // 2) Engagement events, batched
  var queue = [];
  function push(ev) { ev.at = t(); queue.push(ev); if (queue.length >= 20) flush(false); }

  // Section views: a section counts once when 40% of it (or 40% of the screen) is visible.
  var seen = {};
  var sections = doc.querySelectorAll('main section[id], #top, .maxim, footer.foot');
  function sectionName(el) { return el.id || (el.classList.contains('maxim') ? 'maxim' : el.classList.contains('foot') ? 'footer' : el.tagName.toLowerCase()); }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = sectionName(en.target);
        var r = en.intersectionRect.height / Math.min(en.boundingClientRect.height || 1, innerHeight || 1);
        if (!seen[n] && r >= 0.4) { seen[n] = 1; push({ k: 'section', n: n }); }
      });
    }, { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] });
    sections.forEach(function (s) { io.observe(s); });
  }

  // Clicks on links and buttons, with the section they sit in.
  doc.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button,[data-track]') : null;
    if (!el) return;
    var en = el.hasAttribute('data-en') ? el : el.querySelector('.t[data-en], [data-en]');
    var label = el.getAttribute('data-track') || (en && en.getAttribute('data-en')) || el.getAttribute('aria-label') || el.textContent || '';
    label = label.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (el.id === 'theme') label = 'theme → ' + (root.getAttribute('data-theme') === 'champagne' ? 'night' : 'champagne');
    if (el.hasAttribute('data-set-lang')) label = 'lang → ' + el.getAttribute('data-set-lang');
    var sec = el.closest('section[id], #top, .maxim, header, footer');
    push({ k: 'click', n: label, h: (el.getAttribute('href') || '').slice(0, 200), s: sec ? (sec.tagName === 'HEADER' ? 'header' : sectionName(sec)) : '' });
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) flush(true);
  }, true);

  // Max scroll depth, as a share of the page.
  var maxScroll = 0;
  function onScroll() {
    var h = Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0) - innerHeight;
    var p = h <= 0 ? 100 : Math.round(Math.min(100, (scrollY / h) * 100));
    if (p > maxScroll) maxScroll = p;
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active time: counts only while the tab is visible and the visitor has acted in the last 30 s.
  var active = 0, lastTick = Date.now(), lastInput = Date.now();
  ['scroll', 'pointerdown', 'pointermove', 'keydown', 'touchstart'].forEach(function (n) {
    addEventListener(n, function () { lastInput = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    var now = Date.now();
    if (doc.visibilityState === 'visible' && now - lastInput < 30000) active += now - lastTick;
    lastTick = now;
  }, 1000);

  function flush(beacon) {
    sendPv();
    var evs = queue.splice(0, queue.length);
    send({ t: 'ev', pid: pid, ev: evs, scroll: maxScroll, active: active, total: t() }, beacon);
  }
  // Heartbeat every 15 s while visible, so long reads are not lost, and a final beacon on leave.
  var lastSent = -1;
  setInterval(function () {
    if (doc.visibilityState !== 'visible') return;
    if (queue.length || active !== lastSent) { lastSent = active; flush(false); }
  }, 15000);
  addEventListener('pagehide', function () { flush(true); });
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flush(true); });
})();
