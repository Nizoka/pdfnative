# pdfnative

[![CI](https://github.com/Nizoka/pdfnative/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/pdfnative/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Nizoka/pdfnative/actions/workflows/codeql.yml/badge.svg)](https://github.com/Nizoka/pdfnative/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/pdfnative)](https://www.npmjs.com/package/pdfnative)
[![npm downloads](https://img.shields.io/npm/dm/pdfnative)](https://www.npmjs.com/package/pdfnative)
[![bundle size](https://img.shields.io/bundlephobia/minzip/pdfnative)](https://bundlephobia.com/package/pdfnative)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/pdfnative)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm provenance](https://img.shields.io/badge/provenance-signed-blueviolet)](https://docs.npmjs.com/generating-provenance-statements)
[![website](https://img.shields.io/badge/pdfnative.dev-0066FF?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxyZWN0IHg9IjMiIHk9IjIiIHdpZHRoPSIxNCIgaGVpZ2h0PSIxOCIgcng9IjIiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMS41Ii8+PHBhdGggZD0iTTcgN2g2TTcgMTFoOE03IDE1aDQiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=)](https://pdfnative.dev)
[![pdfnative-mcp](https://img.shields.io/npm/v/pdfnative-mcp?label=pdfnative-mcp&color=6366f1)](https://www.npmjs.com/package/pdfnative-mcp)
[![pdfnative-cli](https://img.shields.io/npm/v/pdfnative-cli?label=pdfnative-cli&color=0e7490)](https://www.npmjs.com/package/pdfnative-cli)
[![pdfnative-react](https://img.shields.io/npm/v/pdfnative-react?label=pdfnative-react&color=06b6d4)](https://www.npmjs.com/package/pdfnative-react)

Pure native PDF generation library — zero vendor dependencies. ISO 32000-1 (PDF 1.7) compliant.

## Ecosystem

pdfnative ships as four coordinated packages — pick whichever entry point fits your workflow:

| Package | Latest | Use it for |
|---|:---:|---|
| [`pdfnative`](https://www.npmjs.com/package/pdfnative) | **v1.6.0** | The library itself — call from Node, browsers, Workers, Deno, Bun. |
| [`pdfnative-cli`](https://www.npmjs.com/package/pdfnative-cli) | **v1.2.0** | Render JSON → PDF, sign (RSA + ECDSA-SHA256, native constant-time crypto by default), inspect, verify (PAdES-T + OCSP/CRL), **merge / split / extract** pages, **annotate** (markup annotations), **govern** (AI-governance / HITL gate), batch, and emit JSON Schemas from the shell. Built on pdfnative 1.5.0: 22 scripts + COLRv1 emoji, `--font math`, PDF bookmarks (`--outline`), layout introspection (`--inspect-layout` / `--debug-layout`), and an agent-native `--json`/`E_*`/`--dry-run`/`--summary` contract. |
| [`pdfnative-mcp`](https://www.npmjs.com/package/pdfnative-mcp) | **v1.4.0** | Use pdfnative from Claude Desktop, Cursor, Continue, Zed (or any stdio MCP client) — **19 production tools** including the page-tree trio `merge_pdfs`, `split_pdf`, `extract_pages`, markup `annotate_pdf`, the network-free `draft_governance_issue` (AI-governance / HITL), plus `validate_pdf`, `verify_pdf`, `add_attachment`, `extract_attachments`, and `extract_text`; watermark support, Unicode `normalize`, token-frugal read modes (`verbosity` / `fields`), `pdfA` flags, enriched authoring options (`outline`, `pageLabels`, nested lists, `viewerPreferences`, `cellBorders`, `cellVAlign`), the explicit `math` script, an MCP `prompts` capability, a constant-time `node:crypto` signing provider, DNS-rebinding-protected HTTP transport, and per-tool `_meta.apiVersion`. Built on pdfnative 1.5.0. |
| [`pdfnative-react`](https://www.npmjs.com/package/pdfnative-react) | **v1.0.0** | Write PDFs as declarative JSX — `<Document>`, `<Page>`, `<Table>`, `<Barcode>`, `<Svg>`, `<FormField>`… compiled on-device to pdfnative blocks by a custom React 19 reconciler. Render functions (`renderToBytes` / `renderToStream` / `renderToFile`), client hooks & components (`usePdf`, `PDFViewer`, `PDFDownloadLink`), and a versioned `DocSpec` grammar (`docSpecSchema()`) for AI agents. Peer: pdfnative ≥1.5 (pairs with 1.6.0), React 19, Node ≥20. |

```bash
npm install pdfnative                 # library
npm install pdfnative-react react     # React renderer (React 19 peer)
npm install -g pdfnative-cli          # CLI
npm install -g pdfnative-mcp          # MCP server
```

Detailed docs: [CLI guide](docs/guides/cli.md) · [MCP guide](docs/guides/mcp.md) · [React guide](docs/guides/react.md) · [Onboarding cheatsheet](docs/guides/onboarding.md).

## Highlights

- **Zero dependencies** — built from scratch in pure TypeScript. Zero runtime dependencies, tree-shakeable, auditable
- **ISO 32000-1 compliant** — valid xref tables, /Info metadata, proper font embedding
- **22 Unicode scripts** — Thai, Japanese, Chinese (SC), Korean, Greek, Devanagari, Telugu, Turkish, Vietnamese, Polish, Arabic, Hebrew, Cyrillic, Georgian, Armenian, Bengali, Tamil, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic
- **Thai OpenType shaping** — GSUB substitution + GPOS mark-to-base + mark-to-mark positioning
- **Arabic positional shaping** — GSUB isolated/initial/medial/final forms + lam-alef ligatures
- **BiDi text layout** — Unicode Bidirectional Algorithm (UAX #9) with glyph mirroring, isolates (LRI/RLI/FSI/PDI), and explicit embeddings (LRE/RLE/LRO/RLO/PDF) including character-level X4–X5 overrides (v1.3.0)
- **USE-lite shaping** — `classifyUseCategory` / `classifyClusters` drive joiner classification across the Devanagari, Bengali, and Tamil shapers, fixing nukta+virama, half-form, eyelash-ra, and ya-phalaa edge cases (v1.3.0)
- **Colour emoji (COLRv1)** — opt-in Noto Color Emoji subset (**expanded to ~850 glyphs in v1.6.0**, ~3.1 MB); solid + linear + radial gradient layers rendered as native PDF Form XObjects; monochrome fallback when not registered (v1.3.0). Variation selectors, ZWJ/ZWNJ, and skin-tone modifiers no longer leave tofu, and glyph `/BBox` is computed from contour bounds so emoji are never clipped (v1.3.0). **Advanced compositing** (v1.4.0): COLRv1 sweep (conic) gradients render as native flat-shaded wedges, and `PaintComposite` separable blend modes (Multiply, Screen, Overlay, Darken, Lighten, …) map to PDF `/BM` ExtGState; structural Porter-Duff modes fall back to monochrome. [Guide →](docs/guides/colour-emoji.md)
- **Multi-font fallback** — automatic cross-script font switching with continuation bias
- **TTF subsetting** — only used glyphs embedded (dramatic file size reduction)
- **Tagged PDF / PDF/A** — structure tree, /ActualText, XMP metadata, sRGB OutputIntent (PDF/A-1b, 2b, 2u, 3b with embedded file attachments)
- **PDF Encryption (round-trip)** — write **and read** encrypted PDFs: AES-128 (V4/R4), AES-256 (V5/R6), and legacy RC4 (V1–V4); owner + user passwords, granular permissions. **v1.6.0** adds a Standard Security Handler **decryptor** — `openPdf(bytes, { password })` decrypts transparently, the merge/split API ingests encrypted sources **and re-encrypts its output** (`MergeOptions.encrypt`, AES only, fresh keys) — closing the full *open → edit → re-secure* round trip. [Guide →](docs/guides/pdf-manipulation.md)
- **Native vector charts** (v1.6.0) — bar, horizontal-bar, line, pie, and donut `chart` blocks rendered as pure PDF path operators (zero deps, no rasterisation); multi-series, legends, "nice" axis ticks, negative values, tagged `/Figure` + alt text. [Guide →](docs/guides/charts.md)
- **Text extraction** (v1.6.0) — `extractText()` decodes page content streams into per-page reading-order Unicode text plus optional positioned runs; `/ToUnicode` CMap, `/Encoding /Differences`, and WinAnsi/MacRoman decoding; works on encrypted documents (`{ password }`); hard `maxTextLength` memory cap for untrusted input. [Guide →](docs/guides/text-extraction.md)
- **Free-form document builder** — headings, paragraphs, lists (incl. **nested / hierarchical** bullet & numbered lists, v1.4.0), tables, images, barcodes, SVG paths, form fields, spacers, page breaks, table of contents. Configurable block limit via `layout.maxBlocks` (default 100 000) for very large reports (v1.3.0)
- **Smart tables** — multi-page slicing with repeated headers, auto-wrap on column overflow, zebra striping, captions, and smart auto-fit columns (v1.2.0), plus per-cell **borders** (`cellBorders`) and **vertical alignment** (`cellVAlign` / `ColumnDef.vAlign`, v1.4.0). [Guide →](docs/guides/tables.md)
- **Barcode & QR code generation** — Code 128, EAN-13, QR Code, Data Matrix, PDF417 — pure PDF path operators (no images)
- **SVG rendering** — path, rect, circle, ellipse, line, polyline, polygon as native PDF operators, plus `<text>` elements rendered as upright PDF text with `x`/`y` positioning and `text-anchor` (start/middle/end) support (v1.5.0)
- **AcroForm fields** — text, multiline, checkbox, radio, dropdown, listbox with appearance streams (ISO 32000-1 §12.7). **v1.6.0** adds **fill & flatten of existing forms**: `readFormFields()`, `fillForm()` (regenerates appearances), and `flattenForm()` — non-destructive incremental update that preserves prior signatures. [Guide →](docs/guides/form-filling.md)
- **Digital signatures** — CMS/PKCS#7 detached signatures with RSA + ECDSA, SHA-256/384/512, X.509 parsing (ISO 32000-1 §12.8). One-call placeholder injection via `addSignaturePlaceholder()` (v1.2.0). Pluggable **native crypto provider** (`setCryptoProvider()` / `PdfSignOptions.provider`, v1.4.0) for constant-time, hardware-backed signing (`node:crypto` / Web Crypto / HSM)
- **Streaming output** — AsyncGenerator-based progressive PDF emission with configurable chunk size, object-boundary page-by-page streaming, and **true constant-memory streaming** (`buildDocumentPDFStreamTrue()`, v1.3.0) where the full PDF binary never materialises. One-call `streamToFile()` drains any stream to disk with back-pressure and `AbortSignal` support (v1.4.0). [Guide →](docs/guides/streaming.md)
- **Document outline & page labels** — nested bookmarks (`/Outlines` tree, with bold/italic/colour, collapsible nodes via `open: false`, explicit or `outline: 'auto'` from headings) and logical page numbering (`/PageLabels`: decimal, roman, alpha, prefixes, custom start) (v1.4.0). [Guide →](docs/guides/outlines.md)
- **Viewer preferences** — `PdfLayoutOptions.viewerPreferences` controls initial `/PageLayout` & `/PageMode` plus the `/ViewerPreferences` dict (hide toolbar/menubar, fit/center window, display doc title, non-full-screen mode, reading direction, print scaling) — PDF/A-safe (v1.4.0). [Guide →](docs/guides/viewer-preferences.md)
- **Font-data validator** — opt-in `validateFontData()` structurally checks custom font modules (SFNT magic, base64 integrity, cmap coverage, glyph-id range, width array, finite metrics) and returns `{ valid, errors, warnings }` (v1.4.0). [Guide →](docs/guides/font-validation.md)
- **PDF parser & modifier** — read existing PDFs (tokenizer, xref, object parser, FlateDecode inflate) + incremental modification. Read-only PDF/UA structural checker `validatePdfUA()` (ISO 14289-1: MarkInfo, StructTree, ParentTree, Lang, per-page MCID uniqueness) (v1.3.0). **Page-tree manipulation** (v1.4.0): `mergePdfs()`, `splitPdf()`, `extractPages()` rebuild a clean object graph (inherited attributes resolved, annotations/signatures optionally dropped, deterministic trailer `/ID`, bounded-depth copy, 256 MiB output cap via `maxOutputSize`). **Round-trip readers** (v1.5.0): `getPageLabels()` parses `/PageLabels` back into a typed `PageLabelRange[]`; `getAnnotations()` / `getPageRef()` read page annotations, and `PdfModifier.addAnnotation()` injects new ones incrementally. **v1.6.0**: a Standard Security Handler **decryptor** (`openPdf(bytes, { password })`, RC4/AES-128/AES-256) lets the reader and page-tree API ingest encrypted sources, and **constant-memory streaming** variants `streamMergedPdfs()` / `streamSplitPdf()` / `streamExtractPages()` emit merges/splits in fixed-size chunks (byte-identical to the buffered functions). [Guide →](docs/guides/pdf-manipulation.md)
- **Markup annotations** — typed annotation model (text, highlight, underline, strikeout, squiggly, square, circle, line, freetext) via `buildAnnotation()` / `buildAnnotationBody()`, plus `PdfReader.getAnnotations()` and `PdfModifier.addAnnotation()` for round-trip read/write (v1.5.0). [Guide →](docs/guides/annotations.md)
- **Layout debug & inspection** — opt-in `layout: { debug: true }` overlays margin / content / cell boxes for visual layout debugging; `inspectDocumentLayout()` returns a programmatic per-page block-geometry report. Byte-identical when debug is off (v1.5.0). [Guide →](docs/guides/debugging.md)
- **Math & technical symbols** — bundleable math font under lang `'math'`; mathematical operators, Greek, arrows, and technical symbols route automatically via script detection (v1.5.0)
- **Font-data tooling** — `pdfnative/tools` exposes `compileFontData()` / `parseFontData()` to build and introspect font-data modules programmatically (v1.5.0)
- **Image embedding** — JPEG (DCTDecode) and PNG (FlateDecode) with auto-scaling and alignment
- **Hyperlinks** — PDF link annotations (/URI) with URL validation, blue underlined text, tagged /Link
- **Header/footer templates** — configurable `PageTemplate` with left/center/right zones and `{page}`/`{pages}`/`{date}`/`{title}` placeholders
- **Watermarks** — text and image overlays with configurable opacity, rotation, and position (background/foreground)
- **Table of contents** — auto-generated TOC with internal /GoTo links, dot leaders, and page numbers
- **FlateDecode compression** — zlib stream compression (50–90% size reduction), zero-dependency, platform-native
- **Web Worker support** — off-main-thread generation for large datasets
- **Tree-shakeable** — ESM + CJS dual build with TypeScript declarations
- **95%+ test coverage** — 2309+ tests across 100 files, fuzz suite, dual-mode visual-regression suite, performance benchmarks
- **NPM provenance** — signed builds via GitHub Actions OIDC
- **On-device generation** — runs in Node, browsers, Workers, Deno, Bun. No SaaS round-trip; documents never leave the calling process unless your application explicitly sends them
- **No telemetry, no network calls** — verifiable in source. The library never opens a socket, fetches remote fonts, or phones home
- **AI client integration** — use pdfnative from Claude Desktop, Cursor, Continue, and Zed via [`pdfnative-mcp`](https://github.com/Nizoka/pdfnative-mcp) — **17 production tools** (generate, tables, barcodes, forms, sign, verify, validate, attachments, extraction, inspect, plus page-tree `merge_pdfs` / `split_pdf` / `extract_pages`)
- **Command-line interface** — render, sign, verify, inspect, and batch-render PDFs from the shell with [`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) — zero-config, scriptable, agent-native (`--json`/`E_*`/`--dry-run`), ideal for CI/CD pipelines
- **React renderer** — author PDFs as declarative JSX with [`pdfnative-react`](https://github.com/Nizoka/pdfnative-react): `<Document>`/`<Table>`/`<Barcode>` components, `usePdf`/`PDFViewer` client hooks, on-device rendering with no DOM or headless browser

## Installation

```bash
npm install pdfnative
```

**Requirements:** Node.js >= 22 | Modern browsers | Deno | Bun

## Documentation

- 🌐 **Website:** [pdfnative.dev](https://pdfnative.dev) — landing page, live in-browser demo with 10 examples, comparisons, benchmarks.
- 📘 **Quick Start:** [docs/guides/quickstart.md](docs/guides/quickstart.md) — Node.js, browser, Web Worker, streaming.
- 🏛️ **Architecture:** [docs/guides/architecture.md](docs/guides/architecture.md) — modules, builders, generation pipeline.
- ♿ **Accessibility:** [docs/guides/accessibility.md](docs/guides/accessibility.md) — tagged PDF, PDF/UA, PDF/A.
- ❓ **FAQ:** [docs/guides/faq.md](docs/guides/faq.md) — fonts, encryption, signatures, comparisons.
- 🤖 **Agentic workflows:** [docs/guides/agentic-workflows.md](docs/guides/agentic-workflows.md) — extend the engine at runtime (register fonts without a release) and embed agent-generated images.
- 🛠️ **Troubleshooting:** [docs/guides/troubleshooting.md](docs/guides/troubleshooting.md) — common pitfalls.
- 🎮 **Playgrounds:** nine interactive demos at [docs/playgrounds/](docs/playgrounds/) — [extreme-scripts](docs/playgrounds/extreme-scripts.html) (live BiDi/Indic stress tests), [all-scripts](docs/playgrounds/all-scripts.html) (every Unicode script), [medical-800](docs/playgrounds/medical-800.html) (800-page Web Worker showcase), [toolkit](docs/playgrounds/toolkit.html) (bookmarks, page labels, viewer prefs, merge/split/extract, and v1.6.0 form fill/flatten), [charts](docs/playgrounds/charts.html) (v1.6.0 native vector charts), plus [cli](docs/playgrounds/cli.html), [mcp](docs/playgrounds/mcp.html) and [react](docs/playgrounds/react.html) ecosystem explorers.
- 🧪 **Sample PDFs:** [scripts/generators/](scripts/generators/) — ~219 sample PDFs across 43 categories (see [Sample PDFs](#sample-pdfs) below).

## Why pdfnative?

pdfnative was designed for teams that need **ISO-compliant, production-grade PDF generation** with zero supply-chain risk. Here is how it compares to other popular JavaScript PDF libraries:

| Feature | pdfnative | jsPDF | pdfkit | pdf-lib | pdfmake |
|---------|:---------:|:-----:|:------:|:-------:|:------:|
| Runtime dependencies | **0** | 3 | 6 | 4 | 3 |
| TypeScript declarations | Built-in | Built-in | @types/* | Built-in | @types/* |
| PDF/A (ISO 19005) | 1b, 2b, 2u, 3b | — | — | — | — |
| Tagged PDF / PDF/UA | ✅ | — | ✅ | — | — |
| Encryption (read + write) | AES-128/256 + RC4 read | write | write | write | write |
| Complex text shaping (GSUB/GPOS) | ✅ Thai, Arabic, Devanagari, Bengali, Tamil | — | Via fontkit | Via @pdf-lib/fontkit | Via pdfkit |
| BiDi (RTL) layout | ✅ | — | — | — | — |
| Modify existing PDFs | ✅ (incremental) | — | — | ✅ | — |
| Forms (create + fill + flatten) | ✅ all three | create | create | create + fill | — |
| Native charts (vector) | ✅ bar/line/pie/donut | — | — | — | — |
| Digital signatures | ✅ (RSA + ECDSA) | — | — | — | — |
| Barcode / QR code (native) | ✅ 5 formats | — | — | — | QR |
| SVG path rendering | ✅ | ✅ | ✅ | ✅ | ✅ |
| Streaming output | ✅ | — | ✅ | — | ✅ |
| PDF parser | ✅ | — | — | ✅ | — |
| Tree-shakeable (ESM) | ✅ | — | — | ✅ | — |
| NPM provenance (SLSA) | ✅ | — | — | — | ✅ |

> **Data sources:** npm registry metadata and official README/documentation for each library as of April 2026. Dependency counts reflect direct `dependencies` listed in each package's `package.json`. "—" means the feature is not supported or not documented. Feature claims about third-party libraries are based on their public documentation and may not reflect the latest version — please verify against current releases. Sample PDFs validate with veraPDF (PDF/A) and Adobe Acrobat.

**When to choose another library:** You need advanced vector graphics (complex gradients, arbitrary transforms), rich interactive form scripting (JavaScript actions), or mature ecosystem integrations with existing toolchains.

**When to choose pdfnative:** You need zero-dependency PDF generation with ISO archival compliance (PDF/A), accessibility (tagged PDF), AES encryption, digital signatures, multi-script Unicode support — particularly Arabic/Hebrew BiDi and Thai GSUB/GPOS shaping — form fields, barcode generation, SVG rendering, or the ability to parse and incrementally modify existing PDFs.

## Quick Start

```typescript
import { buildPDFBytes, downloadBlob } from 'pdfnative';

const pdf = buildPDFBytes({
  title: 'Monthly Report',
  infoItems: [
    { label: 'Period', value: 'January 2026' },
    { label: 'Account', value: 'Main Account' },
  ],
  balanceText: 'Balance: $1,234.56',
  countText: '42 transactions',
  headers: ['Date', 'Description', 'Category', 'Amount', 'Status'],
  rows: [
    { cells: ['01/15', 'Grocery Store', 'Food', '-$45.00', ''], type: 'debit', pointed: false },
    { cells: ['01/16', 'Salary', 'Income', '+$3,000.00', 'X'], type: 'credit', pointed: true },
  ],
  footerText: 'Generated by MyApp',
});

// Browser: trigger download
downloadBlob(pdf, 'report.pdf');

// Node.js: write to file
import { writeFileSync } from 'fs';
writeFileSync('report.pdf', pdf);
```

### Document Builder

Build free-form documents with headings, paragraphs, lists, tables, images, barcodes, and more:

```typescript
import { buildDocumentPDFBytes } from 'pdfnative';

const pdf = buildDocumentPDFBytes({
  title: 'Project Report',
  blocks: [
    { type: 'toc' },
    { type: 'heading', text: 'Executive Summary', level: 1 },
    { type: 'paragraph', text: 'This quarter saw strong growth across all divisions...' },
    { type: 'image', data: jpegBytes, width: 400, align: 'center', alt: 'Revenue chart' },
    { type: 'list', items: ['Revenue up 15%', 'Costs down 8%', 'Net profit +23%'], style: 'bullet' },
    { type: 'table', headers: ['Q1', 'Q2', 'Q3', 'Q4'], rows: [
      { cells: ['$1.2M', '$1.4M', '$1.6M', '$1.8M'], type: 'credit', pointed: false },
    ]},
    { type: 'spacer', height: 20 },
    { type: 'heading', text: 'Next Steps', level: 2 },
    { type: 'paragraph', text: 'Focus areas for next quarter include...', align: 'left' },
    { type: 'link', text: 'View full report online', url: 'https://example.com/report' },
    { type: 'barcode', format: 'qr', data: 'https://example.com/report', align: 'center' },
  ],
  footerText: 'Confidential',
}, {
  headerTemplate: { center: 'Project Report', right: '{date}' },
  footerTemplate: { left: 'Confidential', right: 'Page {page} of {pages}' },
});
```

## Unicode Font Support

For non-Latin scripts, register font data loaders (lazy-loaded on demand):

```typescript
import { registerFonts, loadFontData, buildPDFBytes } from 'pdfnative';

registerFonts({
  th: () => import('pdfnative/fonts/noto-thai-data.js'),
  ja: () => import('pdfnative/fonts/noto-jp-data.js'),
  zh: () => import('pdfnative/fonts/noto-sc-data.js'),
  ko: () => import('pdfnative/fonts/noto-kr-data.js'),
  el: () => import('pdfnative/fonts/noto-greek-data.js'),
  hi: () => import('pdfnative/fonts/noto-devanagari-data.js'),
  tr: () => import('pdfnative/fonts/noto-turkish-data.js'),
  vi: () => import('pdfnative/fonts/noto-vietnamese-data.js'),
  pl: () => import('pdfnative/fonts/noto-polish-data.js'),
  ar: () => import('pdfnative/fonts/noto-arabic-data.js'),
  he: () => import('pdfnative/fonts/noto-hebrew-data.js'),
  ru: () => import('pdfnative/fonts/noto-cyrillic-data.js'),
  ka: () => import('pdfnative/fonts/noto-georgian-data.js'),
  hy: () => import('pdfnative/fonts/noto-armenian-data.js'),
  bn: () => import('pdfnative/fonts/noto-bengali-data.js'),
  ta: () => import('pdfnative/fonts/noto-tamil-data.js'),
  te: () => import('pdfnative/fonts/noto-telugu-data.js'), // v1.3.0
  si: () => import('pdfnative/fonts/noto-sinhala-data.js'), // v1.3.0
  bo: () => import('pdfnative/fonts/noto-tibetan-data.js'), // v1.3.0
  km: () => import('pdfnative/fonts/noto-khmer-data.js'), // v1.3.0
  my: () => import('pdfnative/fonts/noto-myanmar-data.js'), // v1.3.0
  am: () => import('pdfnative/fonts/noto-ethiopic-data.js'), // v1.3.0
  // v1.1.0+ — optional Latin fallback for PDF/A documents with curly quotes,
  // em-dash, ellipsis, etc. (activates automatically when needed):
  latin: () => import('pdfnative/fonts/noto-sans-data.js'),
  // v1.1.0+ — optional monochrome emoji:
  emoji: () => import('pdfnative/fonts/noto-emoji-data.js'),
});

const thaiFont = await loadFontData('th');

const pdf = buildPDFBytes({
  title: 'รายงานประจำเดือน',
  // ... other params
  fontEntries: thaiFont ? [{ fontData: thaiFont, fontRef: '/F3', lang: 'th' }] : [],
});
```

### Supported Languages

| Language | Code | Font | Script |
|----------|------|------|--------|
| Thai | `th` | Noto Sans Thai | GSUB + GPOS shaping |
| Japanese | `ja` | Noto Sans JP | CJK ideographs + kana |
| Chinese (Simplified) | `zh` | Noto Sans SC | CJK ideographs |
| Korean | `ko` | Noto Sans KR | Hangul syllables |
| Greek | `el` | Noto Sans Greek | Greek alphabet |
| Hindi (Devanagari) | `hi` | Noto Sans Devanagari | GSUB conjuncts + GPOS marks |
| Turkish | `tr` | Noto Sans Turkish | Latin extended (İ/ı) |
| Vietnamese | `vi` | Noto Sans Vietnamese | Latin + combining marks |
| Polish | `pl` | Noto Sans Polish | Latin extended (Ł/ł) |
| Arabic | `ar` | Noto Sans Arabic | GSUB positional shaping |
| Hebrew | `he` | Noto Sans Hebrew | Right-to-left script |
| Russian (Cyrillic) | `ru` | Noto Sans | Cyrillic alphabet |
| Georgian | `ka` | Noto Sans Georgian | Mkhedruli script |
| Armenian | `hy` | Noto Sans Armenian | Armenian alphabet |
| Bengali | `bn` | Noto Sans Bengali | GSUB conjuncts + GPOS marks |
| Tamil | `ta` | Noto Sans Tamil | GSUB ligatures + split vowels |
| Latin (PDF/A) | `latin` | Noto Sans VF | WinAnsi-extended Latin (curly quotes, em-dash, ellipsis…) |
| Emoji | `emoji` | Noto Emoji | Monochrome emoji (BMP/SMP, Fitzpatrick, ZWJ, VS-15/16) |

## Multi-Font (Mixed Scripts)

Generate PDFs with multiple scripts in the same document:

```typescript
const fonts = await Promise.all([
  loadFontData('th'),
  loadFontData('ja'),
  loadFontData('zh'),
]);

const fontEntries = fonts
  .filter(Boolean)
  .map((fd, i) => ({ fontData: fd!, fontRef: `/F${3 + i}`, lang: ['th', 'ja', 'zh'][i] }));

const pdf = buildPDFBytes({
  title: 'Multi-Language Report',
  headers: ['Date', 'Description', 'Category', 'Amount', 'Status'],
  rows: [
    { cells: ['01/01', 'English text', 'Test', '+100', 'OK'], type: 'credit', pointed: false },
    { cells: ['01/02', 'ข้อความไทย', 'ทดสอบ', '-50', ''], type: 'debit', pointed: false },
    { cells: ['01/03', '日本語テキスト', 'テスト', '+200', '済'], type: 'credit', pointed: true },
  ],
  // ... other params
  fontEntries,
});
```

## Web Worker (Large Datasets)

```typescript
import { createPDF } from 'pdfnative';

const pdf = await createPDF(params, {
  workerUrl: new URL('pdfnative/worker', import.meta.url),
  threshold: 500, // use Worker above 500 rows
  timeout: 30000, // Worker timeout in ms (default: 60000)
  onProgress: (percent) => console.log(`${percent}%`),
});
```

For lower-level control, use `generatePDFInWorker` directly with `WorkerGenerationOptions`:

```typescript
import { generatePDFInWorker } from 'pdfnative';
import type { WorkerGenerationOptions } from 'pdfnative';

const options: WorkerGenerationOptions = {
  timeout: 15000,
  onProgress: (percent) => console.log(`${percent}%`),
};

const pdf = await generatePDFInWorker(workerUrl, params, options);
```

## Layout Customization

```typescript
const pdf = buildPDFBytes(params, {
  pageWidth: 595.28,   // A4 (default)
  pageHeight: 841.89,  // A4 (default)
  margins: { t: 45, r: 36, b: 35, l: 36 },
  colors: {
    title: '#2563EB',           // hex — primary format
    credit: [15, 145, 121],     // RGB tuple [0–255]
    debit: '0.863 0.149 0.149', // PDF operator string [0.0–1.0]
    // ... see PdfColors type
  },
  columns: [
    { f: 0.15, a: 'l', mx: 12, mxH: 12 },
    { f: 0.35, a: 'l', mx: 50, mxH: 50 },
    { f: 0.20, a: 'r', mx: 20, mxH: 20 },
    { f: 0.30, a: 'r', mx: 30, mxH: 30 },
  ],
});
```

### Color Formats

All color values accept three formats:

| Format | Example | Description |
|--------|---------|-------------|
| Hex string | `'#2563EB'` or `'#26E'` | Primary format — `#RRGGBB` or `#RGB` |
| RGB tuple | `[37, 99, 235]` | Array with values 0–255 |
| PDF operator | `'0.145 0.388 0.922'` | Raw PDF RGB string (0.0–1.0) |

```typescript
import { parseColor } from 'pdfnative';

parseColor('#2563EB');           // '0.145 0.388 0.922'
parseColor([37, 99, 235]);       // '0.145 0.388 0.922'
parseColor('0.145 0.388 0.922'); // '0.145 0.388 0.922'
```

All inputs are validated and normalized before interpolation into PDF content streams, preventing operator injection.

### Font Sizes

Customize font sizes for each zone (title, info bar, table header, table cells, footer):

```typescript
const pdf = buildPDFBytes(params, {
  fontSizes: {
    title: 20,   // Title text (default: 16)
    info: 10,    // Info bar items (default: 9)
    th: 9,       // Table header cells (default: 8)
    td: 8,       // Table body cells (default: 7.5)
    ft: 8,       // Footer text (default: 7)
  },
});
```

| Zone | Key | Default | Description |
|------|-----|---------|-------------|
| Title | `title` | 16 | PDF title text |
| Info bar | `info` | 9 | Key-value pairs below title |
| Table header | `th` | 8 | Column header row |
| Table cells | `td` | 7.5 | Data row cells |
| Footer | `ft` | 7 | Page footer text |

All values are in PDF points (1pt = 1/72 inch). Partial overrides are supported — unspecified keys use defaults.

## Building Custom Font Data

### Obtaining TTF Files

For Noto Sans fonts, download the raw `.ttf` file directly from the [noto-fonts GitHub repository](https://github.com/notofonts):

1. Navigate to the font's GitHub repository (e.g., `github.com/notofonts/bengali`)
2. Find the TTF file under `fonts/NotoSansBengali/unhinted/ttf/` (or similar path)
3. Click the file, then click **"Download raw file"** (or use the raw URL)
4. Save it to `fonts/ttf/`

No zip download or extraction needed — each TTF is a standalone file you can download directly.

### Building the Data Module

Convert any TTF font into an importable data module:

```bash
npx pdfnative-build-font fonts/ttf/MyFont.ttf fonts/my-font-data.js
```

The tool extracts cmap, widths, metrics, GSUB, GPOS, and embeds the raw TTF as base64.

### Full colour-emoji coverage (`pdfnative-build-emoji-font`)

The bundled colour-emoji module (`pdfnative/fonts/noto-color-emoji-data.js`)
ships a lean curated subset to keep the package small. When you need glyphs
beyond that subset — up to the **full ~3,600-glyph** Noto Color Emoji set — a
second bundled binary generates a custom data module on demand, so even
**pdfnative-only** users get full coverage without the package ever carrying the
~32 MB source font:

```bash
# Download the pinned Noto Color Emoji (SHA-256 verified) and emit every glyph
npx pdfnative-build-emoji-font --download --all --out my-color-emoji-data.js

# …or build from a local TTF, selecting only the glyphs you need
npx pdfnative-build-emoji-font --ttf NotoColorEmoji-Regular.ttf \
  --codepoints "1F600,1F680,2764" --out my-color-emoji-data.js
```

Select glyphs with `--all`, `--preset`, `--codepoints`, or `--ranges`, then
register the generated module under lang `'emoji'`. See the
[Colour-emoji CLI guide](docs/guides/colour-emoji-cli.md).

## Agentic workflows

pdfnative is shaped so an AI agent can do more than *call* the engine — it can
**extend** it at runtime and **feed it content it generated itself**, without
waiting for a library release. Both patterns use already-shipped, public APIs.

**1. Extend the engine at runtime — no release required.** The font registry is a
runtime API. An agent can compile a TTF/OTF in memory and register it on the spot,
so a document renders the moment it needs a new script, symbol set, or brand font:

```ts
import { buildDocumentPDFBytes, registerFont } from 'pdfnative';
import { parseFontData } from 'pdfnative/tools';

const fontData = parseFontData(ttfBytes);        // pure, in-memory (no fs)
registerFont('custom', () => Promise.resolve(fontData));

const pdf = buildDocumentPDFBytes({
  title: 'Runtime font',
  blocks: [{ type: 'paragraph', text: 'Agent-registered font.', lang: 'custom' }],
});
```

This is how the bundled **Noto Sans Math** font existed as a *working runtime
pattern* before it shipped as a default in v1.5.0. Use `compileFontData()` to emit
a reusable `*-data.js` module (byte-identical to `npx pdfnative-build-font`).

**2. Embed agent-generated images.** Image-generating agents (e.g. Antigravity,
ChatGPT, and other multimodal assistants) can pipe a generated PNG/JPEG straight
into a document — via the `image` block (library / CLI) or the `embed_image` MCP
tool. pdfnative parses and embeds it natively (no rasterization) and validates it
at the boundary.

Runtime extensibility is **not** autonomous modification of the published package:
the agent extends its own in-process instance; the repository is only ever changed
by a human under the [AI-governance / human-in-the-loop contract](docs/guides/ai-governance.md).
See the [Agentic workflows guide](docs/guides/agentic-workflows.md) for the full walkthrough.

## Visual PDF Inspection

<a id="sample-pdfs"></a>

Generate sample PDFs for all supported languages to visually verify output:

```bash
npm run test:generate
```

This creates **~219 PDF files** in `test-output/` (git-ignored), organized in thirty-one categories (including `forms/` fill-&-flatten and `charts/` native vector charts added in v1.6.0).
See [scripts/README.md](scripts/README.md) for the modular generator architecture.

### Financial Statements (per language)

| File | Content |
|------|---------|
| `sample-latin.pdf` | English / Helvetica |
| `sample-th.pdf` | Thai with GSUB + GPOS shaping |
| `sample-ja.pdf` | Japanese (CJK ideographs) |
| `sample-zh.pdf` | Chinese Simplified |
| `sample-ko.pdf` | Korean (Hangul) |
| `sample-el.pdf` | Greek |
| `sample-hi.pdf` | Hindi (Devanagari) |
| `sample-tr.pdf` | Turkish (İ/ı special casing) |
| `sample-vi.pdf` | Vietnamese (combining marks) |
| `sample-pl.pdf` | Polish (Ł/ł) |
| `sample-ar.pdf` | Arabic (RTL, positional shaping) |
| `sample-he.pdf` | Hebrew (RTL) |
| `sample-ru.pdf` | Russian (Cyrillic) |
| `sample-ka.pdf` | Georgian (Mkhedruli) |
| `sample-hy.pdf` | Armenian |
| `sample-bn.pdf` | Bengali (GSUB conjuncts + GPOS marks) |
| `sample-ta.pdf` | Tamil (GSUB + split vowel decomposition) |
| `sample-multi.pdf` | Mixed: all 22 scripts in one PDF |
| `sample-pagination.pdf` | 200 rows, multi-page layout |

### Diverse Use Cases (non-financial)

| File | Content |
|------|---------|
| `diverse-student-transcript.pdf` | University academic transcript (Latin) |
| `diverse-recipe-th.pdf` | Thai recipe — Tom Yum Goong ingredients (Thai) |
| `diverse-server-ja.pdf` | Server monitoring dashboard (Japanese) |
| `diverse-inventory-zh.pdf` | Warehouse product inventory (Chinese) |
| `diverse-sports-ko.pdf` | K-League football standings (Korean) |
| `diverse-library-el.pdf` | Classical Greek library catalog (Greek) |
| `diverse-medical-hi.pdf` | Blood test lab results (Hindi) |
| `diverse-menu-tr.pdf` | Turkish restaurant dinner menu (Turkish) |
| `diverse-weather-vi.pdf` | Weekly weather forecast — Hanoi (Vietnamese) |
| `diverse-train-pl.pdf` | Train schedule — Warsaw (Polish) |
| `diverse-marketplace-ar.pdf` | Gold marketplace catalog — Dubai (Arabic) |
| `diverse-museum-he.pdf` | Museum exhibition catalog — Jerusalem (Hebrew) |

### Alphabet / Character Coverage

| File | Content |
|------|---------|
| `alphabet-thai.pdf` | 44 consonants, vowels, tone marks, digits |
| `alphabet-japanese.pdf` | Hiragana, Katakana, Kanji numerals & common |
| `alphabet-chinese.pdf` | 121 characters by category (HSK frequency) |
| `alphabet-korean.pdf` | Hangul jamo, syllables, complex clusters |
| `alphabet-greek.pdf` | Full uppercase/lowercase, accented, archaic |
| `alphabet-devanagari.pdf` | Vowels, consonants, matras, conjuncts, digits |
| `alphabet-turkish.pdf` | 29 letters, İ/ı dotted-I distinction test |
| `alphabet-vietnamese.pdf` | 7 base vowels × 6 tones, all diacritics |
| `alphabet-polish.pdf` | 32 letters, digraphs, pangram |
| `alphabet-arabic.pdf` | 28 letters, harakat, numerals, ligatures |
| `alphabet-hebrew.pdf` | 22 letters, final forms, vowel points |
| `alphabet-cyrillic.pdf` | 33 Russian letters, Ukrainian/Serbian extended |
| `alphabet-georgian.pdf` | 33 Mkhedruli letters, Asomtavruli |
| `alphabet-armenian.pdf` | 38 letters, ligatures |
| `alphabet-bengali.pdf` | Vowels, consonants, conjuncts, digits |
| `alphabet-tamil.pdf` | Vowels, consonants, compound characters, digits |

### PDF/A Conformance Variants

| File | Content |
|------|---------|
| `tagged-pdfa2b-default.pdf` | PDF/A-2b (tagged=true, default) |
| `tagged-pdfa2b-explicit.pdf` | PDF/A-2b (tagged='pdfa2b', explicit) |
| `tagged-pdfa1b.pdf` | PDF/A-1b (tagged='pdfa1b', legacy) |
| `tagged-pdfa2u.pdf` | PDF/A-2u (tagged='pdfa2u', Unicode) |
| `tagged-pdfa3b.pdf` | PDF/A-3b (tagged='pdfa3b', embedded file attachments) |

### Encrypted PDFs

| File | Content |
|------|---------|
| `encrypted-aes128.pdf` | AES-128 (V4/R4) owner-only |
| `encrypted-aes256.pdf` | AES-256 (V5/R6) owner-only |
| `encrypted-aes128-user.pdf` | AES-128 with user+owner passwords |
| `encrypted-aes256-user.pdf` | AES-256 with user+owner passwords |
| `encrypted-readonly.pdf` | AES-128 read-only (no copy/modify) |
| `encrypted-noprint.pdf` | AES-128 fully restricted |

**Sample passwords** (for testing only — all documented in `scripts/generate-samples.ts`):

| File | Owner Password | User Password |
|------|---------------|---------------|
| `encrypted-aes128.pdf` | `owner123` | _(none — opens freely)_ |
| `encrypted-aes256.pdf` | `owner256` | _(none — opens freely)_ |
| `encrypted-aes128-user.pdf` | `owner123` | `user456` |
| `encrypted-aes256-user.pdf` | `owner256` | `user789` |
| `encrypted-readonly.pdf` | `owner-ro` | _(none — opens freely)_ |
| `encrypted-noprint.pdf` | `owner-np` | _(none — opens freely)_ |
| `doc-encrypted-aes128.pdf` | `docowner` | `docuser` |
| `doc-encrypted-aes256.pdf` | `strongowner256` | _(none — opens freely)_ |

### Document Builder Samples

| File | Content |
|------|---------|
| `doc-headings-paragraphs.pdf` | H1/H2/H3 + paragraphs with text wrapping |
| `doc-lists.pdf` | Bullet + numbered lists |
| `doc-links.pdf` | External hyperlink annotations |
| `doc-table.pdf` | Embedded table in document |
| `doc-spacer-pagebreak.pdf` | Spacers + forced page breaks (3 pages) |
| `doc-encrypted-aes128.pdf` | Document builder + AES-128 encryption |
| `doc-encrypted-aes256.pdf` | Document builder + AES-256 encryption |
| `doc-image.pdf` | Image embedding (JPEG, centered) |
| `doc-custom-colors.pdf` | Color formats (hex, tuple, PDF operator) |
| `doc-japanese.pdf` | Japanese Unicode document (headings, lists, table) |
| `doc-arabic.pdf` | Arabic RTL document (headings, lists, table, BiDi) |
| `doc-hebrew.pdf` | Hebrew RTL document (headings, lists, table, BiDi) |
| `doc-thai.pdf` | Thai user manual (GSUB+GPOS shaping, pricing table) |
| `doc-bengali.pdf` | Bengali document (GSUB conjuncts + GPOS marks) |
| `doc-tamil.pdf` | Tamil document (GSUB substitution + split vowels) |
| `doc-devanagari.pdf` | Hindi (Devanagari) document — GSUB conjuncts, reph reordering, matra reordering, split vowels |
| `doc-telugu.pdf` | Telugu document (virama conjuncts + GPOS marks, no reph) |
| `doc-sinhala.pdf` | Sinhala document (virama conjuncts + pre-base kombuva reordering) |
| `doc-tibetan.pdf` | Tibetan document (vertical subjoined-consonant stacking) |
| `doc-khmer.pdf` | Khmer document (USE-lite: coeng subscripts, pre-base vowels) |
| `doc-myanmar.pdf` | Myanmar document (USE-lite: medials, pre-base reordering) |
| `doc-amharic.pdf` | Amharic/Ethiopic document (syllabic abugida, no reordering) |
| `doc-chinese-catalog.pdf` | Chinese product catalog (tables, ordering info) |
| `doc-multi-language.pdf` | Multi-language showcase: all 22 Unicode scripts in one PDF |
| `doc-invoice.pdf` | Invoice template (line items, totals, payment link) |
| `doc-report-multipage.pdf` | 3-page technical report (7 sections, 4 tables) |
| `doc-contract-bilingual.pdf` | Bilingual EN/AR contract (legal sections, signatures) |
| `doc-showcase-all-blocks.pdf` | All 12 block types in one PDF |

### Compressed PDFs (FlateDecode)

| File | Content |
|------|---------|
| `compressed-latin-100rows.pdf` | 100-row Latin table (87% smaller) |
| `uncompressed-latin-100rows.pdf` | Same 100-row table without compression (baseline) |
| `compressed-japanese.pdf` | Japanese CIDFont + TTF subset (62% smaller) |
| `compressed-arabic.pdf` | Arabic RTL + GSUB shaping (compressed) |
| `compressed-thai.pdf` | Thai GSUB+GPOS shaping (compressed) |
| `compressed-tagged-pdfa2b.pdf` | FlateDecode + Tagged PDF/A-2b (XMP uncompressed) |
| `compressed-encrypted-aes128.pdf` | FlateDecode + AES-128 encryption |
| `doc-compressed.pdf` | Document builder with FlateDecode |

### Stress Test PDFs

| File | Content |
|------|---------|  
| `stress-test-10k-rows.pdf` | 10,000-row table (167 pages, 4.3MB) |
| `doc-extreme-bidi-wrapping.pdf` | Extreme BiDi mixed-script text wrapping |
| `table-heavy-text-overflow.pdf` | Dense table with heavy text overflow |
| `media-rich-document.pdf` | Media-rich document with multiple images |
| `tagged-accessibility-complex.pdf` | Complex tagged PDF/A accessibility tree |
| `layout-extreme-customization.pdf` | Extreme layout customization (margins, columns, colors) |

### Edge-Case Stress Tests

| File | Content |
|------|---------|  
| `doc-unbreakable-text.pdf` | 1000-char words with no spaces (DNA, URL, Base64) |
| `table-micro-columns.pdf` | Extreme column fractions (f=0.025, mx=1) |
| `doc-link-annotation-bomb.pdf` | 500 link annotations across 10 pages |
| `zero-content-empty-table.pdf` | Table with headers but 0 rows |
| `zero-content-empty-doc.pdf` | Document with no blocks |
| `zero-content-empty-strings.pdf` | Empty headings, paragraphs, and list items |
| `doc-heavy-buffer-5mb.pdf` | 5 MB synthetic JPEG embedded (memory stress) |

### Barcode & QR Code Samples

| File | Content |
|------|---------|
| `barcode-showcase.pdf` | All 5 formats: Code 128, EAN-13, QR Code, Data Matrix, PDF417 |
| `barcode-alignment-sizing.pdf` | Alignment (left/center/right) and custom size variations |
| `barcode-tagged-pdfa.pdf` | Barcodes in tagged PDF/A-2b mode (/Figure structure elements) |

### SVG Path Rendering Samples

| File | Content |
|------|---------|
| `svg-basic-shapes.pdf` | Rect, circle, ellipse, line, polyline, polygon |
| `svg-complex-paths.pdf` | Cubic/quadratic Bézier curves, arcs, combined paths |
| `svg-tagged-pdfa.pdf` | SVG elements in tagged PDF/A-2b mode |

### Form Field Samples

| File | Content |
|------|---------|
| `form-fields.pdf` | All field types: text, multiline, checkbox, radio, dropdown, listbox |
| `form-contact.pdf` | Contact form with name, email, message, and submit fields |

### Digital Signature Samples

| File | Content |
|------|---------|
| `sig-rsa-self-signed.pdf` | RSA PKCS#1 v1.5 self-signed signature |
| `sig-ecdsa-p256.pdf` | ECDSA P-256 digital signature |
| `sig-multi-field.pdf` | PDF with multiple signature fields |

### Streaming Output Samples

| File | Content |
|------|---------|
| `streaming-document.pdf` | Document streamed via `buildDocumentPDFStream()` |
| `streaming-table.pdf` | Table streamed via `buildPDFStream()` |

### PDF Parser & Modifier Samples

| File | Content |
|------|---------|
| `parser-original.pdf` | Generated → parsed → verified round-trip |
| `parser-modified.pdf` | Generated → parsed → modified → incremental save |
| `parser-document.pdf` | Document builder → parser round-trip verification |

### Outline & Page Label Samples (v1.4.0)

| File | Content |
|------|---------|
| `outline/outline-explicit.pdf` | Nested bookmarks (`/Outlines`) + roman/decimal page labels |
| `outline/outline-auto.pdf` | `outline: 'auto'` — bookmarks derived from headings |
| `outline/page-labels.pdf` | Roman front matter + prefixed appendix page labels |

### PDF Manipulation Samples (v1.4.0)

| File | Content |
|------|---------|
| `manipulation/merged.pdf` | `mergePdfs()` — multiple documents combined |
| `manipulation/split-report.pdf` | `splitPdf()` — first page range |
| `manipulation/split-invoice.pdf` | `splitPdf()` — second page range |
| `manipulation/extract-reordered.pdf` | `extractPages()` — selected pages, reordered |
| `manipulation/streamed.pdf` | `streamToFile()` — document streamed straight to disk |

## API Reference

### Core

| Function | Description |
|----------|-------------|
| `buildPDF(params, layout?)` | Build table-centric PDF as binary string |
| `buildPDFBytes(params, layout?)` | Build table-centric PDF as `Uint8Array` |
| `buildDocumentPDF(params, layout?)` | Build free-form document PDF as binary string |
| `buildDocumentPDFBytes(params, layout?)` | Build free-form document PDF as `Uint8Array` |
| `wrapText(text, maxWidth, fontSize, enc)` | Word-wrap text into lines |
| `createPDF(params, options?)` | Smart dispatch (Worker or main thread) |
| `initNodeCompression()` | Initialize native zlib for ESM (call once before `compress: true`) |
| `downloadBlob(bytes, filename)` | Trigger browser download |
| `toBytes(str)` | Convert binary string to `Uint8Array` |
| `slugify(str)` | Sanitize string for filename |

### Image Support

| Function | Description |
|----------|-------------|
| `parseImage(bytes)` | Auto-detect and parse JPEG or PNG |
| `parseJPEG(bytes)` | Parse JPEG image (DCTDecode) |
| `parsePNG(bytes)` | Parse PNG image (FlateDecode) |
| `detectImageFormat(bytes)` | Detect JPEG or PNG from magic bytes |
| `buildImageXObject(img, smaskObj?)` | Build PDF Image XObject dictionary |
| `buildImageOperators(ref, x, y, w, h)` | Build `q cm Do Q` content stream operators |

### Link Annotations

| Function | Description |
|----------|-------------|
| `validateURL(url)` | Validate URL scheme (http/https/mailto only) |
| `buildLinkAnnotation(annot)` | Build PDF /Link annotation with /URI action |
| `buildInternalLinkAnnotation(link)` | Build PDF /Link with /GoTo action |
| `isLinkAnnotation(annot)` | Type guard for LinkAnnotation |

### BiDi & Arabic/Hebrew Shaping

| Function | Description |
|----------|-------------|
| `resolveBidiRuns(text)` | Resolve text into BiDi runs with levels |
| `containsRTL(text)` | Check if text contains RTL characters |
| `shapeArabicText(str, fontData)` | Arabic GSUB positional shaping |
| `containsArabic(text)` | Check for Arabic characters |
| `containsHebrew(text)` | Check for Hebrew characters |

### Barcode & QR Code

| Function | Description |
|----------|-------------|
| `renderBarcode(format, data, x, y, opts?)` | Unified barcode renderer (dispatches to format-specific function) |
| `encodeCode128(data)` | Encode data into Code 128 barcode pattern (ISO 15417) |
| `renderCode128(data, x, y, w, h)` | Render Code 128 barcode as PDF path operators |
| `ean13CheckDigit(digits)` | Compute EAN-13 check digit (ISO 15420) |
| `renderEAN13(data, x, y, w, h)` | Render EAN-13 barcode with guard bars and digits |
| `generateQR(data, ecLevel?)` | Generate QR Code matrix (ISO 18004) |
| `renderQR(data, x, y, size, ecLevel?)` | Render QR Code as PDF path operators |
| `generateDataMatrix(data)` | Generate Data Matrix ECC 200 matrix (ISO 16022) |
| `renderDataMatrix(data, x, y, size)` | Render Data Matrix as PDF path operators |
| `encodePDF417(data, ecLevel?)` | Encode data into PDF417 codewords (ISO 15438) |
| `renderPDF417(data, x, y, w, h, ecLevel?)` | Render PDF417 barcode as PDF path operators |

### SVG Rendering

| Function | Description |
|----------|-------------|
| `parseSvgPath(d)` | Parse SVG path `d` attribute into segments |
| `renderSvg(segments, options?)` | Render SVG segments (paths + `<text>`) as PDF operators |

### Markup Annotations

| Function | Description |
|----------|-------------|
| `buildAnnotation(annot, objNum)` | Build a full markup annotation indirect object (v1.5.0) |
| `buildAnnotationBody(annot)` | Build a markup annotation dictionary body (for the modifier) (v1.5.0) |

Supported `MarkupAnnotation` types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`.

### Layout Debug & Inspection

| Function | Description |
|----------|-------------|
| `inspectDocumentLayout(params, layout?)` | Return a programmatic per-page block-geometry `LayoutInspection` (v1.5.0) |

Enable the visual overlay via `layout: { debug: true }` or a granular `LayoutDebugOptions` (`showMargins` / `showContentBounds` / `showCells`). Byte-identical when debug is off.

### Font-Data Tools (`pdfnative/tools`)

| Function | Description |
|----------|-------------|
| `compileFontData(buffer, opts?)` | Compile a TTF/OTF `Uint8Array` into a font-data module source string (v1.5.0) |
| `parseFontData(buffer, opts?)` | Parse a TTF/OTF `Uint8Array` into a `FontDataObject` (metrics, cmap, widths, glyph coverage) (v1.5.0) |

### AcroForm Fields

| Function | Description |
|----------|-------------|
| `buildFormWidget(field, objNum, pageRef)` | Build form field widget annotation + appearance stream |
| `buildAcroFormDict(fieldRefs)` | Build `/AcroForm` dictionary for catalog |
| `buildRadioGroupParent(group)` | Build radio button group parent object |
| `buildAppearanceStreamDict(width, height)` | Build appearance stream dictionary |
| `defaultFieldHeight(type)` | Default height by field type |

### Digital Signatures

| Function | Description |
|----------|-------------|
| `buildSigDict(options)` | Build `/Sig` dictionary with ByteRange/Contents placeholders |
| `signPdfBytes(pdf, options)` | Sign a PDF with CMS/PKCS#7 detached signature |
| `estimateContentsSize(options)` | Estimate hex-encoded `/Contents` size for pre-allocation |
| `setCryptoProvider(provider)` | Install (or clear with `null`) a global native signature provider (v1.4.0) |
| `getCryptoProvider()` | Return the current global `CryptoProvider`, or `null` (v1.4.0) |

### Streaming Output

| Function | Description |
|----------|-------------|
| `buildDocumentPDFStream(params, layout?, streamOpts?)` | Stream document PDF as `AsyncGenerator<Uint8Array>` |
| `buildPDFStream(params, layout?, streamOpts?)` | Stream table PDF as `AsyncGenerator<Uint8Array>` |
| `buildDocumentPDFStreamTrue(params, layout?, streamOpts?)` | **True constant-memory** document streaming — frees each part as it yields (v1.3.0) |
| `buildPDFStreamTrue(params, layout?, streamOpts?)` | **True constant-memory** table streaming (v1.3.0) |
| `buildDocumentPDFStreamPageByPage(params, layout?)` | Stream document PDF chunked at PDF object boundaries |
| `buildPDFStreamPageByPage(params, layout?)` | Stream table PDF chunked at PDF object boundaries |
| `validateDocumentStreamable(params, layout?)` | Validate document is compatible with streaming (no TOC, no `{pages}`) |
| `validateTableStreamable(params, layout?)` | Validate table is compatible with streaming |
| `chunkBinaryString(str, chunkSize)` | Split binary string into `Uint8Array` chunks |
| `concatChunks(chunks)` | Concatenate `Uint8Array` chunks into one |
| `streamByteLength(stream)` | Count total bytes from an async stream |
| `streamToFile(stream, filePath, opts?)` | Drain an `AsyncGenerator<Uint8Array>` to disk with back-pressure + `AbortSignal` (Node) — returns `{ bytesWritten, chunks }` (v1.4.0) |

### Crypto (Hashing, ASN.1, RSA, ECDSA, X.509, CMS)

| Function | Description |
|----------|-------------|
| `sha384(data)` / `sha512(data)` | SHA-384 / SHA-512 hash (FIPS 180-4) |
| `hmacSha256(key, data)` | HMAC-SHA-256 (RFC 2104) |
| `derDecode(data)` | Decode DER-encoded ASN.1 |
| `rsaSign(msg, key)` / `rsaVerify(msg, sig, key)` | RSA PKCS#1 v1.5 sign/verify |
| `ecdsaSign(hash, key)` / `ecdsaVerify(hash, sig, key)` | ECDSA P-256 sign/verify |
| `parseCertificate(der)` | Parse X.509 DER certificate |
| `buildCmsSignedData(options)` | Build CMS SignedData (PKCS#7) |
| `initCrypto()` | Initialize crypto module (lazy load) |

### PDF Parser & Modifier

| Function | Description |
|----------|-------------|
| `openPdf(bytes)` | Parse a PDF `Uint8Array` and return a `PdfReader` |
| `createModifier(reader)` | Create an incremental `PdfModifier` from a `PdfReader` |
| `createTokenizer(data, offset?)` | Create a low-level PDF tokenizer |
| `parseValue(tok)` | Parse a single PDF value from token stream |
| `parseIndirectObject(tok)` | Parse an indirect object (`N M obj ... endobj`) |
| `findStartxref(data)` | Find `startxref` offset in PDF bytes |
| `parseXrefTable(data, offset)` | Parse xref table/stream at given offset |
| `isRef(v)` / `isDict(v)` / `isArray(v)` / `isStream(v)` | Type guards for parsed PDF values |
| `dictGet(dict, key)` / `dictGetName(dict, key)` | Dictionary value accessors |
| `inflateSync(data)` | Decompress FlateDecode data (zlib inflate) |
| `validatePdfUA(bytes)` | Read-only PDF/UA structural checker — returns `{ valid, errors, warnings }` (v1.3.0) |
| `mergePdfs(sources, opts?)` | Merge multiple PDFs into one, rebuilding a clean object graph; `opts.maxOutputSize` caps output at 256 MiB by default (v1.4.0); `opts.encrypt` re-encrypts the output (AES-128/AES-256, v1.6.0) |
| `splitPdf(src, ranges, opts?)` | Split a PDF into multiple documents by inclusive 0-based page ranges (v1.4.0) |
| `extractPages(src, indices, opts?)` | Extract specific pages (0-based) into a new PDF (v1.4.0) |
| `reader.getPageLabels()` | Parse an existing `/PageLabels` number tree into `PageLabelRange[]` or `null` (v1.5.0) |
| `reader.getAnnotations(pageIndex)` | Read a page's annotations into `ParsedAnnotation[]` (v1.5.0) |
| `reader.getPageRef(pageIndex)` | Get the indirect `PdfRef` for a page (v1.5.0) |
| `modifier.addAnnotation(pageIndex, body)` | Inject a new annotation on a page via incremental update (v1.5.0) |
| `extractText(bytes, opts?)` | Extract per-page reading-order Unicode text (+ optional positioned runs) from any PDF, incl. encrypted (`opts.password`); `ToUnicode`/`Differences`/WinAnsi/MacRoman decoding, hard `maxTextLength` memory cap (v1.6.0) |

### Document Block Types

| Type | Description |
|------|-------------|
| `HeadingBlock` | H1/H2/H3 with color, auto-wrapped |
| `ParagraphBlock` | Text with fontSize, lineHeight, align, indent, color |
| `TableBlock` | Headers + rows using PdfRow/ColumnDef |
| `ListBlock` | Bullet or numbered items; entries may be plain strings or nested `ListItem` `{ text, items }` for hierarchical lists (v1.4.0) |
| `ImageBlock` | JPEG/PNG with optional width, height, align, alt text |
| `LinkBlock` | Hyperlink with URL, blue underline, tagged /Link |
| `SpacerBlock` | Vertical whitespace |
| `PageBreakBlock` | Force new page |
| `TocBlock` | Auto-generated table of contents with /GoTo links |
| `BarcodeBlock` | Barcode / QR code rendered via PDF path operators |
| `SvgBlock` | SVG path/shape rendering as native PDF path operators |
| `FormFieldBlock` | AcroForm interactive fields (text, checkbox, radio, dropdown, listbox) |

### Tagged PDF & PDF/A

| Function | Description |
|----------|-------------|
| `resolvePdfAConfig(tagged)` | Resolve tagged option → PDF/A config (version, part, conformance) |
| `encodePdfTextString(str)` | Encode string as PDF text (PDFDocEncoding or UTF-16BE hex) |

### Encryption

Encryption is configured via the `encryption` option in layout options. Internal encryption functions are not part of the public API.

```typescript
const pdf = buildPDFBytes(params, {
  encryption: { userPassword: 'secret', ownerPassword: 'admin', permissions: { printing: true } }
});
```

### Color Utilities

| Function | Description |
|----------|-------------|
| `parseColor(input)` | Parse hex / tuple / PDF string → validated PDF RGB string |
| `isValidPdfRgb(str)` | Check if string is valid `"R G B"` format (0.0–1.0) |
| `normalizeColors(colors)` | Validate and normalize all fields in a PdfColors object |

### Compression

| Function | Description |
|----------|-------------|
| `initNodeCompression()` | Initialize native zlib (async, call once in ESM before `compress: true`) |
| `setDeflateImpl(fn)` | Inject custom DEFLATE function (e.g. for browser polyfill) |

**Browser compression** — In browser environments without native zlib, inject a third-party DEFLATE via `setDeflateImpl`:

```typescript
import { setDeflateImpl, buildPDFBytes } from 'pdfnative';
import { deflateSync } from 'fflate'; // or pako

setDeflateImpl(deflateSync);

const pdf = buildPDFBytes(params, { compress: true });
```

### Fonts

| Function | Description |
|----------|-------------|
| `registerFont(lang, loader)` | Register a font data loader |
| `registerFonts(map)` | Register multiple font loaders |
| `loadFontData(lang)` | Lazy-load font data (cached) |
| `hasFontLoader(lang)` | Check if loader is registered |
| `getRegisteredLangs()` | List registered language codes |
| `createEncodingContext(fontEntries)` | Create encoding context |
| `validateFontData(data)` | Opt-in structural validation of custom font data — returns `{ valid, errors, warnings }` (v1.4.0) |

### Shaping

| Function | Description |
|----------|-------------|
| `shapeThaiText(str, fontData)` | Thai OpenType shaping (GSUB + GPOS) |
| `shapeBengaliText(str, fontData)` | Bengali GSUB conjuncts + GPOS marks |
| `shapeTamilText(str, fontData)` | Tamil GSUB + split vowel decomposition |
| `shapeDevanagariText(str, fontData)` | Devanagari cluster shaping + GSUB/GPOS |
| `shapeTeluguText(str, fontData)` | Telugu GSUB conjuncts + GPOS marks (v1.3.0) |
| `shapeSinhalaText(str, fontData)` | Sinhala conjuncts + pre-base reorder + GSUB/GPOS (v1.3.0) |
| `shapeTibetanText(str, fontData)` | Tibetan vertical subjoined stacking (v1.3.0) |
| `shapeKhmerText(str, fontData)` | Khmer USE-lite — coeng subscripts + pre-base vowels (v1.3.0) |
| `shapeMyanmarText(str, fontData)` | Myanmar USE-lite — medials + virama stacking (v1.3.0) |
| `detectFallbackLangs(texts, primaryLang)` | Detect needed fallback fonts |
| `detectCharLang(codePoint)` | Map codepoint to preferred font language |
| `splitTextByFont(str, fontEntries)` | Multi-font text run splitting |
| `needsUnicodeFont(str)` | Check if text needs CIDFont |
| `containsThai(str)` | Check for Thai characters |
| `resolveBidiRuns(text)` | Resolve BiDi runs (UAX #9) |
| `containsRTL(text)` | Detect RTL content |
| `shapeArabicText(str, fontData)` | Arabic GSUB positional shaping |
| `containsArabic(text)` | Detect Arabic content |
| `containsHebrew(text)` | Detect Hebrew content |
| `containsTelugu(text)` | Detect Telugu content (v1.3.0) |
| `isTeluguCodepoint(cp)` | Telugu codepoint predicate (v1.3.0) |
| `containsSinhala(text)` / `containsTibetan(text)` / `containsKhmer(text)` / `containsMyanmar(text)` / `containsEthiopic(text)` | Detect script content (v1.3.0) |
| `isSinhalaCodepoint(cp)` / `isTibetanCodepoint(cp)` / `isKhmerCodepoint(cp)` / `isMyanmarCodepoint(cp)` / `isEthiopicCodepoint(cp)` | Codepoint predicates (v1.3.0) |
| `containsMath(text)` / `isMathCodepoint(cp)` | Detect / test mathematical symbols → lang `'math'` (v1.5.0) |

### Layout Constants

| Constant | Description |
|----------|-------------|
| `PG_W` / `PG_H` | A4 page dimensions (points) |
| `DEFAULT_MARGINS` | Default margins `{ t, r, b, l }` |
| `DEFAULT_COLORS` | Default color palette |
| `DEFAULT_COLUMNS` | Default 5-column layout |
| `ROW_H` / `TH_H` | Row / header heights |
| `HEADER_H` | Header zone height (15pt) |
| `PAGE_SIZES` | Preset page dimensions (A4, Letter, Legal, A3, Tabloid) |
| `resolveTemplate(tpl, page, pages, title, date)` | Resolve header/footer template placeholders |

## Ecosystem

pdfnative ships as a library, but three official companion packages cover the most common non-library use cases — a CLI, an MCP server, and a React renderer. All live in separate repositories and depend on `pdfnative` only through the public API, so the core library stays zero-dependency.

### pdfnative-cli — command-line interface

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) v1.1.0 is the **official CLI**, built on `pdfnative` v1.3.0. It exposes six commands — `render`, `sign`, `inspect`, `verify`, `batch`, and `schema` (plus `completion`) — for use in shell scripts, Makefiles, GitHub Actions, and Docker images. Zero extra runtime dependencies, npm-provenance-signed, with a CycloneDX SBOM attached to every release.

**New in v1.1.0:** **22 Unicode scripts + COLRv1 colour emoji** through the `--font`/`--lang` shortcuts, **true constant-memory streaming** (`--stream-true`), a `--max-blocks` cap for very large documents, and a **PDF/UA (ISO 14289-1) structural validator** (`inspect --pdfua` / `--check pdfua`). It also adds an **agent-native contract** — a global `--json` status/error envelope, stable `E_*` error codes, a `--dry-run` validation mode, the new **`schema`** command (Draft 2020-12), and token-economy output projection (`--summary` / `--fields` + compact JSON) that cuts agent output ~90 %. **100 % backward-compatible.**

```bash
# render with full layout coverage (encryption + watermark + PDF/A-2b)
npx pdfnative-cli render --input doc.json --output report.pdf \
  --tagged pdfa2b --compress \
  --watermark-text "DRAFT" --watermark-opacity 0.15

# sign with metadata and intermediate cert chain
npx pdfnative-cli sign --input report.pdf --output signed.pdf \
  --reason "Approved" --name "Finance Team" \
  --signing-time 2026-04-28T10:00:00Z \
  --cert-chain intermediate.pem

# verify embedded signatures (byte-range + chain + trust + revocation)
npx pdfnative-cli verify --input signed.pdf --strict --trust ca-root.pem

# inspect with CI assertions, incl. PDF/UA accessibility gate (exit 1 on failure)
npx pdfnative-cli inspect --input signed.pdf \
  --check pdfa --check signed --check pdfua --json --summary
```

See the [CLI Guide](https://pdfnative.dev/guides/cli.html) for the full v1.1.0 reference, agent contract, security model, and recipes. Try the [interactive CLI playground](https://pdfnative.dev/playgrounds/cli.html) to build commands without leaving the browser.

### pdfnative-mcp — Model Context Protocol server

[`pdfnative-mcp`](https://github.com/Nizoka/pdfnative-mcp) v1.3.0 is a **Model Context Protocol server** that bridges pdfnative to any MCP-compatible AI client. Once configured, your AI assistant can generate PDFs, embed barcodes, create forms, sign and verify documents, validate PDF/UA structure, embed and extract attachments, extract text, render international text, merge, split and extract pages, and inspect existing PDFs — all without writing code.

**v1.0.0:** first stable MCP release with 12 tools, `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD PDF/A-3), `extract_text`, smart-table options, auto-placeholder signing, and `_meta.apiVersion`.

**v1.1.0:** adds `validate_pdf`, six additional scripts (Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic), and COLRv1 colour-emoji support via the pdfnative 1.3.0 engine.

**v1.2.0:** adds `extract_attachments`, watermark options on document tools, Unicode `normalize` (NFC/NFD/NFKC/NFKD), token-frugal read modes (`verbosity`/`fields`), and returns base64 PDF bytes once via a `resource` block.

**v1.3.0:** adds the page-tree trio `merge_pdfs` / `split_pdf` / `extract_pages` (**17 tools** total), enriched authoring options (`outline`, `pageLabels`, nested lists, `viewerPreferences`, `cellBorders`, `cellVAlign`), a constant-time `node:crypto` signing provider, and DNS-rebinding protection on the HTTP transport — all via the pdfnative 1.4.0 engine.

```bash
npx -y pdfnative-mcp
```

### Available tools

| Tool | Purpose |
|------|---------|
| `generate_basic_pdf` | Multi-page documents from structured blocks (headings, paragraphs, lists) |
| `add_table` | Smart tables (`wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`) |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 |
| `add_international_text` | 24 script/font codes (22 Unicode scripts + `latin` + `emoji`) with BiDi & OpenType shaping |
| `add_form` | Interactive AcroForm PDFs (text, checkbox, radio, dropdown) |
| `embed_image` | Embed a JPEG or PNG image (base64) |
| `prepare_signature_placeholder` | PDF with a `/Sig` field ready to be signed |
| `sign_pdf` | CMS/PKCS#7 digital signatures (RSA-SHA256 / ECDSA-SHA256) |
| `validate_pdf` | **v1.1.0** — read-only PDF/UA structural validation |
| `verify_pdf` | **v1.0.0** — verify every PAdES signature (integrity + value + optional chain trust) |
| `add_attachment` | **v1.0.0** — PDF/A-3 with embedded files (Factur-X / ZUGFeRD) |
| `extract_attachments` | **v1.2.0** — extract embedded files (optionally metadata-only) |
| `extract_text` | **v1.0.0** — best-effort plain-text extraction from a non-encrypted PDF |
| `merge_pdfs` | **v1.3.0** — concatenate 2–50 PDFs into one via the page-tree API |
| `split_pdf` | **v1.3.0** — split one PDF into one document per page range (multi-output) |
| `extract_pages` | **v1.3.0** — pull an arbitrary, order-preserving page subset (max 5000) into a new PDF |
| `inspect_pdf` | Structured PDF report (metadata, pages, signatures, PDF/A, attachments, placeholder state) |

### Claude Desktop configuration

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

See the [MCP Integration Guide](https://pdfnative.dev/guides/mcp.html) and the [pdfnative-mcp repository](https://github.com/Nizoka/pdfnative-mcp) for configuration on Cursor, Continue, Zed, and more.

### pdfnative-react — declarative JSX renderer

[`pdfnative-react`](https://github.com/Nizoka/pdfnative-react) v1.0.0 turns declarative **JSX** into real, on-device PDFs powered by the zero-dependency pdfnative engine — no DOM, no headless browser, no SaaS round-trips. A custom React reconciler compiles your component tree synchronously into the pdfnative block model. Requires **React 19** and **Node.js ≥ 20** (React is a peer dependency; pdfnative itself stays zero-dependency).

```tsx
import { Document, Heading, Text, Table, renderToBytes } from 'pdfnative-react';

const bytes = renderToBytes(
  <Document title="Invoice #1024" footerText="Acme Inc">
    <Heading level={1}>Invoice #1024</Heading>
    <Text>Thank you for your business.</Text>
    <Table
      headers={['Item', 'Qty', 'Total']}
      rows={[{ cells: ['Pro plan', '1', '$49.00'], type: 'default', pointed: false }]}
      zebra
    />
  </Document>,
); // → Uint8Array, a valid PDF
```

Every component (`Document`, `Page`, `Heading`, `Paragraph`/`Text`, `List`/`Item`, `Table`/`Row`/`Cell`, `Image`, `Link`, `Spacer`, `PageBreak`, `TableOfContents`, `Barcode`, `Svg`, `FormField`) maps 1:1 onto a pdfnative block. Render with `renderToBytes` / `renderToBlob` / `renderToStream` / `renderToFile`, preview live with the `usePdf` hook and `PDFViewer` / `PDFDownloadLink` / `BlobProvider` client components, or let AI agents author documents with the token-frugal `DocSpec` (terse JSON tuples that compile to the *same* PDF, validated by a versioned JSON Schema).

See the [React Guide](https://pdfnative.dev/guides/react.html) for the full component reference, and try the [interactive React playground](https://pdfnative.dev/playgrounds/react.html) to render JSX to PDF in your browser.

## Architecture

```
src/
├── index.ts              # Public API — single entry point
├── types/
│   ├── pdf-types.ts      # Core TypeScript type definitions
│   └── pdf-document-types.ts  # Document builder type definitions (blocks, params)
├── core/
│   ├── pdf-builder.ts    # Table-centric PDF assembly + /Info metadata + tagged PDF
│   ├── pdf-document.ts   # Free-form document builder (headings, paragraphs, lists, tables, images)
│   ├── pdf-assembler.ts  # Shared PDF binary assembly primitives (xref, trailer, writer)
│   ├── encoding-context.ts # Encoding context factory (dependency inversion from fonts/)
│   ├── pdf-image.ts      # JPEG/PNG parsing + PDF Image XObject builder
│   ├── pdf-text.ts       # Text rendering (Latin + CIDFont + shaped + tagged)
│   ├── pdf-stream.ts     # Binary utilities + download
│   ├── pdf-stream-writer.ts # AsyncGenerator streaming output
│   ├── pdf-layout.ts     # Layout constants & computation
│   ├── pdf-tags.ts       # Tagged PDF: structure tree, XMP metadata, ICC profile
│   ├── pdf-annot.ts      # Link annotations: /URI, /GoTo, URL validation + control-char hardening
│   ├── pdf-color.ts      # Color parsing, validation, normalization
│   ├── pdf-compress.ts   # FlateDecode stream compression (zlib, stored-block fallback)
│   ├── pdf-watermark.ts  # Text/image watermarks with ExtGState transparency
│   ├── pdf-barcode.ts    # Barcode/QR code encoders + PDF path rendering (5 formats)
│   ├── pdf-svg.ts        # SVG path/shape rendering as native PDF operators
│   ├── pdf-form.ts       # AcroForm interactive fields with appearance streams
│   ├── pdf-signature.ts  # CMS/PKCS#7 digital signatures (RSA + ECDSA)
│   └── pdf-encrypt.ts    # AES-128/256 encryption, MD5, SHA-256, key derivation
├── crypto/
│   ├── sha.ts            # SHA-384, SHA-512, HMAC-SHA-256
│   ├── asn1.ts           # ASN.1 DER encoding/decoding
│   ├── rsa.ts            # RSA PKCS#1 v1.5 sign/verify
│   ├── ecdsa.ts          # ECDSA P-256 sign/verify
│   ├── x509.ts           # X.509 certificate parsing
│   └── cms.ts            # CMS SignedData (PKCS#7) builder
├── parser/
│   ├── pdf-inflate.ts    # DEFLATE decompression (zlib inflate)
│   ├── pdf-tokenizer.ts  # PDF lexical scanner (ISO 32000-1 §7.2)
│   ├── pdf-object-parser.ts # PDF object parser with type guards
│   ├── pdf-xref-parser.ts # Cross-reference table/stream parser
│   ├── pdf-reader.ts     # High-level PDF reader (page tree, stream decode)
│   └── pdf-modifier.ts   # Incremental modification (non-destructive save)
├── fonts/
│   ├── encoding.ts       # WinAnsi + CIDFont pure encoding functions (no shaping deps)
│   ├── font-loader.ts    # Configurable font registry + cache
│   ├── font-subsetter.ts # TTF subsetting engine (with buffer bounds checking)
│   └── font-embedder.ts  # CMap builder + width arrays
├── shaping/
│   ├── script-registry.ts # Centralized Unicode range constants & script predicates
│   ├── thai-shaper.ts    # Thai GSUB + GPOS shaping pipeline
│   ├── bengali-shaper.ts # Bengali GSUB conjuncts + GPOS mark positioning
│   ├── tamil-shaper.ts   # Tamil GSUB + split vowel decomposition
│   ├── script-detect.ts  # Unicode script range detection (uses script-registry)
│   ├── multi-font.ts     # Cross-script font run splitting
│   ├── bidi.ts           # Unicode Bidirectional Algorithm (UAX #9)
│   └── arabic-shaper.ts  # Arabic GSUB positional shaping (uses script-registry)
└── worker/
    ├── worker-api.ts     # Worker/main-thread dispatch
    └── pdf-worker.ts     # Self-contained worker entry

fonts/                    # Pre-built font data modules (22 scripts)
tools/                    # CLI: build-font-data.cjs (TTF → JS module)
scripts/                  # Modular sample PDF generation (43 generators, ~219 PDFs)
tests/                    # 1726+ tests (48 files: unit + integration + fuzz + parser)
bench/                    # Performance benchmarks (vitest bench)
```

## Development

```bash
git clone https://github.com/Nizoka/pdfnative.git
cd pdfnative
npm install

npm run build            # tsup → dist/ (ESM + CJS + .d.ts)
npm run test             # vitest run (2309+ tests)
npm run test:coverage    # vitest with v8 coverage (95%+)
npm run test:generate       # Generate ~219 sample PDFs → test-output/
npm run lint                # ESLint 9 + typescript-eslint strict
npm run typecheck           # tsc --noEmit (src/)
npm run typecheck:tests     # tsc --project tsconfig.test.json
npm run typecheck:scripts   # tsc --project tsconfig.scripts.json
npm run typecheck:all       # Typecheck src/ + tests/ + scripts/
npm run bench               # Performance benchmarks (vitest bench)
```

### Quality Metrics

| Metric | Value |
|--------|-------|
| Tests | 2309+ (100 files) |
| Statement coverage | 95.41% |
| Branch coverage | 87.79% |
| Function coverage | 98.5% |
| Fuzz tests | 48 edge-case scenarios |
| Benchmarks | Latin 500 rows ~10ms, Unicode ~13ms (Apple M1, Node 22) |
| Dependencies | 0 runtime |
| CI | Node 22/24 matrix |
| Provenance | npm signed builds |

## Known Limitations — Visual vs. Semantic PDF

pdfnative generates **visually pixel-perfect** PDFs for all 16 supported scripts. However, PDF is fundamentally a *visual* format (a digital printer), not a *semantic* one. This distinction matters for **text extraction** (copy-paste, `pdftotext`, screen readers):

### Complex Text Layout (CTL) scripts

For scripts with combining marks — **Thai**, **Devanagari**, **Vietnamese tones** — the shaper positions each mark in its own `BT…ET` block with precise GPOS offsets. PDF viewers **render** this correctly, but text extractors reconstruct content by spatial position rather than logical order. This can produce garbled output when copying text from the PDF.

| Scenario | Visual rendering | Text extraction (Ctrl+C) |
|----------|:---:|:---:|
| Latin, Greek, Polish, Turkish | ✅ Perfect | ✅ Perfect |
| CJK (Japanese, Chinese, Korean) | ✅ Perfect | ✅ Perfect |
| Vietnamese (combining diacritics) | ✅ Perfect | ⚠️ May show Win-1252 fallback artifacts |
| Thai (GSUB + GPOS shaping) | ✅ Perfect | ⚠️ Combining marks may be reordered |
| Devanagari (matras, conjuncts) | ✅ Perfect | ⚠️ Combining marks may be reordered |
| Bengali (conjuncts, GPOS marks) | ✅ Perfect | ⚠️ Combining marks may be reordered |
| Tamil (split vowels, GSUB) | ✅ Perfect | ⚠️ Split vowel recomposition may fail |

### Why this happens

This is an inherent limitation of the PDF spec (ISO 32000-1), not a bug in pdfnative. The ToUnicode CMap correctly maps glyph IDs back to Unicode code points, but extractors that rely on spatial reconstruction rather than CMap lookup will produce artifacts. This behavior is shared by most PDF generators that don't use Tagged PDF.

### Tagged PDF, /ActualText & PDF/A — Implemented ✅

All three roadmap items are now implemented and available via the `tagged` layout option:

```ts
const pdf = buildPDFBytes(params, { tagged: true });       // PDF/A-2b (default)
const pdf1b = buildPDFBytes(params, { tagged: 'pdfa1b' }); // PDF/A-1b (legacy)
const pdf2u = buildPDFBytes(params, { tagged: 'pdfa2u' }); // PDF/A-2u (Unicode)
```

When `tagged` is set, the output includes:

- **Tagged PDF (PDF/UA)** — full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`) with `/Span` marked content operators and `/StructParents` on every page
- **/ActualText** — original Unicode string attached as UTF-16BE hex to every `/Span BDC...EMC` sequence, solving text extraction for GPOS-repositioned glyphs (Thai, Arabic, Devanagari)
- **PDF/A-2b compliance** (default) — PDF 1.7, XMP metadata with `pdfaid:part=2` + `pdfaid:conformance=B`, sRGB ICC OutputIntent (`GTS_PDFA1`), `/MarkInfo << /Marked true >>` on Catalog
- **PDF/A-1b compatibility** — explicit `tagged: 'pdfa1b'` uses PDF 1.4, `pdfaid:part=1`
- **PDF/A-2u variant** — `tagged: 'pdfa2u'` uses PDF 1.7, `pdfaid:conformance=U`

The `tagged` option is backward-compatible — omitting it or setting `false` produces the same output as before.

> **PDF/A status (v1.1.0).** Every PDF/A-claiming sample now passes
> the **veraPDF** reference validator (1b / 2b / 2u / 3b) when the
> Latin font module is registered. Trailer `/ID` and
> `/Info CreationDate` are byte-equivalent to `xmp:CreateDate`
> (with timezone offset). `<dc:title>`, `<dc:description>`,
> `<pdf:Keywords>` mirror `/Info /Title`, `/Subject`, `/Keywords`
> byte-for-byte (ISO 19005-1 §6.7.3 t1 / t4 / t5). Object 3 / Object 4
> are emitted as Type0 redirector dicts pointing to the embedded
> CIDFontType2 chain — no more unembedded `Helvetica` references
> (ISO 19005-1 §6.3.4 / ISO 19005-2 §6.2.11.4.1). To produce strict
> PDF/A:
>
> ```ts
> import { registerFont } from 'pdfnative';
> registerFont('latin', () => import('pdfnative/fonts/noto-sans-data.js'));
> ```
>
> Run `npm run validate:pdfa` locally (with veraPDF installed, see
> [docs/guides/pdfa.html](docs/guides/pdfa.html)) to verify against
> the reference validator. CI runs veraPDF as a blocking check.

### PDF Encryption — Implemented ✅

AES-128 and AES-256 encryption with owner/user passwords and granular permissions:

```ts
const pdf = buildPDFBytes(params, {
  encryption: {
    ownerPassword: 'owner123',       // Required — full access password
    userPassword: 'user456',         // Optional — password to open the PDF
    algorithm: 'aes128',             // 'aes128' (default) or 'aes256'
    permissions: {
      print: true,                   // Allow printing (default: true)
      copy: false,                   // Allow copy/paste (default: false)
      modify: false,                 // Allow modification (default: false)
      extractText: true,             // Allow text extraction (default: true)
    },
  },
});
```

| Algorithm | PDF Version | Revision | Key Length | CFM |
|-----------|------------|----------|------------|-----|
| `aes128` | 1.4 | R4 (V4) | 128-bit | /AESV2 |
| `aes256` | 1.4 | R6 (V5) | 256-bit | /AESV3 |

**Note:** PDF/A and encryption are mutually exclusive (ISO 19005-1 §6.3.2). Setting both `tagged` and `encryption` will throw an error.

## Typography Convention: En-Dash Separator

pdfnative uses **en-dash** `–` (U+2013) with surrounding spaces as the standard title and footer separator:

```
"Arabic Script Coverage – الأبجدية العربية"    ✅ recommended
"Arabic Script Coverage — الأبجدية العربية"    ⚠️ works, but wider gap
```

**Why en-dash?**

| Property | Em-dash `—` (U+2014) | En-dash `–` (U+2013) |
|----------|:---:|:---:|
| Helvetica width | 1000 units (1 em) | 556 units (0.56 em) |
| Visual gap at 16pt | ~24pt with spaces | ~18pt with spaces |
| WinAnsi encodable | ✅ (0x97) | ✅ (0x96) |
| International standard | US English only | ISO / Europe / technical |
| Cursive script rendering | Disproportionate gap | Balanced spacing |

The en-dash is **44% narrower** than the em-dash and follows ISO/international typography standards. This eliminates disproportionate visual gaps in cursive scripts (Arabic, Thai) where compact shaped text amplifies the perceived space around wider separators.

Both em-dash and en-dash are **fully supported** by the library (encoding, width metrics, BiDi classification) — this is a typographic recommendation for the best cross-script visual balance, not a restriction.

## Stream Compression (FlateDecode)

Enable FlateDecode compression for dramatically smaller PDFs:

```typescript
import { initNodeCompression, buildPDFBytes } from 'pdfnative';

// Initialize native zlib (required once in ESM context)
await initNodeCompression();

const pdf = buildPDFBytes(params, { compress: true });
```

| Stream Type | Compressed? | Typical Reduction |
|-------------|:-----------:|:-----------------:|
| Page content (text operators) | ✅ | 80–90% |
| FontFile2 (TTF subset) | ✅ | 60–80% |
| ToUnicode CMap | ✅ | 80–90% |
| ICC sRGB profile | ✅ | 40–60% |
| XMP metadata | ❌ (tagged mode) | — |
| JPEG image | ❌ (already DCTDecode) | — |
| PNG image | ❌ (already FlateDecode) | — |

### Compression + Encryption

Both features compose correctly — compression is applied **before** encryption per ISO 32000-1 §7.3.8:

```typescript
const pdf = buildPDFBytes(params, {
  compress: true,
  encryption: {
    ownerPassword: 'owner123',
    algorithm: 'aes128',
  },
});
```

### Platform Support

| Runtime | Compression Method | Performance |
|---------|-------------------|-------------|
| Node.js 22+ | `zlib.deflateSync()` (native C) | Optimal |
| Browser | Stored-block fallback (valid FlateDecode) | No size reduction |
| Deno / Bun | CJS require fallback | Depends on compat layer |

For browser contexts with full compression, call `setDeflateImpl()` with a custom DEFLATE function.

## Browser & Runtime Compatibility

pdfnative targets ES2020 and works in any environment that supports `Uint8Array`, `TextEncoder`, and `crypto.getRandomValues()`.

| Runtime | Version | Status | Notes |
|---------|---------|:------:|-------|
| Node.js | 22, 24+ | ✅ Tested in CI | Full support (ESM + CJS) |
| Chrome | 80+ | ✅ | ESM via bundler or `<script type="module">` |
| Firefox | 80+ | ✅ | ESM via bundler or `<script type="module">` |
| Safari | 14+ | ✅ | ESM via bundler or `<script type="module">` |
| Edge | 80+ | ✅ | Chromium-based |
| Deno | 1.0+ | ✅ | Native ESM imports |
| Bun | 1.0+ | ✅ | Native ESM imports |
| Web Workers | — | ✅ | Via `pdfnative/worker` entry point |
| React Native | — | ⚠️ | Requires `TextEncoder` polyfill |

**Bundle format:** ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations (`dist/index.d.ts`). Tree-shakeable with `sideEffects: false`.

## Origin

pdfnative was born inside [**plika.app**](https://plika.app) — a personal finance application where high-quality, multi-language PDF generation (bank statements, transaction reports) was a core requirement. Rather than depending on heavy third-party libraries, the PDF engine was built from scratch with zero dependencies, strict ISO compliance, and native support for 22 Unicode scripts.

The decision was then made to extract the engine into an independent open-source library so that everyone can benefit from production-grade PDF generation — not just plika.app users.

> **Where it all started** — the PDF engine that became pdfnative was originally built inside [plika.app](https://plika.app), a personal finance app generating multi-language bank statements and financial summaries across 16 scripts.

## Security

- No `eval()`, `Function()`, or dynamic code execution
- Input validation at `buildPDF()` and `buildDocumentPDF()` entry: type checks, row/block limits
- URL validation at `validateURL()`: blocks `javascript:`, `file:`, `data:` URI schemes + control characters (U+0000–U+001F, U+007F–U+009F)
- RGBA PNG rejection: unsupported color types rejected at parse boundary with descriptive errors
- PDF string escaping for `\`, `(`, `)` — prevents injection
- CIDFont hex encoding — no string injection vector
- TTF subsetting uses typed arrays with bounds checking + compound glyph iteration limits
- XRef offset guard: validates byte offsets before writing cross-reference table
- JPEG parser robustness: validates SOF markers and handles edge-case byte sequences
- PDF encryption: AES-128/256 with per-object keys, random IVs — no ECB mode
- No external crypto dependencies — pure TypeScript AES, MD5, SHA-256 implementations
- NPM provenance — signed builds via GitHub Actions OIDC

For more details, see [SECURITY.md](SECURITY.md).

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development environment setup
- Running tests, linting, and type checking
- Code style requirements (strict TypeScript, pure functions, ESM-first)
- Branch strategy and PR process

## Citing pdfnative

If you use pdfnative in academic, governmental, or compliance work, please cite it. Citation metadata is available in [CITATION.cff](CITATION.cff).

```bibtex
@software{pdfnative,
  author  = {Nizoka},
  title   = {pdfnative: Zero-dependency, ISO 32000-1 compliant PDF generation for TypeScript},
  url     = {https://github.com/Nizoka/pdfnative},
  year    = {2026}
}
```

## License

MIT — see [LICENSE](LICENSE).

Font data files in `fonts/` are licensed under [SIL Open Font License 1.1](https://scripts.sil.org/OFL).
