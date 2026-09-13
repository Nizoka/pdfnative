# pdfnative — Project Guidelines

> Canonical rules for Copilot; [AGENTS.md](../AGENTS.md) is the condensed cross-editor version; [CLAUDE.md](../CLAUDE.md) adds the Claude Code addendum. Keep the three consistent.
> Per-area detail lives in [.github/instructions/](instructions/) (one file per area, selected by `applyTo`). Counts and versions come from `docs/assets/ecosystem.json`, enforced by `npm run verify:docs`.

## Overview

Pure native PDF generation and parsing library. Zero runtime dependencies. ISO 32000-1 (PDF 1.7) and ISO 19005 (PDF/A) conformant output; veraPDF is blocking in CI.
Target: exceed GAFAM-grade quality standards in code, testing, performance, and documentation.

## Architecture

| Path | Purpose | Read first |
|---|---|---|
| `src/core/` | Document/table builders, text, images, tags/XMP, encryption, compression, forms, signatures/LTV, streaming, print | `instructions/pdf-core.instructions.md` |
| `src/parser/` | Tokenizer → object parser → xref → reader/modifier; decrypt, text extraction, page-tree merge/split, PDF/UA check | `instructions/pdf-core.instructions.md` |
| `src/fonts/` | WinAnsi + CIDFont encoding, lazy font registry, TTF subsetter, CMap builder, font-data validator | `instructions/font-engineering.instructions.md` |
| `src/shaping/` | GSUB/GPOS shapers (Thai, Arabic, Indic, …), UAX #9 BiDi, script detection, emoji sequences, generated USE data | `instructions/text-shaping.instructions.md` |
| `src/crypto/` | SHA, ASN.1/DER, RSA, ECDSA, X.509, CMS, RFC 3161, OCSP/CRL, injected timestamp/revocation providers | `instructions/pdf-core.instructions.md` |
| `src/worker/` | Web Worker dispatch + self-contained worker entry | `instructions/worker.instructions.md` |
| `src/tools/` | `pdfnative/tools` entry: `compileFontData` / `parseFontData` | `instructions/font-engineering.instructions.md` |
| `src/types/` | All public types (`pdf-types.ts`, `pdf-document-types.ts`) | `instructions/api-design.instructions.md` |
| `scripts/generators/` | Sample PDF generators (`npm run test:generate`); helpers in `scripts/helpers/`, shared cores in `scripts/lib/` | `instructions/testing.instructions.md` |
| `tests/` | Vitest suites mirroring `src/`, plus fuzzing, visual, regression (sample byte manifest) and docs suites | `instructions/testing.instructions.md` |
| `docs/` | pdfnative.dev site: guides (`.md` + generated `.html`), playgrounds, learn path, llms files, `assets/ecosystem.json` | `instructions/api-design.instructions.md` |
| `recipes/` | Executable documentation (`recipes/*.ts`, indexed by `recipes/index.json`), scanned by `verify:docs` | `instructions/api-design.instructions.md` |

Other top-level directories: `fonts/` (generated font-data modules + git-ignored TTF sources), `tools/` (`build-font-data.cjs`, the TTF → data-module CLI),
`bench/` (vitest bench), `release-notes/` (per-version notes; shipped ones are read-only history).

### Dependency rules

- **Single entry point**: `src/index.ts` re-exports everything public. **Types-first**: domain types live in `src/types/`; consumers import them from the root.
- **Strict unidirectional flow**: `types → core ← fonts ← shaping ← worker`; `crypto` is near-standalone (imports `sha256` from `core/pdf-encrypt`); `parser` imports from `core` (`pdf-compress`, `pdf-encrypt`, `pdf-tags`).
- **One sanctioned reverse edge**: the incremental-update modules in `core/` (`pdf-sig-placeholder`, `pdf-form-fill`, `pdf-dss`, `pdf-sig-utils`, `pdf-doc-timestamp`)
  import the `parser/` reader/modifier because they operate on existing PDFs. Keep new reverse edges to that feature family.
- `encoding-context.ts` lives in `core/` (dependency inversion that broke the `fonts/ → shaping/` cycle); `script-registry.ts` in `shaping/` is the single source of Unicode range constants and script predicates.
- `pdf-renderers.ts` (block renderers, wrapping, height estimation) and `pdf-assembler.ts` (`createPdfWriter`, `writeXrefTrailer`) are internal helpers shared by the builders — not re-exported.

## Code Style

- **English everywhere** — code, comments, messages, tests, sample prose, recipes, docs, release notes. Other languages are demonstrated content only:
  sample data records and script-coverage tables carry a `lang` label; any other foreign-language sentence is framed in English and marked
  `demo-language: <tag> (reason)` on or above the line. The guards detect fr/es/it/pt/de prose and mojibake; other languages rely on the marker and review.
- **TypeScript strict mode** — `strict: true`, `noUnusedLocals`, `noUnusedParameters`. No `any`; use `unknown` with narrowing.
- **ES2020 target** — no polyfills; native `BigInt`, optional chaining, nullish coalescing.
- **ESM-first** — every internal import uses the `.js` extension (`import { x } from './foo.js'`). Type-only imports must be top-level (ESLint forbids inline `import()` types).
- **No classes** — pure functions only; state is passed explicitly. **No module-level side effects** (`sideEffects: false`, probed by `npm run verify:bundle`).
- **Immutable by default** — `readonly` on interface props unless mutation is required. Prefer `const`; never `var`.
- **Short domain names are fine** — `txt`, `txtR`, `txtC` are PDF text-operator conventions.
- Template literals over concatenation for PDF stream assembly.
- **No `console.log`** in library code (tools/ and scripts/ only). `console.warn` is allowed **only** inside `src/core/pdf-diagnostics.ts`, the single sanctioned diagnostics sink (`onDiagnostic` redirects, `strict` escalates).
- **No `eval()` / `Function()` / dynamic code execution.**

## Build & Test

`npm run gate` is THE quality gate (`scripts/gate.ts`; its `STEPS` table is the step list; logs in `test-output/.gate/<step>.log`; summary ≤ 20 lines).

```bash
npm run gate                 # CI profile (default)
npm run gate -- --fast       # typecheck:all, lint, test, verify:docs — before every commit
npm run gate -- --publish    # everything incl. test:generate, verify:samples, validate:pdfa, verify:fonts, verify:bundle
npm run gate -- --only <step>   # one step; --json for machine-readable output
```

Individual commands still exist:

```bash
npm run build            # tsup → dist/ (ESM + CJS + .d.ts; worker and tools entries)
npm run test             # vitest run (dot reporter); one suite: npx vitest run tests/<path>.test.ts
npm run test:coverage    # vitest with v8 coverage (thresholds in vitest.config.ts)
npm run test:generate    # regenerate the sample PDFs → test-output/
npm run typecheck:all    # src/ + tests/ + scripts/
npm run lint             # eslint src/ (ESLint 9 + typescript-eslint strict)
npm run validate:pdfa    # veraPDF over every PDF/A-claiming sample (coverage canary vs declared.pdfaSamples; skips when veraPDF is absent, blocking in CI)
npm run verify:samples   # byte manifest of test-output/ vs tests/regression/baselines/samples.sha256.json; refuses identical pairs unless listed in IDENTICAL_SAMPLE_GROUPS
npm run verify:fonts     # fonts/*-data.js reproduce byte-identically from the TTF sources
npm run verify:unicode   # src/shaping/use-data.ts matches scripts/data/*.txt (generate-use-data.ts --check)
npm run verify:bundle    # tree-shaking probe from dist/
npm run verify:docs      # offline doc-consistency rules; docs/assets/ecosystem.json is the source of truth
npm run docs:all         # docs:api + docs:guides + docs:llms (regenerates api.json, guides/*.html, llms files)
```

- Build tool **tsup**; test runner **vitest**; CI is GitHub Actions on Node 22/24 (lint, typecheck, test, build, veraPDF, sample regression, font reproducibility, docs).
- Publish: GitHub Actions OIDC Trusted Publishing (`npm publish --access public`; provenance attached via `id-token: write`). Agents never publish.
- Generated files are regenerated, never hand-edited: `fonts/*-data.js` + `.d.ts`, `src/shaping/use-data.ts`, `scripts/data/*.txt` (vendored UCD, never edited),
  `docs/assets/api.json`, `docs/guides/*.html`, `docs/llms*.txt` / `llms-index.json`, `tests/regression/baselines/samples.sha256.json` (`verify:samples --update`,
  only with a declared rebaseline), `dist/`, `coverage/`, `test-output/`, `package-lock.json`. The regenerate commands are tabulated in AGENTS.md §Generated files.
- All new code must have tests. Coverage ≥ 88 % statements is enforced by CI (currently ≈ 90.9 % statements); the full thresholds (88/80/85/90 statements/branches/functions/lines) are declared once in `vitest.config.ts`.

## Quality Standards

- **Zero dependency** policy — no runtime `dependencies` in package.json.
- **Tree-shakeable** — `sideEffects: false`, no module-level side effects, probed by `verify:bundle`.
- **ISO 32000-1** compliance for every generated PDF; **ISO 14289-1 (PDF/UA)** in tagged mode (structure tree, /ActualText, marked content).
- **ISO 19005** — PDF/A-1b, PDF/A-2b (default tagged mode: PDF 1.7, `pdfaid:part=2`), PDF/A-2u, PDF/A-3b; veraPDF blocking in CI.
- **Cross-platform** — Node.js, browsers, Deno, Bun, Web Workers. The engine never opens sockets: TSA/OCSP/CRL transport is injected via `TimestampProvider` / `RevocationProvider`.
- **Input validation at the boundary** — `buildPDF()` null/undefined/type checks and row limit; `validateURL()` allows only `http:`, `https:`, `mailto:` and rejects control characters.
- **Byte-identity** — every opt-in feature produces byte-identical output when unused (tested convention); the sample byte manifest pins the generated PDFs.
- **Security** — no `eval()`, CSPRNG-only key/IV generation (`fillRandom` throws without `crypto.getRandomValues`), per-object IVs, real CMS signatures, zip-bomb / recursion / xref-chain caps in the parser.
- **NPM provenance** — signed builds via GitHub Actions OIDC.
- **Human-in-the-loop governance** — agents draft; humans submit. See [AGENT_RULES.md](AGENT_RULES.md) and [ai-governance.json](ai-governance.json).

## Conventions

### PDF-specific invariants

- PDF operators are built as plain strings, not an AST: `"BT /F1 10 Tf ... ET"`. Binary offsets use `byteLength()` (never `.length`) — critical for the xref table.
- All colour values are PDF operator RGB strings (`"0.145 0.388 0.922"`); `parseColor()` validates hex / tuple / PDF string and `normalizeColors()` runs at the layout boundary.
- Tagged PDF: marked content `/Span << /MCID n /ActualText <hex> >> BDC…EMC`; MCIDs restart at 0 per page (`/StructParents`).
  Structure tree: `/Document → /Table → /TR → /TH|/TD`, `/H1–H3`, `/P`, `/L → /LI`, `/Figure`, `/Link`, `/TOC → /TOCI`, `/Form`.
- XMP: `<?xpacket begin="\xEF\xBB\xBF"` uses raw UTF-8 BOM bytes (not `﻿`). XMP streams are never compressed. `dc:creator` is emitted only when `metadata.author` is set and mirrors `/Info /Author`.
- PDF/A invariant: `/Info CreationDate` and `xmp:CreateDate` come from the SAME `buildPdfMetadata()` call in `pdf-tags.ts` — never inline `new Date()` in the builders. Both carry the timezone offset.
- Trailer `/ID` is always emitted: unencrypted = deterministic `md5("pdfnative|"+title+"|"+pdfDate+"|"+totalObjs)` (never randomize — determinism tests depend on it);
  encrypted = `encState.docId`.
- `resolvePdfAConfig(tagged)` maps the option to version/part/conformance; `PDF_A_CONFORMANCE_TARGETS` is the single source of truth consumed by downstream tooling.
  PDF/A and encryption are mutually exclusive (ISO 19005-1 §6.3.2), validated at the build boundary.
- Encryption: AES-128 (V4/R4) and AES-256 (V5/R6) with per-object keys and random IVs (AES-CBC + PKCS7); `emitStreamObj()` compresses and/or encrypts transparently.
  Compress BEFORE encrypt (ISO 32000-1 §7.3.8). `initNodeCompression()` enables native zlib in ESM; stored-block fallback otherwise.
- Images: `/DCTDecode` (JPEG) or `/FlateDecode` + `/Predictor 15` (PNG); RGBA rejected. Links: only `http:` / `https:` / `mailto:`. Watermarks: ExtGState transparency, forbidden under PDF/A-1b (`validateWatermark()` throws).
- Font subsetting always preserves `.notdef` (GID 0); CIDFont Type2 uses Identity-H — glyph IDs are hex-encoded directly. Right/centre-aligned bold text measures with `helveticaBoldWidth()`.
- Typography: en-dash `–` (U+2013) with spaces as title/footer separator, not em-dash — WinAnsi-encodable and 44 % narrower. Uniform `•` bullet at every list depth (zero-tofu choice).
- BiDi: UAX #9 with isolates, embeddings normalised to isolates, full L4 mirroring (generated `bidi-mirroring-data.ts`, applied before any cmap lookup), I1/I2 digit levels;
  `resolveBidiRuns()` returns runs in visual order. Arabic: GSUB positional forms + lam-alef; Hebrew: BiDi order only.
- Shaping: `tryLigature()` in `gsub-driver.ts` and the mark positioners in `gpos-positioner.ts` are shared by every Indic/Arabic shaper;
  `classifyUseCategory()` (`use-lite.ts`) is the joiner-classification authority. Colour-emoji sequences are matched longest-first and fall back per codepoint.
- Streaming: `buildPDFStream` / `buildDocumentPDFStream` chunk an assembled binary; the `…StreamTrue` variants never materialise it and are the ones to use at scale; `streamToFile()` honours back-pressure and `AbortSignal`.
- Parser: tokenizer → object parser → xref parser → reader → modifier (`openPdf()` / `createModifier()`); page-tree surgery only via `mergePdfs` / `splitPdf` / `extractPages`.
  Hardening caps: `MAX_PARSE_DEPTH`, `MAX_XREF_CHAIN`, `MAX_INFLATE_OUTPUT`, `MAX_COPY_DEPTH`, `MAX_MERGE_SOURCES`, `maxOutputSize`.
- Signatures: `signPdfBytes()` builds CMS SignedData (RSA PKCS#1 v1.5 SHA-256/384/512, ECDSA P-256; `profile: 'pades'`).
  LTV ladder: `signPdfBytesWithTimestamp` → `addValidationInfo` → `addDocumentTimestamp`; `setCryptoProvider()` is the native-crypto escape hatch.
- Legacy `buildPDF()` keeps its financial-statement byte-stability invariants (hard-coded amount column, header baselines); the document builder path uses `ColumnDef.kind`.

### API

- Public API is stable and backward-compatible; every public function/type is exported from `src/index.ts` and documented in README §API reference and `docs/assets/api.json`.
- Font data modules are lazy-loaded via `registerFont()` + `loadFontData()`; the worker threshold defaults to 500 rows.
- Downstream-impacting changes are documented in the **Downstream integration notes** of the relevant `release-notes/vX.Y.Z.md`.

### Error handling

- Validate at system boundaries only (public entry points); internal functions trust their callers.
- Descriptive `Error` messages with context: `throw new Error(\`Font '\${lang}' not registered\`)`.

### Performance

- Zero allocations in hot paths (text rendering loop, glyph encoding); TTF subsetting reuses `ArrayBuffer` views; font data is decoded once and cached in the registry.
- Benchmark any change to the core rendering loop (`npm run bench`). See `instructions/performance.instructions.md`.

### Workflow

- Conventional Commits (`feat(scope):`, `fix(scope):`, `docs:`, `test:`, `refactor:`, `chore:`); no `Co-Authored-By` trailers.
- New runtime feature → `src/` + `tests/` (mirroring layout) + a generator in `scripts/generators/` + ROADMAP.md entry + entry in the next `release-notes/vX.Y.Z.md`.
- Never push, never open PRs/issues/releases, never publish: the maintainer does. Issue drafts go to `.github/drafts/` and pass `npm run verify:issue` first.
