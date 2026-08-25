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

  // ── Progressive enhancements shared by both paths ─────────
  // (pre-rendered shells and the runtime-rendered fallback)

  function addCopyButtons(scope) {
    scope.querySelectorAll('pre').forEach(function (pre) {
      // The button lives in a positioned wrapper OUTSIDE the scrollable
      // <pre>: as a child it would scroll away with wide code and its label
      // would pollute manual text selection.
      if (pre.parentNode.classList && pre.parentNode.classList.contains('pre-wrap')) return;
      var wrap = document.createElement('div');
      wrap.className = 'pre-wrap';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.textContent : pre.textContent).then(function () {
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        }, function () { btn.textContent = 'Failed'; });
      });
      wrap.appendChild(btn);
    });
  }

  function addSourceBar(scope) {
    if (document.querySelector('.guide-source-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'guide-source-bar';
    var copyMd = document.createElement('button');
    copyMd.type = 'button';
    copyMd.className = 'guide-source-btn';
    copyMd.textContent = 'Copy page as Markdown';
    copyMd.addEventListener('click', function () {
      fetch(src, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (md) { return navigator.clipboard.writeText(md); })
        .then(function () {
          copyMd.textContent = 'Copied!';
          setTimeout(function () { copyMd.textContent = 'Copy page as Markdown'; }, 1500);
        })
        .catch(function () { copyMd.textContent = 'Copy failed'; });
    });
    var view = document.createElement('a');
    view.className = 'guide-source-link';
    view.href = src;
    view.textContent = 'View Markdown source';
    bar.appendChild(copyMd);
    bar.appendChild(view);
    scope.parentNode.insertBefore(bar, scope);
  }

  function enhance(scope) {
    addSourceBar(scope);
    addCopyButtons(scope);
    if (window.Prism && typeof window.Prism.highlightAllUnder === 'function') {
      window.Prism.highlightAllUnder(scope);
    }
  }

  // ── Pre-rendered path ─────────────────────────────────────
  // build-guides.ts bakes the rendered article and its JSON-LD into the
  // shell (rule guide-render-sync keeps it fresh). Nothing to fetch. The
  // layout-affecting enhancements (source bar, copy buttons) run at once —
  // deferring them behind the Prism wait used to shift the whole article
  // down up to 2s after render. Only the highlighting waits for Prism.
  if (container.getAttribute('data-prerendered') === 'true') {
    addSourceBar(container);
    addCopyButtons(container);
    var tries = 20;
    (function highlightWhenReady() {
      if (window.Prism && typeof window.Prism.highlightAllUnder === 'function') {
        window.Prism.highlightAllUnder(container);
        return;
      }
      if (tries-- > 0) setTimeout(highlightWhenReady, 100);
    })();
    return;
  }

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
      '<code>npm run docs:serve</code><br><br>' +
      'Then open <a href="http://localhost:5000/guides/" target="_blank">localhost:5000/guides/</a> in your browser.<br>' +
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

        // Copy buttons, source bar, Prism
        enhance(container);

        // Update document title from first <h1>
        var h1 = container.querySelector('h1');
        if (h1) {
          document.title = h1.textContent.trim() + ' — pdfnative';
        }

        // Inject structured data (JSON-LD) derived from the rendered content.
        // Non-fatal: a malformed graph must never break the page.
        try {
          injectStructuredData(container, h1, src);
        } catch (sdErr) {
          /* structured data is progressive enhancement only */
        }
      })
      .catch(function (err) { showError(err.message); });
  }

  // ── Structured data (schema.org JSON-LD) ──────────────────
  // BreadcrumbList + TechArticle for every guide, plus a FAQPage
  // when the page is the FAQ — all derived from the visible DOM so
  // the markup can never drift from the rendered content.
  function injectStructuredData(container, h1, src) {
    var canonicalEl = document.querySelector('link[rel="canonical"]');
    var canonical = canonicalEl ? canonicalEl.href : location.href.split('#')[0];
    var descMeta = document.querySelector('meta[name="description"]');
    var description = descMeta ? (descMeta.getAttribute('content') || '') : '';
    var headline = h1 ? h1.textContent.trim() : document.title.replace(/ — pdfnative$/, '');

    var graph = [];

    var breadcrumb = buildBreadcrumb(canonical, headline);
    if (breadcrumb) graph.push(breadcrumb);

    graph.push({
      '@type': 'TechArticle',
      'headline': headline,
      'description': description,
      'inLanguage': 'en',
      'author': { '@type': 'Organization', 'name': 'Nizoka', 'url': 'https://github.com/Nizoka' },
      'publisher': {
        '@type': 'Organization',
        'name': 'pdfnative',
        'url': 'https://pdfnative.dev',
        'logo': { '@type': 'ImageObject', 'url': 'https://pdfnative.dev/assets/logo.svg' }
      },
      'mainEntityOfPage': { '@type': 'WebPage', '@id': canonical },
      'isPartOf': { '@type': 'WebSite', 'name': 'pdfnative', 'url': 'https://pdfnative.dev' }
    });

    if (/(^|\/)faq\.md$/i.test(src)) {
      var faq = buildFaqPage(container);
      if (faq) graph.push(faq);
    }

    var ld = { '@context': 'https://schema.org', '@graph': graph };
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  function buildBreadcrumb(canonical, headline) {
    var bcEl = document.querySelector('.guide-breadcrumb');
    if (!bcEl) return null;
    var items = [];
    var pos = 1;
    bcEl.querySelectorAll('a').forEach(function (a) {
      items.push({
        '@type': 'ListItem',
        'position': pos++,
        'name': a.textContent.trim(),
        'item': a.href
      });
    });
    items.push({ '@type': 'ListItem', 'position': pos, 'name': headline, 'item': canonical });
    return { '@type': 'BreadcrumbList', 'itemListElement': items };
  }

  function buildFaqPage(container) {
    var questions = container.querySelectorAll('h3');
    if (!questions.length) return null;
    var mainEntity = [];
    questions.forEach(function (h3) {
      var question = h3.textContent.trim();
      var parts = [];
      var node = h3.nextElementSibling;
      while (node && node.tagName !== 'H3' && node.tagName !== 'H2' && node.tagName !== 'H1') {
        var txt = node.textContent.trim();
        if (txt) parts.push(txt);
        node = node.nextElementSibling;
      }
      var answer = parts.join('\n\n').trim();
      if (question && answer) {
        mainEntity.push({
          '@type': 'Question',
          'name': question,
          'acceptedAnswer': { '@type': 'Answer', 'text': answer }
        });
      }
    });
    if (!mainEntity.length) return null;
    return { '@type': 'FAQPage', 'mainEntity': mainEntity };
  }

  tryRender(20);
})();
