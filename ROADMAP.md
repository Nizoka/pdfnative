# Roadmap

This document outlines the planned development direction for pdfnative. Priorities may shift based on community feedback and sponsorship.

## Released

- [x] **Core PDF generation** — table-centric builder with Helvetica (ISO 32000-1)
- [x] **11 Unicode scripts** — Thai, Japanese, Chinese, Korean, Greek, Devanagari, Turkish, Vietnamese, Polish, Arabic, Hebrew
- [x] **Thai OpenType shaping** — GSUB substitution + GPOS mark positioning
- [x] **Arabic positional shaping** — GSUB isolated/initial/medial/final + lam-alef ligatures
- [x] **BiDi text layout** — Unicode Bidirectional Algorithm (UAX #9) with glyph mirroring
- [x] **Multi-font fallback** — automatic cross-script font switching with continuation bias
- [x] **TTF subsetting** — glyph-level subset for reduced file size
- [x] **Tagged PDF / PDF/A** — PDF/A-1b, 2b, 2u with structure tree, XMP metadata, sRGB ICC
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

## In Progress

_No items currently in progress._

## Planned

### Medium-Term

- [ ] **SVG path rendering** — draw vector graphics via PDF path operators
- [ ] **Barcode/QR code generation** — pure PDF operator rendering (no image dependency)
- [ ] **Digital signatures** — CMS/PKCS#7 signatures for document authentication
- [ ] **PDF/A-3** — embedded file attachments in archival PDFs (ISO 19005-3)
- [ ] **Devanagari shaping** — GSUB conjuncts and matra reordering
- [ ] **Additional fonts** — Cyrillic, Georgian, Armenian, Bengali, Tamil

### Long-Term

- [ ] **PDF modification** — load and edit existing PDF files
- [ ] **Form fields** — AcroForm creation (text, checkbox, radio, dropdown)
- [ ] **Streaming output** — progressive PDF generation for very large documents
- [ ] **WASM acceleration** — optional WebAssembly module for font subsetting and compression

## How to Influence the Roadmap

- **Feature requests:** [Open an issue](https://github.com/Nizoka/pdfnative/issues/new?template=feature_request.md)
- **Sponsorship:** Sponsored features get prioritized. See [funding options](https://github.com/sponsors/Nizoka)
- **Pull requests:** Community contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
