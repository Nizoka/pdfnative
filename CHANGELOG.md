# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] – 2026-08-21

The long-term-validation release: complete PAdES LTV signing (B-B → B-LTA)
with injected network providers, charts v2, colour-emoji flag & ZWJ
sequences, UAX #9 digit-order and glyph-mirroring conformance, PDF/A
declaration guards, and an incremental-writer hardening pass — plus the
documentation-alignment train (ecosystem manifest + hardened verifier)
staged since v1.6.0. Zero runtime dependencies, no breaking changes:
every new capability is a new API or an additive option, and existing
inputs render byte-identically except where the fixed behaviour was
outright wrong (reversed RTL digits, unmirrored delimiters, mis-joined
Arabic letterforms, per-revision `/ID` reuse). 2639 tests across
121 files; veraPDF-validated.

### Added

- **feat(core): PAdES LTV signing (B-B → B-LTA)** — [`signPdfBytesWithTimestamp()`](src/core/pdf-sign-timestamp.ts)
  embeds a verified RFC 3161 signature timestamp (`id-aa-signatureTimeStampToken`);
  [`collectValidationInfo()` / `embedValidationInfo()` / `addValidationInfo()`](src/core/pdf-dss.ts)
  gather certificate chains + OCSP (RFC 6960) / CRL (RFC 5280) material through an
  injected `RevocationProvider` and write `/DSS` with per-signature `/VRI`
  (uppercase-hex SHA-1 keys, existing `/DSS` merged);
  [`addDocumentTimestamp()`](src/core/pdf-doc-timestamp.ts) appends
  `/DocTimeStamp` revisions (ISO 32000-2 §12.8.5). Network transport lives in
  user land via `setTimestampProvider` / `setRevocationProvider` — the engine
  never opens a socket, and rejected or tampered TSA tokens are never embedded.
  New guide: [docs/guides/ltv.md](docs/guides/ltv.md).
- **feat(crypto): LTV building blocks** — canonical DER `SET OF`
  ([`derSetOf`](src/crypto/asn1.ts), X.690 §11.6), `derGeneralizedTime`, SHA-1
  (identification only), RSA SHA-384/512 digest agility, X.509 extension parsing
  (SKI/AKI, EKU, AIA, CRL DP, ocsp-nocheck), CMS `profile: 'pades'` with the ESS
  signing-certificate-v2 attribute (RFC 5035), CMS unsigned-attribute surgery
  ([`addUnsignedAttribute`](src/crypto/cms-utils.ts) — signed bytes untouched),
  and full RFC 3161 / OCSP / CRL builders + parsers
  ([rfc3161.ts](src/crypto/rfc3161.ts), [ocsp.ts](src/crypto/ocsp.ts), [crl.ts](src/crypto/crl.ts)).
- **feat(core): multiple signatures** — `addSignaturePlaceholder({ allowMultiple })`,
  the `fieldName` selector on `signPdfBytes`, placeholder-baked `/Sig` metadata,
  and [`listSignatures()`](src/core/pdf-sig-utils.ts) enumeration; signed
  signatures are located by their real ByteRange values and can never be
  overwritten.
- **feat(chart): charts v2** — `stackedBar` / `stackedBarH` / `area` / `scatter`
  kinds, secondary right axis (`axis2` + `ChartSeries.yAxis`), log and
  UTC-deterministic time scales, per-point `dataLabels`, and x-label collision
  handling: automatic stride plus `labelStride` / `labelRotation`
  ([#67](https://github.com/Nizoka/pdfnative/issues/67)). Chart kinds 5 → 9.
  ([src/core/pdf-chart.ts](src/core/pdf-chart.ts))
- **feat(shaping): colour-emoji flag & ZWJ sequences** — 51 flags + 22 ZWJ
  sequences resolved through the source font's GSUB into single COLR ligature
  glyphs, longest-match pre-pass, VS-16-tolerant matching, per-codepoint
  fallback (never worse than v1.6.0), CLI `--sequences` / `--sequence-list`;
  module budget 4096 → 5120 KB.
  ([src/shaping/emoji-sequences.ts](src/shaping/emoji-sequences.ts))
- **feat(core): PDF/A declaration guards** — conformance diagnostics channel
  ([src/core/pdf-diagnostics.ts](src/core/pdf-diagnostics.ts)) with additive
  `strict` / `onDiagnostic` layout options: `PDFA_NO_FONT_ENTRIES`
  ([#69](https://github.com/Nizoka/pdfnative/issues/69)),
  `PDFA_UNEMBEDDED_FORM_FONT` and `PDFA_DEVICE_CMYK_IMAGE` surface instead
  of silently stamping a `pdfaid` claim veraPDF would reject.
- **feat(core): print production** — bleed/trim/art/crop page boxes
  (`layout.print`, ISO 32000-1 §14.11.2, with a one-line `bleed` shorthand),
  crop + registration marks drawn as pure vector operators outside the
  TrimBox (§14.11.3), `/Trapped` metadata with `pdf:Trapped` XMP parity,
  print-dialog viewer preferences (`duplex`, `pickTrayByPDFSize`,
  `printPageRange`, `numCopies`), a caller-supplied OutputIntent ICC
  profile for tagged output (RGB, validated), large-format `/UserUnit`
  (header raised to PDF 1.7 when set; rejected under PDF/A-1), and
  BleedBox/TrimBox/ArtBox/UserUnit preservation through
  `mergePdfs`/`splitPdf`/`extractPages` (previously dropped). Byte-identical
  output when unused. New guide: [docs/guides/print.md](docs/guides/print.md).
  ([src/core/pdf-print.ts](src/core/pdf-print.ts))
- **feat(parser): incremental metadata updates** — `PdfModifier.updateMetadata()`
  re-issues `/Info` (adding `/ModDate`) and keeps the XMP packet in sync
  (`xmp:ModifyDate` = `xmp:MetadataDate`, CreateDate + `pdfaid:*` preserved)
  per ISO 19005 §6.7.3 parity; `PdfParams.metadata` forwards
  author/subject/keywords to both `/Info` and XMP in `buildPDF`.
- **`docs/assets/ecosystem.json`** — single source of truth for every version,
  count and inventory quoted anywhere in the documentation, and
  **`scripts/verify-docs.ts`** (`npm run verify:docs`) which fails the build when
  a doc disagrees with it. Sixteen rules: manifest shape, filesystem-derived
  counts, stale tokens, canonical presence, version tokens, phantom APIs,
  JSON-LD versions, internal links, SEO head block, sitemap parity, CDN
  integrity and pinning, playground-switcher parity, learn-path chain,
  benchmark parity, WCAG contrast, and llms.txt sync. `--online` adds npm
  drift.
- **`.github/workflows/docs.yml`** — runs the verifier on documentation changes.
  `ci.yml` has `paths-ignore` for `docs/**` and `**.md`, so documentation
  previously triggered no workflow at all.
- **`docs/playgrounds/scale.html`** — generates 1 000 to 100 000 pages in the
  browser via `buildDocumentPDFStreamTrue` in a Web Worker, with three output
  sinks and a measured (not assumed) page count. Replaces `medical-800.html`,
  which becomes a `noindex` redirect stub.
- **`docs/learn/`** — an eight-step guided path for people who have never
  generated a PDF programmatically. Static HTML with a crawlable, script-verified
  prev/next chain.
- **`docs/responsibility.html`** — sustainability, supply-chain and accessibility
  position, every claim linked to the file that proves it, plus an explicit list
  of what is deliberately not claimed.
- **`bench/RESULTS.md`** — dated benchmark run with hardware, sample counts and
  relative error, plus the 1k–100k streaming measurements.
- Structured data for the index pages: `CollectionPage` + `ItemList` covering all
  27 guides and all 9 playgrounds, and `WebSite` + `Organization` on the homepage.

### Fixed

- **fix(shaping): Arabic ALEF joining and Persian letter forms** — ALEF was
  swept into the dual-joining class by a `0x0626–0x0628` range, so every
  word with a non-final alef rendered wrongly (سال collapsed toward سل,
  كتاب/باب mis-joined, السلام drew a medial lam); ALEF is now right-joining
  per UCD ArabicShaping. The presentation-form table also gains the
  Presentation Forms-A entries for the Persian and Urdu letters
  (پ چ ژ ک گ ی، ٹ ڈ ڑ ں ھ ہ ے ۓ), which previously fell back to their
  isolated glyph in every position (قیمت/ریال rendered with joining gaps).
  The bundled Noto Naskh Arabic font always contained every form — the
  shaper never requested them. Arabic visual baselines regenerated; fonts
  without Forms-A keep the previous fallback.
  ([src/shaping/arabic-shaper.ts](src/shaping/arabic-shaper.ts))
- **fix(shaping): RTL digit runs no longer reverse** — `assignLevels` now
  implements UAX #9 I1/I2: AN/EN digit runs resolve to even embedding levels
  in both paragraph directions, so `۱۴۰۵` can never render `۵۰۴۱` again;
  U+06F0–U+06F9 corrected from AN to EN per DerivedBidiClass; L2 rewritten
  run-based ([#70](https://github.com/Nizoka/pdfnative/issues/70)).
  Silently-wrong financial figures, dates and reference numbers in Persian,
  Arabic and Hebrew documents are the affected class.
- **fix(shaping): UAX #9 rule L4 glyph mirroring** — odd-level runs substitute
  paired delimiters through the full 428-pair `BidiMirroring.txt` table
  (generated module, Unicode 17.0.0), replacing the ~40-pair curated map and
  the incorrect comment that declined L4: logical `(X)` no longer renders
  `)X(` around RTL content ([#71](https://github.com/Nizoka/pdfnative/issues/71)).
- **fix(parser): incremental writer & xref reader conformance hardening** —
  per-revision trailer `/ID`: ID[0] preserved byte-exact (it seeds encryption
  key derivation), ID[1] regenerated deterministically per ISO 32000-1 §14.4;
  a present-but-invalid `/Prev` now raises an explicit integrity error instead
  of silently truncating the revision chain; xref streams honour
  `/DecodeParms /Predictor`; appended revisions start on a fresh line after a
  bare `%%EOF`; an absent or corrupt `/Size` recovers from the xref's highest
  entry instead of silently allocating colliding object numbers.
- **fix(core): complete base-14 `/ToUnicode` coverage** — in BOTH builders,
  base-14 dicts reached under a PDF/A claim, and the AcroForm `/Helv` dict
  in EVERY mode (all form-carrying documents change bytes; form text
  becomes searchable/extractable), now carry the shared WinAnsi CMap; cmap
  inversion keeps a legitimately-mapped U+0000
  ([src/fonts/font-embedder.ts](src/fonts/font-embedder.ts)).
- **fix(fonts): COLRv1 composite degradation** — a `PaintComposite` whose
  SOURCE subtree is unsupported now renders its backdrop alone instead of
  dropping the whole glyph — Noto's flags (SRC_IN-masked wave shading over a
  flat backdrop) render as flat flags instead of tofu.
- **Streaming APIs that were never exported** — <!-- verify-docs:allow api-exists (the entry that bans these names) -->
  `streamDocumentPdf`, `streamPdf`
  and `buildPdfStream` <!-- verify-docs:allow api-exists (the entry that bans these names) -->
  appeared in the FAQ, the CLI guide, the homepage, `ROADMAP`
  and `.github/copilot-instructions.md`. Readers copying the FAQ snippet got a
  `TypeError`.
- **`buildDocumentPDFStreamTrue` was documented as constant-memory.** It calls
  `assembleDocumentParts()` to completion before the first yield, so peak memory
  scales with output size. What it actually avoids is the joined binary, which
  lifts V8's ~512 MB single-string ceiling. JSDoc and guide corrected.
- **Package versions and inventories** — the site described cli 1.2.0 (17
  commands shipped, 11 advertised), mcp 1.4.0 (24 tools shipped, 19 and 17
  advertised in different places on the same URL) and react 1.0.0, including in
  the JSON-LD that crawlers consume and which never self-heals.
- **`docs/guides/onboarding.md`** — all four snippets were wrong: `title` nested
  under `metadata` (emitting `/Title ()`), a spurious `await` on a synchronous
  function, the wrong binary name, positional arguments where flags are required,
  and a `--pdf-a` flag that has never existed.
- **`README.md`** claimed 1726+ tests in 48 files twelve lines after stating the
  real 2379+/104; used an invalid `printing` permission key; and stated the
  encryption surface is private after v1.6.0 made it public.
- **The FAQ and troubleshooting guides both said the parser cannot decrypt** — the
  v1.6.0 headline feature.
- **`versions.js`** read the pdfnative pin only from `dependencies`, so the
  annotation silently never rendered for `pdfnative-react`, which declares it as a
  peer.
- **`--c-text-muted` failed WCAG AA** at 2.56:1 on white (3.75:1 dark), applied to
  footer links. Now 7.58:1 and 6.03:1. Added the missing
  `prefers-reduced-motion` block.
- **190 CDN assets loaded without integrity hashes** on a site claiming freedom
  from supply-chain risk — including `marked` and `DOMPurify`, the path that
  renders every guide. 26 unpinned `pdfnative` CDN imports pinned to `@1.6.0`.
- **`agentic-workflows.svg` told agents to rasterise charts to PNG** and route
  them through `embed_image`; `add_chart` has drawn native vector paths since
  mcp 1.5.0.
- **`docs/guides/quickstart.md`** taught table rows as `{ cells: [...] }`, which
  TypeScript rejects (`TS2739`).
- Broken link `docs/guides/tables.md → ../api.md`; `streamToFile` destructured a
  non-existent `chunks` field; `batch` documented with `--input`/`--output`
  instead of `--input-dir`/`--output-dir`.

### Fixed — hardening pass

A review of the branch against the four package sources found defects in the
work above, several of them introduced by it. Recorded because the pass exists
to make the documentation trustworthy, and hiding its own misses would defeat
that.

- **`docs/learn/` taught three snippets that do not work** — on pages whose
  stated argument was that every snippet had been executed. A `lang` field on a
  paragraph block (no block type has one, so Thai and Arabic rendered as tofu),
  a `list` without its required `style`, and `level (1–6)` where `HeadingBlock`
  accepts 1–3. All rewritten and verified by running the published text.
- **`registerFont` alone never reaches the builder.** `buildDocumentPDFBytes` is
  synchronous and cannot await a loader; the working pattern is
  `registerFonts` → `await loadFontData` → `fontEntries`. This was the root
  cause of Arabic rendering as `????` in the React playground, compounded by the
  preset registering under `'arabic'` where the engine looks up `'ar'`.
- **Three playgrounds declared PDF/A conformance they did not have.** `tagged`
  writes the XMP declaration but embeds no font, and ISO 19005 requires every
  font embedded — so those files would fail veraPDF. Fixed by embedding a font,
  which makes the claim true; the trap is now documented in
  `docs/guides/pdfa.md`.
- **`scale.html` documented a main-thread fallback that does not exist**, and
  left the UI permanently stuck when the Worker constructor threw on `file://`.
  Its page counter also dominated the throughput it reported — replaced with
  `TextDecoder`, which moved the measured figure from 8,146 to 22,950 pages/s
  at 10,000 pages (run since superseded by bench/RESULTS.md).
- **The homepage benchmark figures contradicted `bench/RESULTS.md` by three to
  six times** — the file this branch added as their source. Both re-measured
  from one run, and a new `bench-parity` rule now fails the build if they
  diverge again.
- **Two denylisted phantom APIs survived in `src/` JSDoc** and were being
  published into `dist/index.d.ts`. The verifier had never scanned `src/`.
- **Nineteen references to the retired medical-800 playground** survived a pass
  that updated every switcher, including a full card on the playground hub and
  the URL contributors are told to open in `CONTRIBUTING.md`. The stub is now
  deleted outright.
- **Guides had drifted from their packages**: `cli.md` announced 17 commands and
  listed 12, with no reference section for the five v1.3.0 ones; `mcp.md` had no
  v1.5.0 section and attributed 24 tools to a release that shipped 19;
  `react.md` had a 1.1.0 header over a 1.0.0 body and implied that importing the
  root barrel from a Server Component works, when it fails.
- **Five contrast pairs failed WCAG AA** in exactly the place the new contrast
  rule could not look — it compared tokens only against the page background,
  while `.rs-verify` sits on `--c-surface` at 4.34:1.
- **`scale.html` had no `role="progressbar"` anywhere**, an `aria-live` region
  streaming counters dozens of times per run, and its download link inside a
  `role="alert"`.
- The `architecture.svg` badge overflowed its pill by ~40 px and the parser
  subtitle overflowed its box by ~150 px. The React version label is removed —
  a version does not belong in an architecture diagram.

`scripts/verify-docs.ts` is hardened accordingly: assertions compare captured
numbers for equality instead of listing values already known to be wrong (which
is how "19 pdfnative-mcp tools" passed), the denylist scans `src/`, contrast is
checked per token-surface pair, links to `noindex` stubs are rejected, and
`tests/docs/verify-docs.test.ts` proves each rule by introducing the defect it
exists for — a regex rule that matches nothing is indistinguishable from one
that passes.

### Fixed — final ecosystem audit

A second full audit of the branch against the four package sources
(pdfnative 1.6.0, pdfnative-cli 1.3.0, pdfnative-mcp 1.5.0,
pdfnative-react 1.1.0), one reviewer per package plus one for the playgrounds
and benchmarks and one for reading experience. It found that the passes above
had fixed instances while their classes survived elsewhere:

- **The README's MCP section was two releases stale** — "pdfnative-mcp v1.3.0"
  with a 17-row tool table, eleven lines below a header that said v1.5.0 and
  24. No rule matched a version string in prose; a new `version-token` rule
  now fails any package name paired with a semver the manifest contradicts.
- **Phantom or wrong APIs in the guides**: `verifyPdfSignature` (never existed —
  verification lives in the CLI), `registerFontLoader` (real name:
  `registerFont`, in a wrapper recipe that also could not work across a
  process boundary), `rsa-sha384/512` signature options, `report.errors` on a
  lint report that exposes `findings`, `filename` for `fileName`,
  `PdfReader.open()/getMetadata()/getPageCount()` for
  `openPdf()/getInfo()/pageCount`, a `pageLabels` example that was 1-based
  where the API is 0-based, and CLI `batch` examples using `--input`/`--output`
  where the binary requires `--input-dir`/`--output-dir`.
- **`.github/instructions/` taught agents the denylisted streaming phantoms**
  and a parser/forms API surface that never existed — those files were outside
  the verifier corpus. They are inside it now, and the denylist also scans
  `CHANGELOG.md`.
- **The homepage demo runner and the quickstart imported `pdfnative` unpinned**
  from the CDN while the changelog above claimed every import was pinned — the
  pin rule only scanned HTML. It now scans the whole corpus, with a fixture.
- **Stale claims contradicted by the packages**: merge/split/extract "reject
  encrypted sources" (supported via `--password`/`password` since
  cli 1.3.0 / mcp 1.5.0), MCP fonts "downloaded lazily" (they ship bundled —
  the same guide's security model says no network), RFC 3161 timestamp
  detection attributed to the MCP server (CLI-only), "constant-memory"
  streaming in `ROADMAP.md`, and a `file://` message in `scale.html` still
  promising a 1,000-page cap for a main-thread path that was removed.
- **Counts unified against the tree**: 228 sample PDFs across 37 categories
  (44 generators), 2 396 tests in 105 files on the homepage (was 2 379+/104 —
  the count includes the five verifier fixtures this audit adds),
  89 fuzz tests in 5 files (was "48"), 26 bundled font modules, and coverage
  figures dated to their v1.6.0 measurement with the CI gates (88/80/85/90)
  stated alongside.
- **`llms.txt` returned 404 on the published site** — the file lived only at
  the repo root while the site serves `docs/`. A synced copy now ships in
  `docs/`, plus a generated `docs/llms-full.txt` (`npm run docs:llms`)
  concatenating all 27 guides for single-request agent ingestion; a new
  `llms-sync` rule keeps both honest. Guide shells gained `<noscript>`
  Markdown fallbacks and `rel="alternate"` links for non-JS readers, and the
  Learn/Guides/Playgrounds/Responsibility navigation is now uniform across
  page families.
- **The homepage "PDF/A archival" demo failed veraPDF** (ISO 19005-2
  §6.2.11.4.1) — the only executable PDF/A demo on the site with no
  `fontEntries`, so the engine fell back to unembedded standard-14
  Helvetica/Helvetica-Bold while `tagged: 'pdfa2b'` still wrote the XMP
  conformance claim. The demo now embeds Noto Sans like every other PDF/A
  sample. Two adjacent bugs fixed in the same pass: the multilang demo and
  two static homepage snippets placed `tagged` in the params object instead
  of layoutOptions, where it is silently ignored — the flag never did
  anything there, so removing/relocating it changes no output.
- **The 7 page-tree golden fixtures were corrupted at checkout on Windows** —
  `core.autocrlf=true` (a common system-git default) classified the small
  PDFs as text and rewrote their line endings, while `git status` stayed
  clean; the blobs in git were always intact and CI (Linux) was always
  green, which is why the corruption looked like flaky tests. A root
  `.gitattributes` now declares every binary extension, closing the class.
- **International SEO** — every indexable page now self-references with
  `hreflang="en"` + `hreflang="x-default"` (the signal that makes a
  monolingual site the default result for every locale), carries
  `og:locale` and JSON-LD `inLanguage`, and the sitemap mirrors the
  alternates via `xhtml:link`. The 22-script greeting table in the
  all-scripts playground moved out of a `<script>` block into crawlable
  HTML with per-cell `lang`/`dir` — the demo now reads the visible table,
  so indexed content and rendered content are the same data. A new
  `seo-head` rule (with fixtures) keeps all of it enforced.
- **`docs.yml` was the only workflow not pinned by SHA** — actions are now
  pinned like every other workflow (plus the two residual `@v4` floats in
  verapdf.yml and visual-regression.yml), `persist-credentials: false` set,
  and `src/**` added to its path filters: the `api-exists` rule cross-checks
  documented identifiers against `src/`, so a rename there could break the
  docs without triggering the workflow. `npm-drift` became directional —
  docs behind npm still fails `--strict`, a manifest ahead of npm (the
  normal pre-publication window) only warns.

### Changed

- Compliance and security wording brought down to what the code supports:
  "ISO 32000-1 compliant" → "conforms to"; "full veraPDF conformance" →
  "validated against the veraPDF reference validator in CI"; "constant-time
  crypto" → attributed to `node:crypto`, with the pure-JS path marked as not
  constant-time; "zero dependencies" scoped to the engine; "zero allocations"
  → "no intermediate object graph".
- Homepage benchmark rows relabelled from "(Unicode)" to "(embedded font)" — the
  fixture attaches a synthetic font to Latin text and exercises no non-Latin
  codepoint. Shaped-script throughput is stated as not benchmarked.
- The comparison table is dated, names the exact competitor versions, states the
  dependency-count method, and links its source data.
- Hero CTA points at `/learn/` instead of an off-site 85 KB README. The homepage
  now links 22 of the guides and `llms.txt` all 27.

## [1.6.0] – 2026-07-19

Delivers both v1.6.0 roadmap items — a Standard Security Handler **reader/
decryptor** and **streaming** page-tree manipulation — plus six
differentiating additions: **fill & flatten** of existing AcroForm PDFs,
**native vector charts**, **text extraction** (`extractText`), the completed
**encrypted round trip** (re-encrypt merge/split output + encrypted
incremental updates, both pulled forward from v1.7), and an **expanded
colour-emoji subset** (221 → 1167). All additions are additive and opt-in;
unchanged code paths remain **byte-identical** to v1.5.0 (guarded by the
page-tree golden fixtures). Zero runtime dependencies preserved.
104 test files / 2379 tests, all green.

### Added

- **feat(parser):** Standard Security Handler **reader/decryptor** (roadmap).
  `openPdf(bytes, { password })` decrypts RC4 (V1–V4), AES-128 (V4/R4) and
  AES-256 (V5/R6) documents transparently — strings and streams alike — with
  user- and owner-password authentication and crypt-filter dispatch. New
  `reader.encryption` surface; typed `PdfPasswordError` /
  `PdfEncryptionUnsupportedError`. The page-tree API now ingests encrypted
  sources via `PdfSourceInput` (`{ bytes, password }`) or `MergeOptions.password`;
  merged output is always unencrypted. New
  [src/parser/pdf-decrypt.ts](src/parser/pdf-decrypt.ts).
- **feat(parser):** **streaming** page-tree manipulation (roadmap).
  `streamMergedPdfs()` / `streamSplitPdf()` / `streamExtractPages()` emit the
  assembled document as fixed-size chunks (`StreamMergeOptions.chunkSize`,
  default 64 KiB), holding only the cross-reference offsets in memory — stream
  payloads flow straight from the source bytes and the joined document never
  materialises. Byte-identical to the buffered functions. Composes with
  `streamToFile()`.
- **feat(core):** **fill & flatten existing AcroForm PDFs**. `readFormFields()`
  enumerates a document's field tree; `fillForm()` sets `/V` and regenerates
  self-contained Helvetica appearances (text/choice) or updates `/AS` from the
  widget's own on/off states (checkbox/radio); `flattenForm()` stamps
  appearances into page content and drops the interactive layer. Non-destructive
  incremental update, so prior signatures stay valid for their revision. Typed
  `FormFieldNotFoundError` / `FormValueTypeError` / `FormUnsupportedError`. New
  [src/core/pdf-form-fill.ts](src/core/pdf-form-fill.ts).
- **feat(core):** **native vector charts**. A new `chart` document block renders
  bar, horizontal-bar, line (optional markers), pie, and donut charts as pure
  PDF path operators — zero dependencies, no rasterisation. Multi-series, legend,
  "nice" 1/2/5×10ⁿ axis ticks, gridlines, negative values, injection-safe
  colours, and a tagged-PDF `/Figure` + `/Alt` (auto-generated when omitted;
  PDF/A-safe). New [src/core/pdf-chart.ts](src/core/pdf-chart.ts);
  `ChartBlock` / `ChartSeries` / `ChartType` exported.
- **feat(fonts):** the bundled curated colour-emoji subset is expanded from
  **221 to 1167** single-codepoint glyphs (~4.0 MB, within a 4 MB tarball
  budget) — the complete Emoticons and Supplemental Symbols & Pictographs
  blocks, Miscellaneous Symbols & Pictographs through U+1F53D plus clocks and
  emoji-presentation stragglers, and the **complete assigned Transport & Map
  block (U+1F680–1F6FF)**. A build-time size guard prevents silent bloat.
  Flag/ZWJ/skin-tone sequences remain out of scope (use
  `npx pdfnative-build-emoji-font --download --all` for full coverage).
- **feat(crypto):** new internal decryptor primitives — an incremental MD5
  hasher (which also lifts the internal one-shot MD5 512 MB length ceiling)
  and AES-CBC / AES-ECB decryption routines powering `openPdf` and the
  Standard Security Handler. These stay internal to the parser; the public
  crypto surface (`sha384`, `sha512`, `hmacSha256`, …) is unchanged.
- **feat(parser):** **text extraction**. `extractText(bytes, options?)` decodes
  page content streams into per-page reading-order Unicode text plus optional
  positioned runs (`{ text, x, y, fontSize, fontName }` in device space).
  Decoding resolves `/ToUnicode` CMaps (bfchar/bfrange, surrogate pairs),
  `/Encoding /Differences` via a compact AGL subset, and WinAnsi/MacRoman base
  tables; Form XObjects are recursed; encrypted documents work transparently
  via `options.password`. Hard `maxTextLength` memory cap (default 16 M chars)
  and a recursion-free, capped interpreter make it safe on untrusted input.
  New [src/parser/pdf-text-extract.ts](src/parser/pdf-text-extract.ts).
- **feat(parser):** **re-encrypt page-tree output** (pulled forward from the
  v1.7 roadmap). `MergeOptions.encrypt` re-encrypts the document rebuilt by
  `mergePdfs` / `splitPdf` / `extractPages` (and the streaming variants) with
  AES-128 (V4/R4, default) or AES-256 (V5/R6) under fresh passwords and
  permissions — closing the round trip *open encrypted → edit → re-secure*
  (including password rotation in one call). CSPRNG required; RC4 is never
  emitted; no key material from source documents is reused; the unencrypted
  path stays byte-identical.
- **feat(parser|core):** **encrypted incremental update** (pulled forward from
  the v1.7 roadmap). `fillForm()` / `flattenForm()` and
  `PdfModifier.addAnnotation()` now operate on encrypted PDFs: appended
  objects are encrypted under the document's existing scheme (RC4 / AES-128 /
  AES-256) using the key recovered on open, so no plaintext leaks into an
  encrypted file and no scheme downgrade is possible. The incremental trailer
  now carries `/Encrypt` forward; `addRawObject` fails fast on encrypted
  documents. `/P` permission bits are not enforced (documented — password
  authentication gates the update).

### Fixed

- **fix(crypto):** `computeHashR6` now uses the required SHA-256/384/512 rotation
  of ISO 32000-2 Algorithm 2.B instead of substituting SHA-256 for every round,
  so pdfnative's AES-256 (R6) output is spec-compliant. The decryptor keeps a
  legacy-hash fallback so documents written by pdfnative ≤ 1.5.0 still open.
- **fix(core):** encrypted documents now encrypt **all strings** (Info metadata,
  annotation `/Contents`, outline titles, URIs), not just streams — previously a
  spec-compliant reader decrypted those strings to garbage. The `/Encrypt` dict
  and trailer `/ID` stay exempt; non-encrypted output is unchanged.
- **fix(chart):** bar/line values are clamped to the plot band, so an explicit
  `axis.yMin`/`yMax` that excludes part of the data never draws outside the
  chart rectangle.
- **fix(fonts):** the curated colour-emoji list omitted ranges its own header
  claimed (rest of Misc Symbols & Pictographs U+1F4A6–1F5FF, Transport & Map
  U+1F680–1F6FF), so 15 emoji in `color-emoji-basic.pdf` (🖤 🔥 💯 💪 🚗 🚕 🚌
  🚀 🚢 📱 📌 🔒 🔑 💰 💵) rendered as `.notdef` tofu. Coverage completed (see
  the emoji entry above), the header now states actual coverage, and the data
  test hard-asserts every curated codepoint maps to a colour glyph plus
  cross-checks every emoji the showcase generator uses against the bundled
  cmap — the sample can never silently regress to tofu again.
  ([scripts/lib/curated-emoji.ts](scripts/lib/curated-emoji.ts))
- **fix(shaping):** the Arrows block (U+2190–U+21FF: → ← ⇒ ⇔ ↦ …) is now
  classified as math by `isMathCodepoint`/`detectCharLang`, so arrows route to
  the bundled Noto Sans Math font like the operator blocks instead of relying
  on coverage fallback alone.
- **fix(parser):** the xref-table reader tolerates stray blank lines between
  subsections and before `trailer` — seen in hand-assembled real-world PDFs
  and accepted by desktop readers — instead of failing with
  "invalid subsection header".
- **fix(samples):** `math/math-symbols.pdf` rendered every math symbol as `?`
  since v1.5.0 — the generator never passed the math font in `fontEntries`, so
  text fell back to base-14/WinAnsi encoding. It now loads Noto Sans Math (and
  Noto Sans for prose); a new end-to-end test extracts the sample text and
  asserts no `?` ever appears. The three `signature/digital-signature-*.pdf`
  samples also emitted a stray blank line inside their hand-assembled xref
  table; removed.
- **fix(samples):** `charts/charts-tagged.pdf` claimed PDF/A-2b but rendered
  its text with non-embedded base-14 Helvetica, failing veraPDF rule
  6.2.11.4.1 (all rendering fonts must be embedded). The tagged chart sample
  now embeds Noto Sans like every other PDF/A sample.

## [1.5.0] – 2026-07-05

A feature + fix release resolving six community issues (#56–#61) and delivering
four v1.5.0 roadmap items. All additions are additive and opt-in; unchanged code
paths remain **byte-identical** to v1.4.0. Zero runtime dependencies preserved.

### Added

- **feat(fonts):** bundled **Noto Sans Math** data module
  (`pdfnative/fonts/noto-sans-math-data.js`, OFL-1.1) under lang `'math'`
  ([#57](https://github.com/Nizoka/pdfnative/issues/57)). Mathematical
  operators (U+2200–U+22FF), geometric shapes (U+25A0–U+25FF), and supplemental
  math operators (U+2A00–U+2AFF) are detected and routed to the `'math'` font
  automatically by `splitTextByFont`. Opt-in via
  `registerFont('math', () => import('pdfnative/fonts/noto-sans-math-data.js'))`.
  New predicates `isMathCodepoint` / `containsMath` exported.
- **feat(tools):** programmatic font-compilation API
  ([#60](https://github.com/Nizoka/pdfnative/issues/60)). New `pdfnative/tools`
  sub-path export with `parseFontData(buffer)` → font-data object and
  `compileFontData(buffer, opts?)` → ES/CJS module source string, enabling
  in-memory TTF compilation in serverless/edge/sandboxed runtimes without
  spawning the `pdfnative-build-font` CLI.
- **feat(core):** SVG `<text>` / `<tspan>` rendering
  ([#61](https://github.com/Nizoka/pdfnative/issues/61)). SVG blocks now render
  text labels as native PDF text operators (searchable, copy-pasteable,
  tagged-`/Span` accessible), with `x`/`y`/`dx`/`dy` positioning,
  `text-anchor` (start/middle/end), `font-size`, `fill`, HTML-entity decoding,
  and multi-font fallback (emoji/math inside labels).
- **feat(parser):** `PdfReader.getPageLabels()` reads a document's
  `/PageLabels` number tree back into a `PageLabelRange[]` (roadmap).
- **feat(core):** layout debug overlay + inspection (roadmap).
  `PdfLayoutOptions.debug` overlays margin / content / cell boxes; new
  `inspectDocumentLayout()` returns a deterministic, read-only layout report.
  Byte-identical when `debug` is unset.
- **feat(core+parser):** typed annotation read/write API (roadmap). New
  annotation builders (text note, highlight, underline, strikeout, squiggly,
  square, circle, line, free-text) and `PdfReader.getAnnotations(pageIndex)`.
- **feat(streaming):** streaming document-generation parity promotion
  (roadmap). `buildDocumentPDFStreamTrue` is documented as the recommended
  constant-memory path and guarded by a byte-identity parity test.
- **chore(governance):** AI issue-reporting governance
  ([#56](https://github.com/Nizoka/pdfnative/issues/56)). New
  `.github/ai-governance.json`, `.github/AGENT_RULES.md`, and
  `scripts/verify-issue.mjs` enforce a Human-in-the-Loop, zero-dependency,
  draft-only issue-reporting contract for AI agents.

### Fixed

- **fix(core):** control characters (`\n`, `\r`, `\t`, other C0/C1) no longer
  render as tofu (□) in CID-keyed subset fonts under PDF/A mode
  ([#58](https://github.com/Nizoka/pdfnative/issues/58)). Control characters are
  skipped before the subset cmap glyph lookup in `buildTextRunsWithFallback`.
- **fix(core):** multi-line table cells no longer clip descenders when
  `cellPadding` exceeds the default
  ([#59](https://github.com/Nizoka/pdfnative/issues/59)). `planTable` now
  allocates row height using the actual `cellPadding` instead of the hardcoded
  bottom-pad constant. Byte-identical at the default padding (3).

## [1.4.0] – 2026-06-29

Delivers the full v1.4.0 roadmap (document outline / bookmarks, page labels,
`streamToFile()` Node helper) plus two pulled-forward items: a **page-tree
manipulation API** (`mergePdfs` / `splitPdf` / `extractPages`) that unblocks
`pdfnative-mcp`'s `merge_pdfs` / `split_pdf`, and **COLRv1 advanced
compositing** (sweep gradients + `PaintComposite` blend modes). Also bundles
five additional pulled-forward items: `setCryptoProvider`, `validateFontData`,
document viewer preferences, nested lists, and table cell borders + vertical
alignment, a bundled colour-emoji generator CLI, and an interactive PDF Toolkit
playground. 100% backward-compatible. 83 test files / 2165 tests, all green. See
full notes in [release-notes/v1.4.0.md](release-notes/v1.4.0.md).

### Added

- **feat(core):** document outline / bookmarks. `DocumentParams.outline`
  accepts a nested `OutlineItem[]` (with `bold`/`italic`/`color`, and `open`
  for collapsible nodes) or `'auto'` (derived from heading blocks, nested by
  level). Emits `/Outlines` + `/PageMode /UseOutlines`; `open: false` produces a
  spec-correct negative `/Count` (ISO 32000-1 §12.3.3). PDF/A-safe. New
  [src/core/pdf-outline.ts](src/core/pdf-outline.ts); `OutlineItem` exported.
- **feat(core):** page labels. `DocumentParams.pageLabels` (`PageLabelRange[]`)
  builds the `/PageLabels` number tree (decimal / roman / Roman / alpha /
  Alpha / none, `prefix`, `start`). New
  [src/core/pdf-page-labels.ts](src/core/pdf-page-labels.ts);
  `PageLabelRange` / `PageLabelStyle` exported.
- **feat(stream):** `streamToFile(stream, path, { signal? })` writes any
  streaming builder to disk in constant memory with back-pressure handling and
  `AbortSignal` support; on abort/error it removes the partial file. `node:fs`
  via dynamic + type-only import (browser-safe). Returns
  `StreamToFileResult`. ([src/core/pdf-stream-writer.ts](src/core/pdf-stream-writer.ts))
- **feat(parser):** page-tree manipulation API — `mergePdfs()`, `splitPdf()`,
  `extractPages()` rebuild a fresh document by deep-copying each kept page's
  transitive object graph into a new object-number space. Rejects encrypted
  sources; drops signatures + `/AcroForm`; keeps self-contained URI `/Link`
  annotations; bounded-depth copy (stack-overflow hardening); secure-by-default
  256 MiB output cap (`MergeOptions.maxOutputSize`, `Infinity` to disable)
  enforced before oversized streams are materialised (OOM hardening);
  deterministic content-addressed trailer `/ID` (ISO 32000-1 §7.5.5). `splitPdf`
  and `extractPages` also accept `MergeOptions`. Unblocks `pdfnative-mcp`
  `merge_pdfs` / `split_pdf`. New
  [src/parser/pdf-pagetree.ts](src/parser/pdf-pagetree.ts);
  `PageRange` / `MergeOptions` exported.
- **feat(colr):** COLRv1 advanced compositing. `PaintSweepGradient` (conic) →
  `SweepGradientPaint`, rendered as flat-colour triangular wedges clipped to the
  outline; `PaintComposite` → PDF `/BM` blend modes (Multiply, Screen, Overlay,
  Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference,
  Exclusion, Hue, Saturation, Color, Luminosity). Porter-Duff structural modes
  and `PaintMask` keep the documented monochrome fallback. `ColorLayer.blendMode`
  added. ([src/fonts/colr-parser.ts](src/fonts/colr-parser.ts), [src/core/pdf-color-glyph.ts](src/core/pdf-color-glyph.ts))
- **feat(crypto):** pluggable signature crypto provider. `setCryptoProvider(provider)`
  (global) and `PdfSignOptions.provider` (per-call, wins) route CMS signing
  through a native, constant-time signer (`node:crypto` / Web Crypto / HSM)
  instead of the pure-JS RSA/ECDSA math; `rsaKey` / `ecKey` then optional. New
  [src/crypto/crypto-provider.ts](src/crypto/crypto-provider.ts);
  `setCryptoProvider` / `getCryptoProvider` / `CryptoProvider` exported.
- **feat(fonts):** `validateFontData(data)` — opt-in, read-only structural
  validation of custom font-data modules (`{ valid, errors, warnings }`). Catches
  corrupt base64, non-SFNT binaries, empty `cmap`, out-of-range glyph ids,
  malformed `pdfWidthArray`, non-finite metrics. NOT auto-run by `registerFont`.
  New [src/fonts/font-validator.ts](src/fonts/font-validator.ts);
  `validateFontData` / `FontValidationResult` exported.
- **feat(core):** document viewer preferences.
  `PdfLayoutOptions.viewerPreferences` emits catalog `/PageLayout` + `/PageMode`
  and the `/ViewerPreferences` dict (`hideToolbar`, `fitWindow`,
  `displayDocTitle`, `nonFullScreenPageMode`, `direction`, `printScaling`, …).
  PDF/A-safe; an explicit `pageMode` overrides the outline default. New
  [src/core/pdf-viewer-prefs.ts](src/core/pdf-viewer-prefs.ts); `ViewerPreferences`
  exported.
- **feat(doc):** nested (hierarchical) lists. A `ListBlock.items` entry may be a
  plain string or a `{ text, items }` object with a nested sub-list; deeper
  levels indent, numbered sub-lists restart at 1, tagged mode nests `/L → /LI →
  /L`. String-only lists are byte-identical to pre-1.4.0. `ListItem` exported.
- **feat(doc):** table cell borders + vertical alignment.
  `TableBlock.cellBorders` (sides/`all`, `color`, `width`,
  `solid`/`dashed`/`dotted`) draws per-cell vector strokes; `TableBlock.cellVAlign`
  and per-column `ColumnDef.vAlign` position text top/middle/bottom. Both opt-in;
  byte-identical when unset. `CellBorders` exported.
- **docs(samples):** two new generators — `outline-bookmarks.ts` and
  `pdf-manipulation.ts` (201 sample PDFs total).
- **feat(tools):** `pdfnative-build-emoji-font` CLI — bundled with the package
  (`npx pdfnative-build-emoji-font`), generates a colour-emoji data module with
  exactly the glyphs you choose, from a few codepoints to the full ~3,600-glyph
  Noto Color Emoji set, so users of the `pdfnative` package alone get complete
  colour-emoji coverage without editing library source. `--download` fetches +
  checksum-verifies the official OFL-1.1 font; `--ttf`, `--all`, `--preset`,
  `--codepoints`, `--ranges`, `--out`, `--font-name`, `--types`. Dogfoods the
  same deterministic build core as the bundled curated module.
- **docs(site):** new **PDF Toolkit** playground
  ([docs/playgrounds/toolkit.html](docs/playgrounds/toolkit.html)) — interactive,
  in-browser demos of bookmarks, page labels, viewer preferences, nested lists,
  table cell borders, and merge / split / extract. New
  [colour-emoji-cli](docs/guides/colour-emoji-cli.md) guide.

### Security

- **`js-yaml` advisory (dev-only) resolved** via `npm audit fix` (transitive dev
  dep of `@eslint/eslintrc`); `npm audit` reports 0 vulnerabilities. No runtime
  dependency added.

### Changed

- Sample count 178 → 201; test suite 1982 → 2165 (71 → 83 files).

## [1.3.0] – 2026-06-08

Closes issue [#48](https://github.com/Nizoka/pdfnative/issues/48) (CP-1252
extended characters not extractable under base-14 Helvetica) and delivers the
full v1.3.0 roadmap: COLRv1 colour emoji, USE-lite shaper integration, true
constant-memory streaming, UAX #9 X4–X5 character-level overrides, and a
dual-mode pixel-diff visual-regression suite. Also adds **six new scripts**
(Telugu plus Amharic/Ethiopic, Sinhala, Tibetan, Khmer, Myanmar — **17 → 22
Unicode scripts**), a configurable document block limit (`layout.maxBlocks`),
and a read-only `validatePdfUA()` structural checker. 100% backward-compatible.
71 test files / 1982 tests, all green. See full notes in
[release-notes/v1.3.0.md](release-notes/v1.3.0.md).

### Added

- **feat(shaping):** Telugu script (`te`, U+0C00–U+0C7F). New pure-JS
  GSUB/GPOS mini-shaper ([src/shaping/telugu-shaper.ts](src/shaping/telugu-shaper.ts))
  with virama-mediated conjuncts, subjoined-consonant ligatures, and
  above/below mark positioning (no reph, no pre-base reordering). Bundled
  font `pdfnative/fonts/noto-telugu-data.js` (Noto Sans Telugu, OFL-1.1).
  Exports `shapeTeluguText`, `isTeluguCodepoint`, `containsTelugu`,
  `TELUGU_START`, `TELUGU_END`. Opt-in via
  `registerFont('te', () => import('pdfnative/fonts/noto-telugu-data.js'))`.
- **feat(shaping):** five more scripts — Amharic/Ethiopic (`am`,
  U+1200–U+137F), Sinhala (`si`, U+0D80–U+0DFF), Tibetan (`bo`,
  U+0F00–U+0FFF), Khmer (`km`, U+1780–U+17FF), and Myanmar (`my`,
  U+1000–U+109F) — extend pdfnative from 17 to **22 Unicode scripts**. New
  pure-JS mini-shapers follow the Telugu model (shared `gsub-driver` +
  `gpos-positioner`). Ethiopic is a syllabic abugida needing only detection +
  font routing; Sinhala builds virama conjuncts, pre-base kombuva reordering
  and two-part vowel decomposition; Tibetan stacks subjoined consonants
  vertically; Khmer and Myanmar are pragmatic USE-lite (coeng/medials,
  pre-base vowels, virama stacking). Bundled fonts (all OFL-1.1):
  `noto-ethiopic-data.js`, `noto-sinhala-data.js`, `noto-tibetan-data.js`
  (Noto Serif Tibetan), `noto-khmer-data.js`, `noto-myanmar-data.js`. Exports
  `shapeSinhalaText`, `shapeTibetanText`, `shapeKhmerText`,
  `shapeMyanmarText` and the matching script-registry predicates. Opt-in via
  `registerFont('am'|'si'|'bo'|'km'|'my', () => import('pdfnative/fonts/…'))`.
  ([src/shaping/sinhala-shaper.ts](src/shaping/sinhala-shaper.ts),
  [src/shaping/tibetan-shaper.ts](src/shaping/tibetan-shaper.ts),
  [src/shaping/khmer-shaper.ts](src/shaping/khmer-shaper.ts),
  [src/shaping/myanmar-shaper.ts](src/shaping/myanmar-shaper.ts))
- **feat(core):** configurable document block limit. The previously
  hard-coded 10 000-block cap in `assembleDocumentParts()` is now
  `layout.maxBlocks` with the default raised to **100 000**
  (`DEFAULT_MAX_BLOCKS`). Large multi-thousand-page reports no longer hit a
  spurious ceiling. ([src/core/pdf-document.ts](src/core/pdf-document.ts))
- **feat(parser):** `validatePdfUA(bytes)` — read-only PDF/UA (ISO 14289-1)
  structural checker returning `{ valid, errors, warnings }`. Verifies
  `/MarkInfo /Marked`, `/StructTreeRoot` + `/ParentTree`, `/Metadata`,
  `/Lang`, and per-page `/MCID` uniqueness. Complements veraPDF.
  ([src/parser/pdf-ua-validator.ts](src/parser/pdf-ua-validator.ts))

- **feat(fonts):** COLRv1 colour emoji. Noto Color Emoji (OFL-1.1) is
  bundleable as a curated subset (`pdfnative/fonts/noto-color-emoji-data.js`,
  221 colour glyphs). COLR v0 solid layers and COLR v1 linear / radial
  gradients render as native PDF Form XObjects (`/Shading` Type 2/3 +
  `/ExtGState` alpha). Opt-in via
  `registerFont('emoji', () => import('pdfnative/fonts/noto-color-emoji-data.js'))`;
  monochrome emoji is unchanged when not registered. Self-rendered `glyf` /
  COLR / CPAL parsers, zero dependency.
  ([src/core/color-emoji.ts](src/core/color-emoji.ts),
  [src/fonts/colr-parser.ts](src/fonts/colr-parser.ts))
- **feat(core):** `buildPDFStreamTrue()` and `buildDocumentPDFStreamTrue()` —
  true constant-memory streaming. The PDF is assembled into raw parts and
  yielded as fixed-size `Uint8Array` chunks while each part is freed, so the
  fully-joined binary never materialises in memory. Byte-identical to the
  buffered builders.
  ([src/core/pdf-stream-writer.ts](src/core/pdf-stream-writer.ts))
- **feat(shaping):** UAX #9 X4–X5 character-level direction overrides.
  `resolveBidiRuns()` now forces every codepoint inside an LRO / RLO scope to
  L / R (previously only the base direction was normalised).
  ([src/shaping/bidi.ts](src/shaping/bidi.ts))
- **test(visual):** dual-mode pixel-diff visual-regression suite — a
  glyph-position snapshot guard (show-operator GIDs + baselines) plus a
  rendered-glyph pixel diff (self-rendered `glyf` rasteriser + zero-dependency
  grayscale PNG encoder, ≤1% tolerance) over self-contained extreme-script
  fixtures. CI workflow gated on shaping / font / core changes.
  ([tests/visual/](tests/visual/),
  [.github/workflows/visual-regression.yml](.github/workflows/visual-regression.yml))
- **scripts(samples):** per-language document samples for the five new
  scripts (`doc-sinhala`, `doc-tibetan`, `doc-khmer`, `doc-myanmar`,
  `doc-amharic`) at parity with `doc-telugu`; four text-shaping deep-dives
  (`shaping-sinhala`, `shaping-tibetan`, `shaping-khmer`, `shaping-myanmar`);
  and all five wired into the multi-script font-subsetting and 22-script
  multi-language showcases. `npm run test:generate` now produces **187 sample
  PDFs** across 32 generators.
- **docs(playgrounds):** new `docs/playgrounds/all-scripts.html` — generates a
  single PDF containing all 22 Unicode scripts plus native COLRv1 colour emoji
  in the browser, demonstrating automatic per-code-point font routing, BiDi,
  GSUB/GPOS shaping, and subsetting.

### Changed

- **feat(shaping):** the USE-lite cluster classifier (`classifyUseCategory()`)
  is now the joiner-classification authority across the Devanagari, Bengali,
  and Tamil shapers. Orphan ZWJ / ZWNJ no longer emit `.notdef`; nukta+virama,
  half-form / ZWJ-conjunct, Marathi eyelash-ra, and Bengali ya-phalaa edge
  cases are handled correctly. ([src/shaping/use-lite.ts](src/shaping/use-lite.ts))

### Fixed

- **fix(core, tagged PDF):** per-line MCID allocation in wrapped table cells
  and multi-line table captions. A single MCID was previously reused on every
  wrapped line, producing duplicate `/MCID` values inside one `/TD` / `/TH` /
  `/Caption` (a PDF/UA, ISO 14289-1 §7.10, violation). Each wrapped line now
  gets a distinct MCID; single-line cells and the legacy table path are
  byte-identical. ([src/core/pdf-renderers.ts](src/core/pdf-renderers.ts))
- **fix(fonts, #48):** base-14 Helvetica text now carries a `/ToUnicode` CMap
  so the Windows-1252 high range (€ ‚ ƒ „ … † ‡ ™ œ ž Ÿ …) is correctly
  extractable and searchable. When a `latin` font is registered these glyphs
  additionally embed and render. ([src/fonts/encoding.ts](src/fonts/encoding.ts))
- **fix(shaping, colour emoji):** emoji variation selectors (VS-15/VS-16),
  ZWJ/ZWNJ, and Fitzpatrick skin-tone modifiers that no registered font
  covers are now dropped during run-splitting instead of resolving to
  `.notdef` tofu. Joiners are still preserved when an Indic shaper font maps
  them. New `isZeroWidthFormat()` predicate.
  ([src/shaping/multi-font.ts](src/shaping/multi-font.ts),
  [src/shaping/script-registry.ts](src/shaping/script-registry.ts))
- **fix(core, colour emoji):** `renderColorGlyph()` now derives each
  colour-glyph Form `/BBox` from the transformed contour bounds rather than
  the hard-coded em box, so colour emoji that dip below the baseline are no
  longer clipped. ([src/core/pdf-color-glyph.ts](src/core/pdf-color-glyph.ts))

## [1.2.0] – 2026-05-27

Closes issues [#45](https://github.com/Nizoka/pdfnative/issues/45)
(`addSignaturePlaceholder()` API) and
[#46](https://github.com/Nizoka/pdfnative/issues/46) (X.509 issuer/subject
DN slice corruption), ships object-boundary page-by-page streaming,
completes UAX #9 with embedding controls (LRE/RLE/LRO/RLO/PDF), lands
a USE-lite cluster classifier for future Indic shaper rewires, and adds
_smart tables_ — planner-driven multi-page rendering with auto-wrap,
repeated headers, zebra striping, and captions. 100%
backward-compatible. 53 test files / 1822 tests, all green. See full
notes in [release-notes/v1.2.0.md](release-notes/v1.2.0.md).

### Added

- **feat(crypto, #45):** new `addSignaturePlaceholder(pdfBytes, options?)`
  API — injects an AcroForm + invisible signature widget plus a `/Sig`
  dictionary into an existing PDF via incremental update so
  `signPdfBytes()` can sign freshly-rendered output without downstream
  workarounds. Idempotent on already-signed PDFs.
  ([src/core/pdf-sig-placeholder.ts](src/core/pdf-sig-placeholder.ts))
- **feat(core):** `buildDocumentPDFStreamPageByPage()` and
  `buildPDFStreamPageByPage()` — emit an existing PDF binary as an
  `AsyncGenerator<Uint8Array>` chunked at PDF object boundaries
  (`\nendobj\n`). Useful for streaming the assembled PDF over HTTP / Node
  `WriteStream`. (True one-page-at-a-time _assembly_ remains a v1.3
  target.)
- **feat(shaping):** `normalizeBidiEmbeddings(text)` — UAX #9 explicit
  embeddings (LRE / RLE / LRO / RLO / PDF, U+202A–U+202E) rewritten to
  their sealed-isolate equivalents before BiDi resolution. Stack depth
  125. Invoked transparently from `resolveBidiRuns()`.
- **feat(shaping):** USE-lite cluster classifier in
  [src/shaping/use-lite.ts](src/shaping/use-lite.ts) — `UseCategory`,
  `classifyUseCategory(cp)`, `classifyClusters(cps)`. Per-script tables
  for Devanagari / Bengali / Tamil. Public API ready; shaper rewire
  follows in v1.3.0.
- **refactor(crypto):** `SigDictMetadata` interface extracted from
  `PdfSignOptions` and reused by both `buildSigDict()` and
  `addSignaturePlaceholder()`.
- **refactor(parser):** [src/parser/pdf-modifier.ts](src/parser/pdf-modifier.ts)
  gains `addRawObject(body)` so placeholder-style raw payloads round-trip
  through incremental save without re-serialisation.
- **scripts(samples):** new `signature-placeholder`,
  `bidi-embeddings-showcase`, and `document-table-parity` generators
  wired into `npm run test:generate` (161 sample PDFs total).
- **feat(core, tables):** six new optional `TableBlock` fields, all
  `@since 1.2.0`: `wrap` (`'auto'` | `'always'` | `'never'`, default
  `'auto'`), `repeatHeader` (default `true`), `zebra`, `caption`,
  `minRowHeight`, `cellPadding`. Planner-driven multi-page slicing in
  [src/core/pdf-renderers.ts](src/core/pdf-renderers.ts) +
  [src/core/pdf-document.ts](src/core/pdf-document.ts). Tagged-mode
  `/Table` continues across slices via shared structure-tree accumulator
  (ISO 14289-1 §7.10.6). Existing single-page tables are byte-identical
  to v1.1.0 in their body rendering; bold header positioning shifts by
  2–5pt (correctness fix — see Fixed). See
  [docs/guides/tables.md](docs/guides/tables.md).
- **feat(fonts):** new public `helveticaBoldWidth(str, sz)` exported from
  the root (also from `pdfnative/fonts`). Drives the bold-header
  positioning fix.
- **feat(core):** `txtR`, `txtC`, `txtRTagged`, `txtCTagged` in
  [src/core/pdf-text.ts](src/core/pdf-text.ts) gain an optional trailing
  `bold` parameter (default `false`, backward-compatible).
- **chore(types):** `SigDictMetadata` interface now re-exported from the
  package root. Aligns the runtime surface with the v1.2.0 release notes
  that already advertised it as a stable public type.
- **feat(types, tables):** new optional `ColumnDef.kind?: 'amount'` —
  opt-in replacement for the pre-1.2.0 hardcoded `i === 3` heuristic in
  `renderTable`. When set, data cells render in Helvetica-Bold with
  credit/debit colour driven by `row.type`. Reserved enum.
- **feat(core, mcp):** `PDF_A_CONFORMANCE_TARGETS = ['pdfa1b','pdfa2b','pdfa2u','pdfa3b'] as const`
  and `PdfAConformanceTarget` type exported from the root. Single
  source of truth for tooling — most notably the `pdfnative-mcp`
  server's tool-schema `enum:`. Materially improves how Gemini-CLI and
  other LLM agents discover the legal `pdfA` values.
  ([src/core/pdf-tags.ts](src/core/pdf-tags.ts))
- **docs(demo):** smart-tables example added to the live demo gallery
  at [pdfnative.dev](https://pdfnative.dev) — 32-row table exercising
  `wrap: 'auto'`, `repeatHeader: true`, `zebra: true`, and `caption`
  end-to-end in the browser. ([docs/app.js](docs/app.js))

### Fixed

- **fix(crypto, #46):** `parseCertificate()` issuer and subject `raw`
  slices now correctly begin with the ASN.1 SEQUENCE tag `0x30`. ASN.1
  `decodeAt()` was only patching direct-child offsets, so grandchildren
  carried offsets relative to their parent's value buffer rather than the
  original DER — producing malformed slices that broke CMS
  `IssuerAndSerialNumber` parsing in Adobe Reader and openssl-cms.
  Defensive `raw[0] === 0x30` assertion added at the `parseName()`
  boundary.
- **fix(samples):** `bidi-embeddings-showcase.pdf` — restored a missing
  space in the orphan-PDF demo paragraph (was `"textwith"`, now
  `"text with"`). Cosmetic only.
- **fix(fonts, tables):** right- and centre-aligned bold text (table
  headers, captions) is now measured with Helvetica-Bold AFM advance
  widths instead of Helvetica-Regular. Pre-1.2.0 the `"Amount"` header
  overshot its column by ~2pt at 8pt because the renderer measured
  Regular metrics while rendering Bold glyphs; the trailing `t` got
  clipped/overhung. New `helveticaBoldWidth()` + opt-in `bold` flag on
  `txtR/C/...`, wired through smart-table headers, legacy `buildPDF()`,
  and `autoFitColumns`. Unicode/CIDFont mode unaffected.
  ([src/fonts/encoding.ts](src/fonts/encoding.ts),
  [src/core/pdf-text.ts](src/core/pdf-text.ts),
  [src/core/pdf-renderers.ts](src/core/pdf-renderers.ts),
  [src/core/pdf-builder.ts](src/core/pdf-builder.ts),
  [src/core/pdf-column-fit.ts](src/core/pdf-column-fit.ts))
- **fix(samples):** `document/table-wrap-auto.pdf` and
  `document/table-zebra-caption.pdf` — amount column rewritten with
  `toFixed(2)` (was rendering floating-point noise like
  `+37.019999999999996`); Amount column slightly widened in the
  wrap-auto sample for clarity.
- **fix(core, tables):** `renderTable()` no longer hardcodes column
  index 3 as the Amount column with Helvetica-Bold + credit/debit
  colour. Styling is now opt-in via the new
  `ColumnDef.kind === 'amount'` field. Resolves the spurious bold +
  truncation on the Notes column of `table-smart-autofit.pdf`. The
  legacy `buildPDF()` financial path keeps the historical heuristic for
  byte-identical v1.0/v1.1 output.
- **fix(core, tables):** `emitCell` now applies the v1.1 character
  truncate (`mx` / `mxH`) only when `wrap: 'never'`. Under `'auto'` and
  `'always'` the planner has already sized the column to fit, so the
  redundant char-truncate previously inserted spurious `…` ellipses
  in auto-fitted tables.

### Changed

- **chore(meta):** version bumped to `1.2.0`. Still zero runtime
  dependencies.
- **feat(core, tables):** `wrap` defaults to `'auto'` and `repeatHeader`
  defaults to `true` for multi-page tables. Single-page tables that fit
  without wrapping remain byte-identical to v1.1.0; multi-page tables
  now reprint their header by default. Opt back into v1.1.0 single-pass
  behaviour with `repeatHeader: false` and `wrap: 'never'`.

### Deferred to v1.3.0

- COLRv1 colour emoji renderer; USE-lite shaper rewire; internal
  page-by-page _assembly_; pixel-diff visual regression; UAX #9 X4–X5
  character-level overrides inside LRO/RLO scopes.

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
  dynamic `import(…)`, and exposes `buildDocumentPDFStream`, `registerFonts`,
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

- **AsyncGenerator streaming** — `buildPDFStream()` / `buildDocumentPDFStream()` yield `Uint8Array` chunks progressively
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
