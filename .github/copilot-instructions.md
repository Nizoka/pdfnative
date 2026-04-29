# pdfnative — Project Guidelines

## Overview

Pure native PDF generation library. Zero vendor dependencies. ISO 32000-1 (PDF 1.7) compliant.
Target: exceed GAFAM-grade quality standards in code, testing, performance, and documentation.

## Architecture

```
src/
├── core/         # PDF document assembly, text rendering, binary stream, layout constants, tagged PDF, images, annotations, encryption, compression, watermarks, barcodes, SVG, forms, signatures, streaming
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
│   ├── pdf-svg.ts        # SVG path/shape rendering as native PDF path operators (7 element types)
│   ├── pdf-form.ts       # AcroForm interactive fields with appearance streams (ISO 32000-1 §12.7)
│   ├── pdf-signature.ts  # CMS/PKCS#7 digital signatures (RSA + ECDSA, ISO 32000-1 §12.8)
│   ├── pdf-stream-writer.ts # AsyncGenerator streaming output with configurable chunk size
│   └── pdf-encrypt.ts    # AES-128/256 encryption, MD5, SHA-256, key derivation, permissions
├── crypto/       # Zero-dependency cryptographic primitives
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
│   ├── pdf-reader.ts     # High-level PDF reader (page tree, stream decode, caching)
│   └── pdf-modifier.ts   # Incremental modification (non-destructive save with /Prev)
├── fonts/        # WinAnsi + CIDFont pure encoding functions, lazy font loader, TTF subsetter (with buffer guards), CMap builder
├── shaping/      # Thai/Devanagari/Bengali/Tamil GSUB+GPOS shaping, Arabic positional shaping, BiDi resolution, Unicode script detection, multi-font run splitting, centralized script registry
├── types/        # All public TypeScript type definitions (pdf-types.ts, pdf-document-types.ts)
└── worker/       # Web Worker dispatch + self-contained worker entry
fonts/            # Pre-built font data modules (.js/.d.ts) — 16 scripts + TTF source files
tools/            # CLI tool (build-font-data.cjs) for converting TTF → importable data modules
scripts/          # Modular sample PDF generation (26 generators, 150+ PDFs; emoji-showcase.ts and pdfa-latin-embedding.ts added in v1.1.0)
test-output/extreme/  # Visual regression baselines for extreme scripts (extreme-bidi.pdf, extreme-tamil.pdf, extreme-bengali-devanagari.pdf, extreme-arabic-harakat.pdf, extreme-bidi-isolates.pdf)
tests/            # 1726+ tests (48 files: unit/integration/fuzz/parser) mirroring src/ structure
bench/            # Performance benchmarks (vitest bench)
docs/             # GitHub Pages landing site (pdfnative.dev) — pure HTML/CSS/JS, zero build deps
  └── playgrounds/  # Interactive browser playgrounds (extreme-scripts.html, medical-800.html)
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
npm run test            # vitest run (1588+ tests, 40 files)
npm run test:watch      # vitest (watch mode)
npm run test:coverage   # vitest with v8 coverage (thresholds: 90/80/85/90)
npm run test:generate   # Generate 150+ sample PDFs → test-output/ (incl. extreme/, emoji/, pdfa-latin/ baselines)
npm run typecheck       # tsc --noEmit
npm run typecheck:tests # tsc --project tsconfig.test.json --noEmit
npm run typecheck:scripts # tsc --project tsconfig.scripts.json --noEmit
npm run typecheck:all   # typecheck src/ + tests/ + scripts/
npm run lint            # eslint src/ (ESLint 9 + typescript-eslint strict)
```

- Build tool: **tsup** (dual ESM/CJS, tree-shakeable, sourcemaps)
- Test runner: **vitest** (fast, native ESM, watch mode, v8 coverage)
- CI: GitHub Actions — lint/typecheck/test/build on Node 22/24
- Publish: GitHub Actions OIDC with `npm publish --provenance`
- All new code must have tests. Current: ~95% statement coverage, 1726+ tests (48 files)

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
- Streaming output: `pdf-stream-writer.ts` provides `buildPdfStream()` AsyncGenerator yielding Uint8Array chunks
- Streaming API: `streamPdf(params)` / `streamDocumentPdf(params)` — both return `AsyncGenerator<Uint8Array>`
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
- GSUB LookupType 4 (LigatureSubst): `fontData.ligatures` — `Record<number, number[][]>` mapping first-glyph GID → arrays of `[resultGID, ...componentsAfterKey]` (the first GID is the implicit lookup key, NOT included in the components array). Shared `tryLigature(gids, ligatures)` lives in `src/shaping/gsub-driver.ts` and is used by Bengali, Tamil, Devanagari, and Arabic shapers. Each shaper exposes a thin `tryLig(gids)` closure that forwards to the shared driver.
- GPOS MarkBasePos: shared helpers in `src/shaping/gpos-positioner.ts` (`getBaseAnchor`, `getMarkAnchor`, `getMark2MarkAnchor`, `positionMarkOnBase(markAnchors, markGid, baseGid, baseAdv)`). Used by Devanagari and Arabic shapers. Arabic tracks `lastBaseGid` through the shaping pipeline (including lam-alef ligatures) and applies the anchor offset to transparent (joining type 'T') marks; falls back to (0, 0) when font lacks anchors.
- Emoji: monochrome via Noto Emoji (OFL-1.1) under lang `'emoji'`. Detection in `src/shaping/script-registry.ts` (`EMOJI_RANGES`, `isEmojiCodepoint`, `containsEmoji`, `FITZPATRICK_START/END`, `ZWJ`, `VS15`, `VS16`). `detectCharLang(cp)` returns `'emoji'` for emoji codepoints; `splitTextByFont()` routes them to the registered `'emoji'` font automatically. Opt-in via `registerFont('emoji', () => import('pdfnative/fonts/noto-emoji-data.js'))`. COLRv1 colour emoji deferred to v1.2.
- Latin VF (PDF/A): Noto Sans VF (OFL-1.1) bundled as `fonts/noto-sans-data.{js,d.ts}` under lang `'latin'`. Activates automatically for PDF/A documents containing non-WinAnsi Latin (curly quotes, em-dash, ellipsis…). Opt-in via `registerFont('latin', () => import('pdfnative/fonts/noto-sans-data.js'))`.

### API Design

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
- **95%+ test coverage** — 1726+ tests (48 files), 48 fuzz edge-cases (including recursion/zip-bomb/xref-chain hardening), performance benchmarks
- **NPM provenance** — signed builds via GitHub Actions OIDC
- Security: no `eval()`, no `Function()`, no dynamic code execution
- No `console.log` in library code (only in tools/ and scripts/)
