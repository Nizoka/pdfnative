# Roadmap

This document outlines the planned development direction for pdfnative. Priorities may shift based on community feedback and sponsorship.

## Released

- [x] **Core PDF generation** — table-centric builder with Helvetica (ISO 32000-1)
- [x] **11 Unicode scripts** — Thai, Japanese, Chinese, Korean, Greek, Devanagari, Turkish, Vietnamese, Polish, Arabic, Hebrew
- [x] **3 additional scripts** — Cyrillic (Russian), Georgian, Armenian (14 total)
- [x] **Bengali + Tamil shaping** — GSUB LookupType 4 ligature conjuncts, reph reordering, split vowel decomposition, GPOS mark positioning (16 scripts total)
- [x] **Devanagari OpenType shaping** — full cluster building, reph detection, matra reordering, split vowels, GSUB ligature conjuncts, GPOS mark positioning
- [x] **GSUB LookupType 4 extraction** — `build-font-data.cjs` parses LigatureSubst tables; font data modules include `ligatures` field
- [x] **Thai OpenType shaping** — GSUB substitution + GPOS mark positioning
- [x] **Arabic positional shaping** — GSUB isolated/initial/medial/final + lam-alef ligatures
- [x] **BiDi text layout** — Unicode Bidirectional Algorithm (UAX #9) with glyph mirroring
- [x] **Multi-font fallback** — automatic cross-script font switching with continuation bias
- [x] **TTF subsetting** — glyph-level subset for reduced file size
- [x] **Tagged PDF / PDF/A** — PDF/A-1b, 2b, 2u, 3b with structure tree, XMP metadata, sRGB ICC, embedded file attachments
- [x] **AES encryption** — AES-128 (V4/R4) and AES-256 (V5/R6) with granular permissions
- [x] **Document builder** — free-form API with headings, paragraphs, lists, tables, images, links
- [x] **Image embedding** — JPEG (DCTDecode) and PNG (FlateDecode) with auto-scaling
- [x] **Hyperlinks** — PDF link annotations with URL validation and tagged /Link
- [x] **FlateDecode compression** — zlib stream compression (50–90% size reduction)
- [x] **Web Worker support** — off-main-thread generation for large datasets
- [x] **Color safety** — validated hex/tuple/PDF operator inputs, injection-safe
- [x] **Community & governance** — CODEOWNERS, ROADMAP, Dependabot, CodeQL SAST
- [x] **Custom page sizes** — `PAGE_SIZES` constant (Letter, Legal, A3, Tabloid) + arbitrary `pageWidth`/`pageHeight`
- [x] **Header/footer templates** — `PageTemplate` with `left`/`center`/`right` zones, `{page}`/`{pages}`/`{date}`/`{title}` placeholders
- [x] **Page number formatting** — subsumed by header/footer templates via `{page}/{pages}` placeholders
- [x] **Watermarks** — text + image watermarks with configurable opacity, rotation, and position (background/foreground)
- [x] **Table of contents** — auto-generated TOC with internal `/GoTo` links, dot leaders, and page numbers
- [x] **Barcode & QR code generation** — Code 128 (ISO 15417), EAN-13 (ISO 15420), QR Code (ISO 18004), Data Matrix ECC 200 (ISO 16022), PDF417 (ISO 15438) — pure PDF path operators (no image dependency)
- [x] **SVG path rendering** — 7 SVG element types (path, rect, circle, ellipse, line, polyline, polygon) rendered as native PDF path operators
- [x] **Form fields** — AcroForm interactive fields (ISO 32000-1 §12.7): text, multiline, checkbox, radio, dropdown, listbox with appearance streams
- [x] **Digital signatures** — CMS/PKCS#7 detached signatures (ISO 32000-1 §12.8): RSA PKCS#1 v1.5 + ECDSA P-256, SHA-256/384/512, X.509 certificate parsing, zero-dependency crypto
- [x] **Streaming output** — AsyncGenerator-based progressive PDF emission with configurable chunk size (64 KB default), validation for TOC/template incompatibility, concatChunks utility
- [x] **PDF parser & modifier** — full PDF reader (tokenizer, object parser, xref table/stream, page tree, FlateDecode inflate) + incremental modification (non-destructive save with /Prev chain)
- [x] **npm metadata enrichment** — description enumerates 16 scripts + headline features (BiDi, PDF/A, encryption, signatures, AcroForm, barcodes, SVG); keywords expanded to 27 entries for npm search discoverability (v1.0.2)
- [x] **pdfnative-mcp** — Model Context Protocol server bridging pdfnative to AI clients (Claude Desktop, Cursor, Continue, Zed): 8 production tools (`generate_basic_pdf`, `add_table`, `add_barcode`, `add_international_text`, `add_form`, `embed_image`, `prepare_signature_placeholder`, `sign_pdf`), stdio/HTTP transport, sandboxed file output. See [pdfnative-mcp on GitHub](https://github.com/Nizoka/pdfnative-mcp)
- [x] **Watermark auto-fit** (v1.1.0) — text watermarks with aggressive `fontSize` + `angle` combinations are now scaled down so the rotated bounding box fits within the page. Default `autoFit: true`; opt-out via `autoFit: false` for byte-stable v1.0.x output. ([src/core/pdf-watermark.ts](src/core/pdf-watermark.ts))
- [x] **Unicode ellipsis** (v1.1.0) — `truncate()` and TOC truncation use `…` (U+2026) instead of `..` / `...` for professional typographic output (single grapheme cluster, ~50% narrower in Latin mode, identical glyph in CIDFont mode).
- [x] **Pixel-based truncation API** (v1.1.0) — new `truncateToWidth(str, maxWidthPt, sz, enc)` exported from the root for measurement-based string shortening that respects proportional font widths.
- [x] **Column min/max constraints** (v1.1.0) — additive `minWidth` / `maxWidth` (in points) on `ColumnDef`; constrained columns are clamped first, surplus or deficit is redistributed across unconstrained columns proportional to their `f` weight. Byte-identical to v1.0.5 when no constraint is set.
- [x] **Additional PDF decode filters** (v1.1.0) — `ASCII85Decode`, `ASCIIHexDecode`, `LZWDecode` (variable-width 9–12 bit), and `RunLengthDecode` in the parser module. Handles single-filter and multi-filter chain dispatch. ([src/parser/pdf-decode-filters.ts](src/parser/pdf-decode-filters.ts))
- [x] **Live version widget for the docs site** (v1.1.0) — zero-build, registry-fetched panel showing live versions of `pdfnative`, `pdfnative-cli`, `pdfnative-mcp`, plus the transitive `pdfnative` pin declared by each downstream package. Mounted on the homepage and both playgrounds. ([docs/assets/versions.js](docs/assets/versions.js))
- [x] **PDF/A Latin font embedding** (v1.1.0, [#28](https://github.com/Nizoka/pdfnative/issues/28)) — Noto Sans VF (OFL-1.1) bundleable as `pdfnative/fonts/noto-sans-data.js`. Opt-in via `registerFont('latin', …)`; activates automatically for PDF/A documents containing non-WinAnsi Latin (curly quotes, em-dash, ellipsis…). 4515 glyphs / 3094 cmap entries.
- [x] **UAX #9 isolates** (v1.1.0, [#25](https://github.com/Nizoka/pdfnative/issues/25)) — LRI / RLI / FSI / PDI (U+2066–U+2069) handled with full recursion via three-tier dispatcher (`resolveBidiRuns` → `resolveBidiRunsForced` → `resolveBidiCore`). Nested and unmatched isolates supported. ([src/shaping/bidi.ts](src/shaping/bidi.ts))
- [x] **Arabic GPOS MarkBasePos** (v1.1.0, [#25](https://github.com/Nizoka/pdfnative/issues/25)) — transparent marks (harakat: fatha, kasra, damma, sukun, shadda…) now anchor on the preceding base glyph using font-provided GPOS anchor data. ([src/shaping/arabic-shaper.ts](src/shaping/arabic-shaper.ts))
- [x] **Shared GSUB / GPOS drivers** (v1.1.0) — `src/shaping/gsub-driver.ts` (`tryLigature()`) and `src/shaping/gpos-positioner.ts` (`positionMarkOnBase()`) consolidate three duplicated implementations across Bengali, Tamil, Devanagari, and Arabic shapers.
- [x] **Monochrome emoji** (v1.1.0) — Noto Emoji (OFL-1.1) bundleable as `pdfnative/fonts/noto-emoji-data.js`. 1891 glyphs / 1489 cmap entries. Opt-in via `registerFont('emoji', …)`. Detection covers BMP/SMP emoji ranges, Fitzpatrick modifiers, ZWJ, and VS-15 / VS-16. Multi-font run splitting routes emoji codepoints automatically.
- [x] **Auto-fit column widths** (v1.1.0) — `TableBlock.autoFitColumns: true` derives column-width fractions from measured content widths. Honours per-column `minWidth` / `maxWidth` clamping. Default `false` for byte-stability. ([src/core/pdf-column-fit.ts](src/core/pdf-column-fit.ts))
- [x] **Cell clipping paths** (v1.1.0) — `TableBlock.clipCells: true` (default) wraps every header and data cell in `q <rect> re W n … Q` so variable-width content cannot escape its column rectangle visually. ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts))
- [x] **addSignaturePlaceholder API** (v1.2.0, [#45](https://github.com/Nizoka/pdfnative/issues/45)) — `addSignaturePlaceholder(pdfBytes, options?)` injects an AcroForm + invisible signature widget plus a `/Sig` dictionary into any existing PDF via incremental update (ISO 32000-1 §7.5.6). Idempotent on already-signed PDFs. Enables the one-call `signPdfBytes(addSignaturePlaceholder(buildDocumentPDFBytes(...)))` ergonomic. ([src/core/pdf-sig-placeholder.ts](src/core/pdf-sig-placeholder.ts))
- [x] **X.509 DN slice fix** (v1.2.0, [#46](https://github.com/Nizoka/pdfnative/issues/46)) — ASN.1 `decodeAt()` now recursively absolutises descendant offsets, so `parseCertificate()` issuer/subject `raw` slices correctly begin with the SEQUENCE tag `0x30`. Defensive assertion added at the `parseName()` boundary. CMS `IssuerAndSerialNumber` now parses in Adobe Reader and openssl-cms. ([src/crypto/asn1.ts](src/crypto/asn1.ts))
- [x] **Object-boundary page-by-page streaming** (v1.2.0) — `buildPDFStreamPageByPage()` and `buildDocumentPDFStreamPageByPage()` emit assembled PDFs as `AsyncGenerator<Uint8Array>` chunked at PDF object boundaries (`\nendobj\n`). ([src/core/pdf-stream-writer.ts](src/core/pdf-stream-writer.ts))
- [x] **UAX #9 embeddings** (v1.2.0) — `normalizeBidiEmbeddings()` rewrites LRE / RLE / LRO / RLO / PDF (U+202A–U+202E) to their sealed-isolate equivalents (max stack depth 125) before BiDi resolution. Invoked transparently from `resolveBidiRuns()`. ([src/shaping/bidi.ts](src/shaping/bidi.ts))
- [x] **USE-lite cluster classifier** (v1.2.0) — `classifyUseCategory(cp)` + `classifyClusters(cps)` return per-cluster `{ base, reph, prebase, postbase, premarks, postmarks }` with per-script tables for Devanagari / Bengali / Tamil. Public API ready; shaper rewire follows in v1.3.0. ([src/shaping/use-lite.ts](src/shaping/use-lite.ts))
- [x] **Smart tables** (v1.2.0) — planner-driven multi-page table rendering with auto-wrap on column overflow, repeated headers across page breaks, zebra striping, captions, and configurable minimum row height / cell padding. Six new optional `TableBlock` fields (`wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`). Tagged-mode `/Table` continues across slices via shared structure-tree accumulator (ISO 14289-1 §7.10.6). Single-page tables remain byte-identical to v1.1.0. ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts), [src/core/pdf-document.ts](src/core/pdf-document.ts), [docs/guides/tables.md](docs/guides/tables.md))
- [x] **COLRv1 colour emoji** (v1.3.0) — Noto Color Emoji (OFL-1.1) bundleable as a curated subset `pdfnative/fonts/noto-color-emoji-data.js` (221 colour glyphs). COLR v0 solid layers + COLR v1 linear / radial gradients rendered as native PDF Form XObjects (`/Shading` Type 2/3 + `/ExtGState` alpha). Opt-in via `registerFont('emoji', () => import('pdfnative/fonts/noto-color-emoji-data.js'))`; monochrome emoji unchanged when not registered. Self-rendered `glyf`/COLR parsers, zero dependency. ([src/core/color-emoji.ts](src/core/color-emoji.ts), [src/fonts/colr-parser.ts](src/fonts/colr-parser.ts))
- [x] **USE-lite shaper integration** (v1.3.0) — the v1.2.0 cluster classifier (`classifyUseCategory()`) is now the joiner-classification authority across the Devanagari, Bengali, and Tamil shapers, fixing nukta+virama, half-form / ZWJ-conjunct, Marathi eyelash-ra, and Bengali ya-phalaa edge cases (orphan ZWJ/ZWNJ no longer emit `.notdef`). ([src/shaping/use-lite.ts](src/shaping/use-lite.ts))
- [x] **True constant-memory streaming** (v1.3.0) — `buildPDFStreamTrue()` and `buildDocumentPDFStreamTrue()` assemble the PDF into raw parts and yield fixed-size `Uint8Array` chunks while freeing each part, so the fully-joined PDF binary never materialises in memory. Byte-identical to the buffered builders. ([src/core/pdf-stream-writer.ts](src/core/pdf-stream-writer.ts))
- [x] **Pixel-diff visual regression** (v1.3.0) — self-contained extreme-script fixtures (Tamil, Bengali+Devanagari, Arabic) guarded by both a glyph-position snapshot (show-operator GIDs + baselines) and a rendered-glyph pixel diff (self-rendered `glyf` rasteriser + zero-dependency grayscale PNG encoder, ≤1% tolerance). CI workflow gated on shaping/font/core changes. ([tests/visual/](tests/visual/), [.github/workflows/visual-regression.yml](.github/workflows/visual-regression.yml))
- [x] **UAX #9 X4–X5 overrides** (v1.3.0) — full character-level direction override tracking inside LRO / RLO scopes (`resolveBidiRuns()` now forces inner codepoints to L / R, not just the base direction). ([src/shaping/bidi.ts](src/shaping/bidi.ts))
- [x] **CP-1252 extended characters** (v1.3.0, [#48](https://github.com/Nizoka/pdfnative/issues/48)) — base-14 Helvetica text now carries a `/ToUnicode` CMap so the Windows-1252 high range (€ ‚ ƒ „ … † ‡ … ™ œ ž Ÿ) is correctly extractable/searchable; when a `latin` font is registered these glyphs also embed and render. ([src/fonts/encoding.ts](src/fonts/encoding.ts))
- [x] **Telugu script** (v1.3.0) — pure-JS GSUB/GPOS mini-shaper (`src/shaping/telugu-shaper.ts`): virama-mediated conjuncts, subjoined-consonant ligatures, above/below mark positioning (no reph, no pre-base reordering). Bundled font `pdfnative/fonts/noto-telugu-data.js` (Noto Sans Telugu, OFL-1.1). pdfnative now ships 17 OpenType-shaped scripts. ([src/shaping/telugu-shaper.ts](src/shaping/telugu-shaper.ts))
- [x] **Configurable document block limit** (v1.3.0) — `layout.maxBlocks` replaces the hard-coded 10 000-block cap, default raised to 100 000 (`DEFAULT_MAX_BLOCKS`). Large multi-thousand-page reports no longer hit a spurious ceiling. ([src/core/pdf-document.ts](src/core/pdf-document.ts))
- [x] **`validatePdfUA()` structural checker** (v1.3.0) — read-only ISO 14289-1 gate verifying `/MarkInfo`, `/StructTreeRoot` + `/ParentTree`, `/Metadata`, `/Lang`, and per-page `/MCID` uniqueness. Complements veraPDF. ([src/parser/pdf-ua-validator.ts](src/parser/pdf-ua-validator.ts))
- [x] **Colour-emoji robustness** (v1.3.0) — variation selectors (VS-15/16), ZWJ/ZWNJ, and Fitzpatrick skin-tone modifiers no longer leave `.notdef` tofu (`isZeroWidthFormat()` drop in `splitTextByFont()`); colour-glyph Form `/BBox` is computed from contour bounds so emoji are never clipped. ([src/shaping/multi-font.ts](src/shaping/multi-font.ts), [src/core/pdf-color-glyph.ts](src/core/pdf-color-glyph.ts))

## In Progress

_All v1.3.0 in-progress items have been merged into the [v1.3.0 release](release-notes/v1.3.0.md). See Released above._

## Planned

### v1.4.0

- [ ] **Document outline / bookmarks** — `/Outlines` tree for navigable PDF bookmarks (deferred from v1.3.0; the catalog object-numbering scheme is intricate and warrants isolated work).
- [ ] **Page labels** — `/PageLabels` for roman-numeral front matter and custom page numbering.
- [ ] **`streamToFile()` Node helper** — convenience wrapper writing a streaming builder directly to a `WriteStream` / file path.

### Long-Term

- [ ] **WASM acceleration** — optional WebAssembly module for font subsetting and compression
- [ ] **Full Universal Shaping Engine** — Khmer, Myanmar, complex Sinhala
- [ ] **COLRv1 advanced compositing** — sweep gradients + PaintComposite / PaintMask (Porter-Duff). v1.3.0 ships solid + linear + radial; advanced paints fall back to monochrome.

## How to Influence the Roadmap

- **Feature requests:** [Open an issue](https://github.com/Nizoka/pdfnative/issues/new?template=feature_request.md)
- **Sponsorship:** Sponsored features get prioritized. See [funding options](https://github.com/sponsors/Nizoka)
- **Pull requests:** Community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
