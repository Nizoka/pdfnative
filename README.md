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

Pure native PDF generation library — zero vendor dependencies. ISO 32000-1 (PDF 1.7) compliant.

## Highlights

- **Zero dependencies** — no pdfkit, jsPDF, or other vendors. Pure JavaScript
- **ISO 32000-1 compliant** — valid xref tables, /Info metadata, proper font embedding
- **16 Unicode scripts** — Thai, Japanese, Chinese (SC), Korean, Greek, Devanagari, Turkish, Vietnamese, Polish, Arabic, Hebrew, Cyrillic, Georgian, Armenian, Bengali, Tamil
- **Thai OpenType shaping** — GSUB substitution + GPOS mark-to-base + mark-to-mark positioning
- **Arabic positional shaping** — GSUB isolated/initial/medial/final forms + lam-alef ligatures
- **BiDi text layout** — simplified Unicode Bidirectional Algorithm (UAX #9) with glyph mirroring
- **Multi-font fallback** — automatic cross-script font switching with continuation bias
- **TTF subsetting** — only used glyphs embedded (dramatic file size reduction)
- **Tagged PDF / PDF/A** — structure tree, /ActualText, XMP metadata, sRGB OutputIntent (PDF/A-1b, 2b, 2u, 3b with embedded file attachments)
- **PDF Encryption** — AES-128 (V4/R4) and AES-256 (V5/R6), owner + user passwords, granular permissions
- **Free-form document builder** — headings, paragraphs, lists, tables, images, barcodes, SVG paths, form fields, spacers, page breaks, table of contents
- **Barcode & QR code generation** — Code 128, EAN-13, QR Code, Data Matrix, PDF417 — pure PDF path operators (no images)
- **SVG path rendering** — path, rect, circle, ellipse, line, polyline, polygon as native PDF operators
- **AcroForm fields** — text, multiline, checkbox, radio, dropdown, listbox with appearance streams (ISO 32000-1 §12.7)
- **Digital signatures** — CMS/PKCS#7 detached signatures with RSA + ECDSA, SHA-256/384/512, X.509 parsing (ISO 32000-1 §12.8)
- **Streaming output** — AsyncGenerator-based progressive PDF emission with configurable chunk size
- **PDF parser & modifier** — read existing PDFs (tokenizer, xref, object parser, FlateDecode inflate) + incremental modification
- **Image embedding** — JPEG (DCTDecode) and PNG (FlateDecode) with auto-scaling and alignment
- **Hyperlinks** — PDF link annotations (/URI) with URL validation, blue underlined text, tagged /Link
- **Header/footer templates** — configurable `PageTemplate` with left/center/right zones and `{page}`/`{pages}`/`{date}`/`{title}` placeholders
- **Watermarks** — text and image overlays with configurable opacity, rotation, and position (background/foreground)
- **Table of contents** — auto-generated TOC with internal /GoTo links, dot leaders, and page numbers
- **FlateDecode compression** — zlib stream compression (50–90% size reduction), zero-dependency, platform-native
- **Web Worker support** — off-main-thread generation for large datasets
- **Tree-shakeable** — ESM + CJS dual build with TypeScript declarations
- **95%+ test coverage** — 1513+ tests across 36 files, fuzz suite, performance benchmarks
- **NPM provenance** — signed builds via GitHub Actions OIDC

## Installation

```bash
npm install pdfnative
```

**Requirements:** Node.js >= 22 | Modern browsers | Deno | Bun

## Why pdfnative?

pdfnative was designed for teams that need **ISO-compliant, production-grade PDF generation** with zero supply-chain risk. Here is how it compares to other popular JavaScript PDF libraries:

| Feature | pdfnative | jsPDF | pdfkit | pdf-lib | pdfmake |
|---------|:---------:|:-----:|:------:|:-------:|:------:|
| Runtime dependencies | **0** | 3 | 6 | 4 | 3 |
| TypeScript declarations | Built-in | Built-in | @types/* | Built-in | @types/* |
| PDF/A (ISO 19005) | 1b, 2b, 2u, 3b | — | 6 levels | — | — |
| Tagged PDF / PDF/UA | ✅ | — | ✅ | — | — |
| Encryption | AES-128/256 | RC4 | Up to AES-256 | — | Up to AES-256 |
| Complex text shaping (GSUB/GPOS) | ✅ Thai, Arabic | — | Via fontkit | Via @pdf-lib/fontkit | Via pdfkit |
| BiDi (RTL) layout | ✅ | — | — | — | — |
| Modify existing PDFs | ✅ (incremental) | — | — | ✅ | — |
| Forms (AcroForms) | ✅ | ✅ | ✅ | ✅ | — |
| Digital signatures | ✅ (RSA + ECDSA) | — | — | — | — |
| Barcode / QR code (native) | ✅ 5 formats | — | — | — | QR |
| SVG path rendering | ✅ | ✅ | ✅ | ✅ | ✅ |
| Streaming output | ✅ | — | ✅ | — | ✅ |
| PDF parser | ✅ | — | — | ✅ | — |
| Tree-shakeable (ESM) | ✅ | — | — | ✅ | — |
| NPM provenance (SLSA) | ✅ | — | — | — | — |
| Weekly npm downloads | — | ~12M | ~2.6M | ~4.6M | ~1.5M |

> **Data sources:** npm registry metadata and official README/documentation for each library as of April 2026. Dependency counts reflect direct `dependencies` listed in each package's `package.json`. "—" means the feature is not supported or not documented.

**When to choose pdfnative:** You need zero-dependency PDF generation with ISO archival compliance (PDF/A), accessibility (tagged PDF), AES encryption, digital signatures, multi-script Unicode support — particularly Arabic/Hebrew BiDi and Thai GSUB/GPOS shaping — form fields, barcode generation, SVG rendering, or the ability to parse and incrementally modify existing PDFs.

**When to choose another library:** You need advanced vector graphics (complex gradients, arbitrary transforms), rich interactive form scripting (JavaScript actions), or mature ecosystem integrations with existing toolchains.

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
| Hindi (Devanagari) | `hi` | Noto Sans Devanagari | Devanagari script |
| Turkish | `tr` | Noto Sans Turkish | Latin extended (İ/ı) |
| Vietnamese | `vi` | Noto Sans Vietnamese | Latin + combining marks |
| Polish | `pl` | Noto Sans Polish | Latin extended (Ł/ł) |
| Arabic | `ar` | Noto Sans Arabic | GSUB positional shaping |
| Hebrew | `he` | Noto Sans Hebrew | Right-to-left script |
| Russian (Cyrillic) | `ru` | Noto Sans | Cyrillic alphabet |
| Georgian | `ka` | Noto Sans Georgian | Mkhedruli script |
| Armenian | `hy` | Noto Sans Armenian | Armenian alphabet |\n| Bengali | `bn` | Noto Sans Bengali | GSUB conjuncts + GPOS marks |\n| Tamil | `ta` | Noto Sans Tamil | GSUB + split vowel decomposition |

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
  onProgress: (percent) => console.log(`${percent}%`),
});
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

## Visual PDF Inspection

Generate sample PDFs for all supported languages to visually verify output:

```bash
npm run test:generate
```

This creates **130+ PDF files** in `test-output/` (git-ignored), organized in eighteen categories.
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
| `sample-multi.pdf` | Mixed: all 16 scripts in one PDF |
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
| `doc-chinese-catalog.pdf` | Chinese product catalog (tables, ordering info) |
| `doc-multi-language.pdf` | Multi-language: EN + Arabic + Japanese in one PDF |
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
| `mirrorCodePoint(cp)` | Mirror bracket/parenthesis for RTL |
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

### SVG Path Rendering

| Function | Description |
|----------|-------------|
| `parseSvgPath(d)` | Parse SVG path `d` attribute into segments |
| `renderSvg(segments, options?)` | Render SVG segments as PDF path operators |

### AcroForm Fields

| Function | Description |
|----------|-------------|
| `buildFormWidget(field, objNum, pageRef)` | Build form field widget annotation + appearance stream |
| `buildAcroFormDict(fieldRefs)` | Build `/AcroForm` dictionary for catalog |
| `buildAppearanceStreamDict(width, height)` | Build appearance stream dictionary |
| `defaultFieldHeight(type)` | Default height by field type |

### Digital Signatures

| Function | Description |
|----------|-------------|
| `buildSigDict(options)` | Build `/Sig` dictionary with ByteRange/Contents placeholders |
| `signPdfBytes(pdf, options)` | Sign a PDF with CMS/PKCS#7 detached signature |
| `estimateContentsSize(options)` | Estimate hex-encoded `/Contents` size for pre-allocation |

### Streaming Output

| Function | Description |
|----------|-------------|
| `buildDocumentPDFStream(params, layout?, streamOpts?)` | Stream document PDF as `AsyncGenerator<Uint8Array>` |
| `buildPDFStream(params, layout?, streamOpts?)` | Stream table PDF as `AsyncGenerator<Uint8Array>` |
| `validateDocumentStreamable(params, layout?)` | Validate document is compatible with streaming (no TOC, no `{pages}`) |
| `validateTableStreamable(params, layout?)` | Validate table is compatible with streaming |
| `chunkBinaryString(str, chunkSize)` | Split binary string into `Uint8Array` chunks |
| `concatChunks(chunks)` | Concatenate `Uint8Array` chunks into one |
| `streamByteLength(stream)` | Count total bytes from an async stream |

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

### Document Block Types

| Type | Description |
|------|-------------|
| `HeadingBlock` | H1/H2/H3 with color, auto-wrapped |
| `ParagraphBlock` | Text with fontSize, lineHeight, align, indent, color |
| `TableBlock` | Headers + rows using PdfRow/ColumnDef |
| `ListBlock` | Bullet or numbered items |
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
| `txtTagged(str, x, y, font, sz, enc, mcid)` | Text at position with /ActualText BDC/EMC |
| `txtRTagged(str, rightX, y, font, sz, enc, mcid)` | Right-aligned tagged text |
| `txtCTagged(str, leftX, y, font, sz, colW, enc, mcid)` | Center-aligned tagged text |
| `wrapSpan(content, actualText, mcid)` | Wrap operators in /Span marked content |
| `wrapMarkedContent(content, tag, mcid)` | Generic marked content wrapper |
| `escapePdfUtf16(str)` | Encode string as PDF UTF-16BE hex |
| `createMCIDAllocator()` | Sequential MCID allocator |
| `buildStructureTree(root, startObj)` | Build structure tree PDF objects |
| `buildXMPMetadata(title, producer, date, part?, conformance?)` | XMP metadata for PDF/A (part=2, conformance=B default) |
| `buildOutputIntentDict(iccObjNum, subtype?)` | sRGB OutputIntent dictionary |
| `buildMinimalSRGBProfile()` | Minimal sRGB ICC profile bytes |
| `resolvePdfAConfig(tagged)` | Resolve tagged option → PDF/A config (version, part, conformance) |

### Encryption

| Function | Description |
|----------|-------------|
| `initEncryption(options)` | Initialize encryption state (AES-128 or AES-256) |
| `encryptStream(data, state, objNum, genNum)` | Encrypt stream data (IV + AES-CBC) |
| `encryptString(str, state, objNum, genNum)` | Encrypt string to hex |
| `buildEncryptDict(state)` | Build /Encrypt dictionary (R4 or R6) |
| `buildIdArray(docId)` | Build /ID trailer array |
| `computePermissions(perms?)` | Compute permission bitmask (ISO 32000-1 Table 22) |
| `generateDocId()` | Generate random 16-byte document ID |
| `aesCBC(data, key, iv)` | AES-CBC encryption with PKCS7 padding |
| `md5(data)` | MD5 hash (RFC 1321) |
| `sha256(data)` | SHA-256 hash (FIPS 180-4) |

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
| `deflateSync(data)` | Compress `Uint8Array` via best available platform API |
| `deflateStored(data)` | Wrap data in stored-block zlib (valid FlateDecode, zero compression) |
| `compressStream(str)` | Compress binary string (PDF stream) → compressed binary string |
| `adler32(data)` | Compute Adler-32 checksum (RFC 1950) |

### Fonts

| Function | Description |
|----------|-------------|
| `registerFont(lang, loader)` | Register a font data loader |
| `registerFonts(map)` | Register multiple font loaders |
| `loadFontData(lang)` | Lazy-load font data (cached) |
| `hasFontLoader(lang)` | Check if loader is registered |
| `getRegisteredLangs()` | List registered language codes |
| `createEncodingContext(fontEntries)` | Create encoding context |
| `subsetTTF(ttfBinary, usedGids)` | Subset a TTF font binary |

### Shaping

| Function | Description |
|----------|-------------|
| `shapeThaiText(str, fontData)` | Thai OpenType shaping (GSUB + GPOS) |
| `shapeBengaliText(str, fontData)` | Bengali GSUB conjuncts + GPOS marks |
| `shapeTamilText(str, fontData)` | Tamil GSUB + split vowel decomposition |
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

fonts/                    # Pre-built font data modules (16 scripts)
tools/                    # CLI: build-font-data.cjs (TTF → JS module)
scripts/                  # Modular sample PDF generation (18 generators, 130+ PDFs)
tests/                    # 1513+ tests (36 files: unit + integration + fuzz + parser)
bench/                    # Performance benchmarks (vitest bench)
```

## Development

```bash
git clone https://github.com/Nizoka/pdfnative.git
cd pdfnative
npm install

npm run build            # tsup → dist/ (ESM + CJS + .d.ts)
npm run test             # vitest run (1513+ tests)
npm run test:coverage    # vitest with v8 coverage (95%+)
npm run test:generate       # Generate 130+ sample PDFs → test-output/
npm run lint                # ESLint 9 + typescript-eslint strict
npm run typecheck           # tsc --noEmit (src/)
npm run typecheck:tests     # tsc --project tsconfig.test.json
npm run typecheck:scripts   # tsc --project tsconfig.scripts.json
npm run typecheck:all       # Typecheck src/ + tests/ + scripts/
```

### Quality Metrics

| Metric | Value |
|--------|-------|
| Tests | 1513+ (36 files) |
| Statement coverage | 95.41% |
| Branch coverage | 87.79% |
| Function coverage | 98.5% |
| Fuzz tests | 33 edge-case scenarios |
| Benchmarks | Latin 500 rows ~10ms, Unicode ~13ms |
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
| Devanagari (matras, conjuncts) | ✅ Perfect | ⚠️ Cluster reconstruction may fail |
| Bengali (conjuncts, GPOS marks) | ✅ Perfect | ⚠️ Cluster reconstruction may fail |
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
| Node.js 18+ | `zlib.deflateSync()` (native C) | Optimal |
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

pdfnative was born inside [**plika.app**](https://plika.app) — a personal finance application where high-quality, multi-language PDF generation (bank statements, transaction reports) was a core requirement. Rather than depending on heavy third-party libraries, the PDF engine was built from scratch with zero dependencies, strict ISO compliance, and native support for 16 Unicode scripts.

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

## License

MIT — see [LICENSE](LICENSE).

Font data files in `fonts/` are licensed under [SIL Open Font License 1.1](https://scripts.sil.org/OFL).
