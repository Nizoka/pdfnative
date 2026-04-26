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

## In Progress

### v1.0.5 — PDF/A Latin font embedding (tracked from v1.0.4 veraPDF reports)

The v1.0.4 release fixed two upstream PDF/A defects (trailer `/ID`,
`/Info ↔ XMP` parity) and added a veraPDF CI guardrail. The largest
remaining defect — embedding the standard 14 Latin fonts when PDF/A is
requested — requires object-graph rewrites that exceed SemVer-patch
scope and is tracked here. See
[release-notes/draft-issue-v1.0.5-latin-embedding.md](release-notes/draft-issue-v1.0.5-latin-embedding.md)
for the full plan.

- [ ] **fonts(latin):** bundle a permissively-licensed Helvetica metric-compatible face as a pre-built data module
- [ ] **core(pdf-a):** emit Latin fonts as Font + FontDescriptor + FontFile2 triplet under PDF/A modes
- [ ] **core(pdf-a):** renumber object graph atomically across `pdf-builder.ts` and `pdf-document.ts`
- [ ] **core(pdf-a):** replace `helveticaWidth()` lookups with embedded-font widths when PDF/A is active
- [ ] **core(pdf-a):** audit `OutputIntent` / DefaultRGB cascade (rule 6.2.3.3)
- [ ] **tests(pdfa):** acceptance suite covering every PDF/A flavour
- [ ] **ci(verapdf):** workflow becomes blocking once embedding lands

### v1.1.0 — Deep OpenType shaping & BiDi (tracked from v1.0.3 baselines)

The v1.0.3 release shipped four extreme-script visual baselines under
`test-output/extreme/` that surface deeper shaping defects requiring
GPOS table re-extraction or new OpenType lookup implementations. These
exceed the scope of a SemVer-patch and are tracked here for v1.1.0.
See [release-notes/draft-issue-v1.1.0-shaping-epic.md](release-notes/draft-issue-v1.1.0-shaping-epic.md)
for the full root-cause analysis.

- [ ] **shaping(bidi):** full UAX #9 W1–W7 + N1/N2 + isolates (3+ script paragraphs)
- [ ] **shaping(common):** multi-pass GSUB driver for nested LookupType 4 ligatures
- [ ] **shaping(devanagari/bengali):** Universal Shaping Engine (USE)-lite cluster classification
- [ ] **shaping(arabic):** GPOS MarkBasePos for isolated harakat anchoring
- [ ] **fonts(thai):** re-extract GPOS anchors covering 3+ mark stacks on tall consonants
- [ ] **fonts(indic):** verify pre-built `ligatures` tables include deeply-nested chains
- [ ] **tests(visual):** pixel-diff regression on the four `extreme-*` baselines

## Planned

### Medium-Term

- [ ] **Pixel-based truncation** — truncate table cell text at the actual column width in PDF points (replace character-count truncation in `truncate()`)
- [ ] **Unicode ellipsis** — use `…` (U+2026) instead of `..` for professional typographic rendering
- [ ] **Auto-fit column widths** — scan input data to compute optimal `mx` per column automatically
- [ ] **Column min/max constraints** — optional `minWidth` / `maxWidth` in `ColumnDef` for fine-grained control
- [ ] **Cell clipping paths** — PDF clip rectangle per table cell (`q re W n … Q`) to prevent visual overflow
- [ ] **Constant-memory streaming** — page-by-page assembly for very large documents without buffering the full PDF
- [ ] **Additional PDF decode filters** — ASCII85Decode, LZWDecode support in the parser module

### Long-Term

- [ ] **WASM acceleration** — optional WebAssembly module for font subsetting and compression

## How to Influence the Roadmap

- **Feature requests:** [Open an issue](https://github.com/Nizoka/pdfnative/issues/new?template=feature_request.md)
- **Sponsorship:** Sponsored features get prioritized. See [funding options](https://github.com/sponsors/Nizoka)
- **Pull requests:** Community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
