# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-01

### Added

- **PDF Encryption (Phase 9)** — AES-128 (V4/R4/AESV2) and AES-256 (V5/R6/AESV3) encryption via `encryption` layout option
- **New module `src/core/pdf-encrypt.ts`** — pure TypeScript AES-CBC, MD5, SHA-256 implementations, key derivation (ISO 32000-1 §7.6), per-object keys with random IVs, PKCS7 padding
- **Owner + user passwords** — `ownerPassword` (full access) and optional `userPassword` (open access) with O/U/OE/UE value computation
- **Granular permissions** — `print`, `copy`, `modify`, `extractText` bitmask (ISO 32000-1 Table 22)
- **`EncryptionOptions` type** — `{ ownerPassword, userPassword?, algorithm?, permissions? }`
- **Transparent stream encryption** — `emitStreamObj()` encrypts when encryption state is active
- **PDF/A + encryption mutual exclusion** — validated at build boundary (ISO 19005-1 §6.3.2)
- **Cryptographic random IVs** — `crypto.getRandomValues()` with `Math.random()` fallback
- **New public API exports** — `initEncryption`, `encryptStream`, `encryptString`, `buildEncryptDict`, `buildIdArray`, `computePermissions`, `generateDocId`, `aesCBC`, `md5`, `sha256`, `EncryptionState`
- **6 encrypted sample PDFs** — AES-128/256, owner-only, user+owner, read-only, no-print variants
- **2 encrypted document builder samples** — `doc-encrypted-aes128.pdf`, `doc-encrypted-aes256.pdf`

### Changed

- **Color Safety (Phase 10)** — all color inputs (hex `#RRGGBB`/`#RGB`, RGB tuples `[r, g, b]`, PDF operator strings) are validated and normalized via `parseColor()` before interpolation into PDF content streams, eliminating injection vectors
- **New module `src/core/pdf-color.ts`** — `parseColor()`, `isValidPdfRgb()`, `normalizeColors()` with descriptive error messages
- **New types** — `PdfColor` union type, `PdfRgbString` template literal type, `PdfRgbTuple` tuple type
- **`PdfColors` interface** — all 12 fields changed from `string` to `PdfColor` (accepts hex, tuple, or PDF operator string)
- **Document block colors** — `HeadingBlock.color`, `ParagraphBlock.color`, `LinkBlock.color` accept `PdfColor`
- **New sample PDF** — `doc-custom-colors.pdf` showcasing hex, tuple, and PDF operator color formats
- Total test count: **743 tests** across **24 test files** (was 647/22)
- Both `buildPDF` and `buildDocumentPDF` support encryption via layout options
- PDF trailer emits `/Encrypt` dict reference and `/ID` array when encryption is active

## [0.7.0] — 2026-03-31

### Added

- **PDF/A-2b upgrade (Phase 8)** — default tagged mode now produces PDF/A-2b (ISO 19005-2) instead of PDF/A-1b
- **PDF/A variant selection** — `tagged: true` (PDF/A-2b default), `tagged: 'pdfa1b'` (legacy), `tagged: 'pdfa2b'` (explicit), `tagged: 'pdfa2u'` (Unicode)
- **`resolvePdfAConfig()` utility** — maps tagged option → config (PDF version, pdfaid:part, pdfaid:conformance, OutputIntent subtype)
- **`PdfAConfig` type** — `{ version, part, conformance, subtype }` for PDF/A variant configuration
- **PDF 1.7 header** — `%PDF-1.7` for PDF/A-2b/2u (was `%PDF-1.4` for PDF/A-1b)
- **XMP metadata upgrade** — `pdfaid:part=2`, `pdfaid:conformance=B` (or `U` for PDF/A-2u)
- **4 PDF/A sample PDFs** — `tagged-pdfa2b-default.pdf`, `tagged-pdfa2b-explicit.pdf`, `tagged-pdfa1b.pdf`, `tagged-pdfa2u.pdf`

### Changed

- Total test count: **605 tests** across **21 test files** (was 549/20)
- `tagged: true` now defaults to PDF/A-2b (was PDF/A-1b) — backward-compatible, just a conformance upgrade
- `buildXMPMetadata()` accepts optional `part` and `conformance` parameters

## [0.6.0] — 2026-03-31

### Added

- **BiDi text support (Phase 7)** — Simplified Unicode Bidirectional Algorithm (UAX #9) for Arabic and Hebrew scripts
- **New module `src/shaping/bidi.ts`** — character classification, paragraph level detection, weak/neutral type resolution, level assignment, glyph mirroring, surrogate-safe string reversal
- **New module `src/shaping/arabic-shaper.ts`** — Arabic GSUB positional shaping (isolated/initial/medial/final forms), lam-alef ligature detection, joining type analysis
- **Arabic & Hebrew font data** — `noto-arabic-data.js` (NotoSansArabic, 1399 glyphs) and `noto-hebrew-data.js` (NotoSansHebrew, 151 glyphs)
- **Script detection** — Arabic (U+0600–06FF, U+0750–077F, U+08A0–08FF, U+FB50–FDFF, U+FE70–FEFF) and Hebrew (U+0590–05FF, U+FB1D–FB4F) ranges in `detectFallbackLangs()`
- **Encoding pipeline integration** — Arabic text automatically routed through shaping pipeline in `textRuns()` and `ps()` methods
- **New public API exports** — `resolveBidiRuns`, `containsRTL`, `mirrorCodePoint`, `classifyBidiType`, `detectParagraphLevel`, `reverseString`, `shapeArabicText`, `containsArabic`, `containsHebrew`, `isLamAlef`, `BidiType`, `BidiRun`
- **59 new tests** for BiDi resolution, Arabic shaping, and script detection

### Changed

- Total test count: **549 tests** across **20 test files** (was 490/18)
- `script-detect.ts` now includes Arabic and Hebrew in `needsUnicodeFont()` and `detectFallbackLangs()`
- `encoding.ts` Arabic text runs shaped through `shapeArabicText()` before glyph encoding
- Supported language count: **11 scripts** (was 9)

## [0.5.0] — 2026-03-31

### Added

- **Hyperlink support (Phase 6)** — PDF link annotations for external URLs and internal destinations
- **New module `src/core/pdf-annot.ts`** — URL validation (http/https/mailto only), link annotation builder, internal link builder, type guards
- **`LinkBlock` document block** — `{ type: 'link', text, url, fontSize?, color? }` for the free-form document builder
- **Visual rendering** — blue underlined text with clickable PDF annotation rectangles
- **Tagged mode `/Link`** — link structure element for PDF/UA accessibility
- **Security** — blocks `javascript:`, `file:`, `data:` URI schemes; escapes parentheses/backslashes in URLs
- **New public API exports** — `validateURL`, `buildLinkAnnotation`, `buildInternalLinkAnnotation`, `isLinkAnnotation`, `LinkAnnotation`, `InternalLink`, `Annotation`, `LinkBlock`
- **26 new tests** for URL validation, annotation building, and document builder integration

### Changed

- Total test count: **490 tests** across **18 test files** (was 464/17)
- `pdf-document.ts` now handles `LinkBlock` in block rendering, emits `/Annots` arrays on pages, and annotation indirect objects
- `DocumentBlock` union type now includes `LinkBlock` (8 block types total)

## [0.4.0] — 2026-03-31

### Added

- **Image embedding (Phase 5)** — JPEG and PNG images in free-form documents
- **New module `src/core/pdf-image.ts`** — JPEG parsing (DCTDecode), PNG parsing (FlateDecode), auto-format detection, PDF Image XObject builder
- **`ImageBlock` document block** — embed images with optional `width`, `height`, `align` (`left`/`center`/`right`), and `alt` text for tagged mode
- **Auto-scaling** — images scale to fit content width while preserving aspect ratio; explicit dimensions override
- **Tagged mode `/Figure`** — images wrapped in `/Figure` structure elements with `/ActualText` for PDF/UA accessibility
- **New public API exports** — `parseImage`, `parseJPEG`, `parsePNG`, `detectImageFormat`, `buildImageXObject`, `buildSMaskXObject`, `buildImageOperators`, `ParsedImage` type
- **37 new tests** for image parsing, XObject building, format detection, and document integration

### Changed

- Total test count: **464 tests** across **17 test files** (was 427/16)
- `pdf-document.ts` now handles `ImageBlock` in the block rendering loop and page resource assembly
- PDF object numbering accounts for Image XObject indirect objects between font objects and page objects
- Page `/Resources` dict includes `/XObject` when images are present

## [0.3.0] — 2026-03-31

### Added

- **Free-form document builder (Phase 4)** — `buildDocumentPDF()` / `buildDocumentPDFBytes()` for block-based documents
- **New module `src/core/pdf-document.ts`** — document builder with heading, paragraph, list, table, spacer, and page break blocks
- **New types module `src/types/pdf-document-types.ts`** — `HeadingBlock`, `ParagraphBlock`, `ListBlock`, `TableBlock`, `SpacerBlock`, `PageBreakBlock`, `DocumentBlock`, `DocumentMetadata`, `DocumentParams`
- **`wrapText()` utility** — greedy line-filling word wrap for Latin and Unicode encodings
- **Auto-pagination** — blocks automatically distributed across pages with height estimation
- **Full tagged PDF support** — all block types emit proper structure elements (`/H1-H3`, `/P`, `/L → /LI`, `/Table → /TR → /TH|/TD`, `/Figure`) when `tagged: true`
- **63 new tests** for all block types, pagination, tagged mode, edge cases, and Unicode integration

### Changed

- Total test count: **427 tests** across **16 test files** (was 364/15)
- `src/index.ts` now exports document builder functions and all document block types
- `src/core/index.ts` barrel export updated

## [0.2.0] — 2026-03-30

### Added

- **Tagged PDF (PDF/UA — ISO 14289-1)** — full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/P`) with marked content operators (`BDC`/`EMC`) and `/StructParents` on every page
- **/ActualText on all text spans** — original Unicode string attached as UTF-16BE hex to every `/Span` marked content sequence, solving text extraction for GPOS-repositioned glyphs (Thai, Devanagari, Vietnamese)
- **PDF/A-1b compliance (ISO 19005-1)** — XMP metadata stream with `pdfaid:part=1` + `pdfaid:conformance=B`, sRGB ICC OutputIntent, `/MarkInfo << /Marked true >>` on Catalog
- **New module `src/core/pdf-tags.ts`** — structure tree builder, MCID allocator, XMP metadata, OutputIntent, ICC profile
- **New public API exports** — `wrapSpan`, `wrapMarkedContent`, `escapePdfUtf16`, `createMCIDAllocator`, `buildStructureTree`, `buildXMPMetadata`, `buildOutputIntentDict`, `buildMinimalSRGBProfile`
- **Tagged text functions** — `txtTagged()`, `txtRTagged()`, `txtCTagged()` for marked content text rendering
- **New types** — `StructElement`, `MCRef` for structure tree building
- **`tagged` layout option** — `buildPDFBytes(params, { tagged: true })` enables all tagged/PDF/A features (backward-compatible)
- **45 new tests** for tagged PDF, structure tree, /ActualText, XMP metadata, ICC profile, marked content operators
- **Diverse sample PDFs** — 19 additional sample PDFs covering non-financial use cases and alphabet coverage

### Changed

- Total test count: **364 tests** across **15 test files** (was 319/14)
- Architecture: new dependency `pdf-tags.ts` in `src/core/`
- `pdf-builder.ts` now conditionally emits tagged PDF objects when `tagged: true`
- `pdf-text.ts` exports tagged variants alongside untagged functions

## [0.1.0] — 2026-03-30

### Added

- **Core PDF engine** — ISO 32000-1 (PDF 1.4) compliant document generation
- **Latin mode** — Helvetica built-in font with WinAnsi encoding
- **Unicode mode** — CIDFont Type2 / Identity-H with embedded TTF subsets
- **Multi-font support** — automatic cross-script fallback (Thai, CJK, Korean, Greek, Devanagari, Vietnamese, Polish, Turkish)
- **Thai OpenType shaping** — GSUB substitution + GPOS mark-to-base / mark-to-mark positioning
- **TTF subsetting** — identity-mapped glyph subsetter preserving compound components
- **Table layout** — auto-paginated table with header, data rows, info section, balance box, footer
- **Web Worker API** — off-main-thread PDF generation with configurable threshold and timeout
- **Font data module system** — `registerFont()` / `loadFontData()` for lazy-loaded Noto Sans variants
- **CLI tool** — `build-font-data.cjs` for converting TTF → importable JS data modules
- **Dual format** — ESM + CJS output via tsup with full `.d.ts` declarations
- **Zero dependencies** — no runtime `dependencies` in package.json
- **PDF /Info metadata** — Title, Producer (pdfnative), CreationDate in ISO D:YYYYMMDDHHmmss format
- **Input validation** — type checks, null/undefined guards, 100K row limit at `buildPDF()` boundary
- **Sample PDF generator** — `npm run test:generate` → 12 PDFs (10 languages + multi-lang + pagination)

### Testing & Quality

- **319 tests** across 14 test files (unit + integration + fuzz)
- **98.96% statement coverage** — v8 coverage with enforced thresholds (90/80/85/90)
- **33 fuzz tests** — edge-cases: injection attempts, null bytes, extreme strings, xref validation
- **Performance benchmarks** — vitest bench: Latin 500 rows ~10ms, Unicode ~13ms

### CI/CD

- **GitHub Actions CI** — lint → typecheck → test w/ coverage → build (Node 18/20/22 matrix)
- **NPM provenance** — `.github/workflows/publish.yml` with OIDC `id-token: write`
- **ESLint 9** — flat config with typescript-eslint strict
