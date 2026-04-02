---
description: "Use when writing tests, adding test coverage, creating test fixtures, or debugging test failures. Covers vitest patterns, PDF binary validation, and visual regression testing."
applyTo: "tests/**"
---
# Testing Standards

## Framework
- **vitest** — native ESM, fast watch mode, built-in coverage
- Run: `npm run test` (single run), `npm run test:watch` (watch), `npm run test:coverage`
- Config: `vitest.config.ts` (unit + integration + fuzz)
- Sample PDFs: `npm run test:generate` → `test-output/` (visual inspection, git-ignored)
- **Typecheck tests**: `npm run typecheck:tests` — uses `tsconfig.test.json` (includes `src/` + `tests/`)
- **Typecheck all**: `npm run typecheck:all` — runs both `tsc --noEmit` and `tsc --project tsconfig.test.json --noEmit`
- Test files must NOT use `@types/node` — use dynamic imports with string indirection for Node.js APIs (e.g., `const modName = 'node:zlib'; await import(modName)`)
- Test files must NOT use `createRequire` from `'module'` — use dynamic import pattern instead

## Test Organization
```
tests/
├── core/           # pdf-builder, pdf-text, pdf-stream, pdf-layout, pdf-annot, pdf-pdfa, pdf-encrypt, pdf-compress
├── fonts/          # encoding, font-loader, font-subsetter, font-embedder
├── shaping/        # thai-shaper, script-detect, multi-font, bidi, arabic-shaper
├── worker/         # worker-api
├── integration/    # full PDF generation end-to-end, pdf-compression
├── fuzzing/        # edge-case & adversarial input tests
└── fixtures/       # test data, sample fonts, expected outputs
scripts/
└── generate-samples.ts  # Multi-language PDF generator for manual inspection
```

## Current State (maintain these thresholds)
- **789 tests** across 26 test files + 1 benchmark file
- Statements: ~99% (threshold: 90%)
- Branches: ~91% (threshold: 80%)
- Functions: ~98% (threshold: 85%)
- Lines: 90% threshold
- Coverage excludes: barrel re-exports (`*/index.ts`), type definitions, `pdf-worker.ts`

## Test Patterns
- Name: `describe('functionName', () => { it('should ...', () => { ... }) })`
- One assertion per concept — split complex verifications into separate `it()` blocks
- Use `describe.each` / `it.each` for parameterized tests (e.g., multi-language encoding)
- No `any` in test code — type test inputs properly

## PDF-Specific Testing
- **Binary output**: verify `%PDF-1.4` header, `%%EOF` trailer, valid xref structure
- **Byte offsets**: parse xref, verify each offset points to `N 0 obj`
- **Font subsetting**: verify `.notdef` GID 0 present, `numGlyphs` matches subset, tables aligned
- **Text encoding**: WinAnsi → verify `(escaped)` format; CIDFont → verify `<hex>` format
- **Thai shaping**: test cluster boundaries, GSUB substitutions, GPOS anchor positions
- **Multi-font**: test font switching at script boundaries, continuation bias behavior

## Coverage Targets
- Statements: ≥90% overall (currently 98.96%)
- Core modules (`src/core/`): >95% (currently >99%)
- Font modules (`src/fonts/`): >90% (currently >99%)
- Shaping modules (`src/shaping/`): >90% (currently >95%)
- Worker module: 100% (via mock Worker pattern)
- All new code must include tests — do not regress thresholds

## Test Data
- Use minimal fixtures — smallest possible input that exercises the code path
- Font test data: use pre-built font data modules from `fonts/`
- For binary testing: create known-good PDF snippets as constants
- Never commit large binary fixtures — generate them in `beforeAll`

## Anti-Patterns
- Tests that depend on execution order
- Shared mutable state between tests (use `beforeEach` for fresh state)
- Testing implementation details instead of behavior
- Snapshot tests for binary output (fragile — use structural validation)

## Tagged PDF Testing
- Verify `/StructTreeRoot` reference in Catalog dictionary
- Verify `/MarkInfo << /Marked true >>` on Catalog
- Check `BDC` / `EMC` operator pairs — every BDC must have matching EMC
- Validate `/Span << /MCID n /ActualText <hex> >> BDC` format
- Verify `/ActualText` hex starts with `FEFF` BOM (UTF-16BE)
- Check `/StructParents` on every page object
- Verify structure tree hierarchy: `/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`
- Test with `{ tagged: true }` and `{ tagged: false }` — ensure backward compat
- PDF/A: verify XMP metadata stream contains `pdfaid:part` and `pdfaid:conformance`
- PDF/A: verify `/OutputIntents` array on Catalog

## Image Testing
- Use minimal hand-crafted JPEG/PNG fixtures (smallest valid files)
- JPEG: verify SOF marker parsing for width/height/components
- PNG: verify IHDR parsing for dimensions and color type
- Format detection: test JPEG, PNG, unknown, and too-short inputs
- XObject building: verify PDF dictionary contains `/Type /XObject /Subtype /Image`
- Image integration: verify `/XObject` in page resources and `Do` operator in content stream
- Tagged images: verify `/Figure` structure element and `/ActualText` when `alt` text provided
- No-image documents: verify `/XObject` is NOT in page resources

## Document Builder Testing
- Test each block type renders correct PDF operators
- Test pagination: blocks split across pages when exceeding available height
- Test `pageBreak` block forces new page
- Test title rendering on first page only
- Test footer rendering on all pages with correct page numbers
- Test Unicode mode with CIDFont entries
- Test tagged mode emits correct structure elements per block type
- Test `wrapText()` with various widths, edge cases, empty strings

## Link Annotation Testing
- Test `validateURL()`: valid http/https/mailto accepted, javascript:/file:/data: blocked
- Test `buildLinkAnnotation()`: PDF string format, /URI action, Rect formatting
- Test `buildInternalLinkAnnotation()`: /GoTo action with page reference
- Test `isLinkAnnotation()`: type guard for LinkAnnotation vs InternalLink
- Integration: verify `/Annots` array on page dict, annotation objects in PDF output
- Tagged links: verify `/Link` structure element in tagged mode
- Security: verify malicious URLs rejected, parentheses/backslashes properly escaped
- Multi-link pages: verify correct annotation-to-page grouping

## BiDi & Arabic/Hebrew Testing
- Test `classifyBidiType()`: L, R, AL, EN, AN, ES, ET, CS, WS, ON, NSM, BN classifications
- Test `detectParagraphLevel()`: first-strong-character P2/P3 rules
- Test `resolveBidiRuns()`: pure LTR, pure RTL, mixed, Hebrew, numbers in RTL, whitespace
- Test `containsRTL()`: Arabic, Hebrew, Latin, mixed, empty
- Test `reverseString()`: ASCII, Hebrew, empty string, single character
- Test `mirrorCodePoint()`: brackets, parentheses, guillemets, non-mirrored passthrough
- Test `containsArabic()` / `containsHebrew()`: positive and negative cases
- Test `isLamAlef()`: 4 alef variants with lam, non-lam pairs
- Test `shapeArabicText()`: empty, basic, GSUB substitution, isolated, harakat, lam-alef ligature
- Test BiDi encoding integration in encoding.test.ts: Arabic shaped data, non-zero width, hex format, glyph tracking
- Test Hebrew BiDi in encoding.test.ts: reversed glyph order, reversed hex in ps(), correct width

## PDF/A Testing
- Test `resolvePdfAConfig()`: false → disabled, true → pdfa2b, 'pdfa1b' → part 1, 'pdfa2u' → conformance U
- Verify `buildXMPMetadata(title, producer, date, part, conformance)`: check `pdfaid:part` and `pdfaid:conformance`
- Verify `buildOutputIntentDict(iccObjNum, subtype)`: check `/S /GTS_PDFA1` default and custom subtypes
- Integration: buildPDF with `tagged: true` → `%PDF-1.7`, `pdfaid:part>2`
- Integration: buildPDF with `tagged: 'pdfa1b'` → `%PDF-1.4`, `pdfaid:part>1`
- Backward compatibility: `tagged: false` produces same output as omitted

## Encryption Testing
- Crypto primitives: test MD5, SHA-256, AES-CBC against known RFC/NIST test vectors
- `computePermissions()`: default flags, custom flags, negative result (high bit set)
- `generateDocId()`: 16 bytes, uniqueness across calls
- `initEncryption()`: R4 (AES-128) state shape, R6 (AES-256) state shape, default algorithm
- `encryptStream()`: output length (IV + ciphertext), different outputs for different objects
- `encryptString()`: hex-encoded output format (`<...>`), object-specific output
- `buildEncryptDict()`: R4 contains /V 4 /R 4 /CFM /AESV2, R6 contains /V 5 /R 6 /CFM /AESV3 /OE /UE /Perms
- `buildIdArray()`: format `[<hex> <hex>]` with matching IDs
- Mutual exclusivity: tagged + encryption → throws error in both builders
- Integration: buildPDF with encryption → `/Type /Encrypt`, `/ID [<`, `/Encrypt N 0 R` in trailer
- Integration: buildDocumentPDF with encryption → same structural validation

## Compression Testing
- `adler32()`: known test vectors (“Wikipedia” → 0x11E60398), empty input, single byte, all-zeros, large input
- `deflateStored()`: valid zlib header (0x78 0x01), round-trip via `pako.inflate()`, multi-block (>65535), boundary (65535), overhead calculation, checksum
- `deflateSync()`: text compression, repetitive data, binary data, empty input, single byte, large 10K PDF operators
- `compressStream()`: binary string round-trip, repetitive text, CMap data, binary characters
- `uint8ToBinaryString()`: small arrays, empty, high bytes (≥0x80), large (100K+ without stack overflow), round-trip with `toBytes()`
- Integration — Table builder: `/FlateDecode` present/absent/default, valid PDF structure, size reduction, xref offset validity, decompression verification
- Integration — Document builder: `/FlateDecode` present, size reduction, valid structure
- Integration — Compressed + Encrypted: AES-128, AES-256, document builder (compress → encrypt order)
- Integration — Compressed + Tagged: tagged mode with compression, XMP metadata uncompressed (`skipCompress`), ICC profile compressed, document builder
- Size benchmarks: 100-row table with compression should achieve >30% size reduction versus uncompressed
- ESM init: `beforeAll(async () => { await initNodeCompression(); })` required for native zlib in vitest
