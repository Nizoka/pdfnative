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
[![pdfnative-mcp](https://img.shields.io/npm/v/pdfnative-mcp?label=pdfnative-mcp&color=6366f1)](https://www.npmjs.com/package/pdfnative-mcp)
[![pdfnative-cli](https://img.shields.io/npm/v/pdfnative-cli?label=pdfnative-cli&color=0e7490)](https://www.npmjs.com/package/pdfnative-cli)
[![pdfnative-react](https://img.shields.io/npm/v/pdfnative-react?label=pdfnative-react&color=06b6d4)](https://www.npmjs.com/package/pdfnative-react)

Pure native PDF generation library — zero vendor dependencies. Conforms to ISO 32000-1 (PDF 1.7).

## Ecosystem

pdfnative ships as four coordinated packages — pick whichever entry point fits your workflow:

| Package | Latest | Use it for |
|---|:---:|---|
| [`pdfnative`](https://www.npmjs.com/package/pdfnative) | **v1.8.0** | The library itself — call from Node, browsers, Workers, Deno, Bun. |
| [`pdfnative-cli`](https://www.npmjs.com/package/pdfnative-cli) | **v1.4.0** | Render JSON → PDF, sign with the **complete PAdES ladder** (`sign --timestamp` B-T, `ltv` B-LT with air-gapped collect → embed, `doc-timestamp` B-LTA; RSA-SHA256/384/512 + ECDSA, native constant-time crypto by default), inspect, verify, **compare** (CI text + structure diff), signature-safe **metadata** edits, **merge / split / extract** pages, **annotate**, **govern** (AI-governance / HITL gate), declarative **batch `--manifest`** pipelines, and emit JSON Schemas from the shell. Pins pdfnative `^1.7.0`: 27 scripts + COLRv1 emoji, `--font math`, charts v2, print production, `render --strict` PDF/A gating, and an agent-native `--json`/`E_*`/`--dry-run`/`--summary` contract. Node ≥ 22. |
| [`pdfnative-mcp`](https://www.npmjs.com/package/pdfnative-mcp) | **v1.6.0** | Use pdfnative from Claude Desktop, Cursor, Continue, Zed (or any MCP client, stdio or HTTP) — **28 production tools** spanning the engine's full document model: all 13 block kinds in `generate_basic_pdf`, layout options, build-time `encrypt` that keeps the AcroForm, image watermarks, print production (page boxes, bleed, marks, `/UserUnit`, OutputIntent), charts v2 (stacked / area / scatter, dual axis, log & time scales), the complete PAdES ladder B-B → B-LTA (`sign_pdf` with RFC 3161 timestamps, `add_ltv`, `timestamp_pdf`, `verify_pdf ltv: true`), `update_metadata`, the read-only `inspect_layout` pagination preview, honest PDF/A (`embedFonts` / `strict` / diagnostics), six MCP prompts, token-frugal read modes (`verbosity` / `fields`), the network-free `draft_governance_issue` (AI-governance / HITL), and the MCP **2026-07-28** spec with automatic legacy fallback. No outbound request by default — the only permitted egress is operator-configured TSA / OCSP / CRL. Pins pdfnative `^1.7.0`. |
| [`pdfnative-react`](https://www.npmjs.com/package/pdfnative-react) | **v1.2.0** | Write PDFs as declarative JSX — `<Document>`, `<Page>`, `<Table>`, `<Barcode>`, `<Svg>`, `<FormField>`… compiled on-device to pdfnative blocks by a custom React 19 reconciler. Charts v2 (9 kinds, dual axes, log/time scales), print production (`<Document print>`), the PDF/A diagnostics channel (`layout.strict` / `onDiagnostic`), HTTP caching on `renderToResponse` (`etag` / `cacheControl`), 25 lint rules, client hooks & components (`usePdf`, `PDFViewer`, `PDFDownloadLink`), and a versioned `DocSpec` grammar (`docSpecSchema()`) for AI agents. Peer: pdfnative ^1.7.0, React ^19.0.0, Node ≥22. (A 1.6 engine would throw mid-render on the charts-v2 fields.) |

```bash
npm install pdfnative                 # library
npm install pdfnative pdfnative-react react   # React renderer (pdfnative + React 19 peers)
npm install -g pdfnative-cli          # CLI
npm install -g pdfnative-mcp          # MCP server
```

Detailed docs: [CLI guide](docs/guides/cli.md) · [MCP guide](docs/guides/mcp.md) · [React guide](docs/guides/react.md) · [Onboarding cheatsheet](docs/guides/onboarding.md).

## Highlights

- **Zero dependencies** — built from scratch in pure TypeScript. Zero runtime dependencies, tree-shakeable, auditable
- **Conforms to ISO 32000-1** — valid xref tables, /Info metadata, proper font embedding
- **27 Unicode scripts** — Thai, Japanese, Chinese (SC), Korean, Greek, Devanagari, Telugu, Turkish, Vietnamese, Polish, Arabic, Hebrew, Cyrillic, Georgian, Armenian, Bengali, Tamil, Sinhala, Tibetan, Khmer, Myanmar, Lao, Tai Tham (Lanna), New Tai Lue, Tai Le, Cham, Ethiopic
- **Universal Shaping Engine** — cluster categories derived from the Unicode Character Database, driving Tai Tham and Cham
- **Thai and Lao OpenType shaping** — GSUB substitution + GPOS mark-to-base + mark-to-mark positioning
- **Arabic positional shaping** — GSUB isolated/initial/medial/final forms + lam-alef ligatures
- **BiDi text layout** — Unicode Bidirectional Algorithm (UAX #9) with isolates (LRI/RLI/FSI/PDI) and explicit embeddings (LRE/RLE/LRO/RLO/PDF) including character-level X4–X5 overrides (v1.3.0). **v1.7.0** implements I1/I2 even embedding levels so digit runs (European, Arabic-Indic, Extended Arabic-Indic) keep logical order in RTL text, and full rule-L4 glyph mirroring through the complete 428-pair `BidiMirroring.txt` table
- **Indic OpenType engine** (v1.8.0) — Devanagari, Bengali, Tamil, Telugu and Sinhala share one engine that applies the font's own GSUB features per syllable in specification order (`rphf`, `half`, `blwf`, `pstf`, `vatu`, `cjct`, `pres` … `haln`, contextual lookups included) and attaches every vowel sign to the anchor its font declares: reph over the consonant after the base, half forms, subjoined consonants, pre-base matras in front. Fed by the `otl` layout tables every font module now carries; the words of a rendering report on the Hindi, Tamil and Telugu samples are golden tests on the bundled fonts
- **Latin combining marks** (v1.8.0) — free-standing marks (Yoruba ẹ́ ọ̀, Igbo ị́, NFD accents, Greek and Cyrillic diacritics) compose through the font's `ccmp` and GPOS anchors; Hausa, Yoruba, Igbo and Swahili render on the bundled `latin` module with no new font
- **USE-lite shaping** — `classifyUseCategory` / `classifyClusters` classify joiners for the Indic engine and the Khmer, Myanmar and Tibetan shapers (v1.3.0)
- **Colour emoji (COLRv1)** — opt-in Noto Color Emoji subset (**expanded to 1167 glyphs in v1.6.0**, ~4.5 MB with the v1.7.0 sequence ligatures, incl. the complete Transport & Map block); solid + linear + radial gradient layers rendered as native PDF Form XObjects; monochrome fallback when not registered (v1.3.0). Variation selectors, ZWJ/ZWNJ, and skin-tone modifiers no longer leave tofu, and glyph `/BBox` is computed from contour bounds so emoji are never clipped (v1.3.0). **Advanced compositing** (v1.4.0): COLRv1 sweep (conic) gradients render as native flat-shaded wedges, and `PaintComposite` separable blend modes (Multiply, Screen, Overlay, Darken, Lighten, …) map to PDF `/BM` ExtGState; structural Porter-Duff modes fall back to monochrome. **Flag & ZWJ sequences** (v1.7.0): 51 flags + 22 ZWJ sequences (families, professions, rainbow/pirate flags, …) resolve through the source font's GSUB into single colour ligature glyphs with a longest-match pre-pass — both VS-16 spellings match, uncovered sequences degrade to the historical per-codepoint rendering, and the CLI bundles any custom set (`--sequences`, `--sequence-list`, skin tones included). **Skin tones, transforms and masks** (v1.8.0): 30 gestures and people bundled in all five tones (1189 glyphs + 223 sequences, ~4.9 MB); every COLRv1 transform and variable paint is read, and `SRC_IN`/`DEST_IN` masks render as clipping paths, so flags keep their shaded wave. [Guide →](docs/guides/colour-emoji.md)
- **Multi-font fallback** — automatic cross-script font switching with continuation bias
- **TTF subsetting** — only used glyphs embedded (dramatic file size reduction)
- **Tagged PDF / PDF/A** — structure tree, /ActualText, XMP metadata, sRGB OutputIntent (PDF/A-1b, 2b, 2u, 3b with embedded file attachments). **Conformance guards** (v1.7.0): configurations that would break the declared PDF/A level (no embedded fonts, DeviceCMYK images) surface a diagnostic — `console.warn` by default, a custom `onDiagnostic` sink, or a thrown error under `strict: true`. **CMYK intents** (v1.8.0): CMYK and Gray OutputIntent profiles, with RGB content kept conforming through a calibrated `/DefaultRGB`. [Guide →](docs/guides/pdfa.md)
- **PDF Encryption (round-trip)** — **write** AES-128 (V4/R4) and AES-256 (V5/R6) encrypted PDFs (RC4 is never emitted), and **read** all of AES-128, AES-256, and legacy RC4 (V1–V4); owner + user passwords, granular permissions. **v1.6.0** adds a Standard Security Handler **decryptor** — `openPdf(bytes, { password })` decrypts transparently, the merge/split API ingests encrypted sources **and re-encrypts its output** (`MergeOptions.encrypt`, AES only, fresh keys) — closing the full *open → edit → re-secure* round trip. [Guide →](docs/guides/pdf-manipulation.md)
- **Native vector charts** (v1.6.0, **charts v2 in v1.7.0**) — bar, horizontal-bar, line, pie, donut, **stacked bars, area, and scatter** `chart` blocks rendered as pure PDF path operators (zero deps, no rasterisation); multi-series, legends, "nice" axis ticks, negative values, tagged `/Figure` + alt text. v1.7.0 adds a **secondary right axis**, **log and UTC-deterministic time scales**, **per-point data labels**, and x-label collision handling (automatic stride + `labelStride` / `labelRotation`). [Guide →](docs/guides/charts.md)
- **Text extraction** (v1.6.0) — `extractText()` decodes page content streams into per-page reading-order Unicode text plus optional positioned runs; `/ToUnicode` CMap, `/Encoding /Differences`, and WinAnsi/MacRoman decoding; works on encrypted documents (`{ password }`); hard `maxTextLength` memory cap for untrusted input. [Guide →](docs/guides/text-extraction.md)
- **Free-form document builder** — headings, paragraphs, lists (incl. **nested / hierarchical** bullet & numbered lists, v1.4.0), tables, images, barcodes, SVG paths, form fields, spacers, page breaks, table of contents. Configurable block limit via `layout.maxBlocks` (default 100 000) for very large reports (v1.3.0)
- **Smart tables** — multi-page slicing with repeated headers, auto-wrap on column overflow, zebra striping, captions, and smart auto-fit columns (v1.2.0), plus per-cell **borders** (`cellBorders`) and **vertical alignment** (`cellVAlign` / `ColumnDef.vAlign`, v1.4.0). [Guide →](docs/guides/tables.md)
- **Barcode & QR code generation** — Code 128, EAN-13, QR Code, Data Matrix, PDF417 — pure PDF path operators (no images)
- **SVG rendering** — path, rect, circle, ellipse, line, polyline, polygon as native PDF operators, plus `<text>` elements rendered as upright PDF text with `x`/`y` positioning and `text-anchor` (start/middle/end) support (v1.5.0)
- **AcroForm fields** — text, multiline, checkbox, radio, dropdown, listbox with appearance streams (ISO 32000-1 §12.7). **v1.6.0** adds **fill & flatten of existing forms**: `readFormFields()`, `fillForm()` (regenerates appearances), and `flattenForm()` — non-destructive incremental update that preserves prior signatures, **including on encrypted documents** (appended objects are encrypted under the document's existing scheme). [Guide →](docs/guides/form-filling.md)
- **Digital signatures** — CMS/PKCS#7 detached signatures with RSA (SHA-256/384/512, v1.7.0) + ECDSA-SHA256 (P-256) and X.509 parsing (ISO 32000-1 §12.8). One-call placeholder injection via `addSignaturePlaceholder()` (v1.2.0). Pluggable **native crypto provider** (`setCryptoProvider()` / `PdfSignOptions.provider`, v1.4.0) for constant-time, hardware-backed signing (`node:crypto` / Web Crypto / HSM). **v1.7.0**: PAdES baseline profile (`profile: 'pades'` — ESS signing-certificate-v2, `ETSI.CAdES.detached`), **multiple signatures** (`allowMultiple` + `fieldName` selector), and `listSignatures()` inspection. [Guide →](docs/guides/signatures.md)
- **Print production** (v1.7.0) — bleed/trim/art/crop **page boxes** (`layout.print`, with a one-line `bleed` shorthand), **crop & registration marks** drawn as pure vector operators outside the TrimBox, `/Trapped` metadata with XMP parity, print-dialog defaults (**duplex**, tray pick, page range, copies), caller-supplied **OutputIntent ICC profile** (tagged mode), and large-format `/UserUnit` (banners, plans). Boxes survive `mergePdfs`/`splitPdf`. Byte-identical output when unused. **CMYK & PDF/X-4** (v1.8.0): CMYK colours on every colour option (`[c, m, y, k]` in percent), CMYK and Gray OutputIntents with RGB content kept conforming, marks in the all-separation registration colour and clear of both the trim line and the sheet edge, opt-in **colour control bars** (`marks: { colourBars: true }`), marks tagged as a `/Page` artifact in accessible output, a `pdfx: 'pdfx4'` conformance claim, and `validatePdfX()` to check it. [Guide →](docs/guides/print.md)
- **Typography** (v1.8.0) — paragraphs that break across pages under **widow and orphan** rules, headings **kept with** what they introduce (with a `minLines` quota), opt-in **short-word binding** so a line never ends on "a" or "I", `align: 'justify'` written as one `TJ` array per line (spaces preserved for search and extraction), **optical margin** alignment, soft hyphens plus a `setHyphenationProvider()` seam with a document language, ISO 80000-1 **number–unit binding**, French and Canadian-French **punctuation spacing** (narrow no-break spaces rendered with a registered font), exact Adobe Core 14 **metrics**, GPOS pair **kerning** and OpenType single-substitution **features** (`onum`, `pnum`, `smcp`, …) with a diagnostic when a tag changes nothing. All opt-in under `layout.typography`; byte-identical when unset. [Guide →](docs/guides/typography.md)
- **Long-term validation (LTV, PAdES B-B → B-LTA)** (v1.7.0) — RFC 3161 **signature timestamps** (`signPdfBytesWithTimestamp()`), embedded revocation material in `/DSS` + per-signature `/VRI` (`addValidationInfo()` — OCSP RFC 6960 + CRL RFC 5280), and **document timestamps** (`addDocumentTimestamp()`). Network transport is injected (`TimestampProvider` / `RevocationProvider`) — the engine stays offline and zero-dependency; rejected or tampered TSA tokens are never embedded. [Guide →](docs/guides/ltv.md)
- **Streaming output** — AsyncGenerator-based progressive PDF emission with configurable chunk size, object-boundary page-by-page streaming, and **true constant-memory streaming** (`buildDocumentPDFStreamTrue()`, v1.3.0) where the full PDF binary never materialises. One-call `streamToFile()` drains any stream to disk with back-pressure and `AbortSignal` support (v1.4.0). [Guide →](docs/guides/streaming.md)
- **Document outline & page labels** — nested bookmarks (`/Outlines` tree, with bold/italic/colour, collapsible nodes via `open: false`, explicit or `outline: 'auto'` from headings) and logical page numbering (`/PageLabels`: decimal, roman, alpha, prefixes, custom start) (v1.4.0). [Guide →](docs/guides/outlines.md)
- **Viewer preferences** — `PdfLayoutOptions.viewerPreferences` controls initial `/PageLayout` & `/PageMode` plus the `/ViewerPreferences` dict (hide toolbar/menubar, fit/center window, display doc title, non-full-screen mode, reading direction, print scaling) — PDF/A-safe (v1.4.0). **v1.7.0** adds the print-dialog defaults: `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. [Guide →](docs/guides/viewer-preferences.md)
- **Font-data validator** — opt-in `validateFontData()` structurally checks custom font modules (SFNT magic, base64 integrity, cmap coverage, glyph-id range, width array, finite metrics) and returns `{ valid, errors, warnings }` (v1.4.0). [Guide →](docs/guides/font-validation.md)
- **PDF parser & modifier** — read existing PDFs (tokenizer, xref, object parser, FlateDecode inflate) + incremental modification. Read-only PDF/UA structural checker `validatePdfUA()` (ISO 14289-1: MarkInfo, StructTree, ParentTree, Lang, per-page MCID uniqueness) (v1.3.0), and its PDF/X-4 counterpart `validatePdfX()` (ISO 15930-7: header, XMP identification, OutputIntent profile, page boxes, embedded fonts, annotations, device colour) (v1.8.0). **Page-tree manipulation** (v1.4.0): `mergePdfs()`, `splitPdf()`, `extractPages()` rebuild a clean object graph (inherited attributes resolved, annotations/signatures optionally dropped, deterministic trailer `/ID`, bounded-depth copy, 256 MiB output cap via `maxOutputSize`). **Round-trip readers** (v1.5.0): `getPageLabels()` parses `/PageLabels` back into a typed `PageLabelRange[]`; `getAnnotations()` / `getPageRef()` read page annotations, and `PdfModifier.addAnnotation()` injects new ones incrementally. **v1.6.0**: a Standard Security Handler **decryptor** (`openPdf(bytes, { password })`, RC4/AES-128/AES-256) lets the reader and page-tree API ingest encrypted sources, and **constant-memory streaming** variants `streamMergedPdfs()` / `streamSplitPdf()` / `streamExtractPages()` emit merges/splits in fixed-size chunks (byte-identical to the buffered functions). [Guide →](docs/guides/pdf-manipulation.md)
- **Markup annotations** — typed annotation model (text, highlight, underline, strikeout, squiggly, square, circle, line, freetext) via `buildAnnotation()` / `buildAnnotationBody()`, plus `PdfReader.getAnnotations()` and `PdfModifier.addAnnotation()` for round-trip read/write (v1.5.0); **v1.6.0** lets `addAnnotation()` operate on encrypted documents (RC4/AES sources, annotations stored encrypted). [Guide →](docs/guides/annotations.md)
- **Layout debug & inspection** — opt-in `layout: { debug: true }` overlays margin / content / cell boxes for visual layout debugging; `inspectDocumentLayout()` returns a programmatic per-page block-geometry report. Byte-identical when debug is off (v1.5.0). [Guide →](docs/guides/debugging.md)
- **Math & technical symbols** — bundleable math font under lang `'math'`; mathematical operators, Greek, arrows, and technical symbols route automatically via script detection (v1.5.0)
- **Font-data tooling** — `pdfnative/tools` exposes `compileFontData()` / `parseFontData()` to build and introspect font-data modules programmatically (v1.5.0)
- **Image embedding** — JPEG (DCTDecode) and PNG (FlateDecode) with auto-scaling and alignment
- **Hyperlinks** — PDF link annotations (/URI) with URL validation, blue underlined text, tagged /Link
- **Header/footer templates** — configurable `PageTemplate` with left/center/right zones and `{page}`/`{pages}`/`{date}`/`{title}` placeholders
- **Watermarks** — text and image overlays with configurable opacity, rotation, and position (background/foreground)
- **Table of contents** — auto-generated TOC with internal /GoTo links, dot leaders, and page numbers
- **FlateDecode compression** — zlib stream compression (50–90% size reduction), zero-dependency, platform-native
- **Web Worker support** — off-main-thread generation for large datasets
- **Tree-shakeable** — ESM + CJS dual build with TypeScript declarations
- **Heavily tested** — 3748+ tests across 159 files, fuzz suite, dual-mode visual-regression suite, performance benchmarks; 91.5 % statement coverage measured at the v1.8.0 release, with CI enforcing ≥88% statements / 80% branches / 85% functions / 90% lines (vitest.config.ts)
- **NPM provenance** — signed builds via GitHub Actions OIDC
- **On-device generation** — runs in Node, browsers, Workers, Deno, Bun. No SaaS round-trip; documents never leave the calling process unless your application explicitly sends them
- **No telemetry, no network calls** — verifiable in source. The library never opens a socket, fetches remote fonts, or phones home
- **AI client integration** — use pdfnative from Claude Desktop, Cursor, Continue, and Zed via [`pdfnative-mcp`](https://github.com/Nizoka/pdfnative-mcp) — **28 production tools** (generate, tables, barcodes, forms, sign with the full PAdES ladder, verify, validate, attachments, extraction, inspect, metadata, layout preview, plus page-tree `merge_pdfs` / `split_pdf` / `extract_pages`)
- **Command-line interface** — render, sign, verify, inspect, and batch-render PDFs from the shell with [`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) — zero-config, scriptable, agent-native (`--json`/`E_*`/`--dry-run`), ideal for CI/CD pipelines
- **React renderer** — author PDFs as declarative JSX with [`pdfnative-react`](https://github.com/Nizoka/pdfnative-react): `<Document>`/`<Table>`/`<Barcode>` components, `usePdf`/`PDFViewer` client hooks, on-device rendering with no DOM or headless browser

## Installation

```bash
npm install pdfnative
```

**Requirements:** Node.js >= 22 | Modern browsers | Deno | Bun

## Documentation

- 🌐 **Website:** [pdfnative.dev](https://pdfnative.dev) — landing page, live in-browser demo with 12 examples, comparisons, benchmarks.
- 📘 **Quick Start:** [docs/guides/quickstart.md](docs/guides/quickstart.md) — Node.js, browser, Web Worker, streaming.
- 🏛️ **Architecture:** [docs/guides/architecture.md](docs/guides/architecture.md) — modules, builders, generation pipeline.
- ♿ **Accessibility:** [docs/guides/accessibility.md](docs/guides/accessibility.md) — tagged PDF, PDF/UA, PDF/A.
- ✍️ **Typography:** [docs/guides/typography.md](docs/guides/typography.md) — page breaking under widow and orphan rules, justification, hyphenation, spacing rules, kerning, OpenType features (v1.8.0).
- 🖨️ **Print production:** [docs/guides/print.md](docs/guides/print.md) — page boxes, printer's marks and colour bars, CMYK colours and OutputIntents, PDF/X-4 and `validatePdfX()`.
- ❓ **FAQ:** [docs/guides/faq.md](docs/guides/faq.md) — fonts, encryption, signatures, comparisons.
- 🤖 **Agentic workflows:** [docs/guides/agentic-workflows.md](docs/guides/agentic-workflows.md) — extend the engine at runtime (register fonts without a release) and embed agent-generated images.
- 🛠️ **Troubleshooting:** [docs/guides/troubleshooting.md](docs/guides/troubleshooting.md) — common pitfalls.
- 🎮 **Playgrounds:** twelve interactive demos at [docs/playgrounds/](docs/playgrounds/) — [typography](docs/playgrounds/typography.html) (each typographic option against the default), [print](docs/playgrounds/print.html) (bleed, CMYK, PDF/X-4 and its validation report), [extreme-scripts](docs/playgrounds/extreme-scripts.html) (live BiDi/Indic stress tests), [all-scripts](docs/playgrounds/all-scripts.html) (every Unicode script), [scale](docs/playgrounds/scale.html) (1k-100k pages, Web Worker + true streaming), [authoring-plus](docs/playgrounds/authoring-plus.html) (SVG text, layout overlay, annotations), [toolkit](docs/playgrounds/toolkit.html) (bookmarks, page labels, viewer prefs, merge/split/extract, and v1.6.0 form fill/flatten), [charts](docs/playgrounds/charts.html) (native vector charts — all 9 v1.7.0 types), [inspect](docs/playgrounds/inspect.html) (drop any PDF and read a full report, entirely client-side), plus [cli](docs/playgrounds/cli.html), [mcp](docs/playgrounds/mcp.html) and [react](docs/playgrounds/react.html) ecosystem explorers.
- 🧪 **Sample PDFs:** [scripts/generators/](scripts/generators/) — 292 sample PDFs across 38 categories (49 generators) (see [Sample PDFs](#sample-pdfs) below).
- 🎓 **Learn:** [docs/learn/](docs/learn/) — an eight-step guided path from installing the package to generating 100,000 pages, live at [pdfnative.dev/learn/](https://pdfnative.dev/learn/).
- 🤖 **Machine-readable:** [llms.txt](llms.txt) (doc index for LLMs), [AGENTS.md](AGENTS.md) (agent guidance), and [docs/assets/ecosystem.json](docs/assets/ecosystem.json) — the canonical manifest of ecosystem versions and counts, enforced by `npm run verify:docs`.

## Why pdfnative?

pdfnative was designed for teams that need **ISO-compliant, production-grade PDF generation** with zero supply-chain risk. Here is how it compares to other popular JavaScript PDF libraries:

| Feature | pdfnative | jsPDF | pdfkit | pdf-lib | pdfmake |
|---------|:---------:|:-----:|:------:|:-------:|:------:|
| Runtime dependencies | **0** | 3 | 6 | 4 | 3 |
| TypeScript declarations | Built-in | Built-in | @types/* | Built-in | @types/* |
| PDF/A (ISO 19005) | 1b, 2b, 2u, 3b | — | — | — | — |
| Tagged PDF / PDF/UA | ✅ | — | ✅ | — | — |
| Encryption (read + write) | AES-128/256 + RC4 read | write (RC4) | write | — | write |
| Complex text shaping (GSUB/GPOS) | ✅ Thai, Arabic, Devanagari, Bengali, Tamil, Telugu, Sinhala, Khmer, Myanmar, Tibetan, Lao, USE, Latin marks | — | Via fontkit | Via @pdf-lib/fontkit | Via pdfkit |
| BiDi (RTL) layout | ✅ | — | — | — | — |
| Modify existing PDFs | ✅ (incremental) | — | — | ✅ | — |
| Forms (create + fill + flatten) | ✅ all three | create | create | create + fill | — |
| Native charts (vector) | ✅ 9 kinds incl. stacked/area/scatter | — | — | — | — |
| Digital signatures | ✅ (RSA + ECDSA, PAdES) | — | — | — | — |
| LTV / timestamps (PAdES B-LTA) | ✅ RFC 3161 + /DSS | — | — | — | — |
| Print production (bleed/trim boxes, marks) | ✅ | — | — | — | — |
| Barcode / QR code (native) | ✅ 5 formats | — | — | — | QR |
| SVG path rendering | ✅ | Plugin | ✅ | Paths only | ✅ |
| Streaming output | ✅ | — | ✅ | — | ✅ |
| PDF parser | ✅ | — | — | ✅ | — |
| Tree-shakeable (ESM) | ✅ | — | — | ✅ | — |
| NPM provenance (SLSA) | ✅ | — | — | — | ✅ |

> **Data sources:** npm registry metadata and official README/documentation for each library, compared on **2026-07-28** (pdfkit 0.19.1, jsPDF 4.2.1, pdfmake 0.3.11, pdf-lib 1.17.1 — see [docs/data/comparison-2026-07-28.json](docs/data/comparison-2026-07-28.json)). Dependency counts reflect direct `dependencies` listed in each package's published manifest. "—" means the feature is not supported or not documented. Feature claims about third-party libraries are based on their public documentation and may not reflect the latest version — please verify against current releases. Sample PDFs validate with veraPDF (PDF/A) and Adobe Acrobat.

**When to choose another library:** You need advanced vector graphics (complex gradients, arbitrary transforms), rich interactive form scripting (JavaScript actions), or mature ecosystem integrations with existing toolchains.

**When to choose pdfnative:** You need zero-dependency PDF generation with ISO archival compliance (PDF/A), accessibility (tagged PDF), AES encryption, digital signatures, multi-script Unicode support — particularly Arabic/Hebrew BiDi and Thai GSUB/GPOS shaping — form fields, barcode generation, SVG rendering, or the ability to parse and incrementally modify existing PDFs.

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
  te: () => import('pdfnative/fonts/noto-telugu-data.js'), // v1.3.0
  si: () => import('pdfnative/fonts/noto-sinhala-data.js'), // v1.3.0
  bo: () => import('pdfnative/fonts/noto-tibetan-data.js'), // v1.3.0
  km: () => import('pdfnative/fonts/noto-khmer-data.js'), // v1.3.0
  my: () => import('pdfnative/fonts/noto-myanmar-data.js'), // v1.3.0
  am: () => import('pdfnative/fonts/noto-ethiopic-data.js'), // v1.3.0
  // v1.1.0+ — optional Latin fallback for PDF/A documents with curly quotes,
  // em-dash, ellipsis, etc. (activates automatically when needed). Since
  // v1.8.0 it also carries Hausa ɓ ɗ ƙ ƴ, Yoruba and Igbo tone marks (ẹ́ ọ̀ ị́)
  // and Swahili — no separate module or lang key for those languages:
  latin: () => import('pdfnative/fonts/noto-sans-data.js'),
  // v1.1.0+ — optional monochrome emoji:
  emoji: () => import('pdfnative/fonts/noto-emoji-data.js'),
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
| Hindi (Devanagari) | `hi` | Noto Sans Devanagari | Indic OpenType engine — conjuncts, reph, half forms, matras (v1.8.0) |
| Turkish | `tr` | Noto Sans Turkish | Latin extended (İ/ı) |
| Vietnamese | `vi` | Noto Sans Vietnamese | Latin + combining marks |
| Polish | `pl` | Noto Sans Polish | Latin extended (Ł/ł) |
| Arabic | `ar` | Noto Sans Arabic | GSUB positional shaping |
| Hebrew | `he` | Noto Sans Hebrew | Right-to-left script |
| Russian (Cyrillic) | `ru` | Noto Sans | Cyrillic alphabet |
| Georgian | `ka` | Noto Sans Georgian | Mkhedruli script |
| Armenian | `hy` | Noto Sans Armenian | Armenian alphabet |
| Bengali | `bn` | Noto Sans Bengali | Indic OpenType engine — conjuncts, reph, ya-phala, split vowels (v1.8.0) |
| Tamil | `ta` | Noto Sans Tamil | Indic OpenType engine — ligatures, pre-base and split vowels (v1.8.0) |
| Telugu | `te` | Noto Sans Telugu | Indic OpenType engine — subjoined consonants, vattu (v1.3.0; engine v1.8.0) |
| Sinhala | `si` | Noto Sans Sinhala | Indic OpenType engine — kombuva, rakaransaya, two-part vowels (v1.3.0; engine v1.8.0) |
| Hausa | `latin` | Noto Sans VF | Latin with ɓ ɗ ƙ ƴ ʼ — no dedicated module (v1.8.0) |
| Yoruba | `latin` | Noto Sans VF | Latin with ẹ ọ ṣ and combining tone marks, composed by the Latin-marks shaper (v1.8.0) |
| Igbo | `latin` | Noto Sans VF | Latin with ị ọ ụ ṅ and combining tone marks (v1.8.0) |
| Swahili | `latin` | Noto Sans VF | Plain Latin — renders with the base-14 fonts too (v1.8.0) |
| Latin (PDF/A) | `latin` | Noto Sans VF | WinAnsi-extended Latin (curly quotes, em-dash, ellipsis…) |
| Emoji | `emoji` | Noto Emoji | Monochrome emoji (BMP/SMP, Fitzpatrick, ZWJ, VS-15/16) |

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
  timeout: 30000, // Worker timeout in ms (default: 60000)
  onProgress: (percent) => console.log(`${percent}%`),
});
```

For lower-level control, use `generatePDFInWorker` directly with `WorkerGenerationOptions`:

```typescript
import { generatePDFInWorker } from 'pdfnative';
import type { WorkerGenerationOptions } from 'pdfnative';

const options: WorkerGenerationOptions = {
  timeout: 15000,
  onProgress: (percent) => console.log(`${percent}%`),
};

const pdf = await generatePDFInWorker(workerUrl, params, options);
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

All color values accept five formats — three RGB, two CMYK (v1.8.0):

| Format | Example | Description |
|--------|---------|-------------|
| Hex string | `'#2563EB'` or `'#26E'` | Primary format — `#RRGGBB` or `#RGB` |
| RGB tuple | `[37, 99, 235]` | Array with values 0–255 |
| PDF operator | `'0.145 0.388 0.922'` | Raw PDF RGB string (0.0–1.0) |
| CMYK tuple | `[100, 60, 0, 10]` | Four-element array, ink coverage in percent 0–100 (v1.8.0) |
| CMYK operand | `'1 0.6 0 0.1'` | Raw PDF CMYK string (0.0–1.0) (v1.8.0) |

```typescript
import { parseColor } from 'pdfnative';

parseColor('#2563EB');           // '0.145 0.388 0.922'
parseColor([37, 99, 235]);       // '0.145 0.388 0.922'
parseColor('0.145 0.388 0.922'); // '0.145 0.388 0.922'
parseColor([0, 0, 0, 100]);      // '0 0 0 1'  (CMYK, v1.8.0)
```

The component count decides the colour space: three components write `rg` / `RG`, four write `k` / `K`. All inputs are validated and normalized before interpolation into PDF content streams, preventing operator injection. Under a PDF/A or PDF/X claim whose OutputIntent is not CMYK, a CMYK colour raises `PDFA_DEVICE_CMYK_CONTENT` / `PDFX_DEVICE_CMYK` — see the [print guide](docs/guides/print.md#cmyk-colours-v180).

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

### Full colour-emoji coverage (`pdfnative-build-emoji-font`)

The bundled colour-emoji module (`pdfnative/fonts/noto-color-emoji-data.js`)
ships a lean curated subset to keep the package small. When you need glyphs
beyond that subset — up to the **full ~3,600-glyph** Noto Color Emoji set — a
second bundled binary generates a custom data module on demand, so even
**pdfnative-only** users get full coverage without the package ever carrying the
~32 MB source font:

```bash
# Download the pinned Noto Color Emoji (SHA-256 verified) and emit every glyph
npx pdfnative-build-emoji-font --download --all --out my-color-emoji-data.js

# …or build from a local TTF, selecting only the glyphs you need
npx pdfnative-build-emoji-font --ttf NotoColorEmoji-Regular.ttf \
  --codepoints "1F600,1F680,2764" --out my-color-emoji-data.js
```

Select glyphs with `--all`, `--preset`, `--codepoints`, or `--ranges`, then
register the generated module under lang `'emoji'`. See the
[Colour-emoji CLI guide](docs/guides/colour-emoji-cli.md).

## Agentic workflows

pdfnative is shaped so an AI agent can do more than *call* the engine — it can
**extend** it at runtime and **feed it content it generated itself**, without
waiting for a library release. Both patterns use already-shipped, public APIs.

**1. Extend the engine at runtime — no release required.** The font registry is a
runtime API. An agent can compile a TTF/OTF in memory and register it on the spot,
so a document renders the moment it needs a new script, symbol set, or brand font:

```js
import { registerFont, loadFontData, buildDocumentPDFBytes } from 'pdfnative';
registerFont('th', () => import('pdfnative/fonts/noto-thai-data.js'));
const th = await loadFontData('th');
if (!th) throw new Error('Thai font failed to load');
const bytes = buildDocumentPDFBytes({
  title: 'Thai demo',
  blocks: [{ type: 'paragraph', text: 'สวัสดีชาวโลก' }],
  fontEntries: [{ fontData: th, fontRef: '/F3', lang: 'th' }], // /F1 and /F2 are reserved
});
```

This is how the bundled **Noto Sans Math** font existed as a *working runtime
pattern* before it shipped as a default in v1.5.0. Use `compileFontData()` to emit
a reusable `*-data.js` module (byte-identical to `npx pdfnative-build-font`).

**2. Embed agent-generated images.** Image-generating agents (e.g. Antigravity,
ChatGPT, and other multimodal assistants) can pipe a generated PNG/JPEG straight
into a document — via the `image` block (library / CLI) or the `embed_image` MCP
tool. pdfnative parses and embeds it natively (no rasterization) and validates it
at the boundary.

Runtime extensibility is **not** autonomous modification of the published package:
the agent extends its own in-process instance; the repository is only ever changed
by a human under the [AI-governance / human-in-the-loop contract](docs/guides/ai-governance.md).
See the [Agentic workflows guide](docs/guides/agentic-workflows.md) for the full walkthrough.

## Visual PDF Inspection

<a id="sample-pdfs"></a>

Generate sample PDFs for all supported languages to visually verify output:

```bash
npm run test:generate
```

This creates **292 sample PDFs** in `test-output/` (git-ignored), organized in 38 categories produced by 49 generators (including `charts/` native vector charts, `bidi/` Persian and mirroring showcases, `signatures/` LTV pipelines, and `print/` prepress output added in v1.7.0).
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
| `sample-multi.pdf` | Mixed: all 27 scripts in one PDF |
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
| `alphabet-hausa.pdf` | Boko alphabet, hooked letters ɓ ɗ ƙ ƴ, digraphs, ʼy (v1.8.0) |
| `alphabet-yoruba.pdf` | ẹ ọ ṣ, tone marks on ẹ / ọ, syllabic ń ǹ (v1.8.0) |
| `alphabet-igbo.pdf` | ị ọ ụ ṅ, tone marks, digraphs (v1.8.0) |
| `alphabet-swahili.pdf` | Plain Latin — proof that no module is required (v1.8.0) |

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
| `doc-arabic.pdf` | Arabic one-page conformance document — stacked harakat, lam-alef, Persian/Urdu letters in mixed BiDi, Arabic-Indic digits (rewritten v1.8.0) |
| `doc-hebrew.pdf` | Hebrew one-page conformance document — niqqud, dagesh, shin/sin dots, mixed LTR (rewritten v1.8.0) |
| `doc-thai.pdf` | Thai one-page conformance document — tone marks over vowels, sara am, stacked marks (rewritten v1.8.0) |
| `doc-bengali.pdf` | Bengali one-page conformance document — reph, ya-phala, ra-phala, ক্ষ জ্ঞ, split vowels ো ৌ, chandrabindu (rewritten v1.8.0) |
| `doc-tamil.pdf` | Tamil one-page conformance document — ி after its consonant, ெ ே ை before, split ொ ோ ௌ, pulli, ரூ ஸ்ரீ ligatures (rewritten v1.8.0) |
| `doc-devanagari.pdf` | Hindi one-page conformance document — ि reordering, reph, rakar, half forms, क्ष ज्ञ त्र, nukta, anusvara, digits (rewritten v1.8.0) |
| `doc-telugu.pdf` | Telugu one-page conformance document — subjoined consonants, vattu, ై, anusvara, digits (rewritten v1.8.0) |
| `doc-sinhala.pdf` | Sinhala one-page conformance document — kombuva, rakaransaya ශ්‍රී, yansaya, two-part vowels, hal kirima (rewritten v1.8.0) |
| `doc-tibetan.pdf` | Tibetan one-page conformance document — consonant stacks, vowel signs, tsheg and shad (rewritten v1.8.0) |
| `doc-khmer.pdf` | Khmer one-page conformance document — coeng subscripts, pre-base vowels, series (rewritten v1.8.0) |
| `doc-myanmar.pdf` | Myanmar one-page conformance document — kinzi, medials, stacked consonants (rewritten v1.8.0) |
| `doc-amharic.pdf` | Amharic one-page conformance document — syllabary orders, ። ፣ punctuation, Ethiopic digits (rewritten v1.8.0) |
| `doc-hausa.pdf` | Hausa one-page conformance document — ɓ ɗ ƙ ƴ, capitals Ɓ Ɗ Ƙ Ƴ, ʼy, digraphs, on the `latin` module (v1.8.0) |
| `doc-yoruba.pdf` | Yoruba one-page conformance document — ẹ ọ ṣ, acute and grave tone marks on ẹ / ọ, syllabic ń ǹ (v1.8.0) |
| `doc-igbo.pdf` | Igbo one-page conformance document — ị ọ ụ ṅ with tone marks, digraphs (v1.8.0) |
| `doc-swahili.pdf` | Swahili one-page conformance document — plain Latin, numbers and dates (v1.8.0) |
| `doc-lao.pdf` | Lao one-page conformance document — leading vowels, tone marks over vowels, tall and descender variants, sara am, ຫຼ ໜ ໝ ligatures (v1.8.0) |
| `doc-taitham.pdf` | Northern Thai (Tai Tham) one-page conformance document — sakot stacks, pre-base vowels, medials, tone marks, Hora digits (v1.8.0) |
| `doc-newtailue.pdf` | Tai Lue (New Tai Lue) one-page conformance document — spacing vowels before and after, combining finals, tone letters (v1.8.0) |
| `doc-taile.pdf` | Tai Nüa (Tai Le) one-page conformance document — spacing vowels, tone letters, finals (v1.8.0) |
| `doc-cham.pdf` | Cham one-page conformance document — pre-base vowels, medials, finals, Cham digits (v1.8.0) |
| `doc-korean.pdf` | Korean one-page conformance document — precomposed syllables, complex batchim, compatibility jamo, Hanja, character-level wrapping (v1.8.0) |
| `doc-greek.pdf` | Greek one-page conformance document — tonos, dialytika, final sigma, polytonic, Greek punctuation (v1.8.0) |
| `doc-cyrillic.pdf` | Russian one-page conformance document — ё й щ, stress marks (U+0301), Ukrainian and Serbian letters, guillemets (v1.8.0) |
| `doc-georgian.pdf` | Georgian one-page conformance document — Mkhedruli, Mtavruli, Asomtavruli, Nuskhuri, consonant clusters (v1.8.0) |
| `doc-armenian.pdf` | Armenian one-page conformance document — both cases, և ligature, Armenian punctuation, dram sign (v1.8.0) |
| `doc-turkish.pdf` | Turkish one-page conformance document — İ ı, ğ ş ç ö ü, circumflex, capitalisation, lira sign (v1.8.0) |
| `doc-vietnamese.pdf` | Vietnamese one-page conformance document — six tones, stacked diacritics, ơ ư đ, capitals with tones, dong sign (v1.8.0) |
| `doc-polish.pdf` | Polish one-page conformance document — ogonek, kreska, ł ż, digraphs, pangram, low-high quotes (v1.8.0) |
| `doc-chinese-catalog.pdf` | Chinese product catalog (tables, ordering info) |
| `doc-multi-language.pdf` | Multi-language showcase: all 27 Unicode scripts in one PDF |
| `doc-invoice.pdf` | Invoice template (line items, totals, payment link) |
| `doc-report-multipage.pdf` | 3-page technical report (7 sections, 4 tables) |
| `doc-contract-bilingual.pdf` | Bilingual EN/AR contract (legal sections, signatures) |
| `doc-showcase-all-blocks.pdf` | All 13 block types in one PDF |

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

### Outline & Page Label Samples (v1.4.0)

| File | Content |
|------|---------|
| `outline/outline-explicit.pdf` | Nested bookmarks (`/Outlines`) + roman/decimal page labels |
| `outline/outline-auto.pdf` | `outline: 'auto'` — bookmarks derived from headings |
| `outline/page-labels.pdf` | Roman front matter + prefixed appendix page labels |

### PDF Manipulation Samples (v1.4.0)

| File | Content |
|------|---------|
| `manipulation/merged.pdf` | `mergePdfs()` — multiple documents combined |
| `manipulation/split-report.pdf` | `splitPdf()` — first page range |
| `manipulation/split-invoice.pdf` | `splitPdf()` — second page range |
| `manipulation/extract-reordered.pdf` | `extractPages()` — selected pages, reordered |
| `manipulation/streamed.pdf` | `streamToFile()` — document streamed straight to disk |

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

### SVG Rendering

| Function | Description |
|----------|-------------|
| `parseSvgPath(d)` | Parse SVG path `d` attribute into segments |
| `renderSvg(segments, options?)` | Render SVG segments (paths + `<text>`) as PDF operators |

### Markup Annotations

| Function | Description |
|----------|-------------|
| `buildAnnotation(annot, objNum)` | Build a full markup annotation indirect object (v1.5.0) |
| `buildAnnotationBody(annot)` | Build a markup annotation dictionary body (for the modifier) (v1.5.0) |

Supported `MarkupAnnotation` types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`.

### Layout Debug & Inspection

| Function | Description |
|----------|-------------|
| `inspectDocumentLayout(params, layout?)` | Return a programmatic per-page block-geometry `LayoutInspection` (v1.5.0) |

Enable the visual overlay via `layout: { debug: true }` or a granular `LayoutDebugOptions` (`showMargins` / `showContentBounds` / `showCells`). Byte-identical when debug is off.

### Font-Data Tools (`pdfnative/tools`)

| Function | Description |
|----------|-------------|
| `compileFontData(buffer, opts?)` | Compile a TTF/OTF `Uint8Array` into a font-data module source string (v1.5.0) |
| `parseFontData(buffer, opts?)` | Parse a TTF/OTF `Uint8Array` into a `FontDataObject` (metrics, cmap, widths, glyph coverage) (v1.5.0) |

### AcroForm Fields

| Function | Description |
|----------|-------------|
| `buildFormWidget(field, objNum, pageRef)` | Build form field widget annotation + appearance stream |
| `buildAcroFormDict(fieldRefs)` | Build `/AcroForm` dictionary for catalog |
| `buildRadioGroupParent(group)` | Build radio button group parent object |
| `buildAppearanceStreamDict(width, height)` | Build appearance stream dictionary |
| `defaultFieldHeight(type)` | Default height by field type |

### Digital Signatures

| Function | Description |
|----------|-------------|
| `buildSigDict(options)` | Build `/Sig` dictionary with ByteRange/Contents placeholders (`subFilter: 'ETSI.CAdES.detached'` for PAdES, v1.7.0) |
| `buildDocTimeStampDict(contentsSize?)` | Build a `/DocTimeStamp` dictionary variant (ISO 32000-2 §12.8.5, v1.7.0) |
| `signPdfBytes(pdf, options)` | Sign a PDF with CMS/PKCS#7 detached signature (`profile: 'pades'`, `digestAlgorithm`, multi-signature `fieldName` selector, v1.7.0) |
| `signPdfBytesWithTimestamp(pdf, options)` | Sign + embed a verified RFC 3161 signature timestamp (PAdES B-T, v1.7.0) |
| `listSignatures(pdf)` | Enumerate signature fields — SubFilter, ByteRange, /Contents, placeholder/timestamp flags (v1.7.0) |
| `collectValidationInfo(pdf, opts?)` | Gather certificates + OCSP/CRL material for every signature via the injected `RevocationProvider` (v1.7.0) |
| `embedValidationInfo(pdf, data)` | Write pre-collected LTV material as `/DSS` + `/VRI` — sync, offline, deterministic (v1.7.0) |
| `addValidationInfo(pdf, opts?)` | Collect + embed in one call (PAdES B-LT, v1.7.0) |
| `addDocumentTimestamp(pdf, opts?)` | Append a `/DocTimeStamp` revision (PAdES B-LTA, v1.7.0) |
| `estimateContentsSize(certSizes, algorithm?, opts?)` | Estimate `/Contents` size (`{ timestamp: true }` adds RFC 3161 headroom, v1.7.0) |
| `setCryptoProvider(provider)` | Install (or clear with `null`) a global native signature provider (v1.4.0) |
| `getCryptoProvider()` | Return the current global `CryptoProvider`, or `null` (v1.4.0) |
| `setTimestampProvider(provider)` / `getTimestampProvider()` | Global RFC 3161 transport — TimeStampReq bytes in, TimeStampResp bytes out (v1.7.0) |
| `setRevocationProvider(provider)` / `getRevocationProvider()` | Global OCSP/CRL transport (v1.7.0) |

### Streaming Output

| Function | Description |
|----------|-------------|
| `buildDocumentPDFStream(params, layout?, streamOpts?)` | Stream document PDF as `AsyncGenerator<Uint8Array>` |
| `buildPDFStream(params, layout?, streamOpts?)` | Stream table PDF as `AsyncGenerator<Uint8Array>` |
| `buildDocumentPDFStreamTrue(params, layout?, streamOpts?)` | **True constant-memory** document streaming — frees each part as it yields (v1.3.0) |
| `buildPDFStreamTrue(params, layout?, streamOpts?)` | **True constant-memory** table streaming (v1.3.0) |
| `buildDocumentPDFStreamPageByPage(params, layout?)` | Stream document PDF chunked at PDF object boundaries |
| `buildPDFStreamPageByPage(params, layout?)` | Stream table PDF chunked at PDF object boundaries |
| `validateDocumentStreamable(params, layout?)` | Validate document is compatible with streaming (no TOC, no `{pages}`) |
| `validateTableStreamable(params, layout?)` | Validate table is compatible with streaming |
| `chunkBinaryString(str, chunkSize)` | Split binary string into `Uint8Array` chunks |
| `concatChunks(chunks)` | Concatenate `Uint8Array` chunks into one |
| `streamByteLength(stream)` | Count total bytes from an async stream |
| `streamToFile(stream, filePath, opts?)` | Drain an `AsyncGenerator<Uint8Array>` to disk with back-pressure + `AbortSignal` (Node) — returns `{ bytesWritten, path }` (v1.4.0) |

### Crypto (Hashing, ASN.1, RSA, ECDSA, X.509, CMS)

| Function | Description |
|----------|-------------|
| `sha1(data)` | SHA-1 — `/VRI` keying and OCSP CertID identification only, never a security digest (v1.7.0) |
| `sha384(data)` / `sha512(data)` | SHA-384 / SHA-512 hash (FIPS 180-4) |
| `hmacSha256(key, data)` | HMAC-SHA-256 (RFC 2104) |
| `derDecode(data)` | Decode DER-encoded ASN.1 |
| `derSetOf(...values)` / `derGeneralizedTime(date)` | Canonical DER SET OF (X.690 §11.6) / GeneralizedTime encoder (v1.7.0) |
| `rsaSign(msg, key, digest?)` / `rsaVerify(msg, sig, key, digest?)` | RSA PKCS#1 v1.5 sign/verify — SHA-256/384/512 (digest param v1.7.0) |
| `ecdsaSign(hash, key)` / `ecdsaVerify(hash, sig, key)` | ECDSA P-256 sign/verify |
| `parseCertificate(der)` | Parse X.509 DER certificate — incl. SKI/AKI, EKU, AIA (OCSP/caIssuers URLs), CRL distribution points (v1.7.0) |
| `certHasEku(cert, oid)` | Check an extended-key-usage OID (v1.7.0) |
| `buildCmsSignedData(options)` | Build CMS SignedData — PKCS#7 or PAdES profile, SHA-256/384/512 (v1.7.0) |
| `parseCmsSignedData(der)` / `addUnsignedAttribute(cms, attr)` / `buildAttribute(oid, ...v)` | CMS inspection + unsigned-attribute surgery, signed bytes untouched (v1.7.0) |
| `buildTimestampRequest(imprint, opts?)` / `parseTimestampResponse(der)` / `parseTimestampToken(der)` / `verifyTimestampImprint(info, hash)` | RFC 3161 timestamp protocol (v1.7.0) |
| `buildOcspRequest(cert, issuer, opts?)` / `parseOcspResponse(der)` | OCSP RFC 6960 (v1.7.0) |
| `parseCrl(der)` / `isSerialRevoked(crl, serial)` | CRL RFC 5280 (v1.7.0) |
| `initCrypto()` | Initialize crypto module (lazy load) |

### PDF Parser & Modifier

| Function | Description |
|----------|-------------|
| `openPdf(bytes, opts?)` | Parse a PDF `Uint8Array` and return a `PdfReader`. Pass `{ password }` to open an encrypted document (RC4, AES-128, AES-256) |
| `createModifier(reader)` | Create an incremental `PdfModifier` from a `PdfReader` |
| `createTokenizer(data, offset?)` | Create a low-level PDF tokenizer |
| `parseValue(tok)` | Parse a single PDF value from token stream |
| `parseIndirectObject(tok)` | Parse an indirect object (`N M obj ... endobj`) |
| `findStartxref(data)` | Find `startxref` offset in PDF bytes |
| `parseXrefTable(data, offset)` | Parse xref table/stream at given offset |
| `isRef(v)` / `isDict(v)` / `isArray(v)` / `isStream(v)` | Type guards for parsed PDF values |
| `dictGet(dict, key)` / `dictGetName(dict, key)` | Dictionary value accessors |
| `inflateSync(data)` | Decompress FlateDecode data (zlib inflate) |
| `validatePdfUA(bytes)` | Read-only PDF/UA structural checker — returns `{ valid, errors, warnings }` (v1.3.0) |
| `mergePdfs(sources, opts?)` | Merge multiple PDFs into one, rebuilding a clean object graph; `opts.maxOutputSize` caps output at 256 MiB by default (v1.4.0); `opts.encrypt` re-encrypts the output (AES-128/AES-256, v1.6.0) |
| `splitPdf(src, ranges, opts?)` | Split a PDF into multiple documents by inclusive 0-based page ranges (v1.4.0) |
| `extractPages(src, indices, opts?)` | Extract specific pages (0-based) into a new PDF (v1.4.0) |
| `reader.getPageLabels()` | Parse an existing `/PageLabels` number tree into `PageLabelRange[]` or `null` (v1.5.0) |
| `reader.getAnnotations(pageIndex)` | Read a page's annotations into `ParsedAnnotation[]` (v1.5.0) |
| `reader.getPageRef(pageIndex)` | Get the indirect `PdfRef` for a page (v1.5.0) |
| `modifier.addAnnotation(pageIndex, body)` | Inject a new annotation on a page via incremental update (v1.5.0) |
| `extractText(bytes, opts?)` | Extract per-page reading-order Unicode text (+ optional positioned runs) from any PDF, incl. encrypted (`opts.password`); `ToUnicode`/`Differences`/WinAnsi/MacRoman decoding, hard `maxTextLength` memory cap (v1.6.0) |

### Document Block Types

| Type | Description |
|------|-------------|
| `HeadingBlock` | H1/H2/H3 with color, auto-wrapped |
| `ParagraphBlock` | Text with fontSize, lineHeight, align, indent, color |
| `TableBlock` | Headers + rows using PdfRow/ColumnDef |
| `ListBlock` | Bullet or numbered items; entries may be plain strings or nested `ListItem` `{ text, items }` for hierarchical lists (v1.4.0) |
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
| `resolvePdfAConfig(tagged)` | Resolve tagged option → PDF/A config (version, part, conformance) |
| `encodePdfTextString(str)` | Encode string as PDF text (PDFDocEncoding or UTF-16BE hex) |

### Encryption

Encryption is configured via the `encryption` option in layout options. Since v1.6.0 the reader side is public too — `openPdf(bytes, { password })` plus the `PdfPasswordError`, `PdfEncryptionUnsupportedError` and `PdfEncryptionInfo` exports.

```typescript
const pdf = buildPDFBytes(params, {
  encryption: { userPassword: 'secret', ownerPassword: 'admin', permissions: { print: true } }
});
```

### Color Utilities

| Function | Description |
|----------|-------------|
| `parseColor(input)` | Parse hex / RGB tuple / CMYK tuple / PDF string → validated PDF RGB **or CMYK** operand string (CMYK inputs since v1.8.0) |
| `resolveColor(input)` | Resolve any `PdfColor` to a `ResolvedColor` — `{ space: 'rgb' \| 'cmyk', operands }` (v1.8.0) |
| `fillOp(input)` / `strokeOp(input)` | Complete fill (`rg` / `k`) or stroke (`RG` / `K`) operator for any `PdfColor`, space chosen by component count (v1.8.0) |
| `isValidPdfRgb(str)` | Check if string is valid `"R G B"` format (0.0–1.0) |
| `normalizeColors(colors)` | Validate and normalize all fields in a PdfColors object |

Types (v1.8.0): `PdfCmykTuple` (`readonly [c, m, y, k]`, percent), `PdfCmykString` (`'c m y k'`, 0.0–1.0), `PdfColorSpace` (`'rgb' | 'cmyk'`), `ResolvedColor`. `PdfColor` is the union of every accepted form.

### Typography (v1.8.0)

Everything is opt-in under `layout.typography` (`TypographyOptions`) and byte-identical when absent. The helpers below are the same transforms the builder applies, exposed for text you lay out yourself.

| Function | Description |
|----------|-------------|
| `bindUnits(text, units?)` | Bind a number to the unit symbol that follows it with a no-break space (ISO 80000-1); `units` defaults to `DEFAULT_UNITS` |
| `bindShortWords(text, opts?)` | Bind one-letter words — or `{ maxLength, words }` — to the word that follows with a no-break space (house style, opt-in) |
| `applyPunctuationSpacing(text, rules)` | Turn the plain spaces around punctuation into no-break or narrow no-break spaces per `PunctuationSpacingRule[]` |
| `DEFAULT_UNITS` | Built-in unit-symbol list used by `bindUnits()` and `unitBinding: true` |
| `PUNCTUATION_SPACING_PRESETS` | The `'fr'` and `'fr-CA'` rule sets, keyed by `PunctuationSpacingPreset` |
| `setHyphenationProvider(fn)` / `getHyphenationProvider()` | Install (or clear with `null`) the process-wide `HyphenationProvider` — `(word, lang?) => readonly number[]` break indices, `lang` being `typography.hyphenationLanguage`; the library bundles no dictionary |

Types (block-level `keepWithNext` on headings and paragraphs, and `splittable` on paragraphs, override the document setting): `TypographyOptions` (`splitParagraphs`, `orphans`, `widows`, `keepHeadingsWithNext` — `true` or `{ minLines }`, `bindShortWords`, `unitBinding`, `punctuationSpacing`, `opticalMargins`, `metrics`, `fontFeatures`, `kerning`, `hyphenationLanguage`), `HyphenationProvider`, `UnitBindingOptions` (`{ units }`), `PunctuationSpacingRule` (`{ char, side, space }`), `PunctuationSpacingPreset` (`'fr' | 'fr-CA'`), `Base14Metrics` (`'approximate' | 'exact'`). A `fontFeatures` tag that changes nothing raises the `TYPOGRAPHY_FEATURE_INEFFECTIVE` diagnostic. [Guide →](docs/guides/typography.md)

### Print & PDF/X (v1.8.0)

| Function | Description |
|----------|-------------|
| `validatePdfX(bytes)` | Read-only PDF/X-4 structural checker (ISO 15930-7) — header, XMP identification, OutputIntent profile, page boxes, embedded fonts, annotations, actions, `LZWDecode`, transfer functions, device colour; returns `PdfXValidationResult` `{ valid, errors, warnings }`. Not a certified preflight |
| `PDF_X_CONFORMANCE_TARGETS` | `['pdfx4']` — the accepted `layout.pdfx` values, the single source of truth for downstream tooling; `PdfXConformanceTarget` is its element type |

Types: `PrintOptions` (`layout.print`: `bleed`, `trimBox`, `bleedBox`, `artBox`, `cropBox`, `marks`, `userUnit`), `PrinterMarksOptions` (`crop`, `registration`, `length`, `offset`, `weight`, `colourBars`), `ColourBarOptions` (`tints`, `size`), `CustomOutputIntent` (`iccProfile`, `outputConditionIdentifier`, `registryName`, `outputCondition`, `info` — RGB, CMYK or Gray), `PdfXConformanceTarget`, `PdfXValidationResult`. The build-time coherence errors a PDF/X claim can throw are listed verbatim in [docs/data/errors.json](docs/data/errors.json) (`buildErrors`). [Guide →](docs/guides/print.md)

### Reproducible builds (v1.8.0)

| Function | Description |
|----------|-------------|
| `setDefaultCreationDate(date)` | Pin the instant every subsequent build is stamped with when `layout.creationDate` is absent (`null` restores the wall clock) — fixes `/CreationDate`, `/ModDate`, the XMP dates and therefore the trailer `/ID`, so unencrypted output becomes a pure function of its inputs |
| `getDefaultCreationDate()` | The pinned date, or `null` |

**Reproducible bytes.** Precedence is `layout.creationDate`, then the pinned default, then `new Date()`. Every date is written in UTC with an explicit `+00'00'` offset (v1.8.0), so a pinned instant yields identical bytes on any host without a `TZ` pin. Encryption keys and IVs stay random by design; `PdfSignOptions.signingTime` and the modifier's modification dates keep their own options. `npm run verify:samples` is the byte-regression pattern a consumer can copy.

### Compression

| Function | Description |
|----------|-------------|
| `initNodeCompression()` | Initialize native zlib (async, call once in ESM before `compress: true`) |
| `setDeflateImpl(fn)` | Inject a synchronous **zlib-wrapped** (RFC 1950) deflate — fflate's `zlibSync`, pako's `deflate`, `node:zlib` `deflateSync`. Since v1.8.0 the result is validated and a raw-DEFLATE function throws at build time ([#78](https://github.com/Nizoka/pdfnative/issues/78)) |
| `setDeflateRawImpl(fn)` | Inject a synchronous **raw** DEFLATE (RFC 1951) compressor — fflate's `deflateSync`, zipnative, anything built for ZIP; pdfnative adds the zlib envelope itself (v1.8.0) |
| `wrapZlib(raw, source)` | Wrap a raw DEFLATE payload in the zlib envelope — 2-byte header plus an Adler-32 computed over `source`, the uncompressed input (RFC 1950 §2.2); the adapter `setDeflateRawImpl` applies (v1.8.0) |

**Browser compression** — In browser environments without native zlib, inject a synchronous third-party compressor. Pick the entry point that matches what the compressor returns:

```typescript
import { setDeflateImpl, setDeflateRawImpl, buildPDFBytes } from 'pdfnative';
import { zlibSync, deflateSync } from 'fflate'; // pako.deflate is zlib-wrapped too

setDeflateImpl(zlibSync);          // zlib-wrapped output (RFC 1950) — what /FlateDecode expects
// or, for a raw-DEFLATE function (RFC 1951): pdfnative wraps it with wrapZlib() for you
setDeflateRawImpl(deflateSync);

const pdf = buildPDFBytes(params, { compress: true });
```

Passing fflate's raw `deflateSync` to `setDeflateImpl()` — what the v1.7.0 README recommended — produced pages that rendered blank; v1.8.0 rejects it with an error naming the fix. `CompressionStream` cannot be adapted: it is asynchronous and PDF assembly is synchronous.

### Fonts

| Function | Description |
|----------|-------------|
| `registerFont(lang, loader)` | Register a font data loader |
| `registerFonts(map)` | Register multiple font loaders |
| `loadFontData(lang)` | Lazy-load font data (cached) |
| `hasFontLoader(lang)` | Check if loader is registered |
| `getRegisteredLangs()` | List registered language codes |
| `createEncodingContext(fontEntries)` | Create encoding context |
| `validateFontData(data)` | Opt-in structural validation of custom font data — returns `{ valid, errors, warnings }` (v1.4.0) |

Colour-glyph types (`ColorLayer`, `ColorPaint`, …) describe the bundled COLRv1 data; `ClipOutline` (v1.8.0) is one outline of a colour-layer clip — `{ glyphId, transform? }` — used by the `SRC_IN` / `DEST_IN` masks rendered as clipping paths.

### Shaping

| Function | Description |
|----------|-------------|
| `shapeThaiText(str, fontData)` | Thai OpenType shaping (GSUB + GPOS) |
| `shapeBengaliText(str, fontData)` | Bengali on the Indic OpenType engine — reph, ya-phala, conjuncts, split vowels (engine v1.8.0) |
| `shapeTamilText(str, fontData)` | Tamil on the Indic OpenType engine — pre-base and split vowels, ligatures (engine v1.8.0) |
| `shapeDevanagariText(str, fontData)` | Devanagari on the Indic OpenType engine — reph, rakar, half forms, conjuncts, matras (engine v1.8.0) |
| `shapeTeluguText(str, fontData)` | Telugu on the Indic OpenType engine — subjoined consonants, vattu (v1.3.0; engine v1.8.0) |
| `shapeSinhalaText(str, fontData)` | Sinhala on the Indic OpenType engine — kombuva, rakaransaya, two-part vowels (v1.3.0; engine v1.8.0) |
| `shapeLatinMarksText(str, fontData)` | Latin combining marks — `ccmp`, mark-to-base, mark-to-mark for Yoruba, Igbo and NFD text (v1.8.0) |
| `shapeTibetanText(str, fontData)` | Tibetan vertical subjoined stacking (v1.3.0) |
| `shapeKhmerText(str, fontData)` | Khmer USE-lite — coeng subscripts + pre-base vowels (v1.3.0) |
| `shapeMyanmarText(str, fontData)` | Myanmar USE-lite — medials + virama stacking (v1.3.0) |
| `shapeLaoText(str, fontData)` | Lao OpenType shaping — GSUB + GPOS mark positioning (v1.8.0) |
| `buildLaoClusters(str)` | Lao syllable clusters (base + marks) before shaping (v1.8.0) |
| `shapeUseText(str, fontData)` | Universal Shaping Engine — Tai Tham, Cham, and any registered font's script with no dedicated shaper (v1.8.0) |
| `splitUseSyllables(cps)` / `reorderUseCluster(cps)` | USE syllable segmentation (`UseSyllable[]`) and cluster reordering (v1.8.0) |
| `useCategory(cp)` / `useCategories(cps)` | USE cluster category of one codepoint / a sequence, from the tables generated out of the Unicode Character Database (v1.8.0) |
| `USE_UNICODE_VERSION` | The UCD version the generated USE data was derived from (v1.8.0) |
| `SCRIPT_SHAPERS` / `findShaper(text)` | The shaper registry (`readonly ScriptShaper[]`, in dispatch order) and its single dispatch — the first shaper whose script the text contains, or `null` (v1.8.0) |
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
| `containsTelugu(text)` | Detect Telugu content (v1.3.0) |
| `isTeluguCodepoint(cp)` | Telugu codepoint predicate (v1.3.0) |
| `containsSinhala(text)` / `containsTibetan(text)` / `containsKhmer(text)` / `containsMyanmar(text)` / `containsEthiopic(text)` | Detect script content (v1.3.0) |
| `isSinhalaCodepoint(cp)` / `isTibetanCodepoint(cp)` / `isKhmerCodepoint(cp)` / `isMyanmarCodepoint(cp)` / `isEthiopicCodepoint(cp)` | Codepoint predicates (v1.3.0) |
| `containsMath(text)` / `isMathCodepoint(cp)` | Detect / test mathematical symbols → lang `'math'` (v1.5.0) |
| `containsLao(text)` / `containsTaiTham(text)` / `containsNewTaiLue(text)` / `containsTaiLe(text)` / `containsCham(text)` | Detect script content (v1.8.0) |
| `isLaoCodepoint(cp)` / `isTaiThamCodepoint(cp)` / `isNewTaiLueCodepoint(cp)` / `isTaiLeCodepoint(cp)` / `isChamCodepoint(cp)` | Codepoint predicates (v1.8.0) |

Types (v1.8.0): `ScriptShaper` (`{ id, detect, shape }`), `UseClusterCategory`, `UseSyllable` (`{ type, start, end }`), `UseSyllableType`.

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
| `resolveTemplate(tpl, page, pages, title, date)` | Resolve header/footer template placeholders |

## Ecosystem

pdfnative ships as a library, but three official companion packages cover the most common non-library use cases — a CLI, an MCP server, and a React renderer. All live in separate repositories and depend on `pdfnative` only through the public API, so the core library stays zero-dependency.

### pdfnative-cli — command-line interface

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) v1.4.0 is the **official CLI**, built on `pdfnative` v1.7.0. It exposes 21 commands in five groups — create & edit (`render`, `fill`, `annotate`, `metadata`), page tree (`merge`, `split`, `extract`), security (`sign`, `verify`, `ltv`, `doc-timestamp`, `encrypt`, `decrypt`), read & extract (`inspect`, `extract-text`, `compare`), and automation & meta (`batch`, `doctor`, `schema`, `completion`, `govern`) — for use in shell scripts, Makefiles, GitHub Actions, and Docker images. Zero extra runtime dependencies, npm-provenance-signed, with a CycloneDX SBOM attached to every release. Requires Node ≥ 22.

**New in v1.1.0:** **27 Unicode scripts + COLRv1 colour emoji** through the `--font`/`--lang` shortcuts, **true constant-memory streaming** (`--stream-true`), a `--max-blocks` cap for very large documents, and a **PDF/UA (ISO 14289-1) structural validator** (`inspect --pdfua` / `--check pdfua`). It also adds an **agent-native contract** — a global `--json` status/error envelope, stable `E_*` error codes, a `--dry-run` validation mode, the new **`schema`** command (Draft 2020-12), and token-economy output projection (`--summary` / `--fields` + compact JSON) that cuts agent output ~90 %. **100 % backward-compatible.**

<!-- verify-docs:allow version-token (historical: CLI v1.2.0 shipped on the pdfnative 1.5.0 engine) -->
**New in v1.2.0:** five new commands — **`merge`**, **`split`**, **`extract`** (page-tree manipulation via pdfnative 1.5.0), **`annotate`** (markup annotations via incremental save, so existing signatures stay intact), and **`govern`** (the AI-governance / Human-in-the-Loop contract: `govern rules` / `govern policy` / `govern verify-issue`, with a stable `E_POLICY` error code). Plus PDF bookmarks (`--outline auto` or an explicit tree), the bundled math font (`--font math`), layout introspection (`--inspect-layout` / `--debug-layout`), and native constant-time crypto by default in `sign` (opt out with `--pure-crypto`).

**New in v1.3.0:** five more commands on the pdfnative 1.6 engine — **`fill`** (fill, flatten, and export existing AcroForms via incremental save, encrypted PDFs included), **`encrypt`** / **`decrypt`** (AES-128/256 re-securing and password removal; RC4 never emitted), **`extract-text`** (reading-order Unicode text as text/JSON/NDJSON, `--runs`, `--password`), and **`doctor`** (offline environment preflight). Also native vector charts in `render`, `--password` + `--encrypt` re-encryption on merge/split/extract, an agent capability manifest (`schema manifest` + `llms.txt`), and PowerShell completion.

**New in v1.4.0:** the **complete PAdES ladder** from the shell — `sign --timestamp <tsa-url>` (RFC 3161, B-T), **`ltv`** (B-LT `/DSS`; `collect` gathers revocation evidence as replayable JSON so `embed` can run fully offline in air-gapped environments), and **`doc-timestamp`** (B-LTA document-timestamp revisions) — plus **`metadata`** (signature-safe `/Info` + XMP edits), **`compare`** (text + structure diff with CI exit codes), **`batch --manifest`** declarative pipelines with `@id` references and an `--allow-network` opt-in, `render --strict` PDF/A gating, `inspect --signatures`, RSA-SHA384/512, and a global `--max-inflate-size` zip-bomb cap. Every network path is an explicit opt-in behind an SSRF guard. Requires pdfnative ≥ 1.7.0, Node ≥ 22.

```bash
# render with full layout coverage (encryption + watermark + PDF/A-2b)
npx pdfnative-cli render --input doc.json --output report.pdf \
  --tagged pdfa2b --compress \
  --watermark-text "DRAFT" --watermark-opacity 0.15

# sign with metadata and intermediate cert chain
npx pdfnative-cli sign --input report.pdf --output signed.pdf \
  --reason "Approved" --name "Finance Team" \
  --signing-time 2026-04-28T10:00:00Z \
  --cert-chain intermediate.pem

# verify embedded signatures (byte-range + chain + trust + revocation)
npx pdfnative-cli verify --input signed.pdf --strict --trust ca-root.pem

# inspect with CI assertions, incl. PDF/UA accessibility gate (exit 1 on failure)
npx pdfnative-cli inspect --input signed.pdf \
  --check pdfa --check signed --check pdfua --json --summary
```

<!-- verify-docs:allow version-token (pdfnative-cli's own current version, not the engine) -->
See the [CLI Guide](https://pdfnative.dev/guides/cli.html) for the full v1.4.0 reference, agent contract, security model, and recipes. Try the [interactive CLI playground](https://pdfnative.dev/playgrounds/cli.html) to build commands without leaving the browser.

### pdfnative-mcp — Model Context Protocol server

[`pdfnative-mcp`](https://github.com/Nizoka/pdfnative-mcp) v1.6.0 is a **Model Context Protocol server** that bridges pdfnative to any MCP-compatible AI client. Once configured, your AI assistant can generate PDFs and native vector charts, embed barcodes, create, read, fill and flatten forms, sign documents through the complete PAdES ladder (B-B → B-LTA with RFC 3161 timestamps and embedded revocation material), verify signatures and document timestamps, encrypt and decrypt PDFs, validate PDF/UA structure, embed and extract attachments, extract Unicode text, render international text, merge, split and extract pages, annotate existing PDFs, rewrite document metadata, preview pagination without producing a PDF, draft governance-compliant GitHub issues (human-in-the-loop), and inspect existing PDFs — all without writing code.

<!-- verify-docs:allow stale-token (historical: MCP v1.0.0 shipped 12 tools) -->
**v1.0.0:** first stable MCP release with 12 tools, `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD PDF/A-3), `extract_text`, smart-table options, auto-placeholder signing, and `_meta.apiVersion`.

**v1.1.0:** adds `validate_pdf`, six additional scripts (Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic), and COLRv1 colour-emoji support via the pdfnative 1.3.0 engine. <!-- verify-docs:allow version-token (historical engine reference) -->

**v1.2.0:** adds `extract_attachments`, watermark options on document tools, Unicode `normalize` (NFC/NFD/NFKC/NFKD), token-frugal read modes (`verbosity`/`fields`), and returns base64 PDF bytes once via a `resource` block.

**v1.3.0:** adds the page-tree trio `merge_pdfs` / `split_pdf` / `extract_pages` (**17 tools** total)<!-- verify-docs:allow stale-token (historical: MCP v1.3.0 total) -->, enriched authoring options (`outline`, `pageLabels`, nested lists, `viewerPreferences`, `cellBorders`, `cellVAlign`), a constant-time `node:crypto` signing provider, and DNS-rebinding protection on the HTTP transport — all via the pdfnative 1.4.0 engine.

**v1.4.0:** adds `annotate_pdf` (markup via incremental update) and the network-free `draft_governance_issue` (**19 tools**)<!-- verify-docs:allow stale-token (historical: MCP v1.4.0 total, on the pdfnative 1.5.0 engine) -->, the MCP `prompts` capability (`governance_contract`, `draft_issue_workflow`), `pageLabels[]` in `inspect_pdf`, and the explicit `math` script — via the pdfnative 1.5.0 engine.

**v1.5.0:** adds `add_chart`, `read_form_fields`, `fill_form`, `encrypt_pdf`, `decrypt_pdf` (**24 tools**)<!-- verify-docs:allow stale-token (historical: MCP v1.5.0 total) -->, `password` support on the read-only and page-tree tools, MCP resources (`pdfnative://output/…`), and tool annotations — via the pdfnative 1.6.0 engine.

**v1.6.0:** adds `add_ltv`, `timestamp_pdf`, `update_metadata`, `inspect_layout` (**28 tools**), all 13 block kinds in `generate_basic_pdf`, layout options and build-time `encrypt` on the document tools, image watermarks, print production, charts v2, honest PDF/A (`embedFonts` / `strict` / diagnostics), PAdES timestamps on `sign_pdf`, four new recipe prompts, and the MCP 2026-07-28 spec — via the pdfnative 1.7.0 engine. <!-- verify-docs:allow version-token (historical engine reference) -->

```bash
npx -y pdfnative-mcp
```

### Available tools

| Tool | Purpose |
|------|---------|
| `generate_basic_pdf` | Multi-page documents from structured blocks — all 13 block kinds since v1.6.0 (incl. tables, images, links, TOC, barcodes, SVG, form fields); optional `outline`, `pageLabels`, `pdfA`, layout options, build-time `encrypt`, print production |
| `add_table` | Smart tables (`wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`, `cellBorders`, `cellVAlign`) |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 |
| `add_international_text` | 25 `lang` font codes (27 Unicode scripts + `latin` + `emoji` + explicit `math`) with BiDi and OpenType shaping |
| `add_form` | Interactive AcroForm PDFs (`text`, `textarea`, `checkbox`, `radio`, `dropdown`, `listbox` since v1.6.0) |
| `embed_image` | Embed a JPEG or PNG image (base64), with `align` / `alt` since v1.6.0 |
| `prepare_signature_placeholder` | PDF with a `/Sig` field ready to be signed (optional — `sign_pdf` auto-injects one); `subFilter` / `reserveTimestamp` since v1.6.0 |
| `sign_pdf` | PAdES CMS signatures (RSA-SHA256/384/512 / ECDSA-SHA256 P-256); `profile: 'pades'`, RFC 3161 `timestamp`, cert chains, multiple signatures since v1.6.0 |
| `add_ltv` | Embed `/DSS` + `/VRI` long-term-validation material — PAdES B-LT (v1.6.0) |
| `timestamp_pdf` | Append a `/DocTimeStamp` through the operator TSA — PAdES B-LTA (v1.6.0) |
| `validate_pdf` | Read-only PDF/UA structural validation |
| `verify_pdf` | Verify every PAdES signature and `/DocTimeStamp` (integrity + value + optional chain trust; `ltv: true` reports the achieved PAdES level since v1.6.0) |
| `add_attachment` | PDF/A-3 with embedded files (Factur-X / ZUGFeRD) |
| `extract_attachments` | Extract embedded files (optionally metadata-only) |
| `extract_text` | Unicode text extraction (positioned runs; `password` since v1.5.0) |
| `merge_pdfs` | Concatenate 2–50 PDFs (encrypted sources via `password`; re-encrypt since v1.5.0) |
| `split_pdf` | Split one PDF into one document per page range |
| `extract_pages` | Pull an arbitrary, order-preserving page subset into a new PDF |
| `annotate_pdf` | Overlay markup annotations (9 types) via incremental update; not a redaction |
| `draft_governance_issue` | Governance-compliant GitHub-issue draft, network-free, never submits (HITL) |
| `add_chart` | Native vector charts, zero rasterisation — nine types since v1.6.0 (bar, horizontal bar, stacked bar, stacked horizontal bar, line, area, scatter, pie, donut), dual axis, log & time scales |
| `read_form_fields` | List an existing AcroForm's fields (types, values, options) |
| `fill_form` | Fill and optionally flatten an existing AcroForm (encrypted PDFs supported) |
| `encrypt_pdf` | Re-secure with AES-128/AES-256, owner/user passwords + permissions |
| `decrypt_pdf` | Remove encryption in-server (RC4 / AES-128 / AES-256 sources) |
| `update_metadata` | Rewrite `/Info` (+ XMP) of an existing PDF via incremental update (v1.6.0) |
| `inspect_pdf` | Structured report (metadata, pages, signatures, PDF/A, attachments, `encryptionInfo`, `pageLabels`; annotation and signature inventories, `dss`, page boxes since v1.6.0) |
| `inspect_layout` | Read-only pagination dry run — page count and block geometry, no PDF produced (v1.6.0) |

### Claude Desktop configuration

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

See the [MCP Integration Guide](https://pdfnative.dev/guides/mcp.html) and the [pdfnative-mcp repository](https://github.com/Nizoka/pdfnative-mcp) for configuration on Cursor, Continue, Zed, and more.

### pdfnative-react — declarative JSX renderer

[`pdfnative-react`](https://github.com/Nizoka/pdfnative-react) v1.2.0 turns declarative **JSX** into real, on-device PDFs powered by the zero-dependency pdfnative engine — no DOM, no headless browser, no SaaS round-trips. A custom React reconciler compiles your component tree synchronously into the pdfnative block model. v1.2.0 (peer `pdfnative ^1.7.0`) follows the 1.7.0 engine: charts v2 (9 kinds, secondary axis, log/time scales, data labels), print production via `<Document print>`, the PDF/A diagnostics channel (`layout.strict` / `onDiagnostic`), HTTP caching on `renderToResponse` (`etag` / `cacheControl`), and 25 lint rules — all additive. Requires **React 19**, **pdfnative ^1.7.0** and **Node.js ≥ 22**. React and pdfnative are peer dependencies; the package itself adds one runtime dependency, `react-reconciler`. The pdfnative engine remains dependency-free.

```tsx
import { Document, Heading, Text, Table, renderToBytes } from 'pdfnative-react';

const bytes = renderToBytes(
  <Document title="Invoice #1024" footerText="Acme Inc">
    <Heading level={1}>Invoice #1024</Heading>
    <Text>Thank you for your business.</Text>
    <Table
      headers={['Item', 'Qty', 'Total']}
      rows={[{ cells: ['Pro plan', '1', '$49.00'], type: 'default', pointed: false }]}
      zebra
    />
  </Document>,
); // → Uint8Array, a valid PDF
```

Every component (`Document`, `Page`, `Section`, `Heading`, `Paragraph`/`Text`, `List`/`Item`, `Table`/`Row`/`Cell`, `Image`, `Link`, `Spacer`, `PageBreak`, `TableOfContents` (alias `Toc`), `Barcode`, `Svg`, `Chart`, `FormField`) maps 1:1 onto a pdfnative block. Render with `renderToBytes` / `renderToBlob` / `renderToStream` / `renderToFile` / `renderToFileStream` / `renderToResponse`, introspect with `inspectDocument` / `lintDocument`, preview live with the `usePdf` / `usePdfStream` hooks and `PDFViewer` / `PDFDownloadLink` / `BlobProvider` client components, or let AI agents author documents with the token-frugal `DocSpec` (terse JSON tuples that compile to the *same* PDF, validated by a versioned JSON Schema).

See the [React Guide](https://pdfnative.dev/guides/react.html) for the full component reference, and try the [interactive React playground](https://pdfnative.dev/playgrounds/react.html) to render JSX to PDF in your browser.

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
│   ├── indic-engine.ts   # Indic OpenType engine (Devanagari, Bengali, Tamil, Telugu, Sinhala configs)
│   ├── bengali-shaper.ts # Bengali cluster analysis + engine config
│   ├── tamil-shaper.ts   # Tamil cluster analysis + engine config
│   ├── latin-marks.ts    # Latin combining marks (ccmp + GPOS anchors)
│   ├── script-detect.ts  # Unicode script range detection (uses script-registry)
│   ├── multi-font.ts     # Cross-script font run splitting
│   ├── bidi.ts           # Unicode Bidirectional Algorithm (UAX #9)
│   └── arabic-shaper.ts  # Arabic GSUB positional shaping (uses script-registry)
└── worker/
    ├── worker-api.ts     # Worker/main-thread dispatch
    └── pdf-worker.ts     # Self-contained worker entry

fonts/                    # Pre-built font data modules (27 scripts)
tools/                    # CLI: build-font-data.cjs (TTF → JS module)
scripts/                  # Modular sample PDF generation (49 generators, 292 PDFs)
tests/                    # 3748+ tests (159 files: unit + integration + fuzz + parser + docs)
bench/                    # Performance benchmarks (vitest bench)
```

## Development

```bash
git clone https://github.com/Nizoka/pdfnative.git
cd pdfnative
npm install

npm run build            # tsup → dist/ (ESM + CJS + .d.ts)
npm run test             # vitest run (3748+ tests)
npm run test:coverage    # vitest with v8 coverage (91.5 % statements at the v1.8.0 release; CI gates: 88/80/85/90)
npm run test:generate       # Generate 292 sample PDFs → test-output/ (dates are written in UTC, so the bytes are host-independent — see §Reproducible builds)
npm run lint                # ESLint 9 + typescript-eslint strict
npm run typecheck           # tsc --noEmit (src/)
npm run typecheck:tests     # tsc --project tsconfig.test.json
npm run typecheck:scripts   # tsc --project tsconfig.scripts.json
npm run typecheck:all       # Typecheck src/ + tests/ + scripts/
npm run bench               # Performance benchmarks (vitest bench)
```

### Quality Metrics

| Metric | Value |
|--------|-------|
| Tests | 3748+ (159 files) |
| Statement coverage | 91.5 % (measured at the v1.8.0 release; CI enforces ≥88%, vitest.config.ts) |
| Branch coverage | 82.71% (measured at the v1.8.0 release; CI enforces ≥80%) |
| Function coverage | 96.87% (measured at the v1.8.0 release; CI enforces ≥85%; lines gate: ≥90%) |
| Fuzz tests | 89 cases in 5 suites (`tests/fuzzing/`) |
| Benchmarks | Latin 500 rows ~10ms, Unicode ~13ms (Apple M1, Node 22) |
| Dependencies | 0 runtime |
| CI | Node 22/24 matrix |
| Provenance | npm signed builds |

## Known Limitations — Visual vs. Semantic PDF

pdfnative generates **visually pixel-perfect** PDFs for all 27 supported scripts. However, PDF is fundamentally a *visual* format (a digital printer), not a *semantic* one. This distinction matters for **text extraction** (copy-paste, `pdftotext`, screen readers):

### Complex Text Layout (CTL) scripts

For scripts with combining marks — **Thai**, **Devanagari**, **Vietnamese tones** — the shaper positions each mark in its own `BT…ET` block with precise GPOS offsets. PDF viewers **render** this correctly, but text extractors reconstruct content by spatial position rather than logical order. This can produce garbled output when copying text from the PDF.

| Scenario | Visual rendering | Text extraction (Ctrl+C) |
|----------|:---:|:---:|
| Latin, Greek, Polish, Turkish | ✅ Perfect | ✅ Perfect |
| CJK (Japanese, Chinese, Korean) | ✅ Perfect | ✅ Perfect |
| Vietnamese (combining diacritics) | ✅ Perfect | ⚠️ May show Win-1252 fallback artifacts |
| Thai (GSUB + GPOS shaping) | ✅ Perfect | ⚠️ Combining marks may be reordered |
| Devanagari (matras, conjuncts) | ✅ Perfect | ✅ Conjuncts map to their letters (v1.8.0); marks may be reordered by spatial extractors |
| Bengali (conjuncts, GPOS marks) | ✅ Perfect | ✅ Conjuncts map to their letters (v1.8.0); marks may be reordered by spatial extractors |
| Tamil (split vowels, GSUB) | ✅ Perfect | ✅ Ligatures map to their letters (v1.8.0); split vowels may be reordered by spatial extractors |
| Yoruba / Igbo (Latin combining marks) | ✅ Perfect | ✅ Composed marks map to base + mark (v1.8.0) |

### Why this happens

This is an inherent limitation of the PDF spec (ISO 32000-1), not a bug in pdfnative. The ToUnicode CMap correctly maps glyph IDs back to Unicode code points — since v1.8.0 a conjunct, a subjoined form or a composed mark produced by the Indic engine or the Latin-marks shaper maps to all of its source code points — but extractors that rely on spatial reconstruction rather than CMap lookup will produce artifacts. This behavior is shared by most PDF generators that don't use Tagged PDF.

### Tagged PDF, /ActualText & PDF/A — Implemented ✅

All three roadmap items are now implemented and available via the `tagged` layout option:

```ts
const pdf = buildPDFBytes(params, { tagged: true });       // PDF/A-2b (default)
const pdf1b = buildPDFBytes(params, { tagged: 'pdfa1b' }); // PDF/A-1b (legacy)
const pdf2u = buildPDFBytes(params, { tagged: 'pdfa2u' }); // PDF/A-2u (Unicode)
```

When `tagged` is set, the output includes:

- **Tagged PDF (PDF/UA)** — full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/H1-H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`) with `/Span` marked content operators and `/StructParents` on every page
- **/ActualText** — original Unicode string attached as UTF-16BE hex to every `/Span BDC...EMC` sequence, solving text extraction for GPOS-repositioned glyphs (Thai, Arabic, Devanagari). Since v1.8.0 `extractText()` returns the `/ActualText` of a span instead of the glyphs shown inside it, so text extracted from tagged output matches what the writer declared
- **PDF/A-2b compliance** (default) — PDF 1.7, XMP metadata with `pdfaid:part=2` + `pdfaid:conformance=B`, sRGB ICC OutputIntent (`GTS_PDFA1`), `/MarkInfo << /Marked true >>` on Catalog
- **PDF/A-1b compatibility** — explicit `tagged: 'pdfa1b'` uses PDF 1.4, `pdfaid:part=1`
- **PDF/A-2u variant** — `tagged: 'pdfa2u'` uses PDF 1.7, `pdfaid:conformance=U`

The `tagged` option is backward-compatible — omitting it or setting `false` produces the same output as before.

> **PDF/A status (v1.1.0).** Every PDF/A-claiming sample now passes
> the **veraPDF** reference validator (1b / 2b / 2u / 3b) when the
> Latin font module is registered. Trailer `/ID` and
> `/Info CreationDate` are byte-equivalent to `xmp:CreateDate`
> (with timezone offset). `<dc:title>`, `<dc:description>`,
> `<pdf:Keywords>` mirror `/Info /Title`, `/Subject`, `/Keywords`
> byte-for-byte (ISO 19005-1 §6.7.3 t1 / t4 / t5). Object 3 / Object 4
> are emitted as Type0 redirector dicts pointing to the embedded
> CIDFontType2 chain — no more unembedded `Helvetica` references
> (ISO 19005-1 §6.3.4 / ISO 19005-2 §6.2.11.4.1). To produce strict
> PDF/A:
>
> ```ts
> import { registerFont } from 'pdfnative';
> registerFont('latin', () => import('pdfnative/fonts/noto-sans-data.js'));
> ```
>
> Run `npm run validate:pdfa` locally (with veraPDF installed, see
> [docs/guides/pdfa.html](docs/guides/pdfa.html)) to verify against
> the reference validator. CI runs veraPDF as a blocking check.

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
| Node.js 22+ | `zlib.deflateSync()` (native C) | Optimal |
| Browser | Stored-block fallback (valid FlateDecode) | No size reduction |
| Deno / Bun | CJS require fallback | Depends on compat layer |

For browser contexts with full compression, call `setDeflateImpl()` with a synchronous zlib-wrapped (RFC 1950) deflate such as fflate's `zlibSync`, or `setDeflateRawImpl()` (v1.8.0) with a raw RFC 1951 one such as fflate's `deflateSync` — pdfnative adds the zlib envelope. A raw function handed to `setDeflateImpl()` throws at build time since v1.8.0 instead of producing blank pages.

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

pdfnative was born inside [**plika.app**](https://plika.app) — a personal finance application where high-quality, multi-language PDF generation (bank statements, transaction reports) was a core requirement. Rather than depending on heavy third-party libraries, the PDF engine was built from scratch with zero dependencies, strict ISO compliance, and native support for 27 Unicode scripts.

The decision was then made to extract the engine into an independent open-source library so that everyone can benefit from production-grade PDF generation — not just plika.app users.

> **Where it all started** — the PDF engine that became pdfnative was originally built inside [plika.app](https://plika.app), a personal finance app generating multi-language bank statements and financial summaries across 16 scripts.<!-- verify-docs:allow stale-token (historical: origin story) -->

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

## Citing pdfnative

If you use pdfnative in academic, governmental, or compliance work, please cite it. Citation metadata is available in [CITATION.cff](CITATION.cff).

```bibtex
@software{pdfnative,
  author  = {Nizoka},
  title   = {pdfnative: Zero-dependency, ISO 32000-1 compliant PDF generation for TypeScript},
  url     = {https://github.com/Nizoka/pdfnative},
  year    = {2026}
}
```

## License

MIT — see [LICENSE](LICENSE).

Font data files in `fonts/` are licensed under [SIL Open Font License 1.1](https://scripts.sil.org/OFL). Unicode Character Database source files in `scripts/data/` are © Unicode, Inc., used under the [Unicode License v3](https://www.unicode.org/license.txt). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for the aggregated notices.
