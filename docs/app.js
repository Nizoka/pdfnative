/* ═══════════════════════════════════════════════════════════════
   pdfnative.dev — Interactions
   Theme toggle, tabs, copy-to-clipboard, live demo, GitHub stars, hamburger menu.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Theme toggle ──────────────────────────────────────────
  const toggle = document.querySelector('.theme-toggle');
  const root = document.documentElement;

  function getPreferred() {
    const stored = localStorage.getItem('theme');
    if (stored) return stored;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (toggle) toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  applyTheme(getPreferred());

  if (toggle) {
    toggle.addEventListener('click', function () {
      applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  // ── Hamburger menu ────────────────────────────────────────
  var hamburger = document.querySelector('.nav-hamburger');
  var navLinks = document.querySelector('.nav-links');

  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(open));
      hamburger.textContent = open ? '✕' : '☰';
    });
    // Close menu on link click
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        hamburger.textContent = '☰';
      });
    });
  }

  // ── Copy to clipboard ─────────────────────────────────────
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (!text) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.classList.add('copied');
        var prev = btn.innerHTML;
        btn.innerHTML = '✓';
        setTimeout(function () {
          btn.innerHTML = prev;
          btn.classList.remove('copied');
        }, 1500);
      });
    });
  });

  // ── Code tabs ─────────────────────────────────────────────
  var tabBtns = document.querySelectorAll('.tab-btn');
  var tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-tab');
      tabBtns.forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      var panel = document.getElementById('tab-' + id);
      if (panel) panel.classList.add('active');
    });
  });

  // ── GitHub stars ──────────────────────────────────────────
  var starsEl = document.getElementById('stars-count');
  if (starsEl) {
    var cached = null;
    try {
      var raw = localStorage.getItem('gh-stars');
      if (raw) {
        cached = JSON.parse(raw);
        if (cached && Date.now() - cached.ts < 3600000) {
          starsEl.textContent = formatNumber(cached.count);
        } else {
          cached = null;
        }
      }
    } catch (_) { /* ignore */ }

    if (!cached) {
      fetch('https://api.github.com/repos/Nizoka/pdfnative', { headers: { Accept: 'application/vnd.github.v3+json' } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && typeof data.stargazers_count === 'number') {
            starsEl.textContent = formatNumber(data.stargazers_count);
            try {
              localStorage.setItem('gh-stars', JSON.stringify({ count: data.stargazers_count, ts: Date.now() }));
            } catch (_) { /* ignore */ }
          }
        })
        .catch(function () { /* silently fail — dash stays */ });
    }
  }

  function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  // ── Live Demo ─────────────────────────────────────────────
  var demoBtn = document.getElementById('demo-run');
  var demoCode = document.getElementById('demo-code');
  var demoStatus = document.getElementById('demo-status');
  var demoError = document.getElementById('demo-error');
  var pdfnativeModule = null;

  // CDN URLs to try in order (esm.sh, then unpkg as fallback)
  var CDN_URLS = [
    'https://esm.sh/pdfnative',
    'https://cdn.jsdelivr.net/npm/pdfnative/+esm'
  ];

  async function loadPdfnative() {
    var lastErr = null;
    for (var i = 0; i < CDN_URLS.length; i++) {
      try {
        var mod = await import(CDN_URLS[i]);
        // Handle esm.sh wrapping: named exports may be under .default
        if (typeof mod.buildDocumentPDFBytes === 'function') return mod;
        if (mod.default && typeof mod.default.buildDocumentPDFBytes === 'function') return mod.default;
        if (mod.default && typeof mod.default === 'object') {
          var merged = Object.assign({}, mod, mod.default);
          if (typeof merged.buildDocumentPDFBytes === 'function') return merged;
        }
      } catch (e) { lastErr = e; }
    }
    throw new Error('Could not load pdfnative from CDN. Make sure the package is published to npm. ' + (lastErr ? lastErr.message : ''));
  }

  if (demoBtn && demoCode) {
    demoBtn.addEventListener('click', async function () {
      demoStatus.textContent = 'Loading pdfnative…';
      demoError.style.display = 'none';
      demoBtn.disabled = true;

      try {
        // Lazy-load pdfnative from ESM CDN on first use
        if (!pdfnativeModule) {
          pdfnativeModule = await loadPdfnative();
          demoStatus.textContent = 'Generating PDF…';
        }

        // Extract user code and execute
        var code = demoCode.value;

        // Replace the import statement with our already-loaded module
        var cleanCode = code
          .replace(/import\s*\{[^}]+\}\s*from\s*['"][^'"]+['"]\s*;?/g, '')
          .trim();

        // Create a function scope with pdfnative exports available
        var fn = new Function(
          'buildPDFBytes', 'buildDocumentPDFBytes', 'downloadBlob',
          'buildPDF', 'buildDocumentPDF', 'wrapText',
          cleanCode
        );

        fn(
          pdfnativeModule.buildPDFBytes,
          pdfnativeModule.buildDocumentPDFBytes,
          pdfnativeModule.downloadBlob,
          pdfnativeModule.buildPDF,
          pdfnativeModule.buildDocumentPDF,
          pdfnativeModule.wrapText
        );

        demoStatus.textContent = 'PDF generated!';
        setTimeout(function () { demoStatus.textContent = ''; }, 3000);
      } catch (err) {
        demoError.textContent = err.message || String(err);
        demoError.style.display = 'block';
        demoStatus.textContent = '';
      } finally {
        demoBtn.disabled = false;
      }
    });
  }
})();
