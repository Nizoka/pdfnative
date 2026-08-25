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
    if (toggle) {
      toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      toggle.setAttribute('aria-pressed', String(theme === 'dark'));
    }
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
  // Single helper for every copy affordance: the Clipboard API only exists
  // in secure contexts, so guard it and fall back to execCommand on a
  // temporary textarea instead of throwing synchronously in the handler.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* fall through */ }
      ta.remove();
      if (ok) res(); else rej(new Error('Clipboard unavailable'));
    });
  }

  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (!text) return;
      copyText(text).then(function () {
        btn.classList.add('copied');
        var prev = btn.innerHTML;
        btn.innerHTML = '✓';
        setTimeout(function () {
          btn.innerHTML = prev;
          btn.classList.remove('copied');
        }, 1500);
      }, function () {
        btn.classList.add('copied');
        var prev = btn.innerHTML;
        btn.innerHTML = '✗';
        setTimeout(function () {
          btn.innerHTML = prev;
          btn.classList.remove('copied');
        }, 1500);
      });
    });
  });

  // ── Copy-a-URL's-content buttons (e.g. the agent brief) ───
  document.querySelectorAll('[data-copy-url]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.getAttribute('data-copy-url');
      fetch(url, { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(function (text) { return copyText(text); })
        .then(function () {
          var prev = btn.textContent;
          btn.textContent = '✓ Copied';
          setTimeout(function () { btn.textContent = prev; }, 1500);
        })
        .catch(function () { btn.textContent = 'Copy failed'; });
    });
  });

  // ── Comparison quiz — verdicts derived from the table itself ──
  var quiz = document.getElementById('cmp-quiz');
  if (quiz) {
    var quizBoxes = quiz.querySelectorAll('input[data-quiz-cap]');
    var verdictEl = document.getElementById('cmp-quiz-verdict');
    var updateQuiz = function () {
      var caps = [];
      quizBoxes.forEach(function (b) {
        if (b.checked) b.getAttribute('data-quiz-cap').split(',').forEach(function (c) { caps.push(c); });
      });
      document.querySelectorAll('.cmp-table tr[data-cap]').forEach(function (tr) {
        tr.classList.toggle('cmp-hot', caps.indexOf(tr.getAttribute('data-cap')) !== -1);
      });
      if (!caps.length) { verdictEl.hidden = true; return; }
      // Facts, straight from the table rows above: which needs are
      // pdfnative-only, and which are served elsewhere too.
      var only = [];
      if (caps.indexOf('bidi') !== -1) only.push('BiDi shaping');
      if (caps.indexOf('pdfa') !== -1) only.push('built-in PDF/A');
      if (caps.indexOf('sign') !== -1) only.push('digital signatures');
      var msg;
      if (only.length) {
        msg = 'Of the libraries in this table, only pdfnative offers ' + only.join(', ') +
          ' built in (highlighted rows). The others can sometimes get there with extra work — a different claim.';
      } else if (caps.indexOf('parse') !== -1 && caps.length === 1) {
        msg = 'Both pdf-lib and pdfnative read and modify existing PDFs. If that is your whole need, pdf-lib is a solid, widely used choice; pdfnative adds the generation, extraction and verification stack around it.';
      } else if (caps.indexOf('encrypt') !== -1 && caps.length === 1) {
        msg = 'pdfkit, jsPDF and pdfmake also offer AES encryption (pdf-lib does not). pdfnative adds AES-256 write plus RC4/AES read-and-decrypt if you also work with existing files.';
      } else if (caps.indexOf('barcodes') !== -1 && caps.length === 1) {
        msg = 'pdfmake offers QR codes; the five-format barcode set (QR, Code 128, EAN-13, Data Matrix, PDF417) is pdfnative-only in this table.';
      } else {
        msg = 'Several libraries in the table cover parts of this combination — the highlighted rows show who covers what. pdfnative covers all of the ticked rows in one dependency-free package.';
      }
      verdictEl.textContent = msg;
      verdictEl.hidden = false;
    };
    quizBoxes.forEach(function (b) { b.addEventListener('change', updateQuiz); });
  }

  // ── Code tabs ─────────────────────────────────────────────
  // Scoped to the Examples section: other page controls (e.g. the demo's
  // Code/JSON mode switch) must never be captured by this tablist.
  var exampleTabBar = document.querySelector('#examples .tab-bar');
  var tabBtns = exampleTabBar ? exampleTabBar.querySelectorAll('.tab-btn') : [];
  var tabPanels = document.querySelectorAll('.tab-panel');

  function activateTab(btn) {
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
  }

  tabBtns.forEach(function (btn, i) {
    btn.addEventListener('click', function () { activateTab(btn); });
    // Arrow-key navigation between tabs (WAI-ARIA tabs pattern, activation on focus)
    btn.addEventListener('keydown', function (e) {
      var next = null;
      if (e.key === 'ArrowRight') next = (i + 1) % tabBtns.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + tabBtns.length) % tabBtns.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabBtns.length - 1;
      if (next === null) return;
      e.preventDefault();
      tabBtns[next].focus();
      activateTab(tabBtns[next]);
    });
  });

  // ── GitHub stars ──────────────────────────────────────────
  var starsEl = document.getElementById('stars-count');
  if (starsEl) {
    var hasValidCache = false;
    try {
      var raw = localStorage.getItem('gh-stars');
      if (raw) {
        var cached = JSON.parse(raw);
        if (
          cached &&
          typeof cached.count === 'number' &&
          typeof cached.ts === 'number' &&
          Date.now() - cached.ts < 3600000
        ) {
          starsEl.textContent = formatNumber(cached.count);
          hasValidCache = true;
        } else {
          localStorage.removeItem('gh-stars');
        }
      }
    } catch (_) {
      try { localStorage.removeItem('gh-stars'); } catch (__){ /* ignore */ }
    }

    if (!hasValidCache) {
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
        .catch(function (err) {
          console.warn('GitHub stars fetch failed:', err);
        });
    }
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  // ── Live Demo ─────────────────────────────────────────────
  var demoBtn = document.getElementById('demo-run');
  var demoCode = document.getElementById('demo-code');
  var demoStatus = document.getElementById('demo-status');
  var demoError = document.getElementById('demo-error');
  var demoPicker = document.getElementById('demo-picker');
  var demoReset = document.getElementById('demo-reset');
  var demoDescription = document.getElementById('demo-description');
  var demoSourceLink = document.getElementById('demo-source-link');
  var demoDownload = document.getElementById('demo-download');
  var demoShare = document.getElementById('demo-share');
  var demoPreview = document.getElementById('demo-preview');
  var demoPreviewNote = document.getElementById('demo-preview-note');
  var demoJson = document.getElementById('demo-json');
  var demoJsonNote = document.getElementById('demo-json-note');
  var demoModeCode = document.getElementById('demo-mode-code');
  var demoModeJson = document.getElementById('demo-mode-json');
  var demoCopyCli = document.getElementById('demo-copy-cli');
  var demoCopyMcp = document.getElementById('demo-copy-mcp');
  var pdfnativeModule = null;

  // ── Examples gallery ──────────────────────────────────────
  // Each example: { id, label, description, source, code }
  // `source` links to the most relevant generator in scripts/generators/.
  var GENERATORS_BASE = 'https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/';
  var EXAMPLES = [
    {
      id: 'quickstart',
      label: 'Quick Start — Document',
      description: 'Headings, paragraphs, lists, and a simple table — the canonical "hello world".',
      source: GENERATORS_BASE + 'document-builder.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'Hello from pdfnative',",
        '  blocks: [',
        "    { type: 'heading', text: 'My First PDF', level: 1 },",
        "    { type: 'paragraph', text: 'This PDF was generated entirely in your browser — zero server calls, zero dependencies.' },",
        "    { type: 'list', style: 'bullet', items: [",
        "      'ISO 32000-1 compliant',",
        "      '22 Unicode scripts',",
        "      'PDF/A, encryption, signatures',",
        '    ] },',
        "    { type: 'heading', text: 'A Simple Table', level: 2 },",
        "    { type: 'table', headers: ['Feature', 'Status'], rows: [",
        "      { cells: ['TypeScript-first', 'Yes'] },",
        "      { cells: ['Zero dependencies', 'Yes'] },",
        "      { cells: ['Tree-shakeable', 'Yes'] },",
        '    ] },',
        '  ],',
        "  footerText: 'Generated at pdfnative.dev',",
        '});',
        '',
        "downloadBlob(pdf, 'hello-pdfnative.pdf');"
      ].join('\n')
    },
    {
      id: 'financial',
      label: 'Financial — Table-centric',
      description: 'Monthly bank statement using buildPDFBytes() — title, info items, balance, debit/credit rows.',
      source: GENERATORS_BASE + 'financial-statements.ts',
      code: [
        "import { buildPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        'const pdf = buildPDFBytes({',
        "  title: 'Monthly Report',",
        '  infoItems: [',
        "    { label: 'Period',  value: 'January 2026' },",
        "    { label: 'Account', value: 'Main Account' },",
        '  ],',
        "  balanceText: 'Balance: $1,234.56',",
        "  countText: '3 transactions',",
        "  headers: ['Date', 'Description', 'Category', 'Amount', 'Status'],",
        '  rows: [',
        "    { cells: ['01/15', 'Grocery Store', 'Food',   '-$45.00',    ''], type: 'debit',  pointed: false },",
        "    { cells: ['01/16', 'Salary',        'Income', '+$3,000.00', 'X'], type: 'credit', pointed: true },",
        "    { cells: ['01/18', 'Coffee Shop',   'Food',   '-$4.50',     ''], type: 'debit',  pointed: false },",
        '  ],',
        "  footerText: 'Generated by pdfnative.dev',",
        '});',
        '',
        "downloadBlob(pdf, 'monthly-report.pdf');"
      ].join('\n')
    },
    {
      id: 'toc',
      label: 'Table of Contents',
      description: 'Auto-generated TOC with dot leaders, page numbers, and internal /GoTo links.',
      source: GENERATORS_BASE + 'toc-showcase.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'User Manual',",
        '  blocks: [',
        "    { type: 'heading', text: 'User Manual', level: 1 },",
        "    { type: 'toc', title: 'Table of Contents' },",
        "    { type: 'pageBreak' },",
        "    { type: 'heading', text: 'Introduction', level: 1 },",
        "    { type: 'paragraph', text: 'Welcome to pdfnative — a zero-dependency PDF library.' },",
        "    { type: 'heading', text: 'Installation', level: 2 },",
        "    { type: 'paragraph', text: 'Run npm install pdfnative.' },",
        "    { type: 'heading', text: 'Getting Started', level: 1 },",
        "    { type: 'paragraph', text: 'Import the builder and generate your first PDF.' },",
        "    { type: 'heading', text: 'API Reference', level: 1 },",
        "    { type: 'paragraph', text: 'Two builders: buildPDFBytes (table-centric) and buildDocumentPDFBytes (free-form).' },",
        '  ],',
        '});',
        '',
        "downloadBlob(pdf, 'user-manual.pdf');"
      ].join('\n')
    },
    {
      id: 'barcode',
      label: 'Barcodes & QR codes',
      description: 'Five ISO formats (Code 128, EAN-13, QR, DataMatrix, PDF417) — pure PDF path operators, no images.',
      source: GENERATORS_BASE + 'barcode-showcase.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'Barcode Showcase',",
        '  blocks: [',
        "    { type: 'heading', text: 'Barcodes & QR Codes', level: 1 },",
        "    { type: 'paragraph', text: 'All barcodes are rendered as native PDF vector paths.' },",
        '',
        "    { type: 'heading', text: 'QR Code', level: 2 },",
        "    { type: 'barcode', format: 'qr', data: 'https://pdfnative.dev', width: 120, ecLevel: 'M', align: 'center' },",
        '',
        "    { type: 'heading', text: 'Code 128', level: 2 },",
        "    { type: 'barcode', format: 'code128', data: 'PDFNATIVE-2026', width: 280, height: 60, align: 'center' },",
        '',
        "    { type: 'heading', text: 'EAN-13', level: 2 },",
        "    { type: 'barcode', format: 'ean13', data: '5901234123457', width: 240, height: 80, align: 'center' },",
        '',
        "    { type: 'heading', text: 'Data Matrix', level: 2 },",
        "    { type: 'barcode', format: 'datamatrix', data: 'pdfnative', width: 100, align: 'center' },",
        '  ],',
        '});',
        '',
        "downloadBlob(pdf, 'barcodes.pdf');"
      ].join('\n')
    },
    {
      id: 'svg',
      label: 'SVG embedding',
      description: 'Render SVG paths and shapes as native PDF vector operators. Supports path, rect, circle, ellipse, line, polyline, polygon.',
      source: GENERATORS_BASE + 'svg-showcase.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// SVG markup — note: property is `data`, not `content`',
        "const svgShapes = '<svg viewBox=\"0 0 300 120\">'",
        "  + '<rect x=\"10\" y=\"10\" width=\"80\" height=\"80\" rx=\"10\" fill=\"#3B82F6\"/>'" ,
        "  + '<circle cx=\"160\" cy=\"50\" r=\"40\" fill=\"#10B981\"/>'" ,
        "  + '<ellipse cx=\"260\" cy=\"50\" rx=\"35\" ry=\"25\" fill=\"#8B5CF6\"/>'" ,
        "  + '</svg>';",
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'SVG Demo',",
        '  blocks: [',
        "    { type: 'heading', text: 'Vector SVG embedded as PDF paths', level: 1 },",
        "    { type: 'svg', data: svgShapes, width: 300, height: 120, align: 'center' },",
        "    { type: 'paragraph', text: 'Rect, circle, ellipse — no rasterization, perfect at any zoom.' },",
        "    { type: 'heading', text: 'Raw path data', level: 2 },",
        "    { type: 'svg', data: 'M 50 5 L 63 38 L 98 38 L 70 60 L 80 95 L 50 73 L 20 95 L 30 60 L 2 38 L 37 38 Z',",
        "      width: 120, height: 120, viewBox: [0, 0, 100, 100], fill: '#F59E0B', align: 'center' },",
        '  ],',
        '});',
        '',
        "downloadBlob(pdf, 'svg-demo.pdf');"
      ].join('\n')
    },
    {
      id: 'watermark',
      label: 'Watermarks',
      description: 'Text watermark with configurable opacity, angle, and background/foreground placement.',
      source: GENERATORS_BASE + 'watermarks.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// Watermark lives in layoutOptions (2nd argument)',
        '// WatermarkOptions: { text?: WatermarkText, image?: WatermarkImage, position? }',
        '// WatermarkText: { text, fontSize?, color?, opacity?, angle? }',
        'const pdf = buildDocumentPDFBytes(',
        '  {',
        "    title: 'Confidential Report',",
        '    blocks: [',
        "      { type: 'heading', text: 'Q1 2026 Strategy', level: 1 },",
        "      { type: 'paragraph', text: 'This document contains confidential information.' },",
        "      { type: 'paragraph', text: 'The watermark applies to every page automatically.' },",
        '    ],',
        '  },',
        '  {',
        '    watermark: {',
        '      text: {',
        "        text: 'CONFIDENTIAL',",
        '        opacity: 0.15,',
        '        angle: -45,',
        "        color: '#dc2626',",
        '        fontSize: 72,',
        '      },',
        "      position: 'background',",
        '    },',
        '  }',
        ');',
        '',
        "downloadBlob(pdf, 'confidential.pdf');"
      ].join('\n')
    },
    {
      id: 'forms',
      label: 'AcroForm fields',
      description: 'Interactive PDF form with text inputs, checkboxes, and dropdowns — ISO 32000-1 §12.7 with appearance streams.',
      source: GENERATORS_BASE + 'form-showcase.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'Job Application',",
        '  blocks: [',
        "    { type: 'heading', text: 'Job Application', level: 1 },",
        "    { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name', width: 400 },",
        "    { type: 'spacer', height: 12 },",
        "    { type: 'formField', fieldType: 'text', name: 'email',    label: 'Email',     width: 400 },",
        "    { type: 'spacer', height: 12 },",
        "    { type: 'formField', fieldType: 'dropdown', name: 'role', label: 'Position',",
        "      options: ['Engineer', 'Designer', 'Product Manager'], width: 250 },",
        "    { type: 'spacer', height: 12 },",
        "    { type: 'formField', fieldType: 'checkbox', name: 'remote', label: 'Open to remote work', checked: true },",
        '  ],',
        '});',
        '',
        "downloadBlob(pdf, 'job-application.pdf');"
      ].join('\n')
    },
    {
      id: 'pdfa',
      label: 'PDF/A archival',
      description: 'PDF/A-2b compliance with structure tree, XMP metadata, and sRGB ICC OutputIntent — passes veraPDF.',
      source: GENERATORS_BASE + 'pdfa-variants.ts',
      code: [
        "import { registerFonts, loadFontData, buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// PDF/A requires EVERY font embedded (ISO 19005-2 §6.2.11.4.1). `tagged` writes',
        '// the XMP claim but embeds nothing by itself — without fontEntries the document',
        '// falls back to unembedded Helvetica and veraPDF rejects it.',
        "registerFonts({ latin: () => import('https://esm.sh/pdfnative@1.7.0/fonts/noto-sans-data.js') });",
        "const fontData = await loadFontData('latin');",
        "if (!fontData) throw new Error('latin font failed to load');",
        '',
        '// tagged + compress are layoutOptions → 2nd argument of buildDocumentPDFBytes',
        'const pdf = buildDocumentPDFBytes(',
        '  {',
        "    title: 'Archival Document — PDF/A-2b',",
        "    fontEntries: [{ fontData, fontRef: '/F3', lang: 'latin' }], // /F1 & /F2 are reserved",
        '    blocks: [',
        "      { type: 'heading', text: 'Archival-grade PDF', level: 1 },",
        "      { type: 'paragraph', text: 'This document validates as PDF/A-2b (ISO 19005-2).' },",
        "      { type: 'list', style: 'bullet', items: [",
        "        'Structure tree (PDF/UA accessibility)',",
        "        'XMP metadata stream',",
        "        'sRGB ICC OutputIntent',",
        "        'Embedded font subsets',",
        '      ] },',
        '    ],',
        '  },',
        '  {',
        "    tagged: 'pdfa2b',",
        '    // compress: true — browser falls back to stored-block FlateDecode (valid, no reduction)',
        '    // call setDeflateImpl() with fflate/pako for real compression in the browser',
        '  }',
        ');',
        '',
        "downloadBlob(pdf, 'archival.pdf');"
      ].join('\n')
    },
    {
      id: 'multilang',
      label: 'Multi-language (lazy fonts)',
      description: 'Mix Thai, Arabic (BiDi + GSUB), and Japanese in a single PDF with lazy-loaded font modules.',
      source: GENERATORS_BASE + 'document-builder.ts',
      code: [
        "import { registerFonts, loadFontData, buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// Lazy font registration — only loaded when needed',
        'registerFonts({',
        "  th: () => import('https://esm.sh/pdfnative@1.7.0/fonts/noto-thai-data.js'),",
        "  ar: () => import('https://esm.sh/pdfnative@1.7.0/fonts/noto-arabic-data.js'),",
        "  ja: () => import('https://esm.sh/pdfnative@1.7.0/fonts/noto-jp-data.js'),",
        '});',
        '',
        "const langs = ['th', 'ar', 'ja'];",
        'const fontData = await Promise.all(langs.map(loadFontData));',
        'const fontEntries = fontData',
        '  .map((fd, i) => fd ? { fontData: fd, fontRef: `/F${3 + i}`, lang: langs[i] } : null)',
        '  .filter(Boolean);',
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'Multi-language Demo',",
        '  blocks: [',
        "    { type: 'heading',   text: 'สวัสดี — مرحبا — こんにちは', level: 1 },",
        "    { type: 'paragraph', text: 'pdfnative renders Thai, Arabic (with BiDi & shaping), and Japanese — all from a single API call.' },",
        '  ],',
        '  fontEntries,',
        '});',
        '',
        "downloadBlob(pdf, 'multilang.pdf');"
      ].join('\n')
    },
    {
      id: 'streaming',
      label: 'Streaming output',
      description: 'AsyncGenerator that yields Uint8Array chunks — write directly to a stream without buffering the full PDF.',
      source: GENERATORS_BASE + 'streaming-showcase.ts',
      code: [
        "import { buildDocumentPDFStream, concatChunks, downloadBlob } from 'pdfnative';",
        '',
        '// buildDocumentPDFStream(params, layoutOptions?, streamOptions?) → AsyncGenerator<Uint8Array>',
        '// chunkSize belongs in the 3rd argument (StreamOptions)',
        'const chunks = [];',
        '',
        'for await (const chunk of buildDocumentPDFStream(',
        '  {',
        "    title: 'Streamed PDF',",
        '    blocks: [',
        "      { type: 'heading',   text: 'Streamed in chunks', level: 1 },",
        "      { type: 'paragraph', text: 'Each chunk arrives as it is produced — ideal for large PDFs or Node.js streams.' },",
        '    ],',
        '  },',
        '  {},              // layoutOptions (tagged, compress, watermark, …)',
        '  { chunkSize: 16384 }  // streamOptions',
        ')) {',
        '  chunks.push(chunk);',
        '}',
        '',
        "console.log(`Streamed ${chunks.length} chunk(s)`);",
        '',
        '// concatChunks reassembles all chunks into a single Uint8Array',
        'const pdf = concatChunks(chunks);',
        "downloadBlob(pdf, 'streamed.pdf');"
      ].join('\n')
    },
    {
      id: 'smart-tables',
      label: 'Smart tables — wrap, repeated headers, zebra',
      description: 'Auto-fit columns, automatic cell wrapping, repeated headers across page breaks, zebra striping, and a tagged-PDF caption.',
      source: GENERATORS_BASE + 'document-table-parity.ts',
      code: [
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// Build 32 rows so the table naturally wraps to a second page.',
        'const rows = Array.from({ length: 32 }, (_, i) => ({',
        '  cells: [',
        "    `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,",
        "    i % 5 === 0",
        "      ? 'Widget Pro Max XL Limited Edition with extended warranty'",
        "      : `Item #${i + 1} — standard SKU`,",
        "    i % 3 === 0 ? 'Stock' : i % 3 === 1 ? 'Backorder' : 'Reserved',",
        '    (((i + 1) * 37.5) % 1000).toFixed(2),',
        '  ],',
        '}));',
        '',
        'const pdf = buildDocumentPDFBytes({',
        "  title: 'Smart Tables Demo',",
        '  blocks: [',
        "    { type: 'heading', text: 'Smart Tables', level: 1 },",
        "    { type: 'paragraph', text: 'Auto-fit columns, automatic wrapping, repeated headers across page breaks, and zebra striping.' },",
        '    {',
        "      type: 'table',",
        "      headers: ['Date', 'Product', 'Status', 'Amount'],",
        '      rows,',
        "      wrap: 'auto',           // measure first; wrap only when needed",
        '      repeatHeader: true,     // redraw header on every page',
        '      zebra: true,            // soft alternating row tint',
        "      caption: 'Q1 2026 inventory movements',",
        '    },',
        '  ],',
        '});',
        '',
        "downloadBlob(pdf, 'smart-tables.pdf');"
      ].join('\n')
    },
    {
      id: 'extract-secure',
      label: 'Extract text & re-encrypt (v1.6.0)',
      description: 'The 1.6.0 parser round trip: build a PDF, extract its text with positions (open the browser console), then merge it with an AES-256 encrypted annex and re-encrypt the result with a new password.',
      source: GENERATORS_BASE + 'text-extract-showcase.ts',
      encryptedOutput: true,
      previewNote: 'This example produces an AES-256 encrypted PDF (password: rotated). The inline preview is skipped — the browser viewer would ask for the password inside a cramped frame. Use Download and open the file in your PDF reader.',
      code: [
        "import { buildDocumentPDFBytes, extractText, mergePdfs, downloadBlob } from 'pdfnative';",
        '',
        'const report = buildDocumentPDFBytes({',
        "  title: 'Q3 Report',",
        '  blocks: [',
        "    { type: 'heading', text: 'Q3 Financial Summary', level: 1 },",
        "    { type: 'paragraph', text: 'Revenue grew 14% year over year.' },",
        '  ],',
        '});',
        '',
        '// 1. Extract text with positions — check the browser console.',
        'for (const page of extractText(report, { includeRuns: true })) {',
        '  console.log(`page ${page.pageIndex + 1}:`, page.text);',
        '  for (const run of page.runs ?? []) {',
        '    console.log(`  "${run.text}" @ (${run.x.toFixed(1)}, ${run.y.toFixed(1)}) ${run.fontSize}pt`);',
        '  }',
        '}',
        '',
        '// 2. An AES-256 encrypted annex (password: boardroom).',
        "const annex = buildDocumentPDFBytes({ title: 'Annex', blocks: [",
        "  { type: 'heading', text: 'Confidential annex', level: 1 },",
        "] }, { encryption: { ownerPassword: 'boardroom', algorithm: 'aes256' } });",
        '',
        '// 3. Decrypt on ingest, re-encrypt the merged output with a NEW password.',
        'const secured = mergePdfs(',
        "  [report, { bytes: annex, password: 'boardroom' }],",
        "  { encrypt: { ownerPassword: 'rotated', userPassword: 'rotated', algorithm: 'aes256' } },",
        ');',
        '',
        "downloadBlob(secured, 'report-reencrypted.pdf'); // opens with 'rotated'"
      ].join('\n')
    }
  ];

  // CDN URLs to try in order (esm.sh, then unpkg as fallback)
  var CDN_URLS = [
    'https://esm.sh/pdfnative@1.7.0',
    'https://cdn.jsdelivr.net/npm/pdfnative@1.7.0/+esm'
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
    // ── Populate picker and select default ──────────────────
    var DEFAULT_ID = 'quickstart';
    var currentId = null;
    var lastPdf = null;       // { bytes, name } captured from the last run
    var lastPreviewUrl = null;

    function loadExample(id) {
      var ex = EXAMPLES.find(function (e) { return e.id === id; });
      if (!ex) return;
      currentId = id;
      demoCode.value = ex.code;
      if (demoDescription) demoDescription.textContent = ex.description;
      if (demoSourceLink) demoSourceLink.setAttribute('href', ex.source);
      if (demoStatus) demoStatus.textContent = '';
      if (demoError) { demoError.style.display = 'none'; demoError.textContent = ''; }
    }

    if (demoPicker) {
      EXAMPLES.forEach(function (ex) {
        var opt = document.createElement('option');
        opt.value = ex.id;
        opt.textContent = ex.label;
        demoPicker.appendChild(opt);
      });
      // `#preset=<id>` permalinks restore the selected example.
      var presetMatch = /(?:^|[#&])preset=([\w-]+)/.exec(location.hash);
      if (presetMatch && EXAMPLES.some(function (e) { return e.id === presetMatch[1]; })) {
        DEFAULT_ID = presetMatch[1];
      }
      demoPicker.value = DEFAULT_ID;
      demoPicker.addEventListener('change', function () { loadExample(demoPicker.value); });
    }

    if (demoReset) {
      demoReset.addEventListener('click', function () { if (currentId) loadExample(currentId); });
    }

    loadExample(DEFAULT_ID);

    // ── Inline PDF preview ──────────────────────────────────
    // Same Blob → object-URL pattern as the React playground. Some browsers
    // (most mobile ones) cannot render PDFs in an iframe; when the engine
    // says so, be honest about it instead of showing an empty frame.
    // Explicit opt-in: on browsers that predate the API the property is
    // undefined, and most of those cannot render a PDF in an iframe anyway —
    // an honest note beats an empty grey frame.
    var canPreview = navigator.pdfViewerEnabled === true;
    if (!canPreview && demoPreview && demoPreviewNote) {
      demoPreview.hidden = true;
      demoPreviewNote.hidden = false;
    }

    function showPreview(bytes) {
      if (!demoPreview || !canPreview) return;
      var blob = new Blob([bytes], { type: 'application/pdf' });
      if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
      lastPreviewUrl = URL.createObjectURL(blob);
      demoPreview.src = lastPreviewUrl;
    }

    // An encrypted PDF in the preview iframe makes the browser's viewer ask
    // for the password inside a cramped frame. Primary signal: the example's
    // own declaration; safety net for user-authored code: the /Encrypt token
    // in the byte tail (trailer region).
    function looksEncrypted(bytes) {
      var tail = bytes.subarray(Math.max(0, bytes.length - 2048));
      var text = '';
      for (var i = 0; i < tail.length; i++) text += String.fromCharCode(tail[i]);
      return text.indexOf('/Encrypt') !== -1;
    }

    // The demo module calls `downloadBlob` like real pdfnative code; the demo
    // routes those bytes to the preview pane and only downloads on request.
    function captureSink(bytes, name) {
      lastPdf = { bytes: bytes, name: name || 'document.pdf' };
      var ex = EXAMPLES.find(function (e) { return e.id === currentId; });
      var encrypted = (demoMode === 'code' && ex && ex.encryptedOutput) || looksEncrypted(bytes);
      if (encrypted) {
        if (demoPreview) { demoPreview.hidden = true; demoPreview.removeAttribute('src'); }
        if (demoPreviewNote) {
          demoPreviewNote.textContent = (ex && ex.previewNote) ||
            'This PDF is encrypted — the inline viewer would prompt for its password in a cramped frame. Use Download and open it in your PDF reader.';
          demoPreviewNote.hidden = false;
        }
      } else {
        if (demoPreview && canPreview) demoPreview.hidden = false;
        if (demoPreviewNote && canPreview) demoPreviewNote.hidden = true;
        showPreview(bytes);
      }
      if (demoDownload) demoDownload.disabled = false;
    }

    if (demoDownload) {
      demoDownload.addEventListener('click', function () {
        if (lastPdf && pdfnativeModule) pdfnativeModule.downloadBlob(lastPdf.bytes, lastPdf.name);
      });
    }

    // ── JSON mode: the DocumentParams the whole ecosystem consumes ──
    var demoMode = 'code';
    var BLOCK_TYPES = ['heading', 'paragraph', 'list', 'table', 'image', 'link', 'toc', 'barcode', 'svg', 'formField', 'chart', 'pageBreak', 'spacer'];
    var STARTER_DOC = {
      title: 'Shared document',
      blocks: [
        { type: 'heading', text: 'Shared document', level: 1 },
        { type: 'paragraph', text: 'Edit this JSON and generate — the same object drives the library, pdfnative-cli render, and the generate_basic_pdf MCP tool.' },
        { type: 'table', headers: ['Surface', 'Entry point'], rows: [
          { cells: ['Library', 'buildDocumentPDFBytes(params)'] },
          { cells: ['CLI', 'pdfnative render --input doc.json'] },
          { cells: ['MCP', 'generate_basic_pdf'] }
        ] }
      ]
    };

    function setMode(mode) {
      demoMode = mode;
      var json = mode === 'json';
      if (demoModeCode) demoModeCode.setAttribute('aria-pressed', String(!json));
      if (demoModeJson) demoModeJson.setAttribute('aria-pressed', String(json));
      if (demoCode) demoCode.hidden = json;
      if (demoJson) {
        demoJson.hidden = !json;
        if (json && !demoJson.value) demoJson.value = JSON.stringify(STARTER_DOC, null, 2);
      }
      if (demoPicker) demoPicker.disabled = json;
      if (demoSourceLink) demoSourceLink.hidden = json;
      if (demoJsonNote) demoJsonNote.hidden = !json;
      if (demoCopyCli) demoCopyCli.hidden = !json;
      if (demoCopyMcp) demoCopyMcp.hidden = !json;
      if (demoModeCode) demoModeCode.classList.toggle('active', !json);
      if (demoModeJson) demoModeJson.classList.toggle('active', json);
    }
    if (demoModeCode) demoModeCode.addEventListener('click', function () { setMode('code'); });
    if (demoModeJson) demoModeJson.addEventListener('click', function () { setMode('json'); });

    // Defensive parse: a #doc= payload is untrusted input. Data only — the
    // hash can never carry code — with a size cap and a block-type check
    // against the engine's 13-kind union. Anything off-shape is rejected.
    function parseDocJson(text) {
      if (typeof text !== 'string' || text.length > 100000) throw new Error('Document JSON too large.');
      var doc = JSON.parse(text);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Document must be a JSON object.');
      if (!Array.isArray(doc.blocks)) throw new Error('Document needs a "blocks" array.');
      for (var i = 0; i < doc.blocks.length; i++) {
        var b = doc.blocks[i];
        if (!b || typeof b !== 'object' || BLOCK_TYPES.indexOf(b.type) === -1) {
          throw new Error('blocks[' + i + '].type must be one of: ' + BLOCK_TYPES.join(', '));
        }
        // Shared #doc= payloads are untrusted: only the schemes the engine
        // itself allows may reach a link annotation.
        if (b.type === 'link' && typeof b.url === 'string' && !/^(https?:|mailto:|#)/i.test(b.url)) {
          throw new Error('blocks[' + i + '].url must use http:, https:, mailto: or a #fragment.');
        }
      }
      return doc;
    }

    // #doc= payload: base64url, deflate-raw-compressed when the native
    // CompressionStream API exists ("d." prefix), raw otherwise ("r.").
    function toBase64Url(bytes) {
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromBase64Url(s) {
      s = s.replace(/-/g, '+').replace(/_/g, '/');
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    async function encodeDocHash(jsonText) {
      var raw = new TextEncoder().encode(jsonText);
      if (typeof CompressionStream === 'function') {
        var stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        var packed = new Uint8Array(await new Response(stream).arrayBuffer());
        return 'd.' + toBase64Url(packed);
      }
      return 'r.' + toBase64Url(raw);
    }
    async function decodeDocHash(payload) {
      if (payload.length > 20000) throw new Error('Link payload too large.');
      var kind = payload.slice(0, 2);
      var bytes = fromBase64Url(payload.slice(2));
      if (kind === 'd.') {
        if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the link.');
        // Read the inflated stream chunk by chunk and abort past the JSON
        // size cap — deflate can expand ~1000:1, so never materialise an
        // unbounded payload before checking its size.
        var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        var chunks = [];
        var total = 0;
        for (;;) {
          var step = await reader.read();
          if (step.done) break;
          total += step.value.length;
          if (total > 150000) {
            reader.cancel();
            throw new Error('Link payload too large after decompression.');
          }
          chunks.push(step.value);
        }
        bytes = new Uint8Array(total);
        var off = 0;
        for (var ci = 0; ci < chunks.length; ci++) { bytes.set(chunks[ci], off); off += chunks[ci].length; }
      } else if (kind !== 'r.') {
        throw new Error('Unrecognised link format.');
      }
      return new TextDecoder().decode(bytes);
    }

    if (demoShare) {
      demoShare.addEventListener('click', async function () {
        var base = location.origin + location.pathname;
        var url;
        try {
          if (demoMode === 'json') {
            var doc = parseDocJson(demoJson.value);
            url = base + '#doc=' + (await encodeDocHash(JSON.stringify(doc)));
          } else {
            url = base + '#preset=' + (currentId || DEFAULT_ID);
          }
          await copyText(url);
          var prev = demoShare.textContent;
          demoShare.textContent = '✓ Copied';
          setTimeout(function () { demoShare.textContent = prev; }, 1500);
        } catch (e) {
          demoError.textContent = 'Share failed: ' + (e.message || e);
          demoError.style.display = 'block';
        }
      });
    }

    function copyWithFeedback(btn, text) {
      copyText(text).then(function () {
        var prev = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(function () { btn.textContent = prev; }, 1500);
      });
    }
    if (demoCopyCli) {
      demoCopyCli.addEventListener('click', function () {
        try {
          var doc = parseDocJson(demoJson.value);
          copyWithFeedback(demoCopyCli,
            '# Save the JSON below as doc.json, then:\n' +
            'npx pdfnative-cli render --input doc.json --output out.pdf\n\n' +
            JSON.stringify(doc, null, 2) + '\n');
        } catch (e) { demoError.textContent = e.message; demoError.style.display = 'block'; }
      });
    }
    if (demoCopyMcp) {
      demoCopyMcp.addEventListener('click', function () {
        try {
          var doc = parseDocJson(demoJson.value);
          copyWithFeedback(demoCopyMcp, JSON.stringify({
            tool: 'generate_basic_pdf',
            input: { title: doc.title || 'Document', blocks: doc.blocks, outputMode: 'base64' }
          }, null, 2) + '\n');
        } catch (e) { demoError.textContent = e.message; demoError.style.display = 'block'; }
      });
    }

    // Restore a shared document from the URL hash. `hashReady` lets the
    // autorun observer wait for the (async) decode instead of racing it and
    // rendering the default example over the shared one; #doc= is not an
    // element id, so we also bring the visitor to the demo ourselves.
    var hashReady = Promise.resolve();
    var docMatch = /(?:^|[#&])doc=([\w.~-]+)/.exec(location.hash);
    if (docMatch && demoJson) {
      hashReady = decodeDocHash(docMatch[1])
        .then(function (text) {
          var doc = parseDocJson(text);
          setMode('json');
          demoJson.value = JSON.stringify(doc, null, 2);
          var demoSection = document.getElementById('demo');
          if (demoSection) demoSection.scrollIntoView();
        })
        .catch(function () { /* off-shape payloads are silently ignored */ });
    }

    // ── Execution: real ES module via a Blob URL ─────────────
    // The example code is executed as an actual module, so its
    // `import { … } from 'pdfnative'` lines are real, top-level `await`
    // works natively, and errors carry genuine line numbers. The pdfnative
    // specifier is resolved to the already-loaded module through a global
    // (no second CDN request), with `downloadBlob` routed to the preview.
    function rewriteImports(code) {
      return code
        // Named imports — single- or multi-line.
        .replace(
          /^(\s*)import\s*\{([\s\S]*?)\}\s*from\s*['"]pdfnative['"]\s*;?[ \t]*$/gm,
          '$1const {$2} = globalThis.__pdfnativeDemo.mod;'
        )
        // Namespace imports: import * as pdf from 'pdfnative'.
        .replace(
          /^(\s*)import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]pdfnative['"]\s*;?[ \t]*$/gm,
          '$1const $2 = globalThis.__pdfnativeDemo.mod;'
        );
    }

    function lineFromStack(err) {
      var m = /blob:[^\s)]+:(\d+):\d+/.exec(err && err.stack ? err.stack : '');
      return m ? Number(m[1]) : null;
    }

    async function runDemo() {
      demoStatus.textContent = 'Loading pdfnative…';
      demoError.style.display = 'none';
      demoError.textContent = '';
      demoBtn.disabled = true;

      var moduleUrl = null;
      try {
        // Lazy-load pdfnative from ESM CDN on first use
        if (!pdfnativeModule) {
          pdfnativeModule = await loadPdfnative();
        }
        demoStatus.textContent = 'Generating PDF…';

        if (demoMode === 'json') {
          var doc = parseDocJson(demoJson.value);
          captureSink(pdfnativeModule.buildDocumentPDFBytes(doc), (doc.title || 'document') + '.pdf');
        } else {
          globalThis.__pdfnativeDemo = {
            mod: Object.assign({}, pdfnativeModule, { downloadBlob: captureSink })
          };

          var source = rewriteImports(demoCode.value);
          if (/from\s*['"]pdfnative['"]/.test(source)) {
            throw new Error("This demo can only resolve `import { name } from 'pdfnative'` or `import * as pdf from 'pdfnative'` — rewrite the import in one of those forms.");
          }
          moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          await import(moduleUrl);
        }

        demoStatus.textContent = lastPdf ? 'PDF generated — preview updated.' : 'Done (no PDF produced).';
        setTimeout(function () { demoStatus.textContent = ''; }, 3000);
      } catch (err) {
        var line = lineFromStack(err);
        demoError.textContent = (line ? 'Line ' + line + ': ' : '') + (err.message || String(err));
        demoError.style.display = 'block';
        demoStatus.textContent = '';
      } finally {
        if (moduleUrl) URL.revokeObjectURL(moduleUrl);
        demoBtn.disabled = false;
      }
    }

    demoBtn.addEventListener('click', runDemo);

    // ── Live benchmark (never reuses .bench-label/.bench-value: those
    //    classes are tied to bench/RESULTS.md by the bench-parity CI rule) ──
    var benchBtn = document.getElementById('bench-live-run');
    if (benchBtn) {
      benchBtn.addEventListener('click', async function () {
        var rowsEl = document.getElementById('bench-live-rows');
        var noteEl = document.getElementById('bench-live-note');
        benchBtn.disabled = true;
        benchBtn.textContent = 'Loading pdfnative…';
        try {
          if (!pdfnativeModule) pdfnativeModule = await loadPdfnative();
          benchBtn.textContent = 'Measuring…';
          var makeParams = function (n) {
            var rows = [];
            for (var i = 0; i < n; i++) {
              rows.push({ cells: ['2026-08-' + ((i % 28) + 1), 'Line item ' + i, '$' + (i * 3.5).toFixed(2)] });
            }
            // PdfParams requires infoItems/balanceText/countText/footerText —
            // the engine's boundary validation does not (yet) guard them.
            return {
              title: 'Benchmark ' + n,
              infoItems: [{ label: 'Rows', value: String(n) }],
              balanceText: 'Synthetic dataset',
              countText: n + ' rows',
              headers: ['Date', 'Description', 'Amount'],
              rows: rows,
              footerText: 'pdfnative.dev live benchmark'
            };
          };
          pdfnativeModule.buildPDFBytes(makeParams(50)); // warm-up
          var sizes = [100, 500, 1000];
          var results = [];
          for (var s = 0; s < sizes.length; s++) {
            var t0 = performance.now();
            pdfnativeModule.buildPDFBytes(makeParams(sizes[s]));
            results.push({ n: sizes[s], ms: performance.now() - t0 });
            await new Promise(function (r) { setTimeout(r, 0); }); // keep the tab responsive
          }
          var max = Math.max.apply(null, results.map(function (r) { return r.ms; }));
          rowsEl.innerHTML = results.map(function (r) {
            var pct = Math.max(4, Math.round((r.ms / max) * 100));
            return '<div class="bench-row">' +
              '<span class="bench-live-label">' + r.n.toLocaleString('en-GB') + ' rows — this device</span>' +
              '<div class="bench-bar-bg"><div class="bench-bar bench-live-bar" style="width:' + pct + '%"></div></div>' +
              '<span class="bench-live-value">' + r.ms.toFixed(1) + ' ms</span>' +
              '</div>';
          }).join('');
          rowsEl.hidden = false;
          noteEl.hidden = false;
        } catch (e) {
          // Never destroy the button label with an error message.
          noteEl.textContent = 'Benchmark failed: ' + (e.message || e);
          noteEl.setAttribute('role', 'alert');
          noteEl.hidden = false;
        } finally {
          benchBtn.textContent = '↺ Run again';
          benchBtn.disabled = false;
        }
      });
    }

    // First render without a click, once the demo scrolls into view — the
    // visitor sees a real PDF instead of an empty pane. One shot only, and
    // desktop only: auto-loading the CDN engine on mobile data without a
    // click would be presumptuous.
    if ('IntersectionObserver' in window && canPreview && matchMedia('(min-width: 901px)').matches) {
      var demoSection = document.getElementById('demo');
      if (demoSection) {
        var ran = false;
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !ran) {
              ran = true;
              io.disconnect();
              // Never auto-run an example whose output is encrypted — the
              // visitor would face a password prompt without having clicked.
              var ex = EXAMPLES.find(function (e) { return e.id === DEFAULT_ID; });
              if (ex && ex.encryptedOutput) return;
              // A shared #doc= link may still be decoding: wait for it so the
              // first render shows the shared document, not the default.
              hashReady.then(runDemo);
            }
          });
        }, { rootMargin: '200px' });
        io.observe(demoSection);
      }
    }
  }
})();
