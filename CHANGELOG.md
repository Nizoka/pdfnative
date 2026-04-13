# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Initial release. Pure native PDF generation library with zero runtime dependencies.

### Added

#### Core Engine

- **ISO 32000-1 (PDF 1.7) compliant** document generation with valid xref tables, `/Info` metadata, and proper binary structure
- **Table-centric builder** — `buildPDF()` / `buildPDFBytes()` for auto-paginated financial statements with header, data rows, info section, balance box, and footer
- **Free-form document builder** — `buildDocumentPDF()` / `buildDocumentPDFBytes()` with 12 block types: `HeadingBlock`, `ParagraphBlock`, `ListBlock`, `TableBlock`, `ImageBlock`, `LinkBlock`, `SpacerBlock`, `PageBreakBlock`, `TocBlock`, `BarcodeBlock`, `SvgBlock`, `FormFieldBlock`
- **`wrapText()` utility** — greedy line-filling word wrap for Latin, Unicode, and CJK text with character-level CJK breaking
- **`fontSizes` layout option** — customizable font sizes for title, info bar, table headers, table cells, and footer via `fontSizes: { title, info, th, td, ft }`
- **Auto-pagination** — blocks and table rows automatically distributed across pages with height estimation

#### Unicode & Font Support

- **16 Unicode scripts** — Thai, Japanese, Chinese (SC), Korean, Greek, Devanagari, Turkish, Vietnamese, Polish, Arabic, Hebrew, Cyrillic, Georgian, Armenian, Bengali, Tamil
- **Latin mode** — Helvetica built-in font with full Windows-1252 encoding (including 0x80–0x9F special characters)
- **CIDFont Type2 / Identity-H** — embedded TTF subsets for all non-Latin scripts
- **Multi-font fallback** — automatic cross-script font switching with script-aware preference via `detectCharLang()` and Helvetica continuation bias
- **Font data module system** — `registerFont()` / `loadFontData()` for lazy-loaded Noto Sans font variants
- **TTF subsetting** — identity-mapped glyph subsetter preserving compound components, `.notdef` (GID 0) always included
- **CLI tool** — `build-font-data.cjs` for converting TTF → importable JS data modules

#### Text Shaping & BiDi

- **Thai OpenType shaping** — GSUB substitution + GPOS mark-to-base + mark-to-mark positioning
- **Arabic positional shaping** — GSUB isolated/initial/medial/final forms with joining type analysis and lam-alef ligatures
- **Bengali OpenType shaping** — GSUB conjunct formation (consonant clusters via halant) + GPOS mark positioning for matras and vowel signs
- **Tamil OpenType shaping** — GSUB substitution + split vowel decomposition for multi-part vowel signs
- **BiDi text layout** — simplified Unicode Bidirectional Algorithm (UAX #9) with paragraph level detection, weak/neutral type resolution, level assignment, L2 run reordering, and glyph mirroring
- **BiDi punctuation affinity** — sentence punctuation stays with the preceding LTR word in RTL paragraphs
- **BiDi bracket pairing** — matching brackets enclosing LTR content kept together as a single LTR run
- **Script detection** — Unicode block-based language detection for all 16 supported scripts
- **En-dash separator convention** — en-dash `–` (U+2013) with spaces as standard cross-script title/footer separator (44% narrower than em-dash, WinAnsi-encodable, ISO/international standard)

#### Tagged PDF & PDF/A

- **Tagged PDF (PDF/UA — ISO 14289-1)** — full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`, `/TOC → /TOCI`) with `/Span` marked content operators and `/StructParents` on every page
- **/ActualText** — original Unicode string attached as UTF-16BE hex to every marked content sequence, solving text extraction for GPOS-repositioned glyphs
- **PDF/A-2b compliance (default)** — PDF 1.7, XMP metadata with `pdfaid:part=2` + `pdfaid:conformance=B`, sRGB ICC OutputIntent
- **PDF/A-1b** — explicit `tagged: 'pdfa1b'` for legacy compliance (PDF 1.4, `pdfaid:part=1`)
- **PDF/A-2u** — explicit `tagged: 'pdfa2u'` for Unicode conformance (PDF 1.7, `pdfaid:conformance=U`)
- **PDF/A-3b** — explicit `tagged: 'pdfa3b'` for ISO 19005-3 compliance with embedded file attachment support
- **Embedded file attachments** — `attachments` layout option for associating files (XML, CSV, etc.) with PDF/A-3b documents via `/EmbeddedFile`, `/Filespec`, and `/AFRelationship`
- **`resolvePdfAConfig()` utility** — maps `tagged` option → PDF/A config (version, part, conformance, subtype)

#### Encryption

- **AES-128** — V4/R4/AESV2 with 128-bit keys via `encryption` layout option
- **AES-256** — V5/R6/AESV3 with 256-bit keys
- **Owner + user passwords** — `ownerPassword` (full access) and optional `userPassword` (open access)
- **Granular permissions** — `print`, `copy`, `modify`, `extractText` bitmask (ISO 32000-1 Table 22)
- **Per-object keys** — cryptographic random IVs (AES-CBC + PKCS7) via `crypto.getRandomValues()`
- **Pure TypeScript crypto** — AES-CBC, MD5 (RFC 1321), SHA-256 (FIPS 180-4) with zero dependencies
- **PDF/A + encryption mutual exclusion** — validated at build boundary (ISO 19005-1 §6.3.2)

#### Images & Links

- **JPEG embedding** — DCTDecode with auto-parsing of dimensions, color space, and bit depth
- **PNG embedding** — FlateDecode with predictor filtering, alpha channel via SMask XObject
- **Auto-scaling** — images scale to fit content width preserving aspect ratio; explicit dimensions override
- **Tagged `/Figure`** — images wrapped in `/Figure` structure elements with `/ActualText` for PDF/UA
- **Hyperlink annotations** — `/URI` actions with blue underlined text and clickable annotation rectangles
- **URL validation** — only `http:`, `https:`, `mailto:` schemes allowed; `javascript:`, `file:`, `data:` blocked
- **Tagged `/Link`** — link structure element for PDF/UA accessibility
- **Internal links** — `/GoTo` actions for intra-document navigation

#### Barcode & QR Code

- **5 barcode formats** rendered as pure PDF path operators (no image dependency):
  - **Code 128** (ISO 15417) — variable-length alphanumeric with auto Code B/C switching
  - **EAN-13** (ISO 15420) — 13-digit product barcode with check digit validation
  - **QR Code** (ISO 18004) — 2D matrix with configurable error correction (L/M/Q/H)
  - **Data Matrix** ECC 200 (ISO 16022) — compact 2D barcode with Reed-Solomon ECC
  - **PDF417** (ISO 15438) — stacked linear barcode with configurable EC level (0–8)
- **`BarcodeBlock` document block** — `{ type: 'barcode', format, data, width?, height?, align?, ecLevel?, pdf417ECLevel? }` for the free-form document builder
- **Tagged barcode support** — barcodes wrapped in `/Figure` structure elements with MCID in tagged PDF mode
- **`renderBarcode()` unified dispatcher** — single entry point for all 5 barcode formats

#### Header, Footer & Watermark

- **Header/footer templates** — `headerTemplate` and `footerTemplate` layout options with `PageTemplate` type (`left`/`center`/`right` zones). Placeholder variables: `{page}`, `{pages}`, `{date}`, `{title}`. Backward compatible with existing `footerText` option
- **Custom page sizes** — `PAGE_SIZES` constant exported with A4, Letter, Legal, A3, and Tabloid presets; arbitrary `pageWidth`/`pageHeight` already supported
- **Text watermarks** — `watermark: { text: { text, fontSize?, color?, opacity?, angle? } }` layout option renders rotated, semi-transparent text on every page via ExtGState
- **Image watermarks** — `watermark: { image: { data, opacity?, width?, height? } }` layout option renders centered semi-transparent image on every page
- **Watermark positioning** — `watermark.position: 'background' | 'foreground'` controls rendering order relative to content (default: `'background'`)
- **PDF/A-1b watermark validation** — throws if watermark with opacity < 1.0 is used with `tagged: 'pdfa1b'` (ISO 19005-1 §6.4)

#### Table of Contents

- **`TocBlock` document block** — auto-collected headings, dot leaders, right-aligned page numbers, and internal `/GoTo` links via named destinations (`/Dests`)
- **TOC options** — `title`, `maxLevel` (1–3), `fontSize`, `indent` for customizing TOC appearance
- **TOC multi-pass pagination** — up to 3 pagination passes to stabilize page numbers when TOC shifts content
- **Tagged TOC** — `/TOC` and `/TOCI` structure elements in tagged mode for PDF/UA compliance

#### Compression

- **FlateDecode** — `compress: true` layout option applies `/Filter /FlateDecode` to all content streams (50–90% size reduction)
- **Platform-native zlib** — `initNodeCompression()` for ESM contexts; stored-block fallback for environments without native zlib
- **`setDeflateImpl()`** — inject custom DEFLATE function for browser polyfill
- **Compression + encryption** — compression applied before encryption per ISO 32000-1 §7.3.8
- **XMP metadata exclusion** — XMP streams never compressed in tagged mode for PDF/A validator safety

#### SVG Rendering

- **SVG path/shape rendering** — 7 element types (`<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`) rendered as native PDF path operators
- **`SvgBlock` document block** — `{ type: 'svg', content, width?, height?, align? }` for inline SVG in document builder
- **ViewBox scaling** — SVG coordinates mapped proportionally to PDF points
- **Tagged SVG** — wrapped in `/Figure` structure element with MCID in tagged mode

#### Interactive Forms (AcroForm)

- **AcroForm fields (ISO 32000-1 §12.7)** — text, multiline, checkbox, radio, dropdown, listbox with full `/AP` appearance streams
- **`FormFieldBlock` document block** — `{ type: 'formField', fieldType, name, ... }` for inline form fields in document builder
- **Appearance stream generation** — `buildAppearanceStream()` renders visual state without external viewer dependency
- **Tagged forms** — form fields wrapped in `/Form` structure element with MCID

#### Digital Signatures

- **CMS/PKCS#7 detached signatures (ISO 32000-1 §12.8)** — `signPdfBytes()` signs PDF bytes with embedded certificate
- **RSA PKCS#1 v1.5** — SHA-256 digest with modular exponentiation (BigInt-based, zero dependencies)
- **ECDSA P-256** — secp256r1 signing and verification
- **X.509 certificate parsing** — DER format: issuer, subject, validity, public key extraction
- **Pure TypeScript crypto** — SHA-384, SHA-512, HMAC-SHA-256, ASN.1 DER, RSA, ECDSA, CMS — all zero-dependency

#### Streaming Output

- **AsyncGenerator streaming** — `streamPdf()` / `streamDocumentPdf()` yield `Uint8Array` chunks progressively
- **Configurable chunk size** — `chunkSize` option (default: 65536 bytes)
- **`concatChunks()` utility** — concatenate streaming chunks into a single `Uint8Array`
- **Streaming + compression/encryption** — full feature compatibility in streaming mode

#### PDF Parser & Modifier

- **PDF tokenizer** — lexical scanner (ISO 32000-1 §7.2) for all PDF token types
- **Object parser** — parses all PDF value types with discriminated union type guards (`isDict`, `isArray`, `isStream`, `isRef`)
- **Cross-reference parser** — handles both table and stream xref formats, follows `/Prev` chain for incremental updates
- **PDF reader** — `PdfReader` class: `open(bytes)`, `getPage(n)`, `getPageCount()`, `getMetadata()`, `decodeStream()`
- **PDF modifier** — `PdfModifier` class: `addPage()`, `removePage()`, `setMetadata()`, `save()` with non-destructive incremental `/Prev` chain
- **DEFLATE decompression** — FlateDecode stream decode (native zlib + pure JavaScript fallback)

#### Color Safety

- **`parseColor()`** — validates and normalizes hex (`#RRGGBB`/`#RGB`), RGB tuples (`[r, g, b]`), and PDF operator strings before interpolation into content streams
- **`PdfColor` union type** — `PdfRgbString | PdfRgbTuple | (string & {})` preserving autocomplete for template literals
- **`normalizeColors()`** — validates all fields in a `PdfColors` object at layout boundary
- **Injection prevention** — color values sanitized before interpolation into PDF content streams

#### Web Worker

- **Off-main-thread generation** — `createPDF()` dispatches to Web Worker above configurable row threshold (default: 500)
- **Progress callback** — `onProgress` reports generation percentage
- **Self-contained worker** — `pdf-worker.ts` bundles all dependencies for `noExternal` tsup config

#### Build & Distribution

- **Zero runtime dependencies** — no `dependencies` in `package.json`
- **Dual format** — ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations (`dist/index.d.ts`) via tsup
- **Tree-shakeable** — `sideEffects: false`, no module-level side effects
- **TypeScript strict mode** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`, ES2020 target
- **Immutable interfaces** — `readonly` modifiers on all public interface properties
- **JSDoc coverage** — documentation on 36+ public API functions across all modules
- **NPM provenance** — signed builds via GitHub Actions OIDC
- **CI** — GitHub Actions matrix testing on Node 22, 24

#### Testing & Quality

- **1513+ tests** across 36 test files — unit, integration, fuzz, and parser coverage
- **95%+ statement coverage** — v8 coverage with thresholds: 90/80/85/90 (statements/branches/functions/lines)
- **33 fuzz edge-case scenarios** — boundary conditions, malformed inputs, extreme dimensions
- **130+ sample PDFs** — financial statements (14), diverse use cases (12), alphabet coverage (13), PDF/A variants (5), encrypted (6), document builder (19), compressed (9), barcodes (3), watermarks (6), headers/footers (4), page sizes (6), TOC (3), SVG (3), forms (3), digital signatures (2), streaming (2), parser (2), stress tests/edge cases (13)
- **PDF /Info metadata** — Title, Producer (pdfnative), CreationDate in ISO D:YYYYMMDDHHmmss format
- **Input validation** — type checks, null/undefined guards, 100K row limit at `buildPDF()` boundary
- **18 sample generators** — modular `npm run test:generate` → 130+ PDFs in `test-output/`

### Fixed

- **Watermark xref corruption** — `baseObjCount` in `buildPDF()` did not account for watermark ExtGState/image objects, causing object number collisions and corrupted PDF output (blank pages or viewer errors)
- **AcroForm text field marked content** — appearance streams now include `/Tx BMC...EMC` wrapper required by ISO 32000-1 §12.7.3.3 for proper viewer rendering
- **AcroForm radio button group structure** — radio buttons with the same `name` now emit parent-child `/Kids`/`/Parent` hierarchy with mutual exclusivity via `/V` on parent (ISO 32000-1 §12.7.4.2.4)
- **AcroForm checkbox appearance sizing** — checkbox `/AP` stream scaled to match field dimensions instead of hardcoded 10pt
- **AcroForm indirect font references** — `/DR << /Font << /Helv N 0 R >> >>` uses actual object number instead of inline font dict, fixing viewer font resolution
- **AcroForm label parentheses** — field labels no longer include raw parentheses that break PDF string syntax
- **AcroForm checkbox/radio default state** — `checked: true` on `FormFieldBlock` correctly sets `/V /Yes /AS /Yes` for pre-checked fields
- **Digital signature ByteRange** — `/ByteRange` placeholder sizing ensures sufficient space for CMS SignedData embedding
