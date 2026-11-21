(function () {
  var root = document.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // Language: English is written in the markup, Chinese lives in data-zh.
  var textNodes = document.querySelectorAll('[data-zh]');
  var ariaNodes = document.querySelectorAll('[data-aria-zh]');
  textNodes.forEach(function (el) { el.setAttribute('data-en', el.innerHTML); });
  ariaNodes.forEach(function (el) { el.setAttribute('data-aria-en', el.getAttribute('aria-label') || ''); });
  var langButtons = document.querySelectorAll('[data-set-lang]');

  function setLang(lang, save) {
    var zh = lang === 'zh';
    root.lang = zh ? 'zh-CN' : 'en';
    textNodes.forEach(function (el) {
      var zhText = el.getAttribute('data-zh');
      if (zh) {
        // Keep trailing icons: replace only the leading text when the element holds an svg.
        var svg = el.querySelector('svg');
        el.innerHTML = '';
        el.appendChild(document.createTextNode(zhText));
        if (svg) { el.appendChild(document.createTextNode(' ')); el.appendChild(svg); }
      } else {
        el.innerHTML = el.getAttribute('data-en');
      }
    });
    ariaNodes.forEach(function (el) {
      el.setAttribute('aria-label', zh ? el.getAttribute('data-aria-zh') : el.getAttribute('data-aria-en'));
    });
    langButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang)); });
    updateThemeLabel();
    if (save) store.set('lx-lang', lang);
  }

  // Appearance: Gold night by default, Champagne on request.
  var themeButton = document.getElementById('theme');
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  function updateThemeLabel() {
    var night = root.getAttribute('data-theme') !== 'champagne';
    var zh = root.lang === 'zh-CN';
    themeButton.setAttribute('aria-label', night ? (zh ? '切换到香槟金' : 'Switch to Champagne') : (zh ? '切换到曜金' : 'Switch to Gold night'));
  }
  function setTheme(theme, save) {
    root.setAttribute('data-theme', theme);
    themeMeta.setAttribute('content', theme === 'champagne' ? '#F4ECDC' : '#11120E');
    updateThemeLabel();
    if (save) store.set('lx-theme', theme);
  }

  langButtons.forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang'), true); });
  });
  themeButton.addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'champagne' ? 'night' : 'champagne', true);
  });

  var dialog = document.getElementById('privacy');
  var privacyButton = document.getElementById('privacy-open');
  if (dialog && typeof dialog.showModal === 'function') {
    privacyButton.hidden = false;
    privacyButton.addEventListener('click', function () { dialog.showModal(); });
  }

  document.getElementById('lang').hidden = false;
  themeButton.hidden = false;
  document.getElementById('year').textContent = String(new Date().getFullYear());

  setTheme(root.getAttribute('data-theme') || 'night', false);

  // With no saved choice, follow the device: light mode means Champagne, dark means Gold night.
  // A manual toggle is saved and wins from then on.
  if (window.matchMedia) {
    var light = window.matchMedia('(prefers-color-scheme: light)');
    var follow = function (e) {
      var saved = store.get('lx-theme');
      if (saved !== 'champagne' && saved !== 'night') setTheme(e.matches ? 'champagne' : 'night', false);
    };
    if (light.addEventListener) light.addEventListener('change', follow);
    else if (light.addListener) light.addListener(follow);
  }
  if (root.getAttribute('data-lang-pending') === 'zh') { root.removeAttribute('data-lang-pending'); setLang('zh', false); }
})();
