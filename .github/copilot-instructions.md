# pdfnative — Project Guidelines

## Overview

Pure native PDF generation library. Zero vendor dependencies. ISO 32000-1 (PDF 1.7) compliant.
Target: exceed GAFAM-grade quality standards in code, testing, performance, and documentation.

## Architecture

```
src/
├── core/         # PDF document assembly, text rendering, binary stream, layout constants, tagged PDF, images, annotations, encryption, compression, watermarks, barcodes, SVG, forms, signatures, streaming, outlines, page labels
│   ├── pdf-builder.ts    # Table-centric PDF assembly + tagged mode + encryption + compression
│   ├── pdf-document.ts   # Free-form document builder (headings, paragraphs, lists, tables, images, links, TOC, barcodes, SVG, forms)
│   ├── pdf-renderers.ts  # Extracted block renderers, text wrapping, constants (used by pdf-document.ts)
│   ├── pdf-assembler.ts  # Shared PDF binary assembly primitives (createPdfWriter, writeXrefTrailer)
│   ├── encoding-context.ts # Encoding context factory (dependency inversion — moved from fonts/)
│   ├── pdf-image.ts      # JPEG/PNG parser + PDF Image XObject builder (RGBA rejection, JPEG robustness)
│   ├── pdf-annot.ts      # Link annotations: /URI, /GoTo, URL validation + control-char hardening
│   ├── pdf-color.ts      # Color parsing, validation, normalization (hex, tuple, PDF operator)
│   ├── pdf-compress.ts   # FlateDecode stream compression (zlib + stored-block fallback)
│   ├── pdf-tags.ts       # Structure tree, marked content, XMP metadata, ICC profile, OutputIntent, PDF/A config
│   ├── pdf-watermark.ts  # Text/image watermarks with ExtGState transparency
│   ├── pdf-barcode.ts    # Barcode/QR code encoders + PDF path rendering (Code 128, EAN-13, QR, DataMatrix, PDF417)
│   ├── pdf-svg.ts        # SVG path/shape rendering as native PDF path operators (7 element types) + <text> (v1.5.0)
│   ├── pdf-annot-markup.ts # Markup annotations (text/highlight/underline/strikeout/squiggly/square/circle/line/freetext) buildAnnotation/buildAnnotationBody (v1.5.0)
│   ├── pdf-layout-debug.ts # Opt-in visual layout overlay (margin/content/cell boxes) — resolveDebugOptions + *Ops helpers (v1.5.0)
│   ├── pdf-layout-inspect.ts # inspectDocumentLayout: programmatic per-page block geometry (LayoutInspection) (v1.5.0)
│   ├── pdf-form.ts       # AcroForm interactive fields with appearance streams (ISO 32000-1 §12.7)
│   ├── pdf-signature.ts  # CMS/PKCS#7 digital signatures (RSA + ECDSA, ISO 32000-1 §12.8)
│   ├── pdf-sig-placeholder.ts # addSignaturePlaceholder: AcroForm + /Sig injection via incremental update (v1.2.0)
│   ├── pdf-stream-writer.ts # AsyncGenerator streaming output with configurable chunk size + streamToFile (v1.4.0)
│   ├── pdf-outline.ts    # Document outline/bookmarks: /Outlines tree (/First /Last /Next /Prev /Parent /Count, /F flags, /C color, /Dest) (v1.4.0)
│   ├── pdf-page-labels.ts # /PageLabels number tree (decimal/roman/Roman/alpha/Alpha/none + prefix + start) (v1.4.0)
│   ├── pdf-viewer-prefs.ts # /ViewerPreferences + catalog /PageLayout / /PageMode (v1.4.0)
│   └── pdf-encrypt.ts    # AES-128/256 encryption, MD5, SHA-256, key derivation, permissions
├── crypto/       # Zero-dependency cryptographic primitives
│   ├── crypto-provider.ts # Pluggable native signature provider (setCryptoProvider) (v1.4.0)
│   ├── sha.ts            # SHA-384, SHA-512, HMAC-SHA-256
│   ├── asn1.ts           # ASN.1 DER encoding/decoding
│   ├── rsa.ts            # RSA PKCS#1 v1.5 sign/verify (modular arithmetic)
│   ├── ecdsa.ts          # ECDSA P-256 sign/verify (secp256r1)
│   ├── x509.ts           # X.509 DER certificate parsing
│   └── cms.ts            # CMS SignedData (PKCS#7) builder
├── parser/       # PDF reading & modification (ISO 32000-1 §7)
│   ├── pdf-inflate.ts    # DEFLATE decompression (zlib inflate, pure JS + native fallback, zip-bomb cap via MAX_INFLATE_OUTPUT)
│   ├── pdf-tokenizer.ts  # PDF lexical scanner (ISO 32000-1 §7.2)
│   ├── pdf-object-parser.ts # PDF object parser with type guards and dict helpers (MAX_PARSE_DEPTH=1000 recursion cap)
│   ├── pdf-xref-parser.ts # Cross-reference table/stream parser with /Prev chain (MAX_XREF_CHAIN=100 + cycle detection)
│   ├── pdf-reader.ts     # High-level PDF reader (page tree, stream decode, caching) + getPageLabels/getAnnotations/getPageRef (v1.5.0)
│   ├── pdf-modifier.ts   # Incremental modification (non-destructive save with /Prev) + addAnnotation (v1.5.0)
│   ├── pdf-ua-validator.ts # Read-only PDF/UA (ISO 14289-1) structural checker (v1.3.0)
│   └── pdf-pagetree.ts   # Page-tree manipulation: mergePdfs/splitPdf/extractPages — clean object-graph rebuild (v1.4.0)
├── fonts/        # WinAnsi + CIDFont pure encoding functions, lazy font loader, TTF subsetter (with buffer guards), CMap builder, font-data validator (validateFontData, v1.4.0)
├── shaping/      # Thai/Devanagari/Telugu/Bengali/Tamil GSUB+GPOS shaping, Arabic positional shaping, BiDi resolution, Unicode script detection, multi-font run splitting, centralized script registry
├── tools/        # Font-data compiler/parser: compileFontData/parseFontData (pdfnative/tools entry) (v1.5.0)
├── types/        # All public TypeScript type definitions (pdf-types.ts, pdf-document-types.ts)
└── worker/       # Web Worker dispatch + self-contained worker entry
fonts/            # Pre-built font data modules (.js/.d.ts) — 22 scripts + math (noto-sans-math-data, v1.5.0) + TTF source files
tools/            # CLI tools: build-font-data.cjs (TTF → data module); build-emoji-font (bundled via tsup from scripts/build-emoji-font.ts → dist/tools/, npx pdfnative-build-emoji-font — generates colour-emoji data modules up to the full ~3,600-glyph set)
scripts/          # Modular sample PDF generation (44 generators; text-extract-showcase.ts added in v1.6.0; math-symbols.ts + svg-text-labels.ts + layout-debug-overlay.ts + annotations-showcase.ts + font-compiler-demo.ts added in v1.5.0; outline-bookmarks.ts + pdf-manipulation.ts added in v1.4.0; currency-symbols.ts + color-emoji-showcase real-world rewrite added in v1.3.0; signature-placeholder.ts, bidi-embeddings-showcase.ts, document-table-parity.ts, use-lite-showcase.ts added in v1.2.0/v1.3.0). scripts/lib/ holds the shared deterministic emoji-build core (emoji-font-core.ts, curated-emoji.ts, emoji-cli.ts) used by both build-color-emoji-data.ts and the bundled build-emoji-font CLI
test-output/extreme/  # Visual regression baselines for extreme scripts (extreme-bidi.pdf, extreme-tamil.pdf, extreme-bengali-devanagari.pdf, extreme-arabic-harakat.pdf, extreme-bidi-isolates.pdf)
tests/            # 2379+ tests (104 files: unit/integration/fuzz/parser/visual) mirroring src/ structure
bench/            # Performance benchmarks (vitest bench)
docs/             # GitHub Pages landing site (pdfnative.dev) — pure HTML/CSS/JS, zero build deps
  └── playgrounds/  # Interactive browser playgrounds (extreme-scripts.html, scale.html)
```

- **Single entry point**: `src/index.ts` re-exports everything. All public API surfaces live there.
- **Type-first**: All domain types in `src/types/pdf-types.ts` and `src/types/pdf-document-types.ts`. Consumers import types from root.
- **No circular deps**: strict unidirectional dependency flow: types → core ← fonts ← shaping ← worker; crypto is standalone; parser imports from core/compress for inflate.

## Code Style

- **TypeScript strict mode** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`
- **ES2020 target** — no polyfills, use native `BigInt`, optional chaining, nullish coalescing
- **ESM-first** — all internal imports use `.js` extension (`import { x } from './foo.js'`)
- **No classes** — pure functions only. State passed explicitly as arguments
- **Immutable-by-default** — use `readonly` on interface props where mutation is unnecessary
- **Short, descriptive names** — `txt`, `txtR`, `txtC` are fine for PDF text operators (domain convention)
- Prefer `const` over `let`. Never use `var`
- No `any`. Use `unknown` with type narrowing if needed
- Template literals over string concatenation for PDF stream assembly

## Build & Test

```bash
npm run build           # tsup → dist/ (ESM + CJS + .d.ts)
npm run test            # vitest run (2379+ tests, 104 files)
npm run test:watch      # vitest (watch mode)
npm run test:coverage   # vitest with v8 coverage (thresholds: 90/80/85/90)
npm run test:generate   # Generate ~227 sample PDFs → test-output/ (incl. extreme/, emoji/, pdfa-latin/, forms/, charts/, parser/ baselines)
npm run typecheck       # tsc --noEmit
npm run typecheck:tests # tsc --project tsconfig.test.json --noEmit
npm run typecheck:scripts # tsc --project tsconfig.scripts.json --noEmit
npm run typecheck:all   # typecheck src/ + tests/ + scripts/
npm run lint            # eslint src/ (ESLint 9 + typescript-eslint strict)
```

- Build tool: **tsup** (dual ESM/CJS, tree-shakeable, sourcemaps)
- Test runner: **vitest** (fast, native ESM, watch mode, v8 coverage)
- CI: GitHub Actions — lint/typecheck/test/build on Node 22/24
- Publish: GitHub Actions OIDC Trusted Publishing (`npm publish --access public`; provenance is attached automatically via the workflow's `id-token: write`)
- All new code must have tests. Current: ~95% statement coverage, 2379+ tests (104 files)

## Conventions

### PDF-Specific

- PDF operators are built as plain strings, not AST: `"BT /F1 10 Tf ... ET"`
- Binary offsets use `byteLength()` helper (not `.length`) — critical for xref table
- `pdf-renderers.ts`: extracted block renderers, text wrapping, height estimation, constants — used exclusively by `pdf-document.ts` (internal module, not re-exported from `core/index.ts`)
- `pdf-assembler.ts`: shared binary assembly primitives (`createPdfWriter`, `writeXrefTrailer`) — used by both `pdf-builder.ts` and `pdf-document.ts` to eliminate xref/trailer duplication
- `encoding-context.ts`: encoding context factory in `core/` (dependency inversion — `createEncodingContext()` moved from `fonts/encoding.ts` to break `fonts/ → shaping/` cycle)
- `script-registry.ts`: centralized Unicode range constants and script predicates (`ARABIC_START/END`, `HEBREW_START/END`, `THAI_START/END`, `CYRILLIC_START/END`, `GEORGIAN_START/END`, `ARMENIAN_START/END`, `BENGALI_START/END`, `TAMIL_START/END`, `DEVANAGARI_START/END`, `isArabicCodepoint`, `isHebrewCodepoint`, `isThaiCodepoint`, `isCyrillicCodepoint`, `isGeorgianCodepoint`, `isArmenianCodepoint`, `isBengaliCodepoint`, `isTamilCodepoint`, `isDevanagariCodepoint`, `containsArabic`, `containsHebrew`, `containsThai`, `containsBengali`, `containsTamil`, `containsDevanagari`) — single source of truth, imported by arabic-shaper, thai-shaper, bengali-shaper, tamil-shaper, devanagari-shaper, script-detect, encoding-context
- Font subsetting always preserves `.notdef` (GID 0) per PDF/A spec
- CIDFont Type2 uses Identity-H encoding — glyph IDs are hex-encoded directly
- All color values are PDF operator format RGB strings: `"0.145 0.388 0.922"`
- Tagged PDF: marked content uses `/Span << /MCID n /ActualText <hex> >> BDC...EMC`
- Structure tree: `/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`
- PDF/A-2b: XMP metadata stream + sRGB ICC OutputIntent when `tagged: true` (default since Phase 8)
- XMP metadata: `<?xpacket begin="\xEF\xBB\xBF"` uses raw UTF-8 BOM bytes (not `\uFEFF` which truncates to 0xFF)
- PDF/A invariant: `/Info CreationDate` ↔ `xmp:CreateDate` come from the SAME `buildPdfMetadata()` call in `pdf-tags.ts` — never inline `new Date()` in `pdf-builder.ts`/`pdf-document.ts`. Both formats carry timezone offset (`D:YYYYMMDDHHmmSS+HH'mm'` and ISO 8601 `±HH:MM`)
- Trailer `/ID`: always emitted. Unencrypted = deterministic `md5("pdfnative|"+title+"|"+pdfDate+"|"+totalObjs)` (do NOT randomize — breaks determinism tests). Encrypted = `encState.docId`
- `dc:creator`: emitted ONLY when `metadata.author` is provided, XML-escaped, mirrors `/Info /Author`
- veraPDF reference validator runs in CI (`.github/workflows/verapdf.yml`) and locally via `npm run validate:pdfa` — see [.github/instructions/pdfa-conformance.instructions.md](.github/instructions/pdfa-conformance.instructions.md)
- ICC sRGB profile: 9 required tags (desc, wtpt, cprt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC) — monitor RGB class
- PDF/A-1b: explicit `tagged: 'pdfa1b'` uses PDF 1.4, `pdfaid:part=1`
- PDF/A-2u: explicit `tagged: 'pdfa2u'` uses PDF 1.7, `pdfaid:conformance=U`
- PDF/A-3b: explicit `tagged: 'pdfa3b'` uses PDF 1.7, `pdfaid:part=3`, supports `/EmbeddedFile` attachments
- `resolvePdfAConfig(tagged)` maps option → config (version, part, conformance, subtype)
- Encryption: AES-128 (V4/R4/AESV2) and AES-256 (V5/R6/AESV3) via `encryption` layout option
- Encryption uses per-object keys with random IVs (AES-CBC + PKCS7)
- PDF/A and encryption are mutually exclusive (ISO 19005-1 §6.3.2) — validated at build boundary
- `emitStreamObj()` transparently compresses and/or encrypts streams
- FlateDecode compression: `compress: true` in layout options applies `/Filter /FlateDecode` to all content streams
- Compression ordering: compress BEFORE encrypt (ISO 32000-1 §7.3.8)
- XMP metadata streams are never compressed (skipCompress) for PDF/A validator safety
- `initNodeCompression()` required in ESM for native zlib; stored-block fallback otherwise
- Image XObjects: `/Type /XObject /Subtype /Image` with `/DCTDecode` (JPEG) or `/FlateDecode` (PNG)
- Image operators: `q W 0 0 H X Y cm /ImN Do Q` for positioning and scaling
- DecodeParms for PNG: `/Predictor 15 /Colors N /BitsPerComponent 8 /Columns W`
- Link annotations: `/Type /Annot /Subtype /Link /Rect [x1 y1 x2 y2] /A << /Type /Action /S /URI /URI (url) >>`
- URL validation: only `http:`, `https:`, `mailto:` schemes allowed; `javascript:`, `file:`, `data:` blocked; control characters (U+0000–U+001F, U+007F–U+009F) rejected
- Color safety: `parseColor()` validates/normalizes hex, tuple, PDF string → safe `"R G B"` output; `normalizeColors()` at layout boundary
- Color types: `PdfColor = PdfRgbString | PdfRgbTuple | (string & {})` — union preserves autocomplete for template literals
- BiDi: UAX #9 isolates (LRI U+2066 / RLI U+2067 / FSI U+2068 / PDI U+2069) classified as `BN` and recursed via three-tier dispatcher: public `resolveBidiRuns(text)` finds outermost isolate pairs, internal `resolveBidiRunsForced(text, forcedLevel)` recurses, internal `resolveBidiCore(text, codePoints, cpToStr, forcedLevel?)` runs the W1–W7 / N1–N2 / L2 pipeline. Embeddings (LRE/RLE/LRO/RLO/PDF) deferred to v1.2.
- BiDi: simplified UAX #9 — paragraph level detection, weak/neutral type resolution, level assignment, L2 paragraph-level run reordering
- BiDi: General Punctuation (U+2010–U+2027, U+2030–U+205E) classified as ON — covers dashes, quotes, ellipsis, primes
- BiDi: `resolveBidiRuns()` returns runs in visual order — for RTL paragraphs (paraLevel=1), runs are reversed so LTR text comes first (leftmost) and RTL text last (rightmost)
- BiDi: punctuation affinity — sentence punctuation (`.` `,` `;` `:` `!` `?`) stays with preceding LTR word in RTL paragraphs
- BiDi: bracket pairing — matching brackets `()` `[]` `{}` enclosing LTR content are kept together as a single LTR run
- BiDi integration: `resolveBidiRuns()` called from `textRuns()`/`ps()` in encoding.ts when `containsRTL()` is true
- Helvetica continuation bias: `buildTextRunsWithFallback()` keeps WinAnsi chars in Helvetica mode to avoid CIDFont space-switching between Latin words
- Helvetica width metrics: `helveticaWidth()` handles Unicode codepoints directly (U+2014→1000, U+2013→556, U+2026→1000, curly quotes, Euro) — not WinAnsi byte values
- Arabic RTL segmenting: `splitArabicNonArabic()` extracts non-Arabic chars (em-dash, punctuation) from Arabic runs into Helvetica fallback segments — prevents .notdef glyphs
- Arabic shaping: GSUB positional forms (isol/init/medi/fina) with joining type analysis + lam-alef ligatures
- RTL Arabic pipeline: BiDi reverse → un-reverse to logical → shape → reverse shaped glyphs for visual order
- RTL Hebrew pipeline: BiDi reverse provides visual order directly — encode without additional shaping
- Glyph mirroring: parentheses, brackets, guillemets reversed for RTL runs
- Multi-font splitting: `splitTextByFont()` uses script-aware preference via `detectCharLang()` — characters in specific Unicode blocks prefer the font entry with matching `lang`, Latin/common chars use continuation bias
- CJK line breaking: `wrapText()` uses `tokenizeForWrap()` with `isCJKBreakable()` — CJK codepoints (U+2E80–U+9FFF, U+AC00–U+D7AF, U+F900–U+FAFF, U+FE30–U+FFEF, U+20000–U+2FA1F) break individually; Latin words stay grouped; spaces attach to preceding segment
- Typography convention: use en-dash `–` (U+2013) with surrounding spaces as title/footer separator, not em-dash `—` (U+2014) — en-dash is 44% narrower (556 vs 1000 units), WinAnsi-encodable, ISO/international standard, and avoids disproportionate visual gaps in cursive scripts (Arabic)
- Header/footer templates: `PageTemplate` type with `left`/`center`/`right` zones + `{page}`/`{pages}`/`{date}`/`{title}` placeholders via `resolveTemplate()`
- Watermarks: ExtGState for transparency (`/ca opacity`), text rotation via `cos(θ) sin(θ) -sin(θ) cos(θ) cx cy Tm`, image centering with aspect ratio
- Watermark validation: PDF/A-1b blocks transparency (ISO 19005-1 §6.4) — `validateWatermark()` throws
- Watermark position: `'background'` = ops before content stream; `'foreground'` = ops after content stream
- Table of contents: `TocBlock` with multi-pass pagination (max 3 passes), `_renderToc()` with dot leaders, right-aligned page numbers
- TOC internal links: named destinations `/Dests << /toc_h_N [pageObj /XYZ x y null] >>` in catalog; annotations use `/Dest /toc_h_N` (not `/URI`)
- TOC tagged mode: `/TOC` structure element with `/TOCI` children for PDF/UA compliance
- Smart tables (v1.2.0): `TableBlock` gains six optional fields — `wrap` (`'auto'`|`'always'`|`'never'`, default `'auto'`), `repeatHeader` (default `true`), `zebra` (`boolean|PdfColor`, default `false`, true uses `'0.969 0.973 0.984'`), `caption`, `minRowHeight` (default `12`), `cellPadding` (default `3`). Architecture: `planTable()` in `pdf-renderers.ts` measures once; `_paginateBlocks()` in `pdf-document.ts` slices at row boundaries into `TableSlice` items; `renderTable()` is page-lifecycle-free and accepts an optional `slice` arg. Tagged-mode `/Table` continues across slices via shared `tableStructAccum` array (ISO 14289-1 §7.10.6); `/Caption` emitted once. Single-page tables that fit without wrapping are byte-identical to v1.1.0 in their **body** rendering (header baseline `+4`, data baseline `+3`, `ROW_H=12`, `TH_H=15` preserved); right- and centre-aligned **header** glyph positioning shifts 2–5pt because v1.2.0 corrects a pre-1.2.0 width-measurement bug (see next bullet). `planTable()` and `TableSlice` are internal — NOT re-exported from `src/index.ts`.
- Bold-text width metrics (v1.2.0): right- and centre-aligned bold text (table headers via `enc.f2`, table captions) must use `helveticaBoldWidth()` in Latin mode — Helvetica-Bold AFM advances are ~16% wider than Helvetica-Regular. `txtR`/`txtC`/`txtRTagged`/`txtCTagged` in `pdf-text.ts` accept an optional trailing `bold` flag (default `false`); `emitCell()` passes `bold: isHeader`, caption passes `bold: true`, legacy `buildPDF()` headers pass `bold: true`. `computeAutoFitColumns()` also uses `helveticaBoldWidth()` for the header measurement branch (Latin only — Unicode/CIDFont mode uses `enc.tw` which is already font-correct).
- Column `kind` opt-in (v1.2.0): `renderTable()` in `pdf-renderers.ts` applies Helvetica-Bold + credit/debit colour ONLY when `columns[i].kind === 'amount'` (new optional `ColumnDef.kind?: 'amount'` field). The pre-1.2.0 hardcoded `i === 3` heuristic was removed from the document-builder path because it broke generic tables. Legacy `buildPDF()` in `pdf-builder.ts` keeps `i === 3` (financial-statement byte-stability invariant).
- Wrap-aware cell truncate (v1.2.0): `emitCell()` applies the v1.1 character truncate (`mx` / `mxH`) ONLY when `wrap: 'never'`. Under `'auto'` (default) and `'always'`, the planner has already sized the column to fit; an additional char-truncate produces spurious `…` ellipses.
- PDF/A conformance enum (v1.2.0): `PDF_A_CONFORMANCE_TARGETS = ['pdfa1b','pdfa2b','pdfa2u','pdfa3b'] as const` + `PdfAConformanceTarget` type exported from root (in `core/pdf-tags.ts`). Single source of truth for tooling — `pdfnative-mcp` consumes via `import { PDF_A_CONFORMANCE_TARGETS } from 'pdfnative'` for its tool-schema `enum:`.
- `PAGE_SIZES` constant: `{ A4, Letter, Legal, A3, Tabloid }` with `{ width, height }` in points
- Barcode rendering: all 5 formats use PDF `re f` rectangle operators (pure vector, no image XObjects)
- Barcode formats: Code 128 (ISO 15417), EAN-13 (ISO 15420), QR Code (ISO 18004), Data Matrix ECC 200 (ISO 16022), PDF417 (ISO 15438)
- Barcode math: QR uses GF(256) with 0x11D polynomial; DataMatrix uses GF(256) with 0x12D polynomial; PDF417 uses GF(929)
- `BarcodeBlock`: `{ type: 'barcode', format, data, width?, height?, align?, ecLevel?, pdf417ECLevel? }` — document block type
- Barcode tagged mode: wrapped in `/Figure` structure element with MCID
- `renderBarcode()`: unified dispatcher routing to format-specific render functions
- SVG rendering: `parseSvg()` → `SvgSegment[]` → `renderSvgToPdf()` → PDF path operators (m, l, c, re, h, S, f)
- SVG element types: `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>` — 7 types
- `SvgBlock`: `{ type: 'svg', content, width?, height?, align? }` — document block type
- SVG tagged mode: wrapped in `/Figure` structure element with MCID
- AcroForm: `pdf-form.ts` builds `/AcroForm` dict, `/Fields` array, field objects with `/AP` appearance streams
- AcroForm field types: text, checkbox, radio, dropdown, listbox — all with `/T`, `/V`, `/DA`, `/Rect`
- AcroForm appearance streams: generated via `buildAppearanceStream()` — no external viewer dependency
- AcroForm text fields: `/Tx BMC...EMC` marked content wrapper required (ISO 32000-1 §12.7.3.3)
- AcroForm radio buttons: parent-child group structure — parent `/Kids` array, children `/Parent` ref, mutual exclusivity via `/V` on parent (ISO 32000-1 §12.7.4.2.4)
- AcroForm `checked` property: `FormFieldBlock.checked?: boolean` for checkbox/radio default state
- AcroForm indirect font refs: `/DR << /Font << /Helv fontObjNum 0 R >> >>` uses actual object number, not inline dict
- `FormFieldBlock`: `{ type: 'formField', fieldType, name, ... }` — document block type
- AcroForm tagged mode: form fields wrapped in `/Form` structure element with MCID
- Digital signatures: `pdf-signature.ts` builds `/Sig` field with `/ByteRange` placeholder, CMS SignedData via `crypto/cms.ts`
- Signature algorithms: RSA PKCS#1 v1.5 (SHA-256) and ECDSA P-256 (SHA-256)
- Crypto module: standalone `src/crypto/` — sha.ts (SHA-384/512, HMAC-SHA-256), asn1.ts (DER), rsa.ts, ecdsa.ts, x509.ts, cms.ts
- `signPdfBytes()`: takes PDF bytes + private key + certificate → signed PDF bytes with embedded CMS
- Streaming output: `pdf-stream-writer.ts` provides AsyncGenerators yielding Uint8Array chunks
- Streaming API: `buildPDFStream(params)` / `buildDocumentPDFStream(params)` assemble the full binary then chunk it; `buildPDFStreamTrue` / `buildDocumentPDFStreamTrue` never join the binary and are the ones to use at scale. All return `AsyncGenerator<Uint8Array>`
- Streaming chunk size: configurable via `chunkSize` option (default: 65536 bytes)
- Parser module: `src/parser/` — tokenizer → object parser → xref parser → reader → modifier
- PDF tokenizer: `PdfTokenizer` class scans tokens one at a time (lazy, streaming-friendly)
- PDF object parser: `parseObject()`, `parseDictionary()`, `parseArray()` + type guards (`isDict`, `isArray`, `isStream`)
- PDF xref parser: `parseXref()` handles both table and stream xref formats, follows `/Prev` chain
- PDF reader: `PdfReader` class — `open(bytes)`, `getPage(n)`, `getPageCount()`, `getMetadata()`, `decodeStream()`
- PDF modifier: `PdfModifier` class — `addPage()`, `removePage()`, `setMetadata()`, `save()` with incremental `/Prev` chain
- Parser types: `PdfValue`, `PdfName`, `PdfDict`, `PdfArray`, `PdfStream`, `PdfRef` — discriminated union for type-safe parsing
- PdfName type: `{ type: 'name', value: string }` — distinguishes PDF names from string literals (ISO 32000-1 §7.3.4-7.3.5)
- Name helpers: `isName(v)` type guard, `nameValue(v)` extractor, `dictGetName(dict, key)` returns string value of PdfName
- /Info text strings: `encodePdfTextString(str)` — PDFDocEncoding literal `(...)` or UTF-16BE hex `<FEFF...>` (ISO 32000-1 §7.9.2)
- ParentTree: per-page arrays keyed by `/StructParents` value (ISO 32000-1 §14.7.4.4); MCIDs restart at 0 per page
- Bengali shaping: `shapeBengaliText()` — GSUB conjunct formation + GPOS mark positioning via `bengali-shaper.ts`
- Tamil shaping: `shapeTamilText()` — GSUB substitution + split vowel decomposition via `tamil-shaper.ts`
- Devanagari shaping: `shapeDevanagariText()` — cluster building, reph detection, matra reordering, split vowels, GSUB ligature conjuncts, GPOS mark positioning via `devanagari-shaper.ts`
- Telugu shaping (v1.3.0): `shapeTeluguText()` — virama-mediated conjunct clusters, subjoined-consonant ligatures via shared `gsub-driver`, above/below vowel-sign + modifier positioning via shared `gpos-positioner`, **no reph** and **no pre-base reordering** (Telugu specifics) via `telugu-shaper.ts`. Script range U+0C00–U+0C7F; `TELUGU_START`/`TELUGU_END`, `isTeluguCodepoint`, `containsTelugu` in `script-registry.ts`; `'te'` wired into `script-detect.ts` (needsUnicodeFont/detectFallbackLangs/detectCharLang) and `encoding-context.ts` (3 dispatch sites, after Tamil/before Devanagari). Bundled font `fonts/noto-telugu-data.{js,d.ts}` (Noto Sans Telugu, OFL-1.1). Opt-in via `registerFont('te', () => import('pdfnative/fonts/noto-telugu-data.js'))`.
- Five-script expansion (v1.3.0): Amharic/Ethiopic (`am`), Sinhala (`si`), Tibetan (`bo`), Khmer (`km`), Myanmar (`my`) — extends pdfnative from 17 to 22 Unicode scripts. **Ethiopic** (U+1200–U+137F) syllabic abugida, detection + font routing only (no shaper). **Sinhala** (`sinhala-shaper.ts`, U+0D80–U+0DFF): virama conjuncts, pre-base kombuva reordering, two-part vowel decomposition. **Tibetan** (`tibetan-shaper.ts`, U+0F00–U+0FFF): vertical subjoined-consonant stacking; bundled font is Noto Serif Tibetan. **Khmer** (`khmer-shaper.ts`, U+1780–U+17FF): USE-lite — coeng subscripts, pre-base vowels, two-part vowel decomposition. **Myanmar** (`myanmar-shaper.ts`, U+1000–U+109F): USE-lite — medials, pre-base medial-ra (U+103C) + e-vowel (U+1031), virama stacking. Khmer/Myanmar are pragmatic USE-lite with documented limitations (two-part-vowel MultipleSubst handled JS-side via shaper tables). Range constants/predicates (`ETHIOPIC_START/END`, `isSinhalaCodepoint`, `containsKhmer`, …) in `script-registry.ts`; wired into `script-detect.ts` (3 sites) and `encoding-context.ts` (3 dispatch sites, order Thai→Bengali→Tamil→Telugu→Sinhala→Tibetan→Khmer→Myanmar→Devanagari). Bundled fonts `fonts/noto-{ethiopic,sinhala,tibetan,khmer,myanmar}-data.{js,d.ts}` (all OFL-1.1). Opt-in via `registerFont('am'|'si'|'bo'|'km'|'my', loader)`.
- Opt-in Unicode normalization (v1.3.0): `layout.normalize?: 'NFC'|'NFD'|'NFKC'|'NFKD'|false` (default `false`) applies native `String.prototype.normalize` in `createEncodingContext()` before encoding. Off by default → byte-identical for existing callers.
- CSPRNG-only crypto (v1.3.0): `fillRandom` in `pdf-encrypt.ts` throws when no `crypto.getRandomValues` source is available — never falls back to `Math.random` for encryption keys/IVs.
- GSUB LookupType 4 (LigatureSubst): `fontData.ligatures` — `Record<number, number[][]>` mapping first-glyph GID → arrays of `[resultGID, ...componentsAfterKey]` (the first GID is the implicit lookup key, NOT included in the components array). Shared `tryLigature(gids, ligatures)` lives in `src/shaping/gsub-driver.ts` and is used by Bengali, Tamil, Devanagari, and Arabic shapers. Each shaper exposes a thin `tryLig(gids)` closure that forwards to the shared driver.
- GPOS MarkBasePos: shared helpers in `src/shaping/gpos-positioner.ts` (`getBaseAnchor`, `getMarkAnchor`, `getMark2MarkAnchor`, `positionMarkOnBase(markAnchors, markGid, baseGid, baseAdv)`). Used by Devanagari and Arabic shapers. Arabic tracks `lastBaseGid` through the shaping pipeline (including lam-alef ligatures) and applies the anchor offset to transparent (joining type 'T') marks; falls back to (0, 0) when font lacks anchors.
- Emoji: monochrome via Noto Emoji (OFL-1.1) under lang `'emoji'`. Detection in `src/shaping/script-registry.ts` (`EMOJI_RANGES`, `isEmojiCodepoint`, `containsEmoji`, `FITZPATRICK_START/END`, `ZWJ`, `VS15`, `VS16`). `detectCharLang(cp)` returns `'emoji'` for emoji codepoints; `splitTextByFont()` routes them to the registered `'emoji'` font automatically. Opt-in via `registerFont('emoji', () => import('pdfnative/fonts/noto-emoji-data.js'))`. COLRv1 colour emoji shipped in v1.3.0 (Noto Color Emoji subset `fonts/noto-color-emoji-data.js`, opt-in under lang `'emoji'`; COLR v0/v1 layers → PDF Form XObjects with `/Shading` Type 2/3).
- Colour-emoji selector drop (v1.3.0): `isZeroWidthFormat(cp)` in `script-registry.ts` (ZWJ 0x200D, ZWNJ 0x200C, VS15 0xFE0E, VS16 0xFE0F, Fitzpatrick 0x1F3FB–FF). `splitTextByFont()` drops such chars when NO registered font covers them (prevents `.notdef` tofu); joiners are still preserved when an Indic shaper font maps them. NOTE: `splitTextByFont` early-returns for single-font setups, so the drop only applies with 2+ fonts.
- Colour-emoji computed BBox (v1.3.0): `renderColorGlyph()` in `pdf-color-glyph.ts` derives each colour-glyph Form `/BBox` from transformed contour bounds `[floor(minX)-1, floor(minY)-1, ceil(maxX)+1, ceil(maxY)+1]` (fallback `[0,0,unitsPerEm,unitsPerEm]`) — emoji dipping below the baseline are no longer clipped.
- Bundled colour-emoji CLI (v1.4.0): `npx pdfnative-build-emoji-font` (bin → `dist/tools/build-emoji-font.js`, built by tsup from `scripts/build-emoji-font.ts` with a `#!/usr/bin/env node` banner + `noExternal: [/.*/]`). Lets pdfnative-only users generate a colour-emoji data module covering any glyph subset up to the **full ~3,600-glyph** Noto Color Emoji set — the package never bundles the ~32 MB source. Selects glyphs via `--ttf`|`--download` (pinned Google Fonts URL + SHA-256, warn-not-fail on mismatch) × `--all`|`--preset`|`--codepoints`|`--ranges`. Shared deterministic core lives in `scripts/lib/`: `emoji-font-core.ts` (`buildEmojiFontModule`, `allColorCodepoints` — imports `parseColrCpal`/`subsetTTF` from `src/fonts/`), `curated-emoji.ts` (`CURATED_EMOJI`, 221 codepoints), `emoji-cli.ts` (pure `parseArgs`/`parseHex`/`resolveCodepoints` — fully CI-testable without a TTF). `build-color-emoji-data.ts` was refactored onto the same core and emits the committed `fonts/noto-color-emoji-data.{js,d.ts}` **byte-identically** (single-quote `fontName`/`dtsTypeImport` emission preserves identity). CLI tests in `tests/tools/build-emoji-font.test.ts` (TTF-gated integration via `it.skipIf`).
- UAX #9 embeddings: `normalizeBidiEmbeddings(text)` in `src/shaping/bidi.ts` rewrites LRE/RLE/LRO/RLO/PDF (U+202A–U+202E) to sealed-isolate equivalents (LRI/RLI/PDI) using a stack with max depth 125. `resolveBidiRuns()` invokes the normaliser transparently. X4–X5 character-level overrides inside LRO/RLO scopes are fully implemented (v1.3.0): every codepoint within the scope is forced to strong L (LRO) / strong R (RLO) before the W/N/L rules run.
- USE-lite: `classifyUseCategory(cp)` + `classifyClusters(cps)` in `src/shaping/use-lite.ts` ship as a public API. As of v1.3.0 it is the joiner-classification authority across the Devanagari/Bengali/Tamil shapers (orphan ZWJ/ZWNJ no longer reach the cmap as `.notdef`; ZWJ continues a conjunct, ZWNJ breaks it keeping a visible virama).
- Signature placeholder (v1.2.0, #45): `addSignaturePlaceholder(pdfBytes, options?)` in `src/core/pdf-sig-placeholder.ts` appends an AcroForm + invisible signature widget + `/Sig` dictionary via incremental update (ISO 32000-1 §7.5.6). Idempotent on already-signed PDFs (returns input unchanged when an `/FT /Sig` widget exists). `SigDictMetadata` interface (metadata-only subset of `PdfSignOptions`) extracted in `pdf-signature.ts` and shared by `buildSigDict()` and `addSignaturePlaceholder()`. `PdfModifier.addRawObject(body)` lets placeholder-style raw payloads round-trip without re-serialisation.
- ASN.1 grandchild offsets (v1.2.0, #46): `decodeAt()` in `src/crypto/asn1.ts` recursively absolutises every descendant node's `offset` against the original DER buffer. Previously only direct children were patched, so `parseName()`'s `fullDer.subarray(node.offset, ...)` returned a slice off by exactly the parent's value-field offset, breaking CMS `IssuerAndSerialNumber`. Defensive `raw[0] === 0x30` assertion lives at the `parseName()` boundary.
- Page-by-page streaming (v1.2.0): `buildPDFStreamPageByPage(pdfBytes, opts?)` and `buildDocumentPDFStreamPageByPage(params, opts?)` in `src/core/pdf-stream-writer.ts` chunk an _assembled_ PDF at PDF object boundaries (`\nendobj\n`). `chunkAtObjectBoundaries()` is the underlying helper. True constant-memory streaming shipped in v1.3.0: `buildPDFStreamTrue()` / `buildDocumentPDFStreamTrue()` assemble the PDF into raw parts and yield fixed-size chunks while freeing each part as it is emitted — the fully-joined binary never materialises in memory; byte-identical to the buffered builders.
- Configurable block limit (v1.3.0): the previously hard-coded 10 000-block cap in `assembleDocumentParts()` (`src/core/pdf-document.ts`) is now `layout.maxBlocks` with default `DEFAULT_MAX_BLOCKS = 100_000` (`src/core/pdf-layout.ts`). Applies to every entry point including the streaming builders. The over-limit error names the active limit. `PdfLayoutOptions.maxBlocks?` in `src/types/pdf-types.ts`.
- PDF/UA validator (v1.3.0): `validatePdfUA(bytes)` in `src/parser/pdf-ua-validator.ts` — read-only ISO 14289-1 structural checker returning `{ valid, errors, warnings }`. Verifies `/MarkInfo /Marked`, `/StructTreeRoot` + `/ParentTree`, `/Metadata`, `/Lang`, and per-page `/MCID` uniqueness (regex `/\/MCID\s+(\d+)/g`). Imports from `pdf-reader.js` + `pdf-object-parser.js`. Complements (does not replace) veraPDF. Exported from `src/index.ts` with `PdfUAValidationResult`.
- Latin VF (PDF/A): Noto Sans VF (OFL-1.1) bundled as `fonts/noto-sans-data.{js,d.ts}` under lang `'latin'`. Activates automatically for PDF/A documents containing non-WinAnsi Latin (curly quotes, em-dash, ellipsis…). Opt-in via `registerFont('latin', () => import('pdfnative/fonts/noto-sans-data.js'))`.
- Document outline/bookmarks (v1.4.0): `buildOutlineObjects(items, startObjNum, pageObjNumFor, defaultY, fmtNum, pageCount)` in `src/core/pdf-outline.ts` builds the `/Outlines` tree (`/First /Last /Next /Prev /Parent /Count`, nested children, `/F` flags bold=2 italic=1, `/C` color, `/Dest [pageObj /XYZ 0 y null]`). Titles via `encodePdfTextString`. `OutlineItem.open?: boolean` (default true) — `false` emits a **negative** `/Count` (collapsed, ISO 32000-1 §12.3.3); a collapsed node contributes only itself (not its hidden descendants) to ancestors' visible counts (`openDescendantCount` magnitude + sign by `open`). Wired into `pdf-document.ts` as **trailing indirect objects** appended after embedded files (`totalObjs = outlineStart + built.totalObjects - 1`) so the catalog-rewrite offset-adjustment loop covers them — same pattern as colour-emoji/embedded-files. `DocumentParams.outline?: readonly OutlineItem[] | 'auto'`; `'auto'` derives a nested tree from heading levels via `autoOutlineFromHeadings()`. Catalog gains `/Outlines N 0 R`.
- Page labels (v1.4.0): `buildPageLabelsDict(ranges, pageCount)` in `src/core/pdf-page-labels.ts` emits an inline `/PageLabels << /Nums [...] >>` number tree. `PageLabelStyle` decimal/roman/Roman/alpha/Alpha/none → `/S /D|r|R|a|A` (none omits `/S`). `PageLabelRange { startPage, style?, prefix?, start? }` — validated for ordering/bounds; prefix parens escaped. `DocumentParams.pageLabels?: readonly PageLabelRange[]`. Inline (not indirect) so no object-number impact.
- Page-tree manipulation (v1.4.0): `mergePdfs(sources, opts?)`, `splitPdf(src, ranges)`, `extractPages(src, indices)` in `src/parser/pdf-pagetree.ts` deep-copy kept pages + their transitive object graph into a fresh object-number space (obj 1=Catalog, 2=Pages, 3+=graph). `copyObject()` is memoized per-reader and cycle-safe; `rewrite()`/`copyObject()`/`serializeStreamBody()` thread a `depth` capped at `MAX_COPY_DEPTH=2000` (throws on deeper nesting/ref-chains — stack-overflow hardening). `resolveInherited()` folds MediaBox/CropBox/Rotate/Resources from ancestors onto each page; `filterAnnotations()` keeps only URI `/Link` annots; `serializeValue/Dict` are binary-safe (Latin-1). `serializeDocument()` emits a deterministic content-addressed trailer `/ID [<hex> <hex>]` via `md5(...)` imported from `core/pdf-encrypt.js` (parser→core is an allowed edge). `assertNotEncrypted()` throws on `/Encrypt`. `MAX_MERGE_SOURCES=50`. `MergeOptions { dropSignatures?, dropAnnotations?, maxOutputSize? }` — `maxOutputSize` (default `DEFAULT_MAX_OUTPUT_SIZE = 256*1024*1024`; `Infinity` disables) is a secure-by-default output ceiling enforced via `accountBytes()`/`setBody()` and a pre-flight `accountBytes(ctx, stream.data.length)` in `serializeStreamBody()` *before* the Latin-1 conversion (rejects multi-GB streams before they materialise — OOM hardening); validated at entry via `resolveMaxOutputSize()`. `splitPdf(src, ranges, opts?)` and `extractPages(src, indices, opts?)` also accept `MergeOptions` (additive trailing param). Full rebuild (not in-place surgery) — unblocks `pdfnative-mcp` merge_pdfs/split_pdf.
- streamToFile (v1.4.0): `streamToFile(stream, filePath, { signal? })` in `src/core/pdf-stream-writer.ts` drains any `AsyncGenerator<Uint8Array>` to disk in Node, honouring write back-pressure (awaits `'drain'`) and `AbortSignal`; returns `{ bytesWritten, chunks }`. On abort (pre-start, mid-iter, or post-loop) or any write error it releases the fd (awaits `'close'`) and best-effort `fs.rmSync(filePath, { force: true })` so no orphaned partial file is left behind. Uses top-level `import type * as NodeFs from 'node:fs'` + dynamic `await import('node:fs')` (no static node dep — keeps browser/Deno builds clean). ESLint forbids inline `import()` type annotations, so the type-only import MUST be top-level.
- COLRv1 advanced compositing (v1.4.0): `colr-parser.ts` resolves `PaintSweepGradient` (format 8) → `SweepGradientPaint { kind:'sweep', center, startAngle, endAngle, stops, extend }` (matrix rotation folded via `Math.atan2`), and `PaintComposite` (format 32) → backdrop+source layers with the source tagged `ColorLayer.blendMode` via `compositeModeToBlendMode(mode)` (separable modes 3/13–27 → Normal/Multiply/Screen/Overlay/Darken/Lighten/ColorDodge/ColorBurn/HardLight/SoftLight/Difference/Exclusion/Hue/Saturation/Color/Luminosity; structural Porter-Duff modes → `null` → `UnsupportedPaint` → mono fallback). `pdf-color-glyph.ts`: `emitSweep()` renders flat triangular wedges (no `/Shading` resource); unified `gsFor(alpha, bm)` ExtGState helper combines `/ca`+`/BM`. New types `SweepGradientPaint` + `ColorLayer.blendMode?` in `src/types/pdf-types.ts`.
- Pluggable signature crypto provider (v1.4.0): `src/crypto/crypto-provider.ts` mirrors the `setDeflateImpl` global-registry pattern — module-level `_cryptoProvider`, `setCryptoProvider(provider | null)`, `getCryptoProvider()`. `CryptoProvider { sign(tbs, algorithm): Uint8Array }` receives the **DER-encoded CMS signed attributes** (`signedAttrsForSig`, a SET tag 0x31) and hashes them internally (native `crypto.sign('sha256', …)`); RSA → PKCS#1 v1.5 over SHA-256(tbs), ECDSA → DER-encoded sig. Dispatch lives in `buildSignerInfo()` in `src/crypto/cms.ts`: `const provider = options.provider ?? getCryptoProvider()` — when present, `signatureValue = provider.sign(...)` and `rsaKey`/`ecKey` are not required; else the pure-JS `rsaSignHash`/`ecdsaSignHash` fallback runs. `CmsSignOptions.provider` and `PdfSignOptions.provider` thread the per-call provider (per-call wins over global). Exported from `src/index.ts`. This is the in-library escape hatch for the SECURITY.md BigInt timing caveat.
- Font-data validator (v1.4.0): `validateFontData(data: unknown): FontValidationResult { valid, errors, warnings }` in `src/fonts/font-validator.ts` — opt-in, read-only, **NOT** auto-run by `registerFont` (avoids per-load cost + false-rejecting edge-valid fonts). Checks: metrics finiteness + positive `unitsPerEm` + 4-number `bbox`, non-empty `fontName`, non-empty `cmap` with in-range integer GIDs (vs `numGlyphs`), `widths` presence (missing-width → warning), non-empty `pdfWidthArray`, and `ttfBase64` base64 validity + SFNT magic (`SFNT_MAGIC` = 0x00010000 / 'OTTO' / 'true' / 'ttcf'). `decodeBase64Prefix()` decodes only the 4-byte header via `atob`/`Buffer`. Reports (never throws) on malformed input. Exported from `src/index.ts`.
- Viewer preferences (v1.4.0): `buildViewerPreferences(prefs)` in `src/core/pdf-viewer-prefs.ts` returns `{ pageLayout?, pageMode?, dict }`. `/PageLayout` (singlePage/oneColumn/twoColumnLeft/twoColumnRight/twoPageLeft/twoPageRight) and `/PageMode` (useNone/useOutlines/useThumbs/fullScreen/useOC/useAttachments) are **catalog-level** keys; booleans (HideToolbar/HideMenubar/HideWindowUI/FitWindow/CenterWindow/DisplayDocTitle) + NonFullScreenPageMode + Direction (L2R/R2L) + PrintScaling go in the `/ViewerPreferences` sub-dict. `buildViewerPreferences` kept **internal** (only `ViewerPreferences` type exported, mirroring page-labels). Wired in `pdf-document.ts`: viewer block computed before outline; an explicit `viewerPrefs.pageMode` **wins** over the outline's default `/PageMode /UseOutlines` (`if (!viewerPrefs?.pageMode)` guards the outline emission); `${viewerPrefsStr}` injected into both catalog-rewrite paths + the non-tagged trigger condition. `PdfLayoutOptions.viewerPreferences?: ViewerPreferences`. Byte-identical when unset.
- Nested lists (v1.4.0): `ListBlock.items` widened to `readonly (string | ListItem)[]`; `ListItem { text, items? }`. `renderList()` delegates to recursive `renderListLevel(items, style, depth, …)` in `src/core/pdf-renderers.ts` — depth 0 reproduces exact pre-1.4.0 geometry (marker at `mgL + LIST_INDENT`), each deeper level adds one `LIST_INDENT`. **Uniform `•` bullet at all depths** (deliberate zero-tofu choice — `◦`/`▪` U+25E6/U+25AA aren't WinAnsi-encodable in base-14 mode; indentation conveys hierarchy); numbered sub-lists restart at 1. Tagged mode nests `/L → /LI → /L`. `estimateBlockHeight` list case uses a parallel recursive `measureLevel`. String-only lists are byte-identical. `ListItem` exported from root.
- Table cell borders + vertical alignment (v1.4.0): `TableBlock.cellBorders?: CellBorders { top?, right?, bottom?, left?, all?, color?, width?, style? }` and `TableBlock.cellVAlign?: 'top'|'middle'|'bottom'` (per-column `ColumnDef.vAlign` overrides). In `renderTable()` (`pdf-renderers.ts`), `cellBorderOps(cellX, cellW, top, h)` strokes the requested sides (`m … l S`) and returns `[]` when `cellBorders` is undefined (byte-identical); dashed = `[3] 0 d`, dotted = `[${w} ${w*2}] 0 d` (via `fmtNum`, i.e. `[1.00 2.00] 0 d`), and it **resets the dash with `[] 0 d`** after non-solid borders so row separators/header underline stay solid. Called per cell in the header loop (`headerHeight`) and data-row loop (`rowH`). `emitCell` resolves `vAlign = col.vAlign ?? block.cellVAlign`; when set it positions the text block within the row band (top/middle/bottom, `offset < pad` guard) — when undefined it uses the historic single/multi-line baseline formula (byte-identical). `CellBorders` exported from root.
- Math / technical symbols font (v1.5.0, #57): Noto Sans Math (OFL-1.1) bundled as `fonts/noto-sans-math-data.{js,d.ts}` under lang `'math'`. `MATH_RANGES` + `isMathCodepoint(cp)` / `containsMath(str)` in `script-registry.ts` cover mathematical operators (U+2200–U+22FF), supplemental/misc math operators (U+2A00–U+2AFF, U+27C0–U+27EF, U+2980–U+29FF), arrows (U+2190–U+21FF), letterlike (U+2100–U+214F), and Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF). Wired into `script-detect.ts` (needsUnicodeFont list + `detectFallbackLangs`/`detectCharLang`, **before** emoji since math blocks are distinct). Opt-in via `registerFont('math', () => import('pdfnative/fonts/noto-sans-math-data.js'))`.
- Font-data tools (v1.5.0, #60): `src/tools/font-compiler.ts` (entry `pdfnative/tools`) exposes `compileFontData(buffer, opts?): string` (TTF/OTF `Uint8Array` → font-data module source, mirroring `tools/build-font-data.cjs` **byte-identically**) and `parseFontData(buffer, opts?): FontDataObject` (introspect metrics/cmap/widths/glyph coverage). Types `CompiledFontMetrics`, `FontDataObject`, `CompileFontDataOptions`, `ParseFontDataOptions`. `./tools` export added to package.json; tsup emits `dist/tools/index.{js,cjs,d.ts}`.
- SVG `<text>` (v1.5.0, #61): `pdf-svg.ts` `renderSvg()` collects `shapeOps[]` and `textOps[]` **separately** — the `q/cm/…/Q` transform wrapper is emitted ONLY when `shapeOps.length > 0`; text is emitted OUTSIDE the `cm` so it stays upright (`x`/`y` positioning + `text-anchor` start/middle/end via `Td` with `-?` negative-x for anchor shift). Returns `''` when nothing renders (an existing test relies on this). `sanitizeSvgText()` strips control chars (`eslint-disable-next-line no-control-regex`). MVP: no automatic word-wrap.
- Control-character hardening (v1.5.0, #58): text run encoding drops/escapes control characters that previously produced `.notdef` tofu — byte-safe across base-14 WinAnsi and CIDFont modes.
- Table descender fix (v1.5.0, #59): table cell clipping rectangle no longer clips glyph descenders (g, j, p, q, y).
- Page-labels reader (v1.5.0): `PdfReader.getPageLabels(): PageLabelRange[] | null` in `pdf-reader.ts` — `collectNumberTree` walks `/Nums` + `/Kids`; `STYLE_FROM_OP` reverse-maps `/S` operator (D→decimal, r→roman, R→Roman, a→alpha, A→Alpha, absent→none); reads `/P`→prefix, `/St`→start. Round-trips the v1.4.0 `buildPageLabelsDict` writer. Type-only import of `PageLabelRange`/`PageLabelStyle` from `core/pdf-page-labels.js` (allowed parser→core type edge).
- Annotation read/write (v1.5.0): `pdf-annot-markup.ts` `MarkupAnnotation` union (text/highlight/underline/strikeout/squiggly/square/circle/line/freetext) + `AnnotationBase { rect, contents?, color?, opacity?, title?, modified?, flags? }`. `buildAnnotation(annot, objNum)` (full indirect object) + `buildAnnotationBody(annot)` (dict body, for the modifier). `/Contents`+`/T` via `encodePdfTextString`; `/C`/`/IC` via `parseColor`; `/QuadPoints` auto-derived from `/Rect`; `/F` default 4; line adds `/L`+`/BS`; freetext adds `/DA (/Helv <sz> Tf <col> rg)`. Reader: `getAnnotations(pageIndex): ParsedAnnotation[]` (decodes UTF-16BE `/Contents` via FE FF BOM check) + `getPageRef(pageIndex): PdfRef | null` (depth-capped page-tree walk). Modifier: `addAnnotation(pageIndex, body): number` (addRawObject then rewrites the page `/Annots` via setObject). Unblocks pdfnative-mcp `redact_pdf` overlay.
- Layout debug + inspect (v1.5.0): `pdf-layout-debug.ts` `resolveDebugOptions(debug) → { showMargins, showContentBounds, showCells } | null` (null when off); pure `marginBoxOps`/`blockBoundsOps`/`tableCellOps`, each wrapped in its own `q…Q` block (margin blue `0 0.45 0.95`, block red `0.90 0.20 0.30`, cell green `0 0.62 0.30`). `PdfLayoutOptions.debug?: boolean | LayoutDebugOptions`. In `pdf-document.ts`, `debugOpts` resolved after watermark; per-block `yBefore` captured only when debugOpts truthy; overlay ops appended LAST (drawn on top). Byte-identical when debug off. `pdf-layout-inspect.ts` `inspectDocumentLayout(params, layout?) → LayoutInspection` faithfully ports pagination (shares `estimateBlockHeight`/`planTable`/constants, `TITLE_BAND_H=34`, table slicing). `inspectDocumentLayout` + `LayoutDebugOptions`/`LayoutInspection`/`InspectedPage`/`InspectedBlock` exported from root; `resolveDebugOptions`/`*Ops` are internal.
- AI-agent governance (v1.5.0, #56): `.github/ai-governance.json` (policy: no autonomous GitHub writes, no runtime deps, HITL mandatory, required issue fields) + `.github/AGENT_RULES.md` (HITL protocol, 6 mandatory rules). `scripts/verify-issue.mjs` (ESM, NO shebang — a shebang broke vitest import) exports pure `validateIssueMarkdown(content) → { ok, errors, warnings }` (CI-testable) with a CLI `import.meta.url` guard; detects dep-add patterns, requires a fenced code block, warns on missing repro/env/expected; exit 0/1/2. `scripts/verify-issue.d.mts` companion for typecheck. `.github/drafts/` (README+TEMPLATE tracked, `*.md` gitignored). `npm run verify:issue` script.


- Public API must be stable and backward-compatible once 1.0 ships
- Every public function/type is exported from `src/index.ts`
- Font data modules are lazy-loaded via `registerFont()` + `loadFontData()` pattern
- Worker threshold is configurable, defaults to 500 rows

### Error Handling

- Validate at system boundaries only (public API entry points)
- Internal functions trust their callers — no redundant validation
- Use descriptive `Error` messages with context: `throw new Error(\`Font '\${lang}' not registered\`)`

### Performance

- Zero allocations in hot paths (text rendering loop, glyph encoding)
- TTF subsetting reuses ArrayBuffer views — no copies
- Font data base64 decoded once, cached in registry
- Benchmark any change to core rendering loop

## Quality Standards

- **Zero dependency** policy — no runtime `dependencies` in package.json
- **Tree-shakeable** — `sideEffects: false`, no module-level side effects
- **ISO 32000-1 compliance** — all generated PDFs must validate against spec
- **ISO 14289-1 (PDF/UA)** — tagged mode: structure tree, /ActualText, marked content
- **ISO 19005-1 (PDF/A-1b)** — tagged mode: XMP metadata, sRGB ICC OutputIntent
- **ISO 19005-2 (PDF/A-2b)** — default tagged mode: PDF 1.7, pdfaid:part=2
- **Cross-platform** — works in Node.js, browsers, Deno, Bun, Web Workers
- **PDF /Info metadata** — Title, Producer (pdfnative), CreationDate in D:YYYYMMDDHHmmss format
- **Input validation** — at `buildPDF()` boundary: null/undefined/type checks, 100K row limit
- **URL validation** — at `validateURL()`: blocks javascript:, file:, data: schemes
- **95%+ test coverage** — 2379+ tests (104 files), 48 fuzz edge-cases (including recursion/zip-bomb/xref-chain hardening), dual-mode visual-regression suite, performance benchmarks
- **NPM provenance** — signed builds via GitHub Actions OIDC
- Security: no `eval()`, no `Function()`, no dynamic code execution
- No `console.log` in library code (only in tools/ and scripts/)
