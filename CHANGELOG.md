# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [1.1.0] – 2026-04-30

Maximalist stable cut. Closes issues
[#28](https://github.com/Nizoka/pdfnative/issues/28) (PDF/A Latin font
embedding) and [#25](https://github.com/Nizoka/pdfnative/issues/25)
(UAX #9 isolates + GPOS MarkBasePos for Arabic harakat), and adds
monochrome emoji support. Folds the alpha.1 / alpha.2 medium-term items
into a single stable release. 100% backward-compatible — all new
features are opt-in. **1726 tests / 48 files green.** See full notes in
[release-notes/v1.1.0.md](release-notes/v1.1.0.md).

### Fixed

- **core(pdfa):** PDF/A samples no longer reference unembedded
  `Helvetica` / `Helvetica-Bold` standard-14 fonts when a Latin font
  entry is registered. Object 3 and Object 4 are now emitted as Type0
  redirector dictionaries pointing to the primary embedded font's
  `CIDFontType2` / `FontFile2` chain — making `/F1` and `/F2` valid
  embedded references for veraPDF (ISO 19005-1 §6.3.4 / ISO 19005-2
  §6.2.11.4.1). Bold renders identical to regular under PDF/A in v1.1.0
  (a future release will add Noto Sans Bold as a separate font module).
- **core(xmp):** XMP metadata streams are now UTF-8 encoded via the new
  `utf8EncodeBinaryString()` helper before passing through `toBytes()`.
  Previously, `toBytes()` masked each char to `0xFF`, truncating
  characters above U+00FF (em-dash, ellipsis, smart quotes, CJK) to
  control bytes — which broke ISO 19005-1 §6.7.3 dc:title parity. Now
  `<dc:title>` matches `/Info /Title` byte-for-byte.
- **core(xmp):** `buildXMPMetadata()` now emits `<dc:description>` and
  `<pdf:Keywords>` whenever `/Info /Subject` and `/Info /Keywords` are
  set in the document metadata, satisfying ISO 19005-1 §6.7.3 t4 / t5
  parity rules. Previously, PDF/A-1b validation failed with veraPDF
  rules 6.7.3-4 and 6.7.3-5 on any document carrying `subject` or
  `keywords` metadata. ISO 19005-2/3 was lenient on this and still
  passed; v1.1.0 closes both gaps.
- **core(encoding):** `createEncodingContext(fontEntries, pdfA)` accepts
  an optional `pdfA` flag. When `true` and `fontEntries` is non-empty,
  the WinAnsi/Helvetica fallback in mixed-content runs is disabled —
  characters not covered by the primary CIDFont's cmap render as
  `.notdef` (gid 0) instead of being routed to the unembedded Helvetica
  Type1 font. Required for strict PDF/A conformance.
- **scripts(samples):** `scripts/generators/pdfa-variants.ts` now
  registers a `latin` font entry so `tagged-pdfa{1b,2b,2u,3b}.pdf` are
  fully embedded (zero `Helvetica` references in the output).
  `scripts/generators/pdfa-latin-embedding.ts` math operators paragraph
  trimmed to characters covered by Noto Sans VF (number sets ℝ ℂ ℕ ℤ,
  basic ops × ÷ ±) — Noto Sans Math support deferred.
- **scripts(samples):** Five additional PDF/A-claiming sample
  generators now register a `latin` font entry — `barcode-tagged.pdf`,
  `compressed-tagged-pdfa2b.pdf`, `header-footer-tagged.pdf`,
  `tagged-accessibility-complex.pdf`, `toc-tagged.pdf`. Closes the
  remaining veraPDF rule 6.2.11.4.1-1 (font embedding) failures
  reported by CI.
- **core(annot):** Link annotations (`/Subtype /Link`, both `/URI` and
  `/GoTo`) and form widget annotations (`/Subtype /Widget`) now emit
  `/F 4` (Print flag set, NoView/Hidden/Invisible cleared) per ISO
  19005-2 §6.5.3 / veraPDF rule 6.3.2-1. Required on every annotation
  in PDF/A-2 / PDF/A-3.
- **ci(verapdf):** veraPDF validation is now **blocking** on PRs and
  pushes to `main` (the previous `continue-on-error: true` was a
  pre-v1.0.5 placeholder). `scripts/validate-pdfa.ts` already
  auto-detects PDF/A-claiming files via XMP `pdfaid:part`, so non-PDF/A
  samples never trigger CI failures.

### Notes

- `Helvetica` / `Helvetica-Bold` standard-14 fonts are still emitted in
  non-PDF/A mode and in the Latin-only path (no font entries) for
  backward compatibility. To produce a strictly veraPDF-compliant
  PDF/A, register Noto Sans VF: `registerFont('latin', () =>
  import('pdfnative/fonts/noto-sans-data.js'))`.
- Noto Emoji uses `defaultWidth=2600` over `unitsPerEm=2048` (≈1.27 em
  per glyph), per the font's authoritative metrics. This produces wider
  advance than typical Latin fonts in mixed-script paragraphs — visually
  correct per the font designer's intent but may look spacious.

### Added

- **fonts(latin):** `fonts/noto-sans-data.{js,d.ts}` — Noto Sans VF
  (OFL-1.1), 4515 glyphs / 3094 cmap entries. Opt-in via
  `registerFont('latin', () => import('pdfnative/fonts/noto-sans-data.js'))`.
  Activates automatically for PDF/A documents containing non-WinAnsi
  Latin (curly quotes, em-dash, ellipsis…). Closes
  [#28](https://github.com/Nizoka/pdfnative/issues/28).
- **fonts(emoji):** `fonts/noto-emoji-data.{js,d.ts}` — Noto Emoji
  monochrome (OFL-1.1), 1891 glyphs / 1489 cmap entries. Opt-in via
  `registerFont('emoji', () => import('pdfnative/fonts/noto-emoji-data.js'))`.
- **shaping(bidi):** UAX #9 isolate handling — LRI / RLI / FSI / PDI
  (U+2066–U+2069) classified as `BN`, recursed via three-tier
  dispatcher (`resolveBidiRuns` → `resolveBidiRunsForced` →
  `resolveBidiCore`). Nested and unmatched isolates supported.
  Closes the syntactic half of [#25](https://github.com/Nizoka/pdfnative/issues/25).
- **shaping(arabic):** GPOS MarkBasePos applied to transparent marks
  (harakat: fatha, kasra, damma, sukun, shadda, …). Marks now anchor
  on the preceding base glyph. Closes the visual half of
  [#25](https://github.com/Nizoka/pdfnative/issues/25).
  ([src/shaping/arabic-shaper.ts](src/shaping/arabic-shaper.ts))
- **shaping(drivers):** new shared `src/shaping/gsub-driver.ts`
  (`tryLigature(gids, ligatures)`) and
  `src/shaping/gpos-positioner.ts` (`getBaseAnchor`, `getMarkAnchor`,
  `getMark2MarkAnchor`, `positionMarkOnBase`). Bengali / Tamil /
  Devanagari / Arabic shapers route through these instead of three
  duplicated implementations.
- **shaping(emoji):** `EMOJI_RANGES`, `isEmojiCodepoint`,
  `containsEmoji`, `FITZPATRICK_START/END`, `ZWJ`, `VS15`, `VS16` in
  [src/shaping/script-registry.ts](src/shaping/script-registry.ts).
  `detectCharLang()` returns `'emoji'` for emoji codepoints;
  `detectFallbackLangs()` adds `'emoji'` to the set automatically.

### Changed

- **shaping(bidi):** `resolveBidiRuns()` rewritten as a recursive
  isolate-aware dispatcher. Output byte-identical for inputs without
  isolate characters.
- **shaping(types):** `fixPunctuationAffinity` and `fixBracketPairing`
  parameter types widened to `readonly number[]`. No public API impact.
- **shaping(bengali, tamil, devanagari):** local `tryLigature`
  removed; thin `tryLig(gids)` closure forwards to shared driver.
  Output bytes unchanged.

### Tests

- 24 new tests in
  [tests/shaping/phase2-shaping.test.ts](tests/shaping/phase2-shaping.test.ts)
  (GSUB driver, GPOS positioner, BiDi isolates, Arabic MarkBasePos).
- 15 new tests in [tests/shaping/emoji.test.ts](tests/shaping/emoji.test.ts)
  (ranges, predicates, script-detect integration, baked module shape).
- New PDF/A Latin embedding integration in
  [tests/fonts/pdfa-latin-embedding.test.ts](tests/fonts/pdfa-latin-embedding.test.ts).
- Total: **1726 / 1726 green** (48 files), up from 1674.

### Deferred to v1.2.0

- Full UAX #9 embeddings (LRE / RLE / LRO / RLO / PDF) —
  isolates ship now; embeddings remain rare in practice.
- True page-by-page constant-memory streaming
  (`buildDocumentPDFStreamPageByPage()`).
- COLRv1 colour emoji (v1.1.0 ships monochrome only).

## [1.1.0-alpha.2] – 2026-04-29

This iteration extends alpha.1 with two contained, fully-tested table-layout
features that were on the v1.1.0 medium-term list, plus a small UX polish to
the documentation site. The remaining epics (issue
[#28](https://github.com/Nizoka/pdfnative/issues/28) PDF/A Latin font
embedding, issue [#25](https://github.com/Nizoka/pdfnative/issues/25) full
UAX #9 + multi-pass GSUB + GPOS MarkBasePos) and emoji support stay scheduled
for v1.1.0 stable. True page-by-page constant-memory streaming is deferred
to v1.2.0 because it requires an architectural refactor of `pdf-document.ts`
that we don't want to ship under alpha-velocity.

### Added

- **core(table):** `TableBlock.clipCells?: boolean` (default `true`) —
  every header and data cell is now wrapped in `q <rect> re W n ... Q` so
  variable-width content cannot escape its column rectangle visually. The
  existing character-cap (`ColumnDef.mx` / `mxH`) and clipping operate
  in tandem; opt out with `clipCells: false` for byte-identical v1.0.x
  output. ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts))
- **core(table):** `TableBlock.autoFitColumns?: boolean` — when `true`,
  column-width fractions are derived from actual measured content widths
  (header at `fs.th`, cells at `fs.td`, plus 6 pt cell padding). The
  resulting fractions are forwarded to `computeColumnPositions()` which
  still honours per-column `minWidth` / `maxWidth` clamping. Defaults
  to `false` for byte-stability. ([src/core/pdf-column-fit.ts](src/core/pdf-column-fit.ts))
- **docs(site):** added live `pdfnative-mcp` npm version badge in the
  hero badge strip, mirroring the existing `pdfnative-cli` badge.
- **docs(site):** new compact one-line **live version strip** mounted
  directly under the main `<nav>` (`.pn-version-strip` /
  `data-mode="compact"`), giving visitors immediate visibility into the
  current published `pdfnative` / `pdfnative-cli` / `pdfnative-mcp`
  versions and their transitive `pdfnative` pins. The richer detailed
  widget (footer block) is preserved verbatim.
  ([docs/assets/versions.js](docs/assets/versions.js),
  [docs/style.css](docs/style.css))

### Changed

- **docs(site):** `versions.js` refactored to dual-mode (`compact` /
  `detailed`) with auto-discovery of all matching mounts
  (`#pdfnative-versions`, `.pn-version-strip`, `[data-pn-versions]`)
  on a single `DOMContentLoaded`. Strip propagated to
  `docs/playgrounds/cli.html` and `docs/playgrounds/mcp.html`.

### Tests

- 9 new tests across two files (clip operator emission +
  `computeAutoFitColumns()` redistribution + wiring sanity), bringing
  the suite to **1674 / 1674 green** (45 files).

### Deferred to v1.1.0 stable

- Issue #28 — PDF/A Latin font embedding (Noto Sans subset + ObjectAllocator).
- Issue #25 — Full UAX #9 BiDi (embeddings, isolates, levels >2,
  BD13/14/16) + multi-pass GSUB + GPOS MarkBasePos for Arabic harakat.
- Emoji monochrome support (Noto Emoji OFL-1.1, ZWJ + VS-15/16 + Fitzpatrick).

### Deferred to v1.2.0

- True page-by-page constant-memory streaming
  (`buildDocumentPDFStreamPageByPage()`). The current
  `buildDocumentPDFStream()` already chunks output but materialises the
  full PDF binary string first.

## [1.1.0-alpha.1] – 2026-04-29

This release lands the **Medium-Term roadmap items** that fit cleanly within
a SemVer-minor surface, plus a watermark layout fix that ships a sane default
for aggressive `fontSize` + `angle` combinations. Two larger epics — issue
[#28](https://github.com/Nizoka/pdfnative/issues/28) (PDF/A Latin font
embedding) and issue [#25](https://github.com/Nizoka/pdfnative/issues/25)
(full UAX #9 BiDi + multi-pass GSUB) — remain in progress for the
v1.1.0 stable cut: they require atomic object-graph renumbering and font-data
rebuilds whose risk profile is incompatible with shipping in the same
iteration as smaller, fully-tested changes.

### Added

- **core(watermark):** `WatermarkText.autoFit?: boolean` — when `true`
  (the new default), the renderer scales `fontSize` down so the rotated
  bounding box `(textW·|cos θ| + textH·|sin θ|, textW·|sin θ| + textH·|cos θ|)`
  fits within the page minus a 24 pt safety margin. Aggressive presets
  like `fontSize: 120, angle: -30` on A4 no longer overflow the page;
  set `autoFit: false` to preserve byte-stable v1.0.x output.
  ([src/core/pdf-watermark.ts](src/core/pdf-watermark.ts))
- **fonts(encoding):** new `truncateToWidth(str, maxWidthPt, sz, enc)`
  exported from the root — measurement-based string shortening that
  respects proportional font widths in both Latin and CIDFont modes.
  Uses the active encoding context's width metrics; appends the Unicode
  horizontal ellipsis (`…`, U+2026) on truncation.
  ([src/fonts/encoding.ts](src/fonts/encoding.ts))
- **types(layout):** `ColumnDef.minWidth?: number` /
  `ColumnDef.maxWidth?: number` — additive constraints on table column
  widths in points. Constrained columns are clamped first, then the
  surplus or deficit is redistributed across the unconstrained columns
  proportional to their `f` weight. When neither is set on any column,
  output is byte-identical to v1.0.5.
  ([src/core/pdf-layout.ts](src/core/pdf-layout.ts))
- **parser(decode):** new `pdf-decode-filters.ts` module — pure,
  zero-dependency decoders for the standard non-Flate stream filters:
  `ASCIIHexDecode` (§7.4.2), `ASCII85Decode` (§7.4.3),
  `LZWDecode` (§7.4.4, variable-width 9–12 bit codes with CLEAR / EOD),
  and `RunLengthDecode` (§7.4.5). Wired into the reader's single-filter
  and multi-filter-chain dispatch. Includes a 256 MiB output cap to
  defend against zip-bomb-style adversarial streams.
  ([src/parser/pdf-decode-filters.ts](src/parser/pdf-decode-filters.ts))
- **docs(site):** live version widget — zero-build, zero-dependency
  panel that fetches the latest `pdfnative`, `pdfnative-cli`, and
  `pdfnative-mcp` versions from `registry.npmjs.org` on page load and
  surfaces the **transitive `pdfnative` pin** declared by each
  downstream package. Mounted on the homepage and both playgrounds.
  Falls back to static defaults when the registry is unreachable.
  ([docs/assets/versions.js](docs/assets/versions.js))

### Changed

- **fonts(encoding):** `truncate(str, max)` now appends `…` (U+2026)
  instead of `..`. The Unicode ellipsis is a single grapheme cluster,
  is mapped to WinAnsi `0x85`, and renders correctly in both Latin and
  CIDFont modes. Output is one character shorter for the same `max`
  (e.g. `truncate('Hello World', 7)` was `'Hello..'`, now `'Hello …'`).
  See **Breaking Changes** below.
- **core(renderers):** TOC entry truncation uses `…` (U+2026) instead
  of `'...'` (three ASCII dots).
  ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts))

### Breaking Changes

- **`truncate()` ellipsis character changed** from `..` (two ASCII
  dots) to `…` (U+2026). Snapshot-style assertions on truncated cell
  text need updating. Affected call sites: legacy table builder
  (`pdf-builder.ts`), document-builder table renderer
  (`pdf-renderers.ts`), and TOC renderer. The change is intentional:
  the Unicode ellipsis is the typographically correct character, is
  ~50% narrower than three dots in Latin mode, and is a single
  grapheme cluster.
- **`WatermarkText.autoFit` defaults to `true`.** Generated PDF bytes
  for callers that rely on overflowing watermark presets will differ.
  Set `autoFit: false` on the `WatermarkText` to restore exact
  v1.0.x output for those cases. Watermarks that already fit the page
  are unaffected (the auto-fit branch is short-circuited when no
  overflow is detected).

### Internal

- **tests:** 49 new tests across watermark auto-fit (5), column
  min/max (6), updated truncate ellipsis (9), and the new decode filter
  module (24). Test files: [tests/core/pdf-watermark.test.ts](tests/core/pdf-watermark.test.ts),
  [tests/core/pdf-layout-columns.test.ts](tests/core/pdf-layout-columns.test.ts),
  [tests/parser/pdf-decode-filters.test.ts](tests/parser/pdf-decode-filters.test.ts),
  [tests/fonts/encoding.test.ts](tests/fonts/encoding.test.ts).

### Tracked for v1.1.0 stable

The following items are tracked under the v1.1.0 milestone and
deliberately deferred from this alpha because they require atomic
multi-file object-graph rewrites:

- **Issue [#28](https://github.com/Nizoka/pdfnative/issues/28)** —
  PDF/A Latin font embedding (Helvetica → Noto Sans Regular + Bold,
  SIL OFL-1.1). Requires bundling pre-built font data, replacing
  `helveticaWidth()` with embedded-font widths under PDF/A, and
  renumbering the object graph atomically across `pdf-builder.ts`,
  `pdf-document.ts`, and `pdf-assembler.ts`.
- **Issue [#25](https://github.com/Nizoka/pdfnative/issues/25)** —
  full UAX #9 W1–W7 + N1/N2 + isolates, multi-pass GSUB driver for
  nested LookupType 4 ligatures, USE-lite cluster classification for
  Indic scripts, and GPOS MarkBasePos for isolated Arabic harakat.
- **Auto-fit column widths** — content-aware `mx` computation.
- **Cell clipping paths** — `q re W n … Q` per cell.
- **Constant-memory streaming** — page-by-page assembly without
  buffering the full PDF.


## [1.0.5] – 2026-04-27

### Fixed

- **core(watermark):** text watermarks are now correctly centered on
  the page in both horizontal and vertical axes. The previous
  implementation used `-fontSize/2` as the vertical offset, which
  ignored the font's cap-height and produced visibly off-center
  output. The offset now derives from the font's `capHeight /
  unitsPerEm` ratio (with a `0.718` fallback matching Helvetica),
  yielding mathematically centered glyphs regardless of font.
  ([src/core/pdf-watermark.ts](src/core/pdf-watermark.ts))
- **core(watermark):** Unicode watermark text is now encoded through
  the document's active encoding context (`enc.ps()`) rather than
  unconditionally through the WinAnsi `pdfString()` encoder. When a
  document uses a CIDFont (Identity-H), watermark glyphs are now
  emitted as 2-byte hex GIDs instead of being silently dropped or
  mis-encoded, fixing watermarks for Arabic, Hebrew, CJK, Devanagari,
  Bengali, Tamil, Cyrillic, Greek, Georgian, and Armenian documents.
  ([src/core/pdf-watermark.ts](src/core/pdf-watermark.ts))

### Added

- **docs(cli):** new [CLI Guide](https://pdfnative.dev/guides/cli.html)
  documenting [`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli)
  — the official command-line interface for `render`, `sign`, and
  `inspect` workflows. Covers installation, security model, pipeline
  examples, and library-vs-CLI decision guidance.
- **docs(architecture):** Ecosystem section in the architecture guide
  now documents both `pdfnative-cli` and `pdfnative-mcp` as separate
  npm packages consuming the public API surface. Companion update in
  [README.md](README.md) Ecosystem section.
- **tests(watermark):** 6 new regression tests in
  [tests/core/pdf-watermark.test.ts](tests/core/pdf-watermark.test.ts)
  covering cap-height-based vertical offset, horizontal centering,
  Latin WinAnsi encoding, Unicode CIDFont 2-byte GID hex encoding,
  font-metric-driven offset in Unicode mode, and rotation invariance
  of the visual centering bounding box.

### Changed

- **package:** version bumped from `1.0.4` to `1.0.5` (patch — no
  breaking changes, no public API surface changes).
- **CITATION.cff:** version field bumped to `1.0.5` (was stale at
  `1.0.0`).

### Deferred

- **#28 (PDF/A Latin font embedding):** integration of an embedded
  Latin font (e.g. Liberation Sans / Arimo) for PDF/A documents has
  been deferred to **v1.1.0**. The change requires object renumbering
  across multiple builders and ships ~30–60 KB of additional bytes
  per PDF/A output, which is out of scope for a patch release.

## [1.0.4] – 2026-04-25

### Fixed

- **core(pdf-a):** trailer `/ID` is now emitted for every PDF (previously
  only when encryption was enabled). The unencrypted ID is derived
  deterministically from `MD5(title + creation date)`, so byte-equal
  inputs continue to produce byte-equal outputs. Required by
  ISO 19005-1 §6.1.3 and strongly recommended by ISO 32000-1 §14.4.
  ([src/core/pdf-assembler.ts](src/core/pdf-assembler.ts))
- **core(pdf-a):** `/Info CreationDate` and `xmp:CreateDate` now share
  a single source of truth via the new `buildPdfMetadata()` helper.
  Both formats include the local timezone offset
  (`D:YYYYMMDDHHmmSS+HH'mm'` and ISO 8601 `±HH:MM`), satisfying
  veraPDF rule 6.7.3 t1 (`doCreationDatesMatch`). XMP also emits
  matching `xmp:ModifyDate` and `xmp:MetadataDate` for completeness.
  ([src/core/pdf-tags.ts](src/core/pdf-tags.ts))
- **core(pdf-a):** XMP `dc:creator` is now emitted only when an
  author is provided (via `DocumentParams.metadata.author`) and is
  XML-escaped. The previous unconditional `pdfnative` value caused
  veraPDF rule 6.7.3 to flag a false `dc:creator` ↔ `/Info /Author`
  mismatch on documents with no author. Author values flow through to
  `/Info /Author` and `dc:creator` simultaneously, byte-equivalent.
  ([src/core/pdf-tags.ts](src/core/pdf-tags.ts))

### Added

- **scripts(validation):** new `npm run validate:pdfa` script invokes
  the official veraPDF reference validator against every generated
  sample under `test-output/` that claims PDF/A in its XMP. Skips
  gracefully (exit 0) when veraPDF is not on `$PATH` and `VERAPDF_HOME`
  is unset, so it never blocks local development.
  ([scripts/validate-pdfa.ts](scripts/validate-pdfa.ts))
- **ci(verapdf):** new GitHub Actions workflow `.github/workflows/verapdf.yml`
  installs the veraPDF CLI on every PR/push, regenerates samples, and runs
  `npm run validate:pdfa`. Build fails on any non-compliant PDF/A claim —
  the canonical guardrail used by reportlab/PDFKit/mPDF. veraPDF is
  invoked as an external CI tool, never bundled, preserving the
  zero-runtime-dependency policy.
  ([.github/workflows/verapdf.yml](.github/workflows/verapdf.yml))
- **tests(core):** 18 new tests in
  [tests/core/pdf-trailer-id.test.ts](tests/core/pdf-trailer-id.test.ts)
  cover trailer `/ID` shape, deterministic derivation, ISO 8601 / PDF
  date parity, XMP ↔ /Info equivalence, and `dc:creator` escaping.
- **release-notes:** [release-notes/v1.0.4.md](release-notes/v1.0.4.md)
  full release notes; tracking issue draft at
  [release-notes/draft-issue-v1.0.4-pdfa-conformance.md](release-notes/draft-issue-v1.0.4-pdfa-conformance.md);
  v1.0.5 epic for full Latin font embedding at
  [release-notes/draft-issue-v1.0.5-latin-embedding.md](release-notes/draft-issue-v1.0.5-latin-embedding.md).
- **scripts(validation):** `validate:pdfa` wrapper now prints per-OS
  install hints (macOS / Linux / Windows / online demo) when the
  veraPDF CLI is missing, and reports a `Scanned N PDF(s); M claim
  PDF/A, K skipped (not PDF/A)` summary so users see why ISO 32000-1
  files are filtered out. ([scripts/validate-pdfa.ts](scripts/validate-pdfa.ts))
- **ci(verapdf):** the workflow now also accepts `workflow_dispatch`
  triggers, allowing manual runs against any branch from the GitHub
  Actions UI before opening a pull request. ([.github/workflows/verapdf.yml](.github/workflows/verapdf.yml))
- **docs(guides):** new "Installing veraPDF locally" + "Troubleshooting"
  sections in [docs/guides/pdfa.html](docs/guides/pdfa.html) document
  why ISO 32000-1 files are skipped and how to install the validator
  on each OS.
- **docs(landing):** new "Designed for low-impact computing" section
  on [docs/index.html](docs/index.html) listing factual differentiators
  only — zero deps, on-device generation, no telemetry, tree-shakeable
  ESM, streaming output. No carbon claims.
- **docs(readme):** two factual bullets added to Highlights covering
  on-device generation and the absence of telemetry.

### Known limitations

- **PDF/A — Latin font embedding:** standard 14 Type 1 Helvetica and
  Helvetica-Bold are still emitted as unembedded font references for
  Latin runs. ISO 19005-1 §6.3.4 forbids unembedded fonts in any PDF/A
  conformance level. Files generated with `tagged: true | 'pdfa1b' |
  'pdfa2b' | 'pdfa2u' | 'pdfa3b'` therefore still fail veraPDF rule
  6.3.4 today. v1.0.4 fixes the upstream metadata and trailer issues
  that were independently flagged; the embedded-Helvetica fix is
  tracked as a v1.0.5 epic — see
  [release-notes/draft-issue-v1.0.5-latin-embedding.md](release-notes/draft-issue-v1.0.5-latin-embedding.md).
  Until then, the PDF/A claim in XMP must be considered aspirational,
  not validated. The new CI guardrail will turn green once v1.0.5
  lands.

[#27]: https://github.com/Nizoka/pdfnative/issues/27
[1.0.3]: https://github.com/Nizoka/pdfnative/compare/v1.0.3...v1.0.4

## [1.0.3] – 2026-04-25

### Fixed

- **core(layout):** `wrapText()` now hard-breaks single overlong tokens at
  character boundaries when no whitespace breakpoint exists. Long
  headings and titles such as
  `"Test Bengali + Devanagari ULTRA EXTREME — Shaping & Positioning — pdfnative"`
  previously could overflow the right margin when no segment fit. Code
  points are honored so surrogate pairs and combining sequences remain
  intact at slice boundaries. ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts))
- **docs(landing):** footer links to `guides/architecture.html` and
  `guides/faq.html` previously 404'd because only `.md` files existed
  under `docs/guides/` and `.nojekyll` disables auto-rendering. Each
  guide now ships as a real HTML page with a clean URL.

### Added

- **scripts(generators):** new `extreme-shaping.ts` generator producing
  four visual-regression baselines under `test-output/extreme/`:
  `extreme-bidi.pdf` (Arabic + Hebrew + Thai + Latin + digits),
  `extreme-tamil.pdf` (deep conjuncts, split vowels, BiDi mix),
  `extreme-bengali-devanagari.pdf` (reph + multi-halant chains),
  `extreme-arabic-harakat.pdf` (isolated tashkeel anchoring).
- **tests(integration):** `tests/integration/extreme-shaping.test.ts` —
  five end-to-end builds covering the same extreme inputs to guard
  against pipeline regressions.
- **tests(core):** new regression tests for `wrapText` confirming
  character-level hard-break of overlong tokens and multi-line wrapping
  of long em-dash titles.
- **docs(playgrounds):** new interactive playground
  `docs/playgrounds/extreme-scripts.html` for stress-testing BiDi, Tamil
  conjuncts, Bengali + Devanagari ligatures, and Arabic harakat directly
  in the browser, with editable presets and a code preview.
- **docs(playgrounds):** new
  `docs/playgrounds/medical-800.html` — Web Worker showcase generating
  an 800-page synthetic clinical report using `buildDocumentPDFStream`,
  with live progress, byte/chunk counters, optional Tagged PDF (PDF/A-2b),
  and a main-thread comparison toggle. All patient data is generated
  client-side from a seeded RNG — no real PHI.
- **docs(guides):** static HTML guide pages (`quickstart.html`,
  `architecture.html`, `faq.html`, `troubleshooting.html`,
  `accessibility.html`) plus a guides index at `/guides/`. Each page
  renders its companion `.md` via `marked` + `DOMPurify` (CDN), inherits
  the site chrome, and falls back to the GitHub source on load failure.
- **docs(guides):** new `quickstart.md` covering Node.js, browser,
  multi-language, Web Worker, and streaming setups in a single page.
- **docs(guides):** new `accessibility.md` covering tagged PDF, PDF/UA,
  PDF/A variants, structure tree contents, alt-text discipline, and
  validation tooling (veraPDF, PAC, NVDA/VoiceOver).
- **docs(guides):** rewrote `faq.md` with sectioned topics (Getting
  started, Fonts and Unicode, Standards, Security, Modifying, Performance,
  Common errors) and ten concrete code snippets to reduce inbound
  support load.
- **docs(readme):** added a "Documentation" pointer block linking to the
  guides and to `pdfnative.dev`. Added Indic document samples
  (`doc-bengali`, `doc-tamil`, `doc-devanagari`) to the Document Builder
  Samples table — the generators were added in v1.0.2 but the README
  table was not updated. Added a "Citing pdfnative" section with BibTeX
  pointing to `CITATION.cff`.

### Changed

- **docs(landing):** added a row of project-status badges to the
  `pdfnative.dev` hero (CI, CodeQL, OpenSSF Scorecard, npm version, monthly
  downloads, bundle size, zero deps, TypeScript strict, npm provenance, MIT)
  to mirror the `README.md` and surface supply-chain signals upfront.
- **docs(landing):** rebuilt the "Try It Live" panel as a curated
  10-example gallery (Quick Start, Financial, TOC, Barcode, SVG, Watermark,
  Forms, PDF/A, Multi-language with lazy fonts, Streaming) with a picker,
  reset button, and a "View source" link to the matching generator under
  `scripts/generators/`. The runtime now supports top-level `await`,
  dynamic `import(…)`, and exposes `streamDocumentPdf`, `registerFonts`,
  `loadFontData`, and `signPdfBytes`.
- **docs(landing):** synced the test counter to 1 588+ tests (matches
  `tests/` and `package.json`).
- **docs(landing):** added "Guides" and "Playgrounds" entries in the
  navbar and refreshed the footer with direct links to every guide and
  both new playgrounds.

### Known limitations (tracked for v1.1.0)

The following deeper shaping issues are surfaced by the new extreme
samples and are tracked for the next minor release. They require
either GPOS table re-extraction in the pre-built font data modules or
new OpenType lookups in the shaping pipeline, which exceed the scope of
a SemVer-patch:

- Arabic isolated harakat (تشكيل) without a base consonant fall back to
  default mark positioning rather than precise font-anchored placement.
- Thai mark stacking on tall consonants (ป ฝ ฟ ฬ) with three or more
  combining marks may overlap with the current font anchor data.
- Multi-stage Indic ligatures (ক্ষ্ম, क्ष्म, ஸ்ரீ) are matched greedily;
  some deeply-nested sequences fall back to non-ligated forms.
- BiDi paragraphs mixing 3+ RTL-capable scripts (Arabic + Hebrew + Thai
  + Latin + digits) may exhibit non-canonical run ordering at boundaries
  with neutrals.

See [release-notes/draft-issue-v1.1.0-shaping-epic.md](release-notes/draft-issue-v1.1.0-shaping-epic.md)
for the full follow-up tracking issue.

[#24]: https://github.com/Nizoka/pdfnative/issues/24
[1.0.3]: https://github.com/Nizoka/pdfnative/compare/v1.0.2...v1.0.3

## [1.0.2] – 2026-04-24

### Changed

- **chore(meta):** enriched npm package metadata. `description` now enumerates
  the 16 supported scripts and headline features (BiDi, PDF/A, AES encryption,
  digital signatures, AcroForm, barcodes, SVG). `keywords` expanded from 13 to
  27 entries for improved npm search discoverability (adds `arabic`, `hebrew`,
  `bengali`, `tamil`, `devanagari`, `bidi`, `pdf-a`, `tagged-pdf`,
  `accessibility`, `encryption`, `digital-signature`, `acroform`, `barcode`,
  `qr-code`).

### Fixed

- **fix(docs):** `README.md` multi-font table — Bengali and Tamil rows were
  concatenated on a single line with literal `\n` characters instead of real
  newlines, rendering as broken markdown on npmjs.com and GitHub.
- **fix(samples):** `doc-devanagari.pdf` heading used a Bengali digit one
  (U+09E7) instead of a Devanagari digit one (U+0967), producing a `.notdef`
  tofu box in the rendered PDF.
- **fix(build):** added `scripts/tsconfig.json` extending `tsconfig.scripts.json`
  so VS Code's ts-server picks up `@types/node` for files under `scripts/`.
  Suppresses spurious `Cannot find name 'path'` IDE errors without changing CLI
  behavior (`npm run typecheck:scripts` was already green).

### Added

- **feat(samples):** new `doc-devanagari.pdf` sample demonstrating Hindi
  (Devanagari) document generation with GSUB conjuncts, reph reordering, matra
  reordering, and split vowels — completing the Indic sample triad alongside
  `doc-bengali.pdf` and `doc-tamil.pdf`.
- **feat(samples):** `doc-multi-language.pdf` now covers all 16 supported
  scripts (Latin, Greek, Cyrillic, Turkish, Vietnamese, Polish, Georgian,
  Armenian, Thai, Devanagari, Bengali, Tamil, Japanese, Chinese, Korean,
  Arabic, Hebrew) in a single document instead of the previous EN/AR/JA subset.
- **docs(governance):** new `.github/ISSUE_TEMPLATE/maintenance.md` template
  for release tasks, metadata updates, and governance work.
- **docs(governance):** new `release-notes/TEMPLATE.md` standardizing future
  release notes (section structure, conventional commit prefixes, SemVer
  classification, publication workflow).
- **docs(contributing):** `CONTRIBUTING.md` branch strategy updated — default
  branch corrected from `master` to `main`, added `chore/*` convention for
  maintenance and release branches.

[#19]: https://github.com/Nizoka/pdfnative/issues/19
[1.0.2]: https://github.com/Nizoka/pdfnative/compare/v1.0.1...v1.0.2

## [1.0.1] – 2026-04-23

### Fixed

- **fix(encoding):** bullet list items (`{ type: 'list', style: 'bullet' }`) no
  longer render as `?` in default WinAnsi mode. Root cause: `toWinAnsi()` was
  missing the CP1252 mapping for `•` (U+2022 → 0x95) ([#1]).
- **fix(encoding):** completes all 18 remaining CP1252 0x80–0x9F character
  mappings — ‚ ƒ „ † ‡ ˆ ‰ Š ‹ Œ Ž ˜ ™ š › œ ž Ÿ — which previously fell through
  to the `?` replacement path.
- **fix(docs):** landing page live demo no longer uses U+2713 (✓) which is not
  encodable in WinAnsi; replaced with ASCII text. Removed unrelated financial
  API properties (`type: 'credit'`, `pointed: false`) from the document demo.

[#17]: https://github.com/Nizoka/pdfnative/issues/17
[1.0.1]: https://github.com/Nizoka/pdfnative/compare/v1.0.0...v1.0.1

## [1.0.0] – 2026-04-20

Initial release. Pure native PDF generation library with zero runtime dependencies.

### Security

- **CWE-674 mitigation** — parser recursion depth cap (`MAX_PARSE_DEPTH = 1000`) prevents stack overflow from maliciously nested PDF arrays/dictionaries.
- **CWE-400 mitigation (decompression)** — `inflateSync()` output-size cap (default 100 MB, configurable via `setMaxInflateOutputSize()`) prevents zip-bomb memory exhaustion. Enforced on both the pure-JS fallback and the native Node.js zlib path (via `maxOutputLength`).
- **CWE-400 mitigation (xref)** — xref `/Prev` chain depth cap (`MAX_XREF_CHAIN = 100`) and cycle detection prevent CPU/memory DoS from pathological cross-reference chains.

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
- **Bengali OpenType shaping** — GSUB LookupType 4 ligature-based conjunct formation + GPOS mark-to-base positioning via `bengali-shaper.ts`
- **Tamil OpenType shaping** — GSUB LookupType 4 ligature substitution + split vowel decomposition via `tamil-shaper.ts`
- **Devanagari OpenType shaping** — full cluster building, reph detection, matra reordering, split vowels, GSUB ligature conjuncts, GPOS mark positioning via `devanagari-shaper.ts`
- **GSUB LookupType 4 extraction** — `build-font-data.cjs` now parses LigatureSubst tables; font data modules include `ligatures` field for Bengali (42 groups), Tamil (35), Devanagari (152)
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

- **1588+ tests** across 40 test files — unit, integration, fuzz, and parser coverage
- **95%+ statement coverage** — v8 coverage with thresholds: 90/80/85/90 (statements/branches/functions/lines)
- **48 fuzz edge-case scenarios** — boundary conditions, malformed inputs, extreme dimensions, recursion/zip-bomb/xref-chain hardening
- **140+ sample PDFs** — financial statements (14), diverse use cases (12), alphabet coverage (13), PDF/A variants (5), encrypted (6), document builder (19), compressed (9), barcodes (3), watermarks (6), headers/footers (4), page sizes (6), TOC (3), SVG (3), forms (3), digital signatures (2), streaming (2), parser (2), stress tests/edge cases (13), text shaping deep-dives (3), BiDi algorithm walkthroughs (2), font subsetting deep-dives (2), crypto showcase (1), parser deep-dive (1)
- **PDF /Info metadata** — Title, Producer (pdfnative), CreationDate in ISO D:YYYYMMDDHHmmss format
- **Input validation** — type checks, null/undefined guards, 100K row limit at `buildPDF()` boundary
- **23 sample generators** — modular `npm run test:generate` → 140+ PDFs in `test-output/`

#### Governance & CI

- Public exports: `MAX_PARSE_DEPTH`, `MAX_XREF_CHAIN`, `DEFAULT_MAX_INFLATE_OUTPUT`, `setMaxInflateOutputSize()`, `getMaxInflateOutputSize()`
- OpenSSF Scorecard workflow (`.github/workflows/scorecard.yml`) for continuous supply-chain security assessment
- `CITATION.cff` (Citation File Format 1.2.0) for academic citation
- `SUPPORT.md` documenting support channels and expectations
- CI workflows declare explicit `timeout-minutes` (CI 15 min, Publish 20 min, CodeQL 30 min, Scorecard 20 min)
- Trusted Publishing (npm OIDC) — no long-lived NPM_TOKEN secret required
- Published tarball narrowed via `package.json` `files` whitelist — `fonts/ttf/` source files not shipped to npm (~25 MB reduction)

### Fixed

- **Watermark xref corruption** — `baseObjCount` in `buildPDF()` did not account for watermark ExtGState/image objects, causing object number collisions and corrupted PDF output (blank pages or viewer errors)
- **AcroForm text field marked content** — appearance streams now include `/Tx BMC...EMC` wrapper required by ISO 32000-1 §12.7.3.3 for proper viewer rendering
- **AcroForm radio button group structure** — radio buttons with the same `name` now emit parent-child `/Kids`/`/Parent` hierarchy with mutual exclusivity via `/V` on parent (ISO 32000-1 §12.7.4.2.4)
- **AcroForm checkbox appearance sizing** — checkbox `/AP` stream scaled to match field dimensions instead of hardcoded 10pt
- **AcroForm indirect font references** — `/DR << /Font << /Helv N 0 R >> >>` uses actual object number instead of inline font dict, fixing viewer font resolution
- **AcroForm label parentheses** — field labels no longer include raw parentheses that break PDF string syntax
- **AcroForm checkbox/radio default state** — `checked: true` on `FormFieldBlock` correctly sets `/V /Yes /AS /Yes` for pre-checked fields
- **Digital signature ByteRange** — `/ByteRange` placeholder sizing ensures sufficient space for CMS SignedData embedding
- **Sample generator font bloat** — `text-shaping-deep`, `bidi-algorithm`, and `font-subsetting-deep` generators now load only the fonts used by each PDF instead of all 16, reducing output sizes from 30–40 MB to < 5 MB per file
- **Comparison table accuracy** — corrected pdfkit PDF/A claim (pdfkit supports Tagged PDF/PDF/UA but not PDF/A per ISO 19005)

### Known Limitations

_No major limitations at this time._

## [0.0.1] – 2026-04-13

Name reservation placeholder on npm. No functional code.
