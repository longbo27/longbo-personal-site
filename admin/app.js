(function () {
  var app = document.getElementById('app');
  var status = document.getElementById('status');
  var days = 7;
  try { days = Number(localStorage.getItem('lx-admin-days')) || 7; } catch (e) {}

  var SECTION = { top: '首屏', note: '自述 Note', pursuits: '所好 Pursuits', maxim: '格言', correspondence: '联络 Correspondence', footer: '页脚' };
  var DEVICE = { desktop: '电脑', mobile: '手机', tablet: '平板' };
  var tz = 'America/Toronto';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }
  function secs(ms) { var s = Math.round((ms || 0) / 1000); return s < 60 ? s + ' 秒' : Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒'; }
  function pct(x) { return Math.round((x || 0) * 100) + '%'; }
  function when(ts) {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
  }
  function flag(cc) {
    if (!cc || cc.length !== 2 || cc === 'XX' || cc === 'T1') return '';
    return String.fromCodePoint(127397 + cc.charCodeAt(0), 127397 + cc.charCodeAt(1)) + ' ';
  }
  function delta(cur, prev, fmt) {
    if (!prev) return '<span class="d">上期无数据</span>';
    var d = (cur - prev) / prev;
    var cls = d > 0.005 ? 'up' : d < -0.005 ? 'down' : '';
    return '<span class="d ' + cls + '">' + (d > 0 ? '+' : '') + Math.round(d * 100) + '% 对比上期（' + fmt(prev) + '）</span>';
  }

  function list(title, sub, rows, label) {
    var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 0) || 1;
    var body = rows.length ? rows.map(function (r) {
      var l = label ? label(r) : (r.k || '（未知）');
      return '<div class="r"><i class="b" style="width:' + (r.n / max * 100).toFixed(1) + '%"></i><span title="' + esc(l) + '">' + esc(l) + '</span><span class="n">' + num(r.n) + (r.u != null ? ' · ' + num(r.u) + ' 人' : '') + '</span></div>';
    }).join('') : '<div class="empty">暂无数据</div>';
    return '<section class="card"><h2>' + esc(title) + '</h2><p class="sub">' + esc(sub) + '</p><div class="rows">' + body + '</div></section>';
  }

  function ordered(rows, order) {
    var map = {}; rows.forEach(function (r) { map[r.k] = r.n; });
    return order.map(function (k) { return { k: k, n: map[k] || 0 }; });
  }

  function dailyChart(d) {
    var byDay = {}; d.daily.forEach(function (r) { byDay[r.k] = r; });
    var cells = [], fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (d.days === 1) {
      var h = {}; d.hours.forEach(function (r) { h[r.k] = r.n; });
      for (var i = 0; i < 24; i++) cells.push({ k: i + ':00', n: h[i] || 0, u: null });
    } else {
      for (var t = d.from; t <= d.now + 1; t += 86400000) {
        var k = fmt.format(new Date(t));
        if (cells.length && cells[cells.length - 1].k === k) continue;
        cells.push({ k: k, n: byDay[k] ? byDay[k].n : 0, u: byDay[k] ? byDay[k].u : 0 });
      }
    }
    var max = cells.reduce(function (m, c) { return Math.max(m, c.n); }, 0) || 1;
    var bars = cells.map(function (c) {
      return '<div class="c" title="' + esc(c.k + '：' + c.n + ' 次浏览' + (c.u != null ? '，' + c.u + ' 位访客' : '')) + '"><i style="height:' + (c.n / max * 100).toFixed(1) + '%"></i>' +
        (c.u != null ? '<i class="u" style="height:' + (c.u / max * 100).toFixed(1) + '%"></i>' : '') + '</div>';
    }).join('');
    return '<section class="card wide"><h2>' + (d.days === 1 ? '按小时（多伦多时间，近 ' + d.days * 24 + ' 小时内的时段分布）' : '每日趋势（多伦多时间）') + '</h2>' +
      '<div class="legend"><span><b style="background:var(--bar)"></b>浏览量</span>' + (d.days === 1 ? '' : '<span><b style="background:var(--accent)"></b>访客</span>') + '<span>峰值 ' + num(max) + '</span></div>' +
      '<div class="chart">' + bars + '</div><div class="axis"><span>' + esc(cells[0] ? cells[0].k : '') + '</span><span>' + esc(cells.length ? cells[cells.length - 1].k : '') + '</span></div></section>';
  }

  function parseInfo(v) { try { return JSON.parse(v.info || '{}'); } catch (e) { return {}; } }
  function model(v) { return parseInfo(v).model || ''; }

  function visitsTable(rows) {
    if (!rows.length) return '<section class="card wide"><h2>最近访问</h2><div class="empty">暂无数据</div></section>';
    var tr = rows.map(function (v) {
      var place = flag(v.country) + [v.city, v.region, v.country].filter(Boolean).join(', ');
      var src = v.utm_source ? 'utm: ' + v.utm_source + (v.utm_campaign ? ' / ' + v.utm_campaign : '') : (v.ref_host || '直接访问');
      var secsSeen = (v.sections || '').split(',').filter(Boolean).map(function (s) { return '<span class="tag">' + esc(SECTION[s] || s) + '</span>'; }).join('');
      return '<tr class="v" data-pid="' + esc(v.pid) + '"><td>' + esc(when(v.ts)) + '</td><td>' + esc(place || '未知') + (v.ip ? '<br><code>' + esc(v.ip) + '</code>' : '') + (v.asorg ? '<br><span class="n" style="color:var(--muted)">' + esc(v.asorg) + '</span>' : '') + '</td>' +
        '<td>' + esc((DEVICE[v.device] || v.device) + (model(v) ? '（' + model(v) + '）' : '') + ' · ' + v.os + ' · ' + v.browser) + '<br><span style="color:var(--muted)">' + esc(v.screen + ' · ' + (v.lang || '') + ' · 站点' + (v.site_lang === 'zh' ? '中文' : 'EN')) + '</span></td>' +
        '<td>' + esc(src) + '</td><td>' + esc(secs(v.active_ms)) + '</td><td>' + esc(v.max_scroll + '%') + '</td><td>' + esc(v.clicks) + '</td><td>' + secsSeen + '</td></tr>';
    }).join('');
    return '<section class="card wide"><h2>最近访问（点一行看完整轨迹）</h2><p class="sub">每行是一次页面浏览。“独立访客”按每天更换的标识计算；跨天同一个人可通过 IP 大致判断。</p><div class="scroll"><table><thead><tr><th>时间</th><th>地区 / IP / 网络</th><th>设备</th><th>来源</th><th>停留</th><th>滚动</th><th>点击</th><th>看过的板块</th></tr></thead><tbody>' + tr + '</tbody></table></div></section>';
  }

  function render(d) {
    var k = d.kpi, p = d.prev;
    var html = '<div class="kpis">' +
      kpi('浏览量', num(k.pv), delta(k.pv, p.pv, num)) +
      kpi('独立访客', num(k.uv), delta(k.uv, p.uv, num)) +
      kpi('平均有效停留', secs(k.avg_active), delta(k.avg_active, p.avg_active, secs)) +
      kpi('平均滚动深度', Math.round(k.avg_scroll) + '%', delta(k.avg_scroll, p.avg_scroll, function (x) { return Math.round(x) + '%'; })) +
      kpi('互动率', pct(k.engaged), '<span class="d">停留 ≥10 秒、滚过一半或有点击</span>') +
      kpi('近 30 分钟', num(d.live.pv) + ' 次', '<span class="d">' + num(d.live.uv) + ' 位访客</span>') +
      '</div>';
    html += '<div class="grid">' + dailyChart(d);
    var pvTotal = k.pv || 1;
    var order = ['top', 'note', 'pursuits', 'maxim', 'correspondence', 'footer'];
    var secMap = {}; d.sections.forEach(function (r) { secMap[r.k] = r; });
    html += list('板块到达率', '有多少比例的浏览看到了这个板块（至少 40% 进入屏幕），以及平均第几秒看到', order.map(function (s) { var r = secMap[s] || { n: 0, at: 0 }; return { k: s, n: r.n, at: r.at }; }),
      function (r) { return (SECTION[r.k] || r.k) + '  ' + Math.round(r.n / pvTotal * 100) + '%' + (r.n ? '  · 第 ' + Math.round(r.at / 1000) + ' 秒' : ''); });
    html += list('点击了什么', '链接与按钮，含所在板块', d.clicks, function (r) { return r.k + (r.section ? '  ［' + (SECTION[r.section] || r.section) + '］' : '') + (r.href && r.href.charAt(0) !== '#' ? '  → ' + r.href.replace(/^https?:\/\//, '') : ''); });
    html += list('最远滚动到', '每次浏览的最大滚动深度', ordered(d.scroll, ['0–24%', '25%', '50%', '75%', '100%']));
    html += list('有效停留时长', '只计页面可见且有操作的时间', ordered(d.time, ['<5s', '5–15s', '15–30s', '30–60s', '1–3m', '3m+']));
    html += list('来源网站', '按来访的上一个网站', d.referrers);
    html += list('推广链接 UTM', 'source / medium / campaign，例如 ?utm_source=linkedin', d.utm);
    html += list('国家 / 地区', 'Cloudflare 按 IP 推断', d.countries, function (r) { return flag(r.k) + (r.k || '未知'); });
    html += list('城市', '城市级，可能有偏差', d.cities);
    html += list('网络运营商 / 机构', '访客所用网络的归属（ASN），如运营商、学校或公司', d.networks);
    html += list('IP 地址', '浏览最多的 IP（同一 IP 可能是一家公司或学校的多人）', d.ips);
    html += list('设备类型', '', d.devices, function (r) { return DEVICE[r.k] || r.k || '未知'; });
    html += list('浏览器', '', d.browsers);
    html += list('操作系统', '', d.os);
    html += list('屏幕分辨率', 'CSS 像素', d.screens);
    html += list('设备语言', 'navigator.language', d.langs);
    html += list('站点语言 / 外观', '首次加载时显示的语言与主题，以及设备的深浅色偏好', d.siteLang.map(function (r) { return { k: r.k === 'zh' ? '中文' : 'English', n: r.n, u: r.u }; }).concat(d.theme.map(function (r) { return { k: (r.k || '').replace('champagne', '香槟金').replace('night', '曜金').replace('(device dark)', '（设备深色）').replace('(device light)', '（设备浅色）'), n: r.n, u: r.u }; })));
    html += list('统计同意情况', '仅在开启访客提示弹窗时有区分；“未询问”表示当时弹窗是关闭的', d.consent, function (r) { return { yes: '同意完整统计', anon: '仅匿名（不含 IP 与设备）', none: '未询问' }[r.k] || r.k; });
    html += list('页面', '', d.paths);
    html += visitsTable(d.visits);
    html += '</div>';
    app.innerHTML = html;
  }
  function kpi(l, v, d) { return '<div class="kpi"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div>' + d + '</div>'; }

  function load() {
    status.textContent = '加载中…';
    fetch('/admin/api/stats?days=' + days, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.j && x.j.message || '加载失败');
        render(x.j);
        status.textContent = '已更新 ' + when(x.j.now) + '（多伦多时间）· 数据保留 90 天 · 不含你自己标记为不统计的设备';
      })
      .catch(function (e) { status.textContent = ''; app.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  }

  app.addEventListener('click', function (e) {
    var row = e.target.closest('tr.v');
    if (!row) return;
    var next = row.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); return; }
    var pid = row.getAttribute('data-pid');
    var tr = document.createElement('tr'); tr.className = 'detail';
    tr.innerHTML = '<td colspan="8"><div class="tl">加载中…</div></td>';
    row.after(tr);
    fetch('/admin/api/stats?visit=' + encodeURIComponent(pid), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var v = j.visit || {};
      var lines = ['<div><span class="t">0 秒</span>打开 ' + esc(v.path || '/') + (v.hash ? esc(v.hash) : '') + (v.ref ? '，来自 ' + esc(v.ref) : '') + '</div>'];
      (j.events || []).forEach(function (ev) {
        var t = '<span class="t">' + Math.round(ev.at_ms / 1000) + ' 秒</span>';
        if (ev.kind === 'section') lines.push('<div>' + t + '看到 ' + esc(SECTION[ev.name] || ev.name) + '</div>');
        else lines.push('<div>' + t + '点击「' + esc(ev.name) + '」' + (ev.section ? '（' + esc(SECTION[ev.section] || ev.section) + '）' : '') + (ev.href ? ' → ' + esc(ev.href) : '') + '</div>');
      });
      lines.push('<div><span class="t">' + Math.round((v.total_ms || 0) / 1000) + ' 秒</span>最后一次心跳 · 有效停留 ' + esc(secs(v.active_ms)) + ' · 最远滚动 ' + esc(v.max_scroll) + '%</div>');
      if (j.sameVisitorToday && j.sameVisitorToday.length > 1) lines.push('<div style="margin-top:6px;color:var(--muted)">同一访客今天共浏览 ' + j.sameVisitorToday.length + ' 次</div>');
      var inf = parseInfo(v);
      var dev = [
        ['IP', v.ip], ['ASN', v.asn ? 'AS' + v.asn + (v.asorg ? ' ' + v.asorg : '') : v.asorg],
        ['位置', [v.city, v.region, v.postal, v.country].filter(Boolean).join(', ') + (v.lat != null ? '（约 ' + v.lat + ', ' + v.lon + '，城市级精度）' : '')],
        ['设备', [DEVICE[v.device] || v.device, inf.model, v.os, inf.platformVersion && '系统版本 ' + inf.platformVersion, inf.arch].filter(Boolean).join(' · ')],
        ['浏览器', inf.brands || v.browser],
        ['硬件', [inf.cores && inf.cores + ' 核 CPU', inf.mem && '≥' + inf.mem + ' GB 内存', inf.touchPoints ? inf.touchPoints + ' 点触控' : '无触控'].filter(Boolean).join(' · ')],
        ['屏幕', [v.screen, inf.availW && '可用 ' + inf.availW + '×' + inf.availH, v.viewport && '窗口 ' + v.viewport, 'DPR ' + v.dpr, inf.colorDepth && inf.colorDepth + ' 位色', inf.orientation, inf.hdr && 'HDR', inf.wideGamut && 'P3 广色域'].filter(Boolean).join(' · ')],
        ['网络', [inf.net, inf.downlink && inf.downlink + ' Mbps', inf.rtt != null && inf.rtt !== undefined && 'RTT ' + inf.rtt + ' ms', inf.saveData && '省流量', inf.http, inf.tls].filter(Boolean).join(' · ')],
        ['语言', [inf.langs || v.lang, v.tz].filter(Boolean).join(' · ')],
        ['偏好', [v.dark ? '设备深色' : '设备浅色', inf.reducedMotion && '减少动画', inf.standalone && '已添加到主屏', inf.pdf && '内置 PDF'].filter(Boolean).join(' · ')],
        ['UA', v.ua]
      ].filter(function (x) { return x[1]; });
      lines.push('<div style="margin-top:8px"></div>' + dev.map(function (x) { return '<div><span class="t">' + esc(x[0]) + '</span>' + esc(x[1]) + '</div>'; }).join(''));
      lines.push('<div style="margin-top:6px;color:var(--muted)">' + esc([v.tz, v.colo && 'Cloudflare 节点 ' + v.colo, v.viewport && '窗口 ' + v.viewport, v.dpr && 'DPR ' + v.dpr, v.touch ? '触屏' : '', v.dark ? '设备深色' : '设备浅色'].filter(Boolean).join(' · ')) + '</div>');
      tr.innerHTML = '<td colspan="8"><div class="tl">' + lines.join('') + '</div></td>';
    }).catch(function () { tr.innerHTML = '<td colspan="8"><div class="tl">加载失败</div></td>'; });
  });

  var range = document.getElementById('range');
  function syncRange() { range.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-days')) === days)); }); }
  range.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    days = Number(b.getAttribute('data-days'));
    try { localStorage.setItem('lx-admin-days', String(days)); } catch (er) {}
    syncRange(); load();
  });
  document.getElementById('refresh').addEventListener('click', load);

  var nt = document.getElementById('notrack');
  function syncNt() {
    var on = false; try { on = localStorage.getItem('lx-notrack') === '1'; } catch (e) {}
    nt.textContent = on ? '本设备已排除（点此恢复统计）' : '不统计本设备';
    return on;
  }
  nt.addEventListener('click', function () {
    var on = syncNt();
    try { if (on) localStorage.removeItem('lx-notrack'); else localStorage.setItem('lx-notrack', '1'); } catch (e) {}
    syncNt();
  });
  var ct = document.getElementById('consentToggle');
  function showConsent(on) {
    ct.setAttribute('aria-pressed', String(on));
    ct.textContent = '访客提示弹窗：' + (on ? '已开启' : '已关闭');
  }
  function loadSettings() {
    fetch('/admin/api/settings', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { if (typeof j.consent === 'boolean') showConsent(j.consent); }).catch(function () { ct.textContent = '访客提示弹窗：读取失败'; });
  }
  ct.addEventListener('click', function () {
    var next = ct.getAttribute('aria-pressed') !== 'true';
    ct.disabled = true;
    fetch('/admin/api/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: next }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { showConsent(!!j.consent); status.textContent = j.consent ? '已开启访客提示弹窗，约 30 秒内对新访客生效。' : '已关闭访客提示弹窗，约 30 秒内生效。'; })
      .catch(function () { status.textContent = '切换失败，请重试'; })
      .then(function () { ct.disabled = false; });
  });

  syncNt(); syncRange(); loadSettings(); load();
})();
