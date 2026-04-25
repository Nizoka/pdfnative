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
  var demoPicker = document.getElementById('demo-picker');
  var demoReset = document.getElementById('demo-reset');
  var demoDescription = document.getElementById('demo-description');
  var demoSourceLink = document.getElementById('demo-source-link');
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
        "      '16 Unicode scripts',",
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
        "import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';",
        '',
        '// tagged + compress are layoutOptions → 2nd argument of buildDocumentPDFBytes',
        'const pdf = buildDocumentPDFBytes(',
        '  {',
        "    title: 'Archival Document — PDF/A-2b',",
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
        "  th: () => import('https://esm.sh/pdfnative/fonts/noto-thai-data.js'),",
        "  ar: () => import('https://esm.sh/pdfnative/fonts/noto-arabic-data.js'),",
        "  ja: () => import('https://esm.sh/pdfnative/fonts/noto-jp-data.js'),",
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
        '  tagged: true,',
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
    }
  ];

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
    // ── Populate picker and select default ──────────────────
    var DEFAULT_ID = 'quickstart';
    var currentId = null;

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
      demoPicker.value = DEFAULT_ID;
      demoPicker.addEventListener('change', function () { loadExample(demoPicker.value); });
    }

    if (demoReset) {
      demoReset.addEventListener('click', function () { if (currentId) loadExample(currentId); });
    }

    loadExample(DEFAULT_ID);

    demoBtn.addEventListener('click', async function () {
      demoStatus.textContent = 'Loading pdfnative…';
      demoError.style.display = 'none';
      demoError.textContent = '';
      demoBtn.disabled = true;

      try {
        // Lazy-load pdfnative from ESM CDN on first use
        if (!pdfnativeModule) {
          pdfnativeModule = await loadPdfnative();
          demoStatus.textContent = 'Generating PDF…';
        }

        // Extract user code and execute
        var code = demoCode.value;

        // Strip top-level static `import {…} from 'pdfnative'` statements —
        // we provide those bindings via the function arguments below.
        // Keep dynamic `import('…')` calls intact for examples that need them
        // (e.g. multi-language font modules).
        var cleanCode = code
          .replace(/^\s*import\s*\{[^}]+\}\s*from\s*['"]pdfnative['"]\s*;?/gm, '')
          .trim();

        // Wrap in async IIFE so user code can use top-level `await`
        var wrapped = '"use strict"; return (async () => {\n' + cleanCode + '\n})();';

        var fn = new Function(
          'buildPDFBytes', 'buildDocumentPDFBytes', 'downloadBlob',
          'buildPDF', 'buildDocumentPDF', 'wrapText',
          'buildDocumentPDFStream', 'buildPDFStream', 'concatChunks',
          'registerFonts', 'loadFontData',
          'initNodeCompression', 'signPdfBytes',
          wrapped
        );

        await fn(
          pdfnativeModule.buildPDFBytes,
          pdfnativeModule.buildDocumentPDFBytes,
          pdfnativeModule.downloadBlob,
          pdfnativeModule.buildPDF,
          pdfnativeModule.buildDocumentPDF,
          pdfnativeModule.wrapText,
          pdfnativeModule.buildDocumentPDFStream,
          pdfnativeModule.buildPDFStream,
          pdfnativeModule.concatChunks,
          pdfnativeModule.registerFonts,
          pdfnativeModule.loadFontData,
          pdfnativeModule.initNodeCompression,
          pdfnativeModule.signPdfBytes
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
