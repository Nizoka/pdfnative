# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Header/footer templates** — `headerTemplate` and `footerTemplate` layout options with `PageTemplate` type (`left`/`center`/`right` zones). Placeholder variables: `{page}`, `{pages}`, `{date}`, `{title}`. Backward compatible with existing `footerText` option
- **Custom page sizes** — `PAGE_SIZES` constant exported with A4, Letter, Legal, A3, and Tabloid presets; arbitrary `pageWidth`/`pageHeight` already supported
- **Text watermarks** — `watermark: { text: { text, fontSize?, color?, opacity?, angle? } }` layout option renders rotated, semi-transparent text on every page via ExtGState
- **Image watermarks** — `watermark: { image: { data, opacity?, width?, height? } }` layout option renders centered semi-transparent image on every page
- **Watermark positioning** — `watermark.position: 'background' | 'foreground'` controls rendering order relative to content (default: `'background'`)
- **Table of contents** — `TocBlock` document block type with auto-collected headings, dot leaders, right-aligned page numbers, and internal `/GoTo` links via named destinations (`/Dests`)
- **TOC options** — `title`, `maxLevel` (1–3), `fontSize`, `indent` for customizing TOC appearance
- **TOC multi-pass pagination** — up to 3 pagination passes to stabilize page numbers when TOC shifts content
- **Tagged TOC** — `/TOC` and `/TOCI` structure elements in tagged mode for PDF/UA compliance
- **PDF/A-1b watermark validation** — throws if watermark with opacity < 1.0 is used with `tagged: 'pdfa1b'` (ISO 19005-1 §6.4)
- **`HEADER_H` constant** — header zone height (15pt) exported from layout module
- **`resolveTemplate()` helper** — pure function for placeholder substitution in page templates
- **`validateWatermark()` helper** — PDF/A transparency validation for watermark options
- **`buildWatermarkState()` helper** — builds ExtGState dictionaries and watermark rendering operators

## [1.0.0] — 2026-04-01

Initial public release. Pure native PDF generation library with zero runtime dependencies.

### Core Engine

- **ISO 32000-1 (PDF 1.7) compliant** document generation with valid xref tables, `/Info` metadata, and proper binary structure
- **Table-centric builder** — `buildPDF()` / `buildPDFBytes()` for auto-paginated financial statements with header, data rows, info section, balance box, and footer
- **Free-form document builder** — `buildDocumentPDF()` / `buildDocumentPDFBytes()` with 9 block types: `HeadingBlock`, `ParagraphBlock`, `ListBlock`, `TableBlock`, `ImageBlock`, `LinkBlock`, `SpacerBlock`, `PageBreakBlock`, `TocBlock`
- **`wrapText()` utility** — greedy line-filling word wrap for Latin, Unicode, and CJK text with character-level CJK breaking
- **`fontSizes` layout option** — customizable font sizes for title, info bar, table headers, table cells, and footer via `fontSizes: { title, info, th, td, ft }`
- **Auto-pagination** — blocks and table rows automatically distributed across pages with height estimation

### Unicode & Font Support

- **11 Unicode scripts** — Thai, Japanese, Chinese (SC), Korean, Greek, Devanagari, Turkish, Vietnamese, Polish, Arabic, Hebrew
- **Latin mode** — Helvetica built-in font with full Windows-1252 encoding (including 0x80–0x9F special characters)
- **CIDFont Type2 / Identity-H** — embedded TTF subsets for all non-Latin scripts
- **Multi-font fallback** — automatic cross-script font switching with script-aware preference via `detectCharLang()` and Helvetica continuation bias
- **Font data module system** — `registerFont()` / `loadFontData()` for lazy-loaded Noto Sans font variants
- **TTF subsetting** — identity-mapped glyph subsetter preserving compound components, `.notdef` (GID 0) always included
- **CLI tool** — `build-font-data.cjs` for converting TTF → importable JS data modules

### Text Shaping & BiDi

- **Thai OpenType shaping** — GSUB substitution + GPOS mark-to-base + mark-to-mark positioning
- **Arabic positional shaping** — GSUB isolated/initial/medial/final forms with joining type analysis and lam-alef ligatures
- **BiDi text layout** — simplified Unicode Bidirectional Algorithm (UAX #9) with paragraph level detection, weak/neutral type resolution, level assignment, L2 run reordering, and glyph mirroring
- **BiDi punctuation affinity** — sentence punctuation stays with the preceding LTR word in RTL paragraphs
- **BiDi bracket pairing** — matching brackets enclosing LTR content kept together as a single LTR run
- **Script detection** — Unicode block-based language detection for Arabic, Hebrew, Thai, CJK, Greek, Devanagari, and all supported scripts
- **En-dash separator convention** — en-dash `–` (U+2013) with spaces as standard cross-script title/footer separator (44% narrower than em-dash, WinAnsi-encodable, ISO/international standard)

### Tagged PDF & PDF/A

- **Tagged PDF (PDF/UA — ISO 14289-1)** — full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`) with `/Span` marked content operators and `/StructParents` on every page
- **/ActualText** — original Unicode string attached as UTF-16BE hex to every marked content sequence, solving text extraction for GPOS-repositioned glyphs
- **PDF/A-2b compliance (default)** — PDF 1.7, XMP metadata with `pdfaid:part=2` + `pdfaid:conformance=B`, sRGB ICC OutputIntent
- **PDF/A-1b** — explicit `tagged: 'pdfa1b'` for legacy compliance (PDF 1.4, `pdfaid:part=1`)
- **PDF/A-2u** — explicit `tagged: 'pdfa2u'` for Unicode conformance (PDF 1.7, `pdfaid:conformance=U`)
- **`resolvePdfAConfig()` utility** — maps `tagged` option → PDF/A config (version, part, conformance, subtype)

### Encryption

- **AES-128** — V4/R4/AESV2 with 128-bit keys via `encryption` layout option
- **AES-256** — V5/R6/AESV3 with 256-bit keys
- **Owner + user passwords** — `ownerPassword` (full access) and optional `userPassword` (open access)
- **Granular permissions** — `print`, `copy`, `modify`, `extractText` bitmask (ISO 32000-1 Table 22)
- **Per-object keys** — cryptographic random IVs (AES-CBC + PKCS7) via `crypto.getRandomValues()`
- **Pure TypeScript crypto** — AES-CBC, MD5 (RFC 1321), SHA-256 (FIPS 180-4) with zero dependencies
- **PDF/A + encryption mutual exclusion** — validated at build boundary (ISO 19005-1 §6.3.2)

### Images & Links

- **JPEG embedding** — DCTDecode with auto-parsing of dimensions, color space, and bit depth
- **PNG embedding** — FlateDecode with predictor filtering, alpha channel via SMask XObject
- **Auto-scaling** — images scale to fit content width preserving aspect ratio; explicit dimensions override
- **Tagged `/Figure`** — images wrapped in `/Figure` structure elements with `/ActualText` for PDF/UA
- **Hyperlink annotations** — `/URI` actions with blue underlined text and clickable annotation rectangles
- **URL validation** — only `http:`, `https:`, `mailto:` schemes allowed; `javascript:`, `file:`, `data:` blocked
- **Tagged `/Link`** — link structure element for PDF/UA accessibility
- **Internal links** — `/GoTo` actions for intra-document navigation

### Compression

- **FlateDecode** — `compress: true` layout option applies `/Filter /FlateDecode` to all content streams (50–90% size reduction)
- **Platform-native zlib** — `initNodeCompression()` for ESM contexts; stored-block fallback for environments without native zlib
- **`setDeflateImpl()`** — inject custom DEFLATE function for browser polyfill
- **Compression + encryption** — compression applied before encryption per ISO 32000-1 §7.3.8
- **XMP metadata exclusion** — XMP streams never compressed in tagged mode for PDF/A validator safety

### Color Safety

- **`parseColor()`** — validates and normalizes hex (`#RRGGBB`/`#RGB`), RGB tuples (`[r, g, b]`), and PDF operator strings before interpolation into content streams
- **`PdfColor` union type** — `PdfRgbString | PdfRgbTuple | (string & {})` preserving autocomplete for template literals
- **`normalizeColors()`** — validates all fields in a `PdfColors` object at layout boundary
- **Injection prevention** — color values sanitized before interpolation into PDF content streams

### Web Worker

- **Off-main-thread generation** — `createPDF()` dispatches to Web Worker above configurable row threshold (default: 500)
- **Progress callback** — `onProgress` reports generation percentage
- **Self-contained worker** — `pdf-worker.ts` bundles all dependencies for `noExternal` tsup config

### Build & Distribution

- **Zero runtime dependencies** — no `dependencies` in `package.json`
- **Dual format** — ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations (`dist/index.d.ts`) via tsup
- **Tree-shakeable** — `sideEffects: false`, no module-level side effects
- **TypeScript strict mode** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`, ES2020 target
- **Immutable interfaces** — `readonly` modifiers on all public interface properties
- **JSDoc coverage** — documentation on 36+ public API functions across all modules
- **NPM provenance** — signed builds via GitHub Actions OIDC
- **CI** — GitHub Actions matrix testing on Node 18, 20, 22

### Testing & Quality

- **827+ tests** across 26 test files — unit, integration, and fuzz coverage
- **~99% statement coverage** — v8 coverage with thresholds: 90/80/85/90 (statements/branches/functions/lines)
- **33 fuzz edge-case scenarios** — boundary conditions, malformed inputs, extreme dimensions
- **88 sample PDFs** — financial statements (14), diverse use cases (12), alphabet coverage (11), PDF/A variants (4), encrypted (8), document builder (19), compressed (8), stress tests (6), edge cases (7)
- **Zero dependencies** — no runtime `dependencies` in package.json
- **PDF /Info metadata** — Title, Producer (pdfnative), CreationDate in ISO D:YYYYMMDDHHmmss format
- **Input validation** — type checks, null/undefined guards, 100K row limit at `buildPDF()` boundary
- **Sample PDF generator** — `npm run test:generate` → 12 PDFs (10 languages + multi-lang + pagination)
