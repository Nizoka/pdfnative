/* ═══════════════════════════════════════════════════════════════
   pdfnative.dev — Guide page renderer
   Loads a companion `.md` from the same dir, renders via marked.js.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Theme toggle (shared with main page) ──────────────────
  var toggle = document.querySelector('.theme-toggle');
  var root = document.documentElement;

  function getPreferred() {
    var stored = localStorage.getItem('theme');
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

  // ── Hamburger menu (shared) ───────────────────────────────
  var hamburger = document.querySelector('.nav-hamburger');
  var navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(open));
      hamburger.textContent = open ? '✕' : '☰';
    });
  }

  // ── Markdown rendering ────────────────────────────────────
  var container = document.getElementById('guide-content');
  if (!container) return;

  var src = container.getAttribute('data-md');
  if (!src) return;

  function showError(msg) {
    container.innerHTML = '<div class="guide-error">' +
      'Failed to load this guide. ' +
      '<a href="https://github.com/Nizoka/pdfnative/blob/main/docs/guides/' +
      encodeURIComponent(src) + '" target="_blank" rel="noopener">View on GitHub</a>.' +
      (msg ? '<br><small>' + escapeHtml(msg) + '</small>' : '') +
      '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Detect file:// protocol — fetch() is blocked by browsers on file://
  // (same-origin policy). Show a helpful message instead of a cryptic error.
  if (window.location.protocol === 'file:') {
    container.innerHTML =
      '<div class="guide-error">' +
      '<strong>Local preview requires a server.</strong><br>' +
      'Browsers block resource loading on <code>file://</code>. ' +
      'Run a local server from the repo root:<br><br>' +
      '<code>cd docs &amp;&amp; npx serve .</code><br><br>' +
      'Then open <a href="http://localhost:3000" target="_blank">localhost:3000</a> in your browser.<br>' +
      '<a href="https://github.com/Nizoka/pdfnative/blob/main/docs/guides/' +
      encodeURIComponent(src) + '" target="_blank" rel="noopener">View this guide on GitHub \u2192</a>' +
      '</div>';
    return;
  }

  // marked + DOMPurify must be loaded by the host page (CDN).
  // We retry a few times in case scripts are still loading.
  function tryRender(retries) {
    if (typeof window.marked === 'undefined' || typeof window.DOMPurify === 'undefined') {
      if (retries > 0) {
        setTimeout(function () { tryRender(retries - 1); }, 100);
        return;
      }
      showError('Markdown renderer unavailable.');
      return;
    }

    fetch(src, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (md) {
        // Configure marked: GFM tables, headerIds for anchor links
        window.marked.use({
          gfm: true,
          breaks: false,
          mangle: false,
          headerIds: true,
        });
        var html = window.marked.parse(md);
        // Sanitize against XSS — guides are trusted but defense-in-depth.
        var clean = window.DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['target', 'rel'],
        });
        container.innerHTML = clean;

        // Open external links in new tab
        container.querySelectorAll('a[href^="http"]').forEach(function (a) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener');
        });

        // If URL has a hash, scroll to it after render
        if (location.hash) {
          var el = document.getElementById(location.hash.slice(1));
          if (el) el.scrollIntoView();
        }

        // Trigger Prism if loaded
        if (window.Prism && typeof window.Prism.highlightAllUnder === 'function') {
          window.Prism.highlightAllUnder(container);
        }

        // Update document title from first <h1>
        var h1 = container.querySelector('h1');
        if (h1) {
          document.title = h1.textContent.trim() + ' — pdfnative';
        }
      })
      .catch(function (err) { showError(err.message); });
  }

  tryRender(20);
})();
