# pdfnative-cli — Command-Line Interface Guide

> **Tracks the latest published `pdfnative-cli`** (v1.6.0, requires pdfnative ≥ 1.9.0 — pins `^1.9.0`). The CLI versions independently from the library. Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html). Full history: [pdfnative-cli releases](https://github.com/Nizoka/pdfnative-cli/releases).

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface** for the [`pdfnative`](https://github.com/Nizoka/pdfnative) library. It exposes 21 commands in five groups — create & edit (`render`, `fill`, `annotate`, `metadata`), page tree (`merge`, `split`, `extract`), security (`sign`, `verify`, `ltv`, `doc-timestamp`, `encrypt`, `decrypt`), read & extract (`inspect`, `extract-text`, `compare`), and automation & meta (`batch`, `doctor`, `schema`, `completion`, `govern`) — that together cover the full document lifecycle from JSON to a signed, timestamped, archive-grade PDF with the complete PAdES ladder (B-B → B-T → B-LT → B-LTA), plus page-tree editing, markup annotations, document comparison, and an AI-governance gate, with an agent-native automation contract for autonomous AI and CI pipelines. Since v1.5.0 it also exposes the typography engine, PDF/X-4 output with CMYK colours, custom fonts from disk and byte-reproducible builds; v1.6.0 adds right-to-left layout under the full Unicode Bidirectional Algorithm, 32 Unicode scripts, spot colours, the PDF/A-2 + PDF/X-4 dual claim, JPEG 2000 images, a stream-limit policy for text extraction and PAdES B-LT from material you already hold.

> **Why a CLI?** Many real-world workflows live outside Node.js: shell scripts, CI pipelines, Docker containers, Makefiles, batch jobs, build tools written in other languages. The CLI lets all of them call `pdfnative` without writing JavaScript, and is fully composable through stdin/stdout pipelines.

The CLI is a **pure dispatch layer** over `pdfnative`. No PDF logic lives in the CLI itself — every command forwards to a public `pdfnative` API:

| CLI command | `pdfnative` API |
|---|---|
| `render` | `buildDocumentPDFBytes()` / `buildDocumentPDFStream()` / `buildDocumentPDFStreamTrue()` / `buildPDFBytes()` (table variant = `buildPDFBytes`, the table-centric builder; document variant = `buildDocumentPDFBytes`, the free-form block builder) |
| `fill` | `readFormFields()` / `fillForm()` / `flattenForm()` |
| `encrypt` / `decrypt` | `openPdf(bytes, { password })` + `MergeOptions.encrypt` |
| `extract-text` | `extractText()` — since v1.6.0 with `onStreamError` (`--on-stream-error limit\|throw\|skip`) |
| `doctor` | — (environment probe, no library equivalent) |
| `sign` | `signPdfBytes()` / `addSignaturePlaceholder()` — the native constant-time provider is implemented in the CLI (`createNativeCryptoProvider` is a CLI utility, not a pdfnative API) and passed per call as `options.provider` (pdfnative also exposes a global `setCryptoProvider()`, which the CLI does not use) |
| `inspect` | `openPdf()` / `getInfo()` / `pageCount` / `getPageLabels()` / `getAnnotations()` / `validatePdfUA()` / `validatePdfX()` *(v1.5.0)* / `decodePdfTextString()` *(v1.6.0 — `/Info` strings in PDFDocEncoding and UTF-16)* |
| `verify` | `openPdf()` + `verifyCertSignature()` (X.509 certificate-signature checks); the CMS/PKCS#7, RFC 3161 timestamp and OCSP/CRL revocation verification is implemented in the CLI itself |
| `merge` | `mergePdfs()` |
| `split` | `splitPdf()` |
| `extract` | `extractPages()` |
| `annotate` | `PdfModifier.addAnnotation()` / `buildAnnotationBody()` — since v1.6.0 the `link` type too (the engine builds the `/Link` + `/URI` body; the CLI's own builder is gone) |
| `metadata` | `PdfModifier.updateMetadata()` — incremental `/Info` + XMP edits that keep existing signatures valid for their revision |
| `ltv` | `collectValidationInfo()` / `embedValidationInfo()` / `addValidationInfo()` (PAdES B-LT `/DSS`) / `composeLtvData()` *(v1.6.0 — `embed --cert` / `--ocsp` / `--crl` material)* |
| `doc-timestamp` | `addDocumentTimestamp()` — an RFC 3161 `/DocTimeStamp` revision (PAdES B-LTA) |
| `compare` | `openPdf()` / `extractText()` / `readFormFields()` / `getAnnotations()` / `listSignatures()` / `decodePdfTextString()` *(v1.6.0)* — text + structure diff, implemented in the CLI |
| `govern` | AI-governance contract (`.github/ai-governance.json`, `AGENT_RULES.md`) — draft gating uses the CLI's own `validateGovernanceDraft()` (the core repo's equivalent check is a repo script, not a published API) |
| `batch` | the `render` pipeline, applied in parallel across a directory |
| `schema` | versioned JSON Schemas (Draft 2020-12) for every input/output shape |

This means **every feature of the library is one release away from the CLI**, and any bug fix in `pdfnative` is automatically picked up by `pdfnative-cli` on its next dependency bump.

---

## Installation

```bash
# Run directly with npx — no global install required
npx pdfnative-cli render --input document.json --output report.pdf

# Or install globally
npm install --global pdfnative-cli
pdfnative render --input document.json --output report.pdf
```

**Requirements:** Node.js ≥ 22 *(since v1.4.0 — Node 20 reached end-of-life on 2026-04-30)* · Bun · Deno (`node dist/cli.cjs`).

The CLI ships with **NPM provenance** — verify the published artifact with `npm audit signatures` or on [npmjs.com](https://www.npmjs.com/package/pdfnative-cli).

---

## When to use the CLI vs the library

| Use the **CLI** when… | Use the **library** when… |
|---|---|
| You write shell scripts, Makefiles, or Bash/PowerShell pipelines | You build a Node.js / Bun / Deno service |
| Your CI/CD job runs in Docker or GitHub Actions | You need fine-grained streaming control or Web Worker offloading |
| You want to compose with `cat`, `jq`, `tee`, `gzip`, etc. | You target browsers, Web Workers, or Deno Deploy |
| You sign, verify, or inspect PDFs ad-hoc from the terminal | You bundle PDFs through a custom pipeline (custom font registry, hooks, etc.) |
| You want a one-liner instead of a 30-line Node.js script | You need 100 % programmatic control of the API surface |

The two are **complementary**. A typical full-stack project uses the library at runtime and the CLI in CI scripts and operator workflows.

---

## Quick start

### 1. Render a document

Create `report.json`:

```json
{
  "title": "April 2026 Report",
  "blocks": [
    { "type": "heading", "text": "April 2026 Report", "level": 1 },
    { "type": "paragraph", "text": "Summary for the financial period ending 30 April 2026." },
    { "type": "list", "style": "bullet", "items": [
      "Revenue: +18% year-on-year",
      "Net Promoter Score: 72",
      "Active customers: 12,400"
    ]},
    { "type": "table",
      "headers": ["Quarter", "Revenue", "Profit"],
      "rows": [
        { "cells": ["Q1", "$1.2M", "$400K"], "type": "credit", "pointed": false },
        { "cells": ["Q2", "$1.5M", "$600K"], "type": "credit", "pointed": true }
      ]
    }
  ],
  "footerText": "Confidential",
  "metadata": { "author": "Finance Team", "subject": "April 2026 Report" }
}
```

Render it:

```bash
pdfnative render --input report.json --output report.pdf
```

That's it — the file `report.pdf` is now a valid ISO 32000-1 PDF, ready to send.

### 2. Sign the rendered PDF (with metadata)

```bash
# Set keys via environment variables (recommended for CI/CD — never logged)
export PDFNATIVE_SIGN_KEY="$(cat private.pem)"
export PDFNATIVE_SIGN_CERT="$(cat cert.pem)"

pdfnative sign \
  --input report.pdf \
  --output report.signed.pdf \
  --reason "Approved by Finance" \
  --name "Finance Team" \
  --location "Paris, FR" \
  --signing-time 2026-04-28T10:00:00Z
```

The CLI accepts both **RSA PKCS#1 v1.5** and **ECDSA P-256** keys, both with SHA-256 digests. The signed PDF carries a CMS/PKCS#7 signature embedded as ISO 32000-1 §12.8 prescribes, validatable by Adobe Acrobat, MuPDF, and any other PAdES-compatible reader.

### 3. Verify embedded signatures

```bash
pdfnative verify --input report.signed.pdf --strict --trust ca-root.pem
```

v0.3.0 performs **real CMS/PKCS#7 verification** — the CLI recomputes the byte-range digest, validates the signature value (RSA-SHA256 or ECDSA-SHA256), walks the certificate chain via `pdfnative`'s `verifyCertSignature`, evaluates trust against `--trust` roots and self-signed acceptance, and reports the presence of an RFC 3161 timestamp token. Exit code is 0 on success, 1 on any failure under `--strict`.

A sample JSON report:

```json
{
  "signatures": [
    {
      "integrity": true,
      "signatureValid": true,
      "signatureAlgorithm": "ecdsa-sha256",
      "chainValid": true,
      "trustedRoot": true,
      "timestampPresent": false,
      "signerSubject": "CN=pdfnative-cli ECDSA Test, O=pdfnative-cli, C=FR",
      "signerIssuer": "CN=pdfnative-cli ECDSA Test, O=pdfnative-cli, C=FR",
      "notes": ["no --trust provided; accepted self-signed root"]
    }
  ]
}
```

<!-- legacy anchor preserved for incoming external links -->
<a id="pdfnative-verify-new-in-v020"></a>

### 4. Inspect any PDF

```bash
pdfnative inspect --input report.signed.pdf --format text
```

```
Version:        1.7
Pages:          2
Encrypted:      no
PDF/A:          none
Signatures:     1
Title:          April 2026 Report
Author:         Finance Team
Created:        2026-04-28T10:00:00+00:00
Subject:        April 2026 Report
Producer:       —
```

JSON output (default) is suited for piping into `jq` or storing as a CI artifact.

---

## Hybrid layout model

`render` adopts the same layout philosophy as `gh`, `kubectl`, and `docker`: high-frequency knobs are first-class flags, while the full `PdfLayoutOptions` shape is reachable via a JSON layout file.

**Precedence:** `CLI flags > --layout file > pdfnative defaults`.

```bash
# 1) Flags only — best for ad-hoc invocations
pdfnative render --input doc.json --output report.pdf \
  --page-size A4 --margin 50 --compress --tagged pdfa2b

# 2) Layout file only — best for reproducible CI configs
pdfnative render --input doc.json --output report.pdf \
  --layout layout.json

# 3) Hybrid — base config in a file, per-job overrides on the CLI
pdfnative render --input doc.json --output report.pdf \
  --layout layout.json \
  --watermark-text "DRAFT $(date +%Y-%m-%d)"
```

`layout.json` accepts any subset of `PdfLayoutOptions`:

```json
{
  "pageSize": { "width": 595, "height": 842 },
  "margin": { "top": 60, "right": 50, "bottom": 60, "left": 50 },
  "compress": true,
  "tagged": "pdfa2b",
  "headerTemplate": { "left": "{title}", "right": "{date}" },
  "footerTemplate": { "center": "Page {page} / {pages}" }
}
```

> **Security:** `--layout` paths are validated against directory traversal, and any `attachments[].data` field embedded in the JSON is **stripped on load**. Binary attachment payloads must come from `--attachment <path>` so the CLI can apply the same path-validation rules.

---

## Command reference

### `pdfnative render`

Renders a JSON document into a PDF. Supports both renderer variants exposed by `pdfnative`.

#### Core flags

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | JSON file ([`DocumentParams`](https://pdfnative.dev/assets/api.json) for `--variant document`, `PdfParams` for `--variant table`) |
| `--output <file>` | stdout | Output PDF path |
| `--variant document\|table` | `document` | Selects `buildDocumentPDFBytes` (free-form) or `buildPDFBytes` (table-centric) |
| `--stream` | off | Streaming output via `buildDocumentPDFStream` (`AsyncGenerator<Uint8Array>`) — recommended for >100-page documents |
| `--stream-page-by-page` | off | Streaming chunked at PDF object boundaries. Assembles the full document first, so TOC blocks and `{pages}` **are** supported. Mutually exclusive with `--stream` |
| `--stream-true` *(v1.1.0)* | off | Streaming via `buildDocumentPDFStreamTrue` / `buildPDFStreamTrue` — PDF parts are emitted and freed as they go, so the joined binary never materialises. Byte-identical to the buffered builders. Same constraints as `--stream` (no TOC, no `{pages}`); mutually exclusive with the other `--stream*` flags |
| `--max-blocks <n>` *(v1.1.0)* | `100000` | Exposes `layout.maxBlocks` so very large multi-thousand-page reports no longer hit a spurious ceiling |
| `--layout <file.json>` | — | Load any subset of `PdfLayoutOptions` |
| `--chunk-size <n>` *(v1.4.0)* | `65536` | Chunk size in bytes for the `--stream` / `--stream-true` output (not applicable to `--stream-page-by-page`) |
| `--strict` *(v1.4.0)* | off | Escalate conformance diagnostics into a hard failure **before the first output byte** — exit 1, `E_CHECK_FAILED`. Since v1.6.0 the set is 13 diagnostic codes: PDF/A (`PDFA_NO_FONT_ENTRIES`, `PDFA_UNEMBEDDED_FORM_FONT`, `PDFA_DEVICE_CMYK_IMAGE`, `PDFA_DEVICE_CMYK_CONTENT`, `PDFA_ICC_PROFILE_VERSION`, and *(v1.6.0)* `PDFA_GLYPH_WITHOUT_UNICODE`, `PDFA1_JPX_IMAGE` — a JPEG 2000 image under PDF/A-1, which is PDF 1.4 — and `PDFA_JPX_IMAGE` — a JPEG 2000 image with an opacity channel or a channel count other than 1, 3 or 4 under PDF/A-2/3), PDF/X (`PDFX_NO_FONT_ENTRIES`, `PDFX_DEVICE_CMYK`, `PDFX_ANNOTATIONS`), `TYPOGRAPHY_FEATURE_INEFFECTIVE` and *(v1.6.0)* `TEXT_GLYPH_NOT_COVERED` (a code point no registered font covers). Without it they are `warning:` lines on stderr (hidden by `--quiet`) plus an additive `diagnostics[]` array in the `--json` envelope |
| `--dry-run` (global) | off | Since v1.5.0 `render --dry-run` **runs the real build in memory** and discards the bytes: engine coherence errors (`--pdfx` without an output intent, attachments without PDF/A-3, …) and every diagnostic — `--strict` included — surface exactly as on a real run. The envelope carries `dryRun: true` and no `bytes` |

#### Smart tables _(v1.3.0, document variant)_

These flags fill `TableBlock` fields left unset in the JSON (caption is per-table — set it in the JSON `TableBlock`):

| Flag | Description |
|------|-------------|
| `--table-wrap <mode>` | `auto` (default), `always`, or `never` |
| `--repeat-header [true\|false]` | Repeat the header row on continuation pages |
| `--zebra [true\|false\|"R G B"]` | Alternate-row striping |
| `--min-row-height <pt>` | Minimum row height in points |
| `--cell-padding <pt>` | Horizontal cell padding in points |

#### Page geometry

| Flag | Default | Description |
|------|---------|-------------|
| `--page-size <name\|WxH>` | `a4` | Named (`a4`, `letter`, `legal`, `a3`, `tabloid`, `a5`) or `WxH` in points |
| `--margin <N>` or `<t,r,b,l>` | `50` | Uniform or per-side margin in points |
| `--compress` | off | Apply `/Filter /FlateDecode` to all content streams |

#### PDF/A conformance

| Flag | Default | Description |
|------|---------|-------------|
| `--tagged <level>` | `none` | Unified PDF/A flag: `none`, `pdfa1b`, `pdfa2b`, `pdfa2u`, `pdfa3b`. Since v1.6.0 `pdfa2b` / `pdfa2u` combine with `--pdfx pdfx4` (the dual claim, below); the `--json` envelope carries `tagged` when a level is claimed |
| `--conformance <level>` | — | **Deprecated.** Maps to `--tagged pdfa<level>` with a one-line stderr notice. Removed in v1.0.0 |

#### PDF/X-4 output _(v1.5.0)_

`--pdfx` is mutually exclusive with every encryption flag (rejected with exit 2 before the build). Since v1.6.0 it is **no longer exclusive with `--tagged`**: `--tagged pdfa2b` or `pdfa2u` next to `--pdfx pdfx4` is the PDF/A-2 + PDF/X-4 **dual claim** — two OutputIntents and both identifications in the XMP; the CLI pre-check that refused the pair is gone. `pdfa1b` and `pdfa3b` with `--pdfx` are refused by the engine with a level-specific message, transmitted as `E_INPUT` (exit 1, not the former usage error). Needs pdfnative ≥ 1.9.0.

| Flag | Default | Description |
|------|---------|-------------|
| `--pdfx pdfx4` | — | Claim PDF/X-4 (ISO 15930-7). Requires a printer (`prtr`) output intent and every font embedded (`--font latin --lang latin` or `--font-file`). `--trapped unknown` is refused; omitted, the file declares `/Trapped /False`. Each page gets a TrimBox — from `layout.print` (bleed or `trimBox`), else the BleedBox or MediaBox — unless it sets an ArtBox; both is an error. Engine coherence errors (missing output profile, `--trapped unknown`, `layout.pdfx` with `pdfa1b` / `pdfa3b`, TrimBox and ArtBox together, …) map to `E_INPUT`; the `--json` envelope carries `pdfx: "pdfx4"` (and `tagged` under the dual claim) |
| `--output-intent-icc <file.icc>` | — | ICC profile for `layout.outputIntent` (RGB, CMYK or Gray). PDF/X-4 needs a printer-class (`prtr`) profile — **CMYK or Gray** both qualify. 16 MiB cap, `acsp` signature checked, then validated by the engine |
| `--output-intent-id <s>` | ICC file basename | `outputConditionIdentifier` of the output intent |
| `--trapped true\|false\|unknown` | — | `/Info /Trapped` (also XMP); wins over `metadata.trapped` in the JSON. Under `--pdfx`, `unknown` is refused and omitted means `false` |

Colours everywhere — document JSON, `--layout` and colour flags — accept CMYK beside hex / RGB: `"c m y k"` operands in 0–1 or `[c,m,y,k]` in percent (`DeviceCMYK`). `layout.print.marks.colourBars: true | { tints, size }` adds printer's colour bars to the marks. Since v1.6.0 spot inks declared in `layout.print.spotColours` can be painted next to them (see *Right-to-left, spot colours, the dual claim & JPEG 2000* below). Re-check the result with `pdfnative inspect --check pdfx` — or `--check pdfa,pdfx` for the dual claim (structural validation evidence, not a certified preflight).

#### Watermarks

| Flag | Description |
|------|-------------|
| `--watermark-text <str>` | Diagonal text watermark |
| `--watermark-image <path>` | Image watermark (PNG/JPEG and, since v1.6.0, JPEG 2000 `.jp2` / `.j2k` — the format is sniffed from the bytes, never from the extension; centered, aspect-preserved) |
| `--watermark-opacity <0..1>` | ExtGState `/ca` value |
| `--watermark-angle <deg>` | Rotation angle |
| `--watermark-color <hex\|R,G,B>` | Fill color (text only) |
| `--watermark-font-size <pt>` | Font size (text only) |
| `--watermark-position background\|foreground` | Drawing order vs. content |

> Watermarks with transparency are **mutually exclusive** with PDF/A-1b (ISO 19005-1 §6.4). The pdfnative core enforces this at render time — the run fails with the generic exit code 1 (`Watermark transparency is not allowed with PDF/A-1b`), not a CLI usage error.

#### Headers / footers

| Flag | Description |
|------|-------------|
| `--header-left <str>` / `--header-center` / `--header-right` | Page-template zones |
| `--footer-left <str>` / `--footer-center` / `--footer-right` | Page-template zones |

Supported placeholders: `{page}`, `{pages}`, `{date}`, `{title}`. The `{pages}` placeholder is rejected with `--stream` because the total page count is only known after multi-pass pagination.

#### Encryption

Since v1.3.0, `render` speaks the same **unified encryption vocabulary** as `merge` / `split` / `extract`:

| Flag | Env var | Description |
|------|---------|-------------|
| `--encrypt [aes-128\|aes-256]` | — | Enable encryption (bare `--encrypt` = `aes-128`) |
| `--owner-password <pass>` | `PDFNATIVE_ENCRYPT_OWNER_PASS` | **Required** whenever encryption is requested |
| `--user-password <pass>` | `PDFNATIVE_ENCRYPT_USER_PASS` | Optional password needed to open the document |
| `--permissions <list>` | — | Comma list: `print`, `copy`, `modify`, `extract` |

The legacy v0.2.0 flags — `--encrypt-algorithm`, `--encrypt-owner-pass`, `--encrypt-user-pass`, `--encrypt-permissions` — remain accepted as aliases; when both are given, the unified value wins.

Env vars take precedence over flags, ensuring secrets never appear in shell history. Encryption is **mutually exclusive** with `--tagged pdfa*` per ISO 19005-1 §6.3.2 — rejected with exit 2.

#### PDF/A-3 attachments

| Flag | Description |
|------|-------------|
| `--attachment <path>[:mime[:rel[:desc]]]` | Embed a file as `/EmbeddedFile`. Repeatable |

The Windows drive-letter colon (`D:\path`) is detected and not split — see *Troubleshooting*.

#### Multilingual fonts

| Flag | Description |
|------|-------------|
| `--lang <code,code>` | Activate font loaders for the listed languages (e.g. `th,ja,ar,te,si,km,lo`). Since v1.5.0 the aliases `ha`, `yo`, `ig`, `sw` (Hausa, Yoruba, Igbo, Swahili) resolve to `latin` |
| `--font <name>` *(v1.1.0)* | Register a bundled pdfnative font shortcut. Repeatable. Allow-list covers every bundled font — 36 bundled font modules: `latin`, `emoji`, `color-emoji`, `math` *(v1.2.0)*, and the 32 script codes — `ar hy bn ru hi am ka el he ja km ko my pl zh si ta te th bo tr vi` plus *(v1.5.0)* `lo nod khb tdd cjm` (Lao, Tai Tham, New Tai Lue, Tai Le, Cham) plus *(v1.6.0)* `gu pa kn ml or` (Gujarati, Gurmukhi / Punjabi, Kannada, Malayalam, Odia); `ha yo ig sw` alias `latin`. Each shortcut name doubles as its `--lang` code. Since v1.5.0 `--variant table` embeds these fonts too |
| `--font-file <path.ttf>[:name]` *(v1.5.0)* | Register a TrueType/OpenType font from disk. Repeatable. Path-traversal check, 32 MiB cap, magic bytes (`00 01 00 00`, `true`, `OTTO` — collections and WOFF are refused), then parsed and validated by pdfnative (errors → `E_INPUT`, warnings → stderr). The name defaults to the file stem (`[a-z0-9-]`) and is added to `--lang`; a name that collides with the bundled allow-list is a usage error. Never loadable from a JSON payload |

`--lang` activates a *programmatically registered* font loader via `loadFontData(code)`. Latin scripts are built-in. With v1.1.0, every bundled font is registrable directly through `--font` — no wrapper script needed for the 32 bundled scripts, colour emoji, or Latin. pdfnative routes each code point to the font whose cmap covers it. Since v1.5.0, a font you ship yourself is registered with `--font-file`; see *Recipes → Multilang fonts* for the library path when you need a custom loader.

#### Bookmarks, math & layout tooling _(v1.2.0)_

| Flag | Description |
|------|-------------|
| `--outline auto\|<tree.json>` | Add a navigable PDF bookmark tree (`/Outlines`). `auto` derives it from the document's headings; a file supplies an explicit `OutlineItem[]` tree |
| `--font math` | Register the bundled **Noto Sans Math** font; pdfnative auto-routes math-operator and geometric-shape code points to it |
| `--inspect-layout` | Emit a `LayoutInspection` JSON report (per-page blocks, positions, sizes) instead of a PDF (document variant only) |
| `--debug-layout [margins,content,cells]` | Render a normal PDF with the opt-in layout-debug guides overlaid |

```bash
# Bookmarks derived from headings + math font
pdfnative render --input paper.json --output paper.pdf --outline auto --font math

# Layout introspection instead of a PDF
pdfnative render --input report.json --inspect-layout > layout.json
```

#### Print production, images from JSON & charts v2 _(v1.4.0)_

Everything here is reachable through the existing `--layout` file and the document JSON (pdfnative ≥ 1.9.0 on the current release). v1.4.0 added no flags for it; since v1.5.0, typography and PDF/X have dedicated flags (see *PDF/X-4 output* above and *Typography* below), and `layout.outputIntent` can be supplied with `--output-intent-icc`:

- **Image blocks in the document JSON** — `{ "type": "image", "src": "logo.png" }` (path resolved relative to the `--input` JSON, same validation as `--attachment`) or `{ "type": "image", "dataBase64": "…" }` for inline JPEG/PNG — and, since v1.6.0, JPEG 2000 (`.jp2` container or raw `.j2k` codestream), passed through as `/JPXDecode`.
- **`layout.print`** — `bleed`, `trimBox` / `bleedBox` / `artBox` / `cropBox`, vector printer's marks (`print.marks`), and `/UserUnit` (1–75 000). `merge` / `split` / `extract` now preserve these boxes too.
- **`layout.outputIntent`** — a custom ICC output intent (RGB, CMYK or Gray since v1.5.0); **`layout.viewerPreferences`** — `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`.
- **`params.metadata`** — `author`, `subject`, `keywords`, and `trapped: True|False|Unknown`, written to `/Info` and XMP.
- **Charts v2** — the `chart` block now covers 9 types (adds `stackedBar`, `stackedBarH`, `area`, `scatter`), a secondary Y axis (`series.yAxis: "right"` + `axis2`), `category` / `linear` / `time` X axes, log scale, `dataLabels`, `labelStride`, and `labelRotation`.

#### Typography _(v1.5.0)_

<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
The pdfnative 1.8.0 typography engine is reachable through `layout.typography` — in the document JSON or a `--layout` file — and four flags that fill the same keys:

| Flag | Description |
|------|-------------|
| `--split-paragraphs [true\|false]` | Paragraphs may break across pages (widows / orphans default to 2) |
| `--keep-headings-with-next [true\|false]` | A heading never ends a page alone |
| `--kerning [true\|false]` | Pair kerning — needs a registered font (`--font` / `--font-file`) |
| `--font-features <tag,…>` | Comma-separated four-letter OpenType features (`tnum`, `pnum`, `lnum`, `onum`, `zero`, `ordn`, `sups`, `subs`, `smcp`, `c2sc`, `case`); a tag the font cannot honour raises the `TYPOGRAPHY_FEATURE_INEFFECTIVE` diagnostic |

`layout.typography` carries the engine's 12 keys verbatim: `widows`, `orphans`, `splitParagraphs`, `keepHeadingsWithNext`, `opticalMargins`, `punctuationSpacing` (`"fr"`, `"fr-CA"` or a rules array), `unitBinding`, `bindShortWords`, `hyphenationLanguage`, `kerning`, `fontFeatures`, `metrics` (`"exact"` acts on the base-14 path only). Soft hyphens (U+00AD) are honoured unconditionally. Paragraph blocks accept `align: "justify"`, `keepWithNext` and `splittable`; heading blocks accept `keepWithNext`. Flags win over the file; nested `typography` / `outputIntent` objects merge one level deep between the document, `--layout` and the flags. `punctuationSpacing: "fr"` inserts narrow no-break spaces only where a font is embedded (`--font latin --lang latin`).

```bash
pdfnative render --input report.json --output report.pdf --font latin --lang latin \
  --split-paragraphs --keep-headings-with-next --kerning --font-features onum,smcp
```

#### Right-to-left, spot colours, the dual claim & JPEG 2000 _(v1.6.0)_

Two new `render` flags (57 → 59) carry the pdfnative 1.9.0 bidirectional engine; everything else in this block is reachable from the document JSON or a `--layout` file, with no flag of its own.

| Flag | Default | Description |
|------|---------|-------------|
| `--direction auto\|ltr\|rtl` | — *(unset)* | `layout.direction` — the base text direction under the full Unicode Bidirectional Algorithm (UAX #9). `auto` resolves each paragraph from its first strong character; `rtl` right-aligns and justifies in visual order, with punctuation and numbers on the right side. A paragraph block's own `direction` wins. **There is no CLI default**: omitted, nothing is set and the output is the left-to-right behaviour of the previous engine. The envelope carries `direction` when set |
| `--actual-text [true\|false]` | — *(engine default `true`)* | `layout.actualText` — untagged shaped and right-to-left runs carry their logical text as `/Span /ActualText`, so `extract-text` returns Arabic, Hebrew, Khmer, Myanmar or Indic text as typed. Only `false` changes the output (the bare glyph runs, extraction in visual order — not the 1.8.0 bytes: the 1.9.0 subsets and line structure still apply); it removes the logical-order guarantee on that file, and the envelope carries `actualText: false` only in that case |

```bash
pdfnative render --input letter.json --output letter.pdf --direction auto \
  --font ar --font he --font latin --lang ar,he,latin
pdfnative extract-text --input letter.pdf --format ndjson
```

**Spot colours** — JSON only (document JSON or `--layout`), no CLI validator: declare the inks in `layout.print.spotColours: [{ "name": "PANTONE 300 C", "alternate": [100, 44, 0, 0] }]` (the alternate is a CMYK tuple in percent or an RGB tuple), then paint with `{ "spot": "PANTONE 300 C" }`, `{ "spot": "…", "tint": 0.5 }` (0–1) — a `/Separation` colour space named after the ink — or `{ "inks": { "PANTONE 300 C": 1, "PANTONE 1235 C": 0.4 } }`, a `/DeviceN` mix. Accepted wherever a colour is: text, tables and charts, where `series[].colors` paints one colour per value on the four bar kinds and a series `label` is optional (`Series N` when missing). The engine's refusals (an undeclared ink, a mix across alternate spaces — messages starting with `Spot colour ` / `Ink mix `) are `E_INPUT`, before any byte is written under `--dry-run`. A RIP that knows the ink puts it on its own plate; a composite proof paints the alternate.

**JPEG 2000** — an `image` block or `--watermark-image` whose bytes are a `.jp2` container or a raw `.j2k` codestream is embedded untouched as `/JPXDecode` (PDF 1.5), with the colour space and opacity its header declares (an RGBA image becomes `/SMaskInData 1`). The engine sniffs the magic bytes — the file extension is never consulted. Under PDF/A the image raises `PDFA1_JPX_IMAGE` (PDF/A-1 has no JPX filter) or `PDFA_JPX_IMAGE` (an opacity channel, or a channel count other than 1, 3 or 4, under PDF/A-2/3) — both escalate under `--strict`.

**The dual claim** — `--tagged pdfa2b --pdfx pdfx4 --output-intent-icc <cmyk-or-gray.icc>` writes one file that claims PDF/A-2b (or 2u) *and* PDF/X-4; `inspect --check pdfa,pdfx` asserts both with one exit code. `pdfa1b` and `pdfa3b` stay exclusive with `--pdfx` (engine refusal, `E_INPUT`). See *PDF/X-4 output* above for the output-intent rules.

#### Iteration helpers _(v0.3.0)_

| Flag | Description |
|------|-------------|
| `--watch` | Re-render on input file change. 200 ms debounce, stderr-only logs. Requires `--input <file>` and a file `--output` (stdin / stdout pipelines are not supported — watch needs a stable on-disk source) |
| `--template <file.json>` | Deep-merge a base template under stdin / `--input`. Plain objects merge recursively; arrays and primitives are replaced (caller wins). Useful for centralising title / layout / headers in CI |

```bash
# Watch a file
pdfnative render --input report.json --output report.pdf --watch

# Template + override (template carries title/layout/headers, stdin overrides body)
echo '{"blocks":[{"type":"paragraph","text":"Today only."}]}' \
  | pdfnative render --template template.json -o today.pdf

# Bundled fonts via flag (no wrapper)
echo '{"blocks":[{"type":"paragraph","text":"Hi \ud83d\ude80"}]}' \
  | pdfnative render --font latin --font emoji --lang latin,emoji -o out.pdf
```

### `pdfnative sign`

Applies a CMS/PKCS#7 digital signature to an existing PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--output <file>` | stdout | Output signed PDF |
| `--key <file>` | `PDFNATIVE_SIGN_KEY` env | PEM-encoded private key (env var takes precedence) |
| `--cert <file>` | `PDFNATIVE_SIGN_CERT` env | PEM-encoded X.509 certificate (env var takes precedence) |
| `--cert-chain <file>` | `PDFNATIVE_SIGN_CHAIN` env | Intermediate-CA PEM (repeatable, concatenated into `certChain[]`) |
| `--algorithm <algo>` | `rsa-sha256` | `rsa-sha256` or `ecdsa-sha256` (both fully wired in v0.3.0; SEC1 / PKCS#8 P-256 keys accepted) |
| `--reason <str>` | — | `PdfSignOptions.reason` |
| `--name <str>` | — | `PdfSignOptions.name` |
| `--location <str>` | — | `PdfSignOptions.location` |
| `--contact <str>` | — | `PdfSignOptions.contact` |
| `--signing-time <ISO 8601>` | now | Explicit timestamp; validated up-front before any credential I/O |
| `--pure-crypto` *(v1.2.0)* | off | Force pdfnative's portable **pure-JS** bignum CMS path instead of the default native provider |
| `--timestamp <tsa-url>` *(v1.4.0)* | — | Embed an **RFC 3161 timestamp token** from the given TSA (PAdES **B-T** — combine with `--profile pades` for a true ETSI baseline). The only network opt-in on `sign` — SSRF-guarded, no fallback: transport failure is `E_NETWORK`, a malformed response is `E_PARSE`. `--dry-run` never touches the network |
| `--timestamp-digest <algo>` *(v1.4.0)* | `sha256` | TSA digest: `sha256`, `sha384`, or `sha512` |
| `--timestamp-nonce <hex>` *(v1.4.0)* | random | Explicit RFC 3161 nonce (testing / reproducibility) |
| `--timestamp-timeout <ms>` *(v1.5.0)* | `10000` | Upper bound on the TSA round-trip (positive integer; a usage error without `--timestamp`). Reported as `timestamp.timeoutMs` in the `--json` envelope |
| `--digest <algo>` *(v1.4.0)* | `sha256` | CMS digest for RSA keys: `sha256`, `sha384`, or `sha512`. Combining `sha384`/`sha512` with `--algorithm ecdsa-sha256` is a usage error (exit 2) — ECDSA is SHA-256 only |
| `--profile <p>` *(v1.4.0)* | `pkcs7` | `pkcs7` or `pades` — `pades` emits `ETSI.CAdES.detached` with the ESS signing-certificate-v2 attribute and omits signing-time |
| `--allow-multiple` *(v1.4.0)* | off | Add a signature to an already-signed PDF instead of refusing (the 1.x idempotent default is preserved) |
| `--field-name <name>` *(v1.4.0)* | auto | Explicit signature field name (auto-suffixed on collision) |
| `--signature-rect <x1,y1,x2,y2>` / `--signature-page <n>` *(v1.4.0)* | invisible | Place a visible signature widget |
| `--placeholder-bytes <n>` *(v1.4.0)* | auto | Reserve a larger `/Contents` placeholder (e.g. for long chains or large timestamp tokens) |

> **Native constant-time signing (v1.2.0).** `sign` now routes CMS signing through Node's `node:crypto` by default (via `createNativeCryptoProvider`), for side-channel-resistant RSA/ECDSA. Pass **`--pure-crypto`** to select the portable pure-JS path (e.g. on a runtime without `node:crypto`).

> **PAdES B-T (v1.4.0).** `--timestamp <tsa-url>` — previously a reserved flag that failed with `E_UNSUPPORTED` — is now functional: the CLI POSTs an RFC 3161 request through its SSRF guard, verifies the token, and embeds it in the CMS unsigned attributes via `signPdfBytesWithTimestamp`. Pair it with `--profile pades`: the default `pkcs7` profile writes `/SubFilter /adbe.pkcs7.detached`, a valid CMS signature but not an ETSI EN 319 142-1 baseline. The typical ladder:
>
> ```bash
> pdfnative sign --timestamp <tsa> --profile pades   # → B-T
> pdfnative ltv add --online                         # → B-LT
> pdfnative doc-timestamp --url <tsa>                # → B-LTA
> pdfnative ltv add --online                         # LTV for the doc-timestamp itself
> ```
>
> Continue with [`ltv`](#pdfnative-ltv-v140) (B-LT) and [`doc-timestamp`](#pdfnative-doc-timestamp-v140) (B-LTA) below.

Signing keys are **never logged** — not in error output, not in debug traces, not in stack traces. The CLI redacts them at every code path that surfaces error context. `--signing-time` is a deliberate legal instant and is **not** pinned by the global `--creation-date` *(v1.5.0)*.

### `pdfnative inspect`

Inspects metadata and conformance of an existing PDF. Read-only — never modifies the input.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | `json` or `text` |
| `--verbose` | off | Adds `verbose.{trailerKeys, catalogKeys, objectCount, xmpMetadata}`. Sanitised — no raw stream bytes |
| `--pages` | off | Adds `pages: [{ index, width, height, rotation, annotations, formFields }]` — since v1.4.0 also `cropBox` / `trimBox` / `bleedBox` / `artBox` and `userUnit` when present. (`metadata.trapped` is reported unconditionally since v1.4.0, with or without `--pages`) |
| `--pdfua` *(v1.1.0)* | off | Adds a `pdfua: { valid, errors, warnings }` report from `validatePdfUA()` (ISO 14289-1 structural checks: MarkInfo, StructTree, ParentTree, Lang, per-page MCID uniqueness) |
| `--pdfx` *(v1.5.0)* | off | Adds a `pdfx: { valid, errors, warnings }` report from pdfnative's structural PDF/X-4 validator (ISO 15930-7). The XMP claim `pdfxConformance` (e.g. `"PDF/X-4"` or `null`) is reported unconditionally, and `--summary` gains `pdfx` |
| `--iso-dates` *(v1.5.0)* | off | Normalise `metadata.creationDate` and `metadata.modDate` (the latter is new in v1.5.0) from raw PDF date strings to ISO 8601 |
| `--annotations` *(v1.2.0)* | off | Lists markup + link annotations per page (from `getAnnotations()`). `/PageLabels` are reported automatically when present |
| `--form-fields` *(v1.3.0)* | off | Lists AcroForm fields (name, type, value, required/read-only) |
| `--encryption` *(v1.3.0)* | off | Reports the encryption scheme (algorithm, revision, opened-as) |
| `--password <pass>` *(v1.3.0)* | — | Password for an encrypted PDF (env `PDFNATIVE_PASSWORD`) |
| `--signatures` *(v1.4.0)* | off | Structural signature inventory via `listSignatures()` — `fieldName`, `subFilter`, `byteRange`, `isDocTimestamp`, `isPlaceholder`, `sigObjNum`, `contentsLength`. Never emits the signature bytes themselves |
| `--check <assertion>` | — | Repeatable; ANDed. Values: `pdfa`, `signed`, `encrypted`, `pdfua` *(v1.1.0)*, `signatures>=N` *(v1.4.0)*, `pdfx` *(v1.5.0 — passes when the structural PDF/X-4 validation holds)*. Since v1.6.0 a comma list is accepted next to the repeated form — `--check pdfa,pdfx` asserts the dual claim in one flag (an empty piece, e.g. a trailing comma, is a usage error). Sets exit 0 = pass, 1 = fail |
| `--summary` *(v1.1.0)* | off | Under `--json`, emit a canonical minimal verdict (`{ pages, encrypted, signatures, pdfa, pdfx }` — `pdfx` since v1.5.0) |
| `--fields <a,b.c>` *(v1.1.0)* | — | Project the JSON result to named dot-paths (array segments map over elements; unknown paths omitted) |
| `--pretty` | off | Force indented JSON even under the global `--json` (agent mode is compact) |

Composable example:

```bash
pdfnative inspect --input dist/q1.pdf \
  --check pdfa --check signed \
  --format json > dist/q1.report.json
echo "exit code: $?"   # 0 if both assertions hold

# v1.6.0: the dual claim, one flag, one exit code
pdfnative inspect --input brochure.pdf --check pdfa,pdfx --json --summary
```

Since v1.6.0 the `/Info` strings (`title`, `author`, `subject`, `keywords`, …) are decoded through the engine's `decodePdfTextString` — PDFDocEncoding (U+2022 for `0x80`, U+2026 for `0x83`, …) as well as UTF-16BE with its BOM — so a title with an em dash or a bullet reads back as written. `compare` decodes the same way.

> **Behaviour change in v1.4.0:** `--check signed` now counts only *actual* signatures — unsigned placeholders and `/DocTimeStamp` revisions no longer satisfy it. A placeholder-only PDF that passed under v1.3.0 fails under v1.4.0; this is a deliberate correctness fix. v1.4.0 also fixes the `signatures` and `formFields` counters in the JSON body, which previously always reported 0. Use `--check "signatures>=1"` together with `--signatures` when you need the structural inventory.

### `pdfnative verify`

Verifies CMS/PKCS#7 signatures embedded in a PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | `json` or `text` |
| `--strict` | off | Exit 1 on any failure or zero signatures |
| `--trust <pem>` | — | Trust-anchor certificate (repeatable) |
| `--revocation <mode>` | `offline` | `offline` (embedded `/DSS` only), `online` (opt-in, SSRF-guarded OCSP/CRL fetch), or `disabled` |
| `--revocation-policy <p>` | `soft-fail` | `soft-fail` or `strict` |
| `--summary` *(v1.1.0)* | off | Under `--json`, emit a minimal verdict (`{ valid, signatures, invalid }`) |
| `--fields <a,b.c>` *(v1.1.0)* | — | Project the JSON result to named dot-paths |
| `--pretty` | off | Indented JSON even under the global `--json` |

**Scope (since v1.0.0):**

- ✅ Byte-range integrity (SHA-256 recomputed and compared with CMS `messageDigest` attribute)
- ✅ Signature value verification — RSA-SHA256, ECDSA-SHA256, and *(v1.4.0)* RSA-SHA384 / RSA-SHA512
- ✅ Certificate chain verification via `pdfnative`'s `verifyCertSignature`
- ✅ Trust evaluation against `--trust` roots, with self-signed acceptance for testing
- ✅ **RFC 3161 timestamp validation (PAdES-T)** — TSA signature, `messageImprint` binding, chain, `genTime`
- ✅ **OCSP (RFC 6960) + CRL (RFC 5280) revocation** — embedded `/DSS` offline by default, opt-in SSRF-guarded online via AIA / CDP
- ✅ *(v1.4.0)* **`/DocTimeStamp` revisions** validated as RFC 3161 tokens; each signature in the report now carries `fieldName` and `isDocTimestamp` (additive fields, no new flags)
- ✅ *(v1.5.0)* **Timestamp digest reporting** — each timestamped signature carries `timestampDigest` (the RFC 3161 `messageImprint` algorithm, e.g. `sha256`). A SHA-1 imprint adds the note `weak digest: RFC 3161 messageImprint uses SHA-1 (refused under --strict)` and fails under `--strict` (`E_VERIFY_FAILED`)

> Since v1.4.0 the CLI also **creates** LTV material — `sign --timestamp` (B-T), [`ltv`](#pdfnative-ltv-v140) (B-LT `/DSS`), and [`doc-timestamp`](#pdfnative-doc-timestamp-v140) (B-LTA) — so `verify` and the write side now cover the same PAdES ladder.

### `pdfnative ltv` _(v1.4.0)_

Embeds long-term-validation material — certificates, OCSP responses, CRLs — into a signed PDF's `/DSS` dictionary (PAdES **B-LT**), via the engine's `collectValidationInfo` / `embedValidationInfo` / `addValidationInfo` and, since v1.6.0, `composeLtvData` for material you already hold.

```bash
# Connected machine: gather the revocation evidence as replayable JSON
pdfnative ltv collect --input signed.pdf --online --output ltv-data.json

# Air-gapped machine: embed it — no network I/O is even possible here
pdfnative ltv embed --input signed.pdf --data ltv-data.json --output signed.lt.pdf

# Or both in one pass on a connected machine
pdfnative ltv add --input signed.pdf --online --output signed.lt.pdf

# v1.6.0 — material you already hold, no collect step, no network
pdfnative ltv embed --input signed.pdf --output signed.lt.pdf \
  --cert chain.pem --ocsp signer.ocsp.der --crl ca.crl --match chain
```

11 command flags since v1.6.0 (7 → 11; `--dry-run` is global):

| Flag | Default | Description |
|------|---------|-------------|
| `collect` \| `embed` \| `add` | — *(required)* | Subcommand: gather evidence, embed evidence, or both |
| `--input <file>` | stdin | Signed source PDF |
| `--output <file>` | stdout | Destination — `collect` writes the evidence JSON, `embed`/`add` write the PDF |
| `--online` | off | **Required for `collect` / `add`** — the explicit network opt-in (refused with exit 2 without it). `embed` is 100 % offline by design |
| `--data <file>` | — | Evidence JSON produced by `collect` (for `embed`). Mutually exclusive with the material flags below (exit 2) |
| `--cert <file>` *(v1.6.0)* | — | `embed` only: certificates for the `/DSS` — a PEM bundle (split into its blocks) or a single DER file. Repeatable, 16 MiB cap per file, parsed by the engine |
| `--ocsp <file>` *(v1.6.0)* | — | `embed` only: a DER OCSP response. Repeatable, 16 MiB cap |
| `--crl <file>` *(v1.6.0)* | — | `embed` only: a DER CRL. Repeatable, 16 MiB cap |
| `--match all\|chain` *(v1.6.0)* | `all` | How the material is referenced from the per-signature `/VRI` dictionaries: `all` references every item from every VRI (the Adobe-tolerant superset), `chain` only what validates each signature (the minimal, standards-exact form); unmatched material still ships in `/DSS`. Applies to the material flags only — with `--data` it is a usage error |
| `--prefer <src>` | — | `ocsp` or `crl` when both are available |
| `--extra-cert <pem>` | — | Additional certificate for the `/DSS` (repeatable) |
| `--timeout <ms>` | `10000` | Per-fetch network timeout |
| `--dry-run` | off | Validate without writing — with material flags, composes the `/DSS` + `/VRI` and reports the counts |

The evidence JSON (`schema ltv-data`, versioned, DER as base64) is the air-gap bridge: `collect` on a connected machine, transfer the JSON, `embed` inside the enclave. Network fetches go through the same SSRF guard as `verify --revocation online`; failures surface as `E_NETWORK`.

Since v1.6.0 the ladder also has an **offline B-LT rung**: `ltv embed --cert … --ocsp … --crl …` composes the `/DSS` + `/VRI` from certificates, OCSP responses and CRLs obtained by any means (your PKI's export, an HSM appliance, a previous `verify --revocation online` run elsewhere), through the engine's `composeLtvData`. `--data` and the material flags are exclusive (exit 2); `embed` without either is a usage error; `composeLtvData` refuses only an empty material set or a document with no signed signature (`E_INPUT`); material that matches no signature still ships in `/DSS` — every `/VRI` references it under `all`, none does under `chain`. The `--json` envelope carries `match` on this path (also under `--dry-run`).

### `pdfnative doc-timestamp` _(v1.4.0)_

Appends an RFC 3161 **document timestamp** revision (`/DocTimeStamp`, `/SubFilter /ETSI.RFC3161` — ISO 32000-2 §12.8.5) covering every byte of the document (PAdES **B-LTA**). Earlier revisions stay byte-identical; run it again years later to renew the protection before the TSA's certificate expires.

```bash
pdfnative doc-timestamp --input signed.lt.pdf \
  --url https://tsa.example.com/rfc3161 --output signed.lta.pdf
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Source PDF |
| `--output <file>` | stdout | Output PDF |
| `--url <tsa-url>` | — *(required)* | TSA endpoint — requiring it makes the network use an explicit opt-in |
| `--digest <algo>` | `sha256` | `sha256`, `sha384`, or `sha512` |
| `--field-name <name>` | `DocTimeStamp1` | Field name (auto-suffixed on collision) |
| `--placeholder-bytes <n>` | `12288` | Reserved `/Contents` size for the token |
| `--nonce <hex>` | random | Explicit RFC 3161 nonce |
| `--timeout <ms>` | `10000` | Network timeout |
| `--dry-run` | off | Validate without writing (never touches the network) |

### `pdfnative merge` _(v1.2.0)_

Concatenates **2–50** PDFs into one document, in order, via `mergePdfs`.

```bash
pdfnative merge a.pdf b.pdf c.pdf --output combined.pdf
```

| Flag | Default | Description |
|------|---------|-------------|
| `<paths…>` / `--input <file>` | — *(required)* | Source PDFs — positional paths and/or repeatable `--input`. 2–50 total |
| `--output <file>` | stdout | Output PDF |
| `--drop-annotations` | off | Drop non-link annotations from the sources |
| `--max-output-size <bytes>` | 256 MiB | Reject an output larger than this ceiling |
| `--password <pass>` *(v1.3.0)* | — | Password for encrypted sources (env `PDFNATIVE_PASSWORD`). One password is applied to every source; mixed passwords fail with `E_PASSWORD` |
| `--encrypt [aes-128\|aes-256]` *(v1.3.0)* | — | Re-encrypt the output (bare = `aes-128`); needs `--owner-password` |
| `--owner-password` / `--user-password` *(v1.3.0)* | — | Passwords for `--encrypt` (env `PDFNATIVE_ENCRYPT_OWNER_PASS` / `_USER_PASS`) |
| `--permissions <list>` *(v1.3.0)* | `print,extract` | Comma list: `print`, `copy`, `modify`, `extract` — without the flag, print and extract are allowed, copy and modify denied |
| `--stream` *(v1.3.0)* | off | Constant-memory streaming output (`--chunk-size N`) |
| `--dry-run` | off | Validate inputs without writing output |

> Encrypted sources are **supported since v1.3.0** via `--password` (a single password applied to every source), and the output can be re-encrypted via `--encrypt`. Signatures and `/AcroForm` are dropped (page edits invalidate `/ByteRange`); self-contained URI `/Link` annotations are preserved. Every path — positionals included — is validated against traversal.

### `pdfnative split` _(v1.2.0)_

Splits one PDF into many via `splitPdf` — one output per page (default) or one per comma-separated range.

```bash
# One output per page
pdfnative split --input report.pdf --output-dir pages/ --prefix page

# One output per range (1-based, inclusive)
pdfnative split --input report.pdf --output-dir out/ --pages "1-2,3-4"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Source PDF |
| `--output-dir <dir>` | — *(required)* | Destination directory; parts are written as `<prefix>-<n>.pdf` (zero-padded) |
| `--prefix <str>` | input basename (`part` on stdin) | Output filename prefix |
| `--pages <ranges>` | per-page | Comma-separated 1-based inclusive ranges (e.g. `1-2,3-4`) |
| `--max-output-size <bytes>` | 256 MiB | Per-part output ceiling |
| `--password <pass>` *(v1.3.0)* | — | Password for an encrypted source (env `PDFNATIVE_PASSWORD`) |
| `--encrypt [aes-128\|aes-256]` *(v1.3.0)* | — | Re-encrypt each output (needs `--owner-password`; `--user-password` / `--permissions` as in `merge`) |
| `--stream` *(v1.3.0)* | off | Constant-memory streaming output (`--chunk-size N`) |
| `--dry-run` | off | Validate without writing |

### `pdfnative extract` _(v1.2.0)_

Pulls a selected, order-preserving subset of pages into a single PDF via `extractPages`.

```bash
pdfnative extract --input report.pdf --output cover.pdf --pages "4,1-2"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Source PDF |
| `--output <file>` | stdout | Output PDF |
| `--pages <list>` | — *(required)* | 1-based page list/ranges; **order is preserved and repeats are allowed** |
| `--max-output-size <bytes>` | 256 MiB | Output ceiling |
| `--password <pass>` *(v1.3.0)* | — | Password for an encrypted source (env `PDFNATIVE_PASSWORD`) |
| `--encrypt [aes-128\|aes-256]` *(v1.3.0)* | — | Re-encrypt the output (needs `--owner-password`; `--user-password` / `--permissions` as in `merge`) |
| `--stream` *(v1.3.0)* | off | Constant-memory streaming output (`--chunk-size N`) |
| `--dry-run` | off | Validate without writing |

### `pdfnative annotate` _(v1.2.0)_

Attaches markup annotations to an existing PDF via an **incremental save**, so the original bytes — and any existing signature — stay intact.

```bash
pdfnative annotate --input report.pdf --output annotated.pdf \
  --annotations notes.json
```

`notes.json` is a JSON array (or `{ "annotations": […] }`), each entry a markup annotation plus a 1-based `page`:

```json
[
  { "page": 1, "type": "highlight", "rect": [72, 700, 520, 715], "color": "#ffe066", "contents": "Review this clause" },
  { "page": 2, "type": "text", "rect": [80, 640, 100, 660], "contents": "Sticky note" }
]
```

Supported types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`, and *(v1.5.0)* `link` — `{ "page": 1, "type": "link", "rect": [72, 700, 300, 715], "url": "https://example.org" }`, emitted as a `/Link` annotation with a `/URI` action; only `http:`, `https:` and `mailto:` URLs without control characters are accepted (`E_INPUT` otherwise). Since v1.6.0 the `/Link` + `/URI` body is built by the engine's `buildAnnotationBody({ type: 'link', rect, url })` — the CLI's own builder is gone, so `annotate/linked.pdf` bytes differ from v1.5.0 output while staying spec-valid. Colours accept CMYK since v1.5.0 (hex, RGB and CMYK only — spot colours are a `render` feature, not an annotation one). Only known fields are forwarded (no dictionary injection). Read them back with `inspect --annotations`. Since v1.4.0, `--password <pass>` (env `PDFNATIVE_PASSWORD`) lets you annotate an encrypted PDF — the added objects are encrypted under the document's existing scheme.

> **Overlay, not redaction.** Annotations are a *visual review layer*; the underlying bytes remain. They do **not** remove or obscure content for security purposes.

### `pdfnative metadata` _(v1.4.0)_

Updates `/Info` and XMP metadata via an **incremental save** — the original bytes are kept as a prefix, so existing signatures remain valid for their revision. `xmp:ModifyDate` and `pdf:Keywords` stay synchronised. Reading metadata remains `inspect`'s job.

```bash
pdfnative metadata --input report.pdf --output revised.pdf \
  --title "Quarterly report (revised)" --keywords "finance,Q2"
```

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Source PDF |
| `--output <file>` | stdout | Output PDF |
| `--title` / `--author` / `--subject` / `--keywords` | — | Individual `/Info` + XMP fields (at least one field is required) |
| `--mod-date <ISO 8601>` | now | Explicit modification date |
| `--from-json <file>` | — | All fields from a JSON file (`schema metadata`) — mutually exclusive with the individual flags |
| `--password <pass>` | — | Open an encrypted source (env `PDFNATIVE_PASSWORD`) |
| `--dry-run` | off | Validate without writing |

### `pdfnative govern` _(v1.2.0)_

Surfaces pdfnative's **AI-governance / Human-in-the-Loop (HITL)** contract. Agents act as **draftsmen**: a human must always review and submit under their own GitHub identity.

```bash
pdfnative govern rules                  # human/agent protocol (AGENT_RULES)
pdfnative govern policy --json          # machine-readable policy JSON
pdfnative govern verify-issue draft.md  # gate a draft (exit 1 / E_POLICY)
```

| Subcommand | Description |
|------|-------------|
| `rules` | Print the human-and-agent protocol (mirrors `.github/AGENT_RULES.md`) |
| `policy [--json]` | Print the governance policy (mirrors `.github/ai-governance.json`) |
| `verify-issue <draft.md>` | Gate a local issue draft; exit `1` / `E_POLICY` on a violation (proposes a runtime dependency, omits a reproduction code block). Missing recommended fields surface as warnings |

> `verify-issue` is a pure, **fully offline** validator — no GitHub or network access. A passing check is *necessary but not sufficient*: the human review gate always applies.

### `pdfnative fill` _(v1.3.0)_

Fill, flatten or export an AcroForm. The three modes compose into a round trip:
export the current values, edit the JSON, feed it back.

```bash
pdfnative fill --input form.pdf --export --output values.json   # read
pdfnative fill --input form.pdf --data values.json --output filled.pdf
pdfnative fill --input filled.pdf --flatten --output flat.pdf   # freeze
```

| Flag | Default | Purpose |
|---|---|---|
| `--data <file>` | — | Values JSON. Required unless `--flatten` or `--export` |
| `--flatten` | off | Flatten after filling, or flatten the existing values |
| `--export` | off | Read-only: emit current values in `--data` shape |
| `--force` | off | Flatten even when a signed signature field is present |
| `--on-unknown <mode>` | `throw` | `throw` or `ignore` for unknown field names |
| `--need-appearances` | off | Set `/NeedAppearances` to allow non-WinAnsi values |
| `--password <pass>` | — | Open an encrypted form (env `PDFNATIVE_PASSWORD`) |
| `--dry-run` | off | Validate and enumerate fields without writing |

Flattening a signed document invalidates the signature, which is why `--force`
exists rather than it being silent.

### `pdfnative encrypt` _(v1.3.0)_

Re-secure an existing PDF. `--owner-password` is required; without a
`--user-password` the document **opens with no prompt** and the owner password
only governs permissions.

```bash
pdfnative encrypt --input report.pdf --output secure.pdf \
  --owner-password "$OWNER" --user-password "$USER" \
  --algorithm aes-256 --permissions print,extract
```

| Flag | Default | Purpose |
|---|---|---|
| `--owner-password <pass>` | — | **Required.** Env `PDFNATIVE_ENCRYPT_OWNER_PASS` |
| `--user-password <pass>` | — | Password needed to open. Env `PDFNATIVE_ENCRYPT_USER_PASS` |
| `--algorithm <alg>` | `aes-128` | `aes-128` or `aes-256` |
| `--permissions <list>` | `print,extract` | Comma-separated: `print`, `copy`, `modify`, `extract` — without the flag, print and extract are allowed, copy and modify denied |
| `--password <pass>` | — | Open an already-encrypted source (password rotation) |
| `--drop-annotations` | off | Drop all annotations; the default keeps URI links |
| `--max-output-size <n>` | 256 MiB | Cap on the assembled size |
| `--stream` | off | Stream the output (`--chunk-size N`) |
| `--dry-run` | off | Validate without writing |

### `pdfnative decrypt` _(v1.3.0)_

Remove encryption, given the password. Reads RC4, AES-128 and AES-256 sources.

```bash
pdfnative decrypt --input secure.pdf --password "$PASS" --output plain.pdf
```

| Flag | Default | Purpose |
|---|---|---|
| `--password <pass>` | — | Document password. Env `PDFNATIVE_PASSWORD` |
| `--drop-annotations` | off | Drop all annotations; the default keeps URI links |
| `--max-output-size <n>` | 256 MiB | Cap on the assembled size |
| `--stream` | off | Stream the output (`--chunk-size N`) |
| `--dry-run` | off | Validate without writing |

### `pdfnative extract-text` _(v1.3.0)_

Reading-order Unicode text from an existing PDF. `ndjson` emits one JSON object
per page, which makes it a natural feed for a RAG ingestion pipeline.

```bash
pdfnative extract-text --input paper.pdf --format ndjson --runs > pages.ndjson
pdfnative extract-text --input paper.pdf --pages 1,3,5-7 --format text
```

| Flag | Default | Purpose |
|---|---|---|
| `--format, -f <fmt>` | `text` | `text`, `json`, or `ndjson` (one object per page) |
| `--pages <selector>` | all | 1-based selector, e.g. `1,3,5-7` |
| `--runs` | off | Include positioned runs `{ text, x, y, fontSize, fontName }` |
| `--password <pass>` | — | Extract from an encrypted PDF |
| `--max-length <n>` | 16000000 | Hard cap on total characters; `0` disables |
| `--on-stream-error <policy>` *(v1.6.0)* | `limit` | What to do with a content or font stream the engine cannot decode: `limit` — a stream past the global `--max-inflate-size` is `E_INPUT`, the message naming both remedies; `throw` — any undecodable stream is an error; `skip` — the page is read without that stream's text (the lenience of earlier releases). 10 flags with it (9 → 10) |
| `--summary` | off | (json) Emit only `{ pages, characters }` |
| `--fields <paths>` | — | (json) Comma-separated dot-paths to keep |
| `--pretty` | off | Indented JSON even under the global `--json` |

Text comes from the `/ToUnicode` mapping, so it is real Unicode rather than
glyph indices. A page whose content decodes entirely to U+FFFD is reported as
not extractable rather than returning noise.

Since v1.6.0 (pdfnative ≥ 1.9.0) untagged shaped and right-to-left runs carry `/Span /ActualText`, so Arabic, Hebrew, Khmer, Myanmar or Indic text comes back in **logical order, as typed** — from untagged output too, unless the file was rendered with `--actual-text false`; `subs` / `sups` glyphs extract as their source characters. The stream-limit policy is a refusal, not a silently empty page: the error is classified by the engine's `PdfStreamLimitError` instance (code `PDF_STREAM_LIMIT`), never by its message. Prefer `limit` for untrusted input and raise `--max-inflate-size` for a trusted large file instead of passing `skip`.

### `pdfnative compare` _(v1.4.0)_

Compares two PDFs by extracted text and by structure — page count, page/print boxes, metadata, form fields, annotations, encryption, signatures. Built for CI: identical documents exit 0; differences print the report on stdout **first**, then exit 1 with `E_CHECK_FAILED`.

```bash
pdfnative compare golden.pdf candidate.pdf --mode both --format json --pretty
```

| Flag | Default | Description |
|------|---------|-------------|
| `<a.pdf> <b.pdf>` | — *(required)* | The two documents, as positionals |
| `--mode <m>` | `both` | `text`, `structure`, or `both` |
| `--format <fmt>` | `text` | `text` or `json` |
| `--tolerance <pt>` | `0` | Geometric tolerance in points for box comparisons |
| `--ignore-whitespace` | off | Normalise whitespace before the text diff |
| `--pages <selector>` | all | 1-based page selector |
| `--password-a` / `--password-b` | — | Passwords for encrypted inputs |
| `--on-stream-error <policy>` *(v1.6.0)* | `limit` | Same policy as `extract-text` (`limit` \| `throw` \| `skip`), applied to **both** PDFs. 9 flags with it (8 → 9) |
| `--pretty` | off | Indented JSON |

Since v1.6.0 a stream past the inflate cap fails the comparison (`E_INPUT` under `limit`, the default) and `throw` fails on any undecodable stream; under `limit` a corrupt stream is still skipped as before, so `throw` is the only policy under which `compare` cannot call two files equal over an unread stream. `/Info` strings are decoded through the engine's `decodePdfTextString` (PDFDocEncoding and UTF-16), as in `inspect`.

> **Not a visual diff.** pdfnative has no rasteriser, so pixel comparison is out of scope by design — `compare` diffs what the format itself declares (text and structure). Pair it with an external rasteriser if you need pixel-level checks.

### `pdfnative doctor` _(v1.3.0)_

Environment and capability preflight. The first thing to run in a new
environment, and the first thing an agent should call before planning work.

```bash
pdfnative doctor              # human-readable
pdfnative doctor --format json --pretty
```

| Flag | Default | Purpose |
|---|---|---|
| `--format, -f <fmt>` | `text` | `text` or `json` |
| `--pretty` | off | Indented JSON even under the global `--json` |

Since v1.5.0 the report also carries `fonts` (the bundled modules and scripts probed on disk — `36 modules / 32 scripts` since v1.6.0, every `--font` shortcut listed in the detail), `unicode` (the Universal Shaping Engine's Unicode version) and `conformance` (`pdfa1b,pdfa2b,pdfa2u,pdfa3b,pdfx4` — the `--tagged` / `--pdfx` targets). Fully offline.

### `pdfnative batch`

Renders every JSON file in a directory to PDF **in parallel**, reusing the full `render` pipeline.

| Flag | Default | Description |
|------|---------|-------------|
| `--input-dir <dir>` | — *(required)* | Directory of `*.json` documents |
| `--output-dir <dir>` | — *(required)* | Destination directory for `*.pdf` (created if absent) |
| `--concurrency <n>` | `4` | Bounded parallelism |
| `--fail-fast` | off | Abort on the first failure |
| `--dry-run` *(v1.1.0)* | off | Validate every input without writing output |
| `--json` / `--summary` *(v1.1.0)* | off | Machine-readable per-file report; `--summary` emits `{ total, succeeded, failed }` |
| `--format <fmt>` | `text` | Report format: `text` or `json` |
| `[render options]` | — | `--layout`, `--variant`, smart tables, PDF/A, compression… — every `render` option is honoured and applied to each file |
| `--manifest <tasks.json>` *(v1.4.0)* | — | **Declarative pipeline mode** — see below. Mutually exclusive with `--input-dir` / `--output-dir` (exit 2) |
| `--allow-network` *(v1.4.0)* | off | Required before any network flag inside a manifest (`--timestamp`, `--url`, `--online`, `--revocation online`) — an untrusted manifest can never trigger network I/O on its own |
| `--continue-on-error` *(v1.4.0)* | off | Keep going after a task fails; tasks that reference the failed output via `@id` are skipped |

```bash
pdfnative batch --input-dir inputs/ --output-dir outputs/ --tagged pdfa2b --concurrency 4
```

#### Manifest mode _(v1.4.0)_

`--manifest tasks.json` runs a declarative pipeline — `{ "version": 1, "tasks": [{ "id", "command", "flags" }] }` (`schema batch-manifest`). Flag names are written **bare, without the leading dashes** (a dashed key is rejected with exit 2). A flag value of `"@<id>"` references the output of an earlier task; relative paths resolve against the manifest's directory. The whole manifest is validated **before** anything runs, then executed sequentially and fail-fast (unless `--continue-on-error`).

```json
{
  "version": 1,
  "tasks": [
    { "id": "report",  "command": "render", "flags": { "input": "report.json", "output": "report.pdf", "tagged": "pdfa2b" } },
    { "id": "stamped", "command": "metadata", "flags": { "input": "@report", "output": "final.pdf", "title": "Q2 report" } }
  ]
}
```

Only a fixed **14-command whitelist** is allowed inside a manifest — `render`, `sign`, `verify`, `inspect`, `merge`, `split`, `extract`, `extract-text`, `fill`, `encrypt`, `decrypt`, `annotate`, `metadata`, `doc-timestamp`. `ltv` and `compare` are excluded (they take positionals, which manifest tasks — a flat flag map — cannot express), and the meta commands (`batch`, `govern`, `schema`, `completion`, `doctor`) can never nest. Manifests are capped at 1 000 tasks with the same path-traversal checks as direct flags. Error classes: a structural violation, an invalid flag name or value type, or a network-reaching flag without `--allow-network` exits 2/`E_USAGE`; an invalid or duplicate task id, a non-whitelisted command, or a broken `@ref` exits 1/`E_INPUT`; malformed JSON is 1/`E_PARSE`.

### `pdfnative schema`

Prints a versioned **JSON Schema (Draft 2020-12)** for a CLI input/output shape, so agents can self-validate before invoking a command. The `$id` embeds the CLI version — `https://pdfnative.dev/schema/cli/<version>/<subject>.schema.json` (e.g. `…/cli/1.6.0/status.schema.json`). Since v1.6.0 `schema status` pins 35 envelope properties (adds `tagged`, `direction`, `actualText`, `match`) and lists the 13 diagnostic codes; `schema render` describes `direction`, `actualText`, `print.spotColours`, the spot and ink colour values, JPEG 2000, the dual claim, the 32 scripts and the `--variant table` shape.

```bash
pdfnative schema render            # input schema for `render`
pdfnative schema inspect-summary   # compact inspect verdict shape
pdfnative schema list              # enumerate every subject
```

Subjects (19): `render`, `inspect`, `verify`, `batch`, `annotate` *(v1.2.0)*, `govern-verify` *(v1.2.0)*, `extract-text`, `fill`, `form-export`, `status`, `manifest`, `doctor` *(all v1.3.0)*, `metadata`, `ltv-data`, `compare`, `batch-manifest` *(all v1.4.0)*, and the compact `inspect-summary` / `verify-summary` / `batch-summary` shapes. `pdfnative schema list` enumerates them all.

### `pdfnative completion`

Emits a shell-completion script: `pdfnative completion bash|zsh|fish|powershell` *(PowerShell added in v1.3.0)*.

---

## Agent-native automation contract

v1.1.0 makes the CLI deterministic to drive from autonomous AI agents and CI pipelines. Since v1.5.0 the full consumer contract lives in [pdfnative-cli docs/AGENT_CONTRACT.md](https://github.com/Nizoka/pdfnative-cli/blob/main/docs/AGENT_CONTRACT.md) (the repository's AGENTS.md now holds the rules for agents working *on* the CLI). Architecture-level compositions — reproducible builds, PDF/X-4 press handoff, house fonts, the process contract from any language — are on the [CLI use cases](use-cases-cli.html) page.

- **Global `--json` envelope.** Any command run with `--json` emits a single machine-readable object on **stderr**: `{ ok: false, command, error: { code, message } }` on failure, and a `{ ok: true, … }` status line for `render` / `sign` / `batch` on success (since v1.3.0, every write command emits the success line). stdout stays reserved for the primary artifact (PDF, report, schema, script). stderr may carry `warning:` lines before the envelope — the envelope is always the **last** line (`--quiet` drops the rest).
- **Stable `E_*` error codes** on every failure: `E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`, `E_SIGN`, `E_VERIFY_FAILED`, `E_CHECK_FAILED`, `E_POLICY` *(v1.2.0 — governance-gate failure)*, `E_UNSUPPORTED`, `E_PASSWORD` *(v1.3.0 — encrypted PDF: password missing or incorrect)*, `E_NETWORK` *(v1.4.0 — an opt-in network operation failed: TSA / OCSP / CRL fetch)*, `E_RUNTIME`. Numeric exit codes (0/1/2) are unchanged.
- **`--dry-run`** for `render`, `sign`, `batch`, and — since v1.2.0 — `merge`, `split`, `extract`, and `annotate` (v1.3.0 extends it to `fill`, `encrypt` and `decrypt`; v1.4.0 to `metadata`, `ltv` and `doc-timestamp`) — fully validate inputs (and, for `sign`, parse credentials and prepare the PDF) without producing output. A dry run never touches the network.
- **Global `--max-inflate-size <bytes>`** *(v1.4.0)* caps the decompressed size of each PDF stream when parsing untrusted inputs (anti zip-bomb; default 100 MiB). Since v1.6.0 a stream past the cap is **`E_INPUT`** with a message naming the flag, on every command that opens a PDF (it was the engine's bare inflate error, `E_PARSE`); `verify` keeps its own `E_PARSE`, and `extract-text` / `compare` add `--on-stream-error limit|throw|skip`.
- **Global `--creation-date <iso8601>`** *(v1.5.0 — the 10th global flag)* pins the creation instant of every PDF written in the run (`render`, and every task of a `batch`): `/CreationDate`, `xmp:CreateDate`, the `{date}` placeholder and the trailer `/ID` derive from it, in UTC, so the same input renders to identical bytes on every host and timezone. Falls back to `SOURCE_DATE_EPOCH` (integer seconds); an invalid value is a usage error. The envelope carries `creationDate`. Encrypted output is never byte-reproducible; `sign --signing-time` and `metadata --mod-date` stay separate instants.
- **Global flags may precede the command** *(v1.5.0)* — `pdfnative --json --dry-run render …` is equivalent to `pdfnative render … --json --dry-run`. Arguments without any command now exit 2 (`E_USAGE`) instead of printing the usage with exit 0; a bare `pdfnative` still prints the usage.
- **`schema status` pins every envelope field** *(v1.5.0)* — 35 properties since v1.6.0, the command-specific ones included. v1.5.0 added `pdfx`, `creationDate`, `timestamp.timeoutMs` and `dryRun` on every dry-run envelope; v1.6.0 adds `tagged` (the PDF/A level claimed by `render`), `direction`, `actualText` (only ever `false`) and `match` (`ltv embed` from material). A parity test in the CLI repository holds the schema to every emitted field, and the previous release's `schema` captures are replayed on every pull request (`compat-previous`) — a minor only adds.
- **Token-economy output projection** (`inspect` / `verify` / `batch` / `extract-text`): stdout JSON is **compact by default** under `--json` (`--pretty` opts back into the human 2-space form), **`--summary`** emits a canonical minimal verdict, and **`--fields a,b.c`** projects the result to named dot-paths. Typically ~90 % fewer output tokens with no loss of the fields agents branch on. Non-`--json` human output is unchanged.

```bash
# Agent-friendly: compact verdict on stdout, structured status on stderr
pdfnative inspect --input report.pdf --json --summary 2>status.json

# Branch on a stable error class
pdfnative verify --input report.pdf --json --strict \
  || echo "failed: $(jq -r .error.code status.json)"
```

---

## Recipes

### Render → sign → verify → inspect, in a single chain

```bash
cat report.json \
  | pdfnative render --tagged pdfa2b --compress \
  | pdfnative sign --reason "Approved" \
  | tee signed.pdf \
  | pdfnative verify --strict --trust ca.pem
pdfnative inspect --input signed.pdf --check pdfa --check signed
```

### Encrypted PDF/A-3 hybrid invoice (Factur-X / ZUGFeRD)

```bash
pdfnative render \
  --input invoice.json --output invoice.pdf \
  --tagged pdfa3b \
  --attachment factur-x.xml:application/xml:Source:"Structured invoice data" \
  --footer-center "Page {page} / {pages}"
```

### Encrypted distribution copy

```bash
pdfnative render \
  --input contract.json --output contract.encrypted.pdf \
  --encrypt-algorithm aes256 \
  --encrypt-permissions print
# PDFNATIVE_ENCRYPT_OWNER_PASS read from the env — never on the command line
```

### Multilang fonts

For the 32 bundled scripts (plus `latin`, `emoji`, `color-emoji`, `math` — 36 bundled font modules), no wrapper is needed — `--font` registers each bundled font inside the CLI process:

```bash
echo '{"blocks":[{"type":"paragraph","text":"สวัสดี こんにちは"}]}' \
  | pdfnative render --font th --font ja --lang th,ja -o out.pdf
```

For a font file you ship yourself, use `--font-file` *(v1.5.0)* — see *House font + typography flags* below. Only a custom *loader* (a font module registered programmatically) still requires the library: in-memory font registration does not cross a process boundary, so a wrapper that registers fonts and then *spawns* the CLI does not work. Call the library directly instead:

```javascript
// render-custom-font.mjs
import { registerFont, loadFontData, buildDocumentPDFBytes } from 'pdfnative';
import { writeFile } from 'node:fs/promises';

registerFont('th', () => import('./fonts/my-thai-data.js'));
const th = await loadFontData('th');
if (!th) throw new Error('Thai font failed to load');
const bytes = buildDocumentPDFBytes({
  title: 'Thai demo',
  blocks: [{ type: 'paragraph', text: 'สวัสดี' }],
  fontEntries: [{ fontData: th, fontRef: '/F3', lang: 'th' }], // /F1 and /F2 are reserved
});
await writeFile('out.pdf', bytes);
```

### CI assertion (GitHub Actions)

```yaml
- name: Render and assert PDF/A + signed
  run: |
    pdfnative render --input data/q1.json --output dist/q1.pdf --tagged pdfa2b
    pdfnative sign  --input dist/q1.pdf  --output dist/q1.signed.pdf
    pdfnative verify --input dist/q1.signed.pdf --strict
    pdfnative inspect --input dist/q1.signed.pdf --check pdfa --check signed
```

### Batch-render a directory of JSON files

```bash
for f in inputs/*.json; do
  pdfnative render --input "$f" --output "outputs/$(basename "$f" .json).pdf" --tagged pdfa2b
done
```

### Byte-reproducible build _(v1.5.0)_

Pin the creation instant and the same input renders to identical bytes on every host and timezone (not for encrypted output — CSPRNG keys):

```bash
pdfnative render --input doc.json --output a.pdf --creation-date 2026-01-01T00:00:00Z
TZ=Asia/Tokyo pdfnative render --input doc.json --output b.pdf --creation-date 2026-01-01T00:00:00Z
sha256sum a.pdf b.pdf                          # identical hashes

# Same thing from the environment (integer seconds), e.g. in a CI job
SOURCE_DATE_EPOCH=1767225600 pdfnative render --input doc.json --output c.pdf
```

### PDF/X-4 press handoff _(v1.5.0)_

```bash
pdfnative render --input brochure.json --output brochure.pdf \
  --pdfx pdfx4 --output-intent-icc press.icc --font latin --lang latin \
  --trapped false --strict
pdfnative inspect --input brochure.pdf --check pdfx     # exit 0 when the structural claim holds
pdfnative inspect --input brochure.pdf --json --pdfx --fields pdfx.valid,pdfx.errors
```

`press.icc` must be a printer (`prtr`) CMYK profile. Each page gets a TrimBox automatically (from `layout.print`, else the BleedBox or MediaBox) unless it sets an ArtBox — never both. `--strict` turns the `PDFX_*` diagnostics into `E_CHECK_FAILED` before any byte is written.

### House font + typography flags _(v1.5.0)_

```bash
pdfnative render --input report.json --output report.pdf \
  --font-file fonts/House-Regular.ttf:house --lang house \
  --split-paragraphs --keep-headings-with-next --kerning --font-features onum,smcp
```

The `:house` suffix names the font (default: the file stem) and doubles as its `--lang` code. Repeat `--font-file` for additional faces; a name that collides with a bundled shortcut is a usage error.

### Right-to-left letter → logical-order text _(v1.6.0)_

<!-- demo-language: ar, he (right-to-left demonstration content; the JSON carries Arabic and Hebrew paragraphs) -->
```bash
pdfnative render --input letter.json --output letter.pdf --direction auto \
  --font ar --font he --font latin --lang ar,he,latin \
  --creation-date 2026-01-01T00:00:00Z
pdfnative extract-text --input letter.pdf --format ndjson > letter.ndjson
```

`--direction auto` resolves each paragraph's base direction from its first strong character (a paragraph block's own `direction` wins); the Arabic and Hebrew paragraphs come out right-aligned and justified in visual order. The untagged runs carry `/Span /ActualText`, so every page object in `letter.ndjson` holds the text in **logical order, as typed** — ready for a RAG pipeline. Add `--actual-text false` only to drop the spans (bare runs in visual order — it does not restore 1.8.0 bytes, the 1.9.0 subsets and line structure still apply); it drops that guarantee on the file.

### The dual claim — PDF/A-2b + PDF/X-4 in one file _(v1.6.0)_

```bash
pdfnative render --input brochure.json --output brochure.pdf \
  --tagged pdfa2b --pdfx pdfx4 --output-intent-icc press.icc \
  --trapped false --font latin --lang latin --strict
pdfnative inspect --input brochure.pdf --check pdfa,pdfx --json --summary
```

One file, two claims: two OutputIntents, both identifications in the XMP, verified with one flag and one exit code (0 when both structural checks hold). `press.icc` is a printer-class (`prtr`) CMYK **or Gray** profile. `--tagged pdfa1b` or `pdfa3b` next to `--pdfx` is refused by the engine (`E_INPUT`) — `--dry-run` shows it before any byte is written. `metadata` rewrites the XMP without the PDF/X identification: re-check after editing.

### Offline PAdES B-LT from material you hold → `verify --strict` _(v1.6.0)_

```bash
pdfnative ltv embed --input signed.pdf --output never.pdf \
  --cert chain.pem --ocsp signer.ocsp.der --crl ca.crl --match chain --dry-run --json
pdfnative ltv embed --input signed.pdf --output signed.lt.pdf \
  --cert chain.pem --ocsp signer.ocsp.der --crl ca.crl --match chain --json
pdfnative verify --input signed.lt.pdf --strict
pdfnative inspect --input signed.lt.pdf --signatures --json --fields signatures
```

No `collect` step and no network: the certificates (PEM bundle or DER), DER OCSP responses and DER CRLs come from wherever your PKI keeps them. The `--dry-run` composes the `/DSS` + `/VRI` and reports the counts without writing; `--match chain` references only what validates each signature (`all`, the default, references everything from every VRI). Material that matches no signature still ships in `/DSS` (no `/VRI` references it under `chain`); only an empty material set or a document without a signed signature is `E_INPUT`. `verify --strict` then runs fully offline against the embedded `/DSS` (`--revocation offline` is the default).

Architecture-level compositions: [CLI use cases](use-cases-cli.html).

---

## Security model

`pdfnative-cli` is built with the same zero-trust posture as the underlying library:

- **No `eval`, no `Function`, no dynamic code** — input JSON is parsed via the standard `JSON.parse` with a 50 MB cap to prevent memory exhaustion.
- **Path traversal protection** — all `--input` / `--output` / `--key` / `--cert` / `--cert-chain` / `--trust` / `--layout` / `--attachment` / `--watermark-image` paths are validated against `..` segments before any file system access.
- **Secrets never logged** — `loadPem` / `loadPemChain` surface only generic error messages on parse failure; raw key material never appears in `CliError` messages or stderr. Encryption passwords are never echoed.
- **Layout-file injection blocked** — `attachments[].data` fields embedded in `--layout` JSON are **stripped on load**. Binary attachment payloads must come from `--attachment <path>` so the CLI can apply path validation.
- **Env-var precedence for secrets** — `PDFNATIVE_SIGN_KEY` / `PDFNATIVE_SIGN_CERT` / `PDFNATIVE_SIGN_CHAIN` / `PDFNATIVE_ENCRYPT_OWNER_PASS` / `PDFNATIVE_ENCRYPT_USER_PASS` are preferred over file-path flags so secrets never enter shell history.
- **Stdin/stdout safe** — binary streams are passed through without interpretation; no shell-quoting issues.
- **Zip-bomb cap** *(v1.4.0)* — the global `--max-inflate-size` bounds the decompressed size of every PDF stream (default 100 MiB). Since v1.6.0 an over-cap content or font stream is a refusal (`E_INPUT`), never a silently empty page: `extract-text` / `compare --on-stream-error limit` is the default, and `skip` is an explicit opt-in.
- **Bounded offline material** *(v1.6.0)* — `ltv embed --cert` / `--ocsp` / `--crl` files are path-validated, capped at 16 MiB each and parsed by the engine; nothing is fetched. `--font-file` fonts (32 MiB cap, magic bytes checked) and `--output-intent-icc` profiles (16 MiB, `acsp` checked) follow the same rule: never loadable from a JSON payload.
- **NPM provenance** — every published version is signed via GitHub Actions OIDC. Verify with `npm audit signatures`.

The CLI opens **no network connection unless you explicitly opt in** — the only network paths are `verify --revocation online`, `sign --timestamp <url>`, `ltv --online`, `doc-timestamp --url <url>`, and `batch --allow-network`, and all of them go through the same SSRF guard: http/https only, private / loopback / metadata addresses blocked, DNS pinning, 10 s timeout, 5 MiB response cap, no redirects. Response bodies are never echoed into CLI output. It never writes to system directories outside the working directory or loads arbitrary code.

---

## Comparison with the library API

The CLI now covers nearly the full library surface; only Web Worker offloading remains library-only.

| Feature | CLI v1.6.0 | Library |
|---|---|---|
| Document rendering (13 block types) | ✅ | ✅ |
| **Right-to-left layout (UAX #9) + logical-order extraction** | ✅ `render --direction auto\|ltr\|rtl` / `--actual-text`, `extract-text` *(v1.6.0)* | ✅ `layout.direction` / `layout.actualText`, `extractText()`, `resolveBidiLevels()` |
| **Spot colours (`/Separation`, `/DeviceN`)** | ✅ `layout.print.spotColours` + `{ spot, tint }` / `{ inks }` from JSON *(v1.6.0 — no CLI validator, engine refusals → `E_INPUT`)* | ✅ `layout.print.spotColours`, `PdfSpotColor` / `PdfInkMix` |
| **PDF/A-2 + PDF/X-4 dual claim** | ✅ `--tagged pdfa2b\|pdfa2u --pdfx pdfx4` / `inspect --check pdfa,pdfx` *(v1.6.0)* | ✅ `tagged` + `layout.pdfx` together |
| **JPEG 2000 images (`/JPXDecode`)** | ✅ `image` blocks and `--watermark-image` (`.jp2` / `.j2k`, sniffed) *(v1.6.0)* | ✅ `parseJPX()` / image blocks |
| **Stream-limit policy on extraction** | ✅ `extract-text` / `compare --on-stream-error limit\|throw\|skip` *(v1.6.0)* | ✅ `extractText({ onStreamError })` / `PdfStreamLimitError` |
| **Offline PAdES B-LT from held material** | ✅ `ltv embed --cert / --ocsp / --crl --match all\|chain` *(v1.6.0)* | ✅ `composeLtvData()` |
| **Typography engine** | ✅ `layout.typography` + `--split-paragraphs` / `--keep-headings-with-next` / `--kerning` / `--font-features` *(v1.5.0)* | ✅ `layout.typography` |
| **PDF/X-4 output + structural check** | ✅ `render --pdfx pdfx4 --output-intent-icc` / `inspect --check pdfx` *(v1.5.0)* | ✅ `layout.pdfx` / `validatePdfX()` |
| **CMYK colours + colour bars** | ✅ `"c m y k"` / `[c,m,y,k]`, `layout.print.marks.colourBars` *(v1.5.0)* | ✅ |
| **Custom font from disk** | ✅ `--font-file <path.ttf>[:name]` *(v1.5.0)* | ✅ `registerFont()` + `parseFontData()` (`pdfnative/tools`) |
| **Reproducible output** | ✅ global `--creation-date` / `SOURCE_DATE_EPOCH` *(v1.5.0)* | ✅ `setDefaultCreationDate()` / `layout.creationDate` |
| Streaming output | ✅ `--stream` / `--stream-true` | ✅ `buildDocumentPDFStream()` / `buildDocumentPDFStreamTrue()` |
| Configurable block cap | ✅ `--max-blocks` | ✅ `layout.maxBlocks` |
| PDF/A conformance (1b, 2b, 2u, 3b) | ✅ `--tagged` | ✅ `tagged: '…'` |
| Digital signatures (RSA-SHA256/384/512) | ✅ (`--digest`, v1.4.0 for 384/512) | ✅ `signPdfBytes()` |
| Digital signatures (ECDSA-SHA256) | ✅ `--algorithm ecdsa-sha256` | ✅ `signPdfBytes()` |
| **PAdES B-T timestamp at signing** | ✅ `sign --timestamp` *(v1.4.0)* | ✅ `signPdfBytesWithTimestamp()` |
| **PAdES B-LT `/DSS` (LTV)** | ✅ `ltv collect / embed / add` *(v1.4.0)* | ✅ `collectValidationInfo()` / `embedValidationInfo()` / `addValidationInfo()` |
| **PAdES B-LTA document timestamp** | ✅ `doc-timestamp` *(v1.4.0)* | ✅ `addDocumentTimestamp()` |
| **Metadata update (signature-safe)** | ✅ `metadata` *(v1.4.0)* | ✅ `PdfModifier.updateMetadata()` |
| **Text + structure diff** | ✅ `compare` *(v1.4.0 — implemented in the CLI)* | — (compose the readers) |
| **Native constant-time signing** | ✅ default (`--pure-crypto` opts out; the native provider is a CLI utility) | ✅ `setCryptoProvider()` (accepts any `CryptoProvider`) |
| Inspection / metadata | ✅ | ✅ `PdfReader` |
| **PDF/UA structural validation** | ✅ `inspect --pdfua` | ✅ `validatePdfUA()` |
| **Annotation listing** | ✅ `inspect --annotations` | ✅ `getAnnotations()` |
| **Signature verification (CMS/PKCS#7)** | ✅ `verify` (real CMS, RSA + ECDSA — implemented in the CLI) | ➖ `openPdf()` + `verifyCertSignature()` only (X.509 certificate-signature check, not CMS PDF-signature verification) |
| **PAdES-T timestamp + OCSP/CRL revocation** | ✅ `verify --revocation` (implemented in the CLI) | — |
| **Encryption (AES-128/256)** | ✅ `--encrypt-*` | ✅ `encryption: {…}` |
| **Watermarks** | ✅ `--watermark-*` | ✅ `watermark: {…}` |
| **PDF/A-3 attachments** | ✅ `--attachment` | ✅ `attachments: [...]` |
| **Every bundled script (32 scripts, 36 modules) + COLRv1 emoji + math** | ✅ `--font` / `--lang` (`gu pa kn ml or` since v1.6.0) | ✅ `registerFont()` / `loadFontData()` |
| **Page-tree editing (merge / split / extract)** | ✅ `merge` / `split` / `extract` | ✅ `mergePdfs()` / `splitPdf()` / `extractPages()` |
| **Markup annotations** | ✅ `annotate` | ✅ `PdfModifier.addAnnotation()` / `buildAnnotationBody()` |
| **Bookmarks / outline** | ✅ `render --outline` | ✅ `outline: '…'` |
| **Layout introspection / debug** | ✅ `render --inspect-layout` / `--debug-layout` | ✅ `inspectDocumentLayout()` / `layout.debug` |
| **AI-governance / HITL gate** | ✅ `govern` (draft validation via the CLI's `validateGovernanceDraft()`) | — (contract files in the repo; the core's check is a repo script, not a published API) |
| **Parallel batch render** | ✅ `batch` | — (compose `render`) |
| **JSON Schema export** | ✅ `schema` | — N/A |
| **Agent-native `--json`/`E_*`/`--dry-run`** | ✅ | — N/A |
| **Table-centric variant** | ✅ `--variant table` | ✅ `buildPDFBytes()` |
| **Full `PdfLayoutOptions`** | ✅ `--layout file.json` | ✅ |
| **Web Worker offloading** | ❌ N/A | ✅ `pdfWorker.ts` |

---

## Examples — ready-to-run

The [`samples/`](https://github.com/Nizoka/pdfnative-cli/tree/main/samples) directory in the CLI repository ships **ready-to-run examples** organized by feature — the generator renders 99 of them as the byte-stable sample corpus (82 under `render/`), nine of which are new in v1.6.0:

| Category | What it shows |
|---|---|
| `render/document/` | Minimal document, all blocks reference, invoice, technical spec, multi-page report |
| `render/table/` | Project status, financial summary |
| `render/table-variant/` | `PdfParams`-shaped financial ledger via `--variant table` |
| `render/barcode/` | QR code, Code 128, EAN-13 |
| `render/form/` | Contact form, survey |
| `render/toc/` | Auto-generated table of contents with `/GoTo` links; `02-long-toc` — a 160-entry TOC that paginates, `--inspect-layout` agreeing *(v1.6.0)* |
| `render/link/` | Resource directory with hyperlinks |
| `render/watermark/` | Draft / Confidential watermarks |
| `render/layout/` | US Letter, A5 portrait, A4 landscape |
| `render/pdfa/` | PDF/A-1b, 2b, 3b archival conformance |
| `render/encryption/` | AES-128 password-protected PDF |
| `render/headers-footers/` | Page templates with `{page}/{pages}/{date}/{title}` |
| `render/attachments/` | PDF/A-3 hybrid invoice with embedded XML (Factur-X / ZUGFeRD) |
| `render/multilang/` | Multilang rendering via the bundled `--font` shortcuts — every one of the 32 script codes is rendered by the corpus; `12-five-indic-scripts` (Gujarati, Gurmukhi, Kannada, Malayalam, Odia) and `13-rtl-direction` (Arabic and Hebrew under `--direction auto`) *(v1.6.0)* |
| `render/chart/` | Native vector charts (bar, line, pie, donut) *(v1.3.0)*; `06-per-bar-colours` — `series[].colors` per value and an unlabelled series *(v1.6.0)* |
| `render/images/` | `01-jpeg2000` — a JPEG 2000 image block passed through as `/JPXDecode` *(v1.6.0)* |
| `render/math/` | Noto Sans Math font routing *(v1.2.0)* |
| `render/outline/` | `/Outlines` bookmark trees (`--outline auto` and explicit JSON) *(v1.2.0)* |
| `render/table-smart/` | Smart-table flags (`--table-wrap`, `--zebra`, …) *(v1.3.0)* |
| `render/font/`, `render/template/`, `render/watch/`, `render/inspect-layout/` | Font shortcuts (incl. `--font-file` since v1.5.0), templates, watch mode, layout introspection |
| `render/typography/` | Paragraph breaking, justify + optical margins + soft hyphens, French and custom punctuation spacing, kerning + OpenType features, per-block `keepWithNext` / `splittable` *(v1.5.0)* |
| `render/print/` | Bleed / trim boxes and printer's marks, viewer preferences; CMYK colours, colour bars and PDF/X-4 with a synthetic CMYK profile *(v1.5.0)*; `08-spot-colours` (`/Separation` inks, a `/DeviceN` mix, an undeclared ink refused under `--dry-run`) and `09-dual-pdfa2b-pdfx4` (the dual claim, `--check pdfa,pdfx`, PDF/A-1b refused) *(v1.6.0)* |
| `render/reproducible/`, `render/base14/` | `--creation-date` / `SOURCE_DATE_EPOCH` double-render byte-identity check; `metrics: "exact"` on the base-14 path *(v1.5.0)* |
| `fill/` | AcroForm fill / flatten / export round trip *(v1.3.0)* |
| `encrypt/` | Encrypt / decrypt an existing PDF *(v1.3.0)* |
| `extract-text/` | Reading-order text extraction (`text` / `json` / `ndjson`) *(v1.3.0)*; `03-rtl-logical-order` — Arabic and Hebrew back in logical order, and the same file with `--actual-text false` for contrast *(v1.6.0)* |
| `merge/`, `split/`, `extract/`, `annotate/` | Page-tree editing and markup annotations *(v1.2.0)* |
| `sign/` | Bash + PowerShell signing scripts (basic + with metadata), the LTV ladder; `11-ltv-offline` — `ltv embed --cert … --match chain` from held material, `--dry-run` first *(v1.6.0)* |
| `inspect/` | JSON & text inspection, `--verbose --pages`, `--check pdfa` |
| `verify/` | Self-signed verification, strict-mode CI gating |
| `batch/`, `doctor/`, `govern/`, `completion/`, `agent/`, `config/` | Automation, preflight, governance, shell completion, agent patterns |
| `streaming/` | 200-section document via streaming render |

Render them all at once (since v1.5.0 the sample generator drives the built binary under a pinned date, replacing the former `samples/run-all.js`):

```bash
git clone https://github.com/Nizoka/pdfnative-cli
cd pdfnative-cli
npm ci && npm run build && npm run test:generate
```

---

## Release history

### What's new in v1.6.0

v1.6.0 is built on **pdfnative 1.9.0** (pin `^1.9.0`) and exposes every 1.9.0 engine feature — right-to-left layout under the full Unicode Bidirectional Algorithm, five more Indic scripts (32 in all, 36 bundled font modules), spot colours, the PDF/A-2 + PDF/X-4 dual claim, JPEG 2000 images, four more diagnostics (13 diagnostic codes), the stream-limit policy of `extractText()`, offline LTV material, engine-built link bodies and `/Info` text-string decoding — and delivers every roadmap item the engine unblocked. 21 commands, 19 schema subjects, 12 stable error codes and 10 global flags are unchanged; `render` grows 57 → 59 flags, `extract-text` 9 → 10, `compare` 8 → 9, `ltv` 7 → 11. **100 % backward-compatible command surface** — every envelope field is additive and the v1.5.0 test suite is replayed against the current sources on every pull request (`compat-previous`, 67 files / 839 cases) — but the *bytes* differ from v1.5.0 output for every PDF that embeds a font (see *Compatibility*).

| Area | v1.5.0 | v1.6.0 |
|---|---|---|
| Right-to-left | left-to-right only; untagged shaped runs extracted in visual order | **`--direction auto\|ltr\|rtl`** (`layout.direction`, UAX #9; no CLI default — omitted keeps the old behaviour; a paragraph's own `direction` wins), **`--actual-text [true\|false]`** (`/Span /ActualText` on untagged shaped and RTL runs — `extract-text` returns **logical order, as typed**; only `false` changes the output); the envelope carries `direction` and, when switched off, `actualText: false` |
| Fonts | 27 scripts <!-- verify-docs:allow stale-token (v1.5.0-era count) -->, 31 modules | **32 scripts** / **36 bundled font modules** — `gu pa kn ml or` (Gujarati, Gurmukhi, Kannada, Malayalam, Odia); `doctor`, the `--font` allow-list error and `schema render` say the new numbers; `TEXT_GLYPH_NOT_COVERED` names a code point no registered font covers |
| Print / colour | CMYK, colour bars, PDF/X-4 exclusive with PDF/A | **Spot colours** from JSON (`layout.print.spotColours`, `{ spot }` / `{ spot, tint }` / `{ inks }` → `/Separation` / `/DeviceN`; `Spot colour ` / `Ink mix ` refusals → `E_INPUT`); chart `series[].colors` per value, optional series `label`; the **PDF/A-2b\|2u + PDF/X-4 dual claim** (`--tagged pdfa2b --pdfx pdfx4`; the CLI pre-check is gone, `pdfa1b` / `pdfa3b` refused by the engine → `E_INPUT`); `--output-intent-icc` takes a `prtr` CMYK **or Gray** profile; the envelope carries `tagged` |
| Images | JPEG / PNG | **JPEG 2000** (`.jp2` / `.j2k`) in `image` blocks and `--watermark-image`, sniffed by the engine, embedded as `/JPXDecode` (PDF 1.5; RGBA → `/SMaskInData 1`); `PDFA1_JPX_IMAGE` and `PDFA_JPX_IMAGE` diagnostics |
| Diagnostics | 9 codes under `--strict` | **13 diagnostic codes** — adds `PDFA_GLYPH_WITHOUT_UNICODE`, `PDFA1_JPX_IMAGE`, `PDFA_JPX_IMAGE`, `TEXT_GLYPH_NOT_COVERED`; `schema status` lists them |
| `extract-text` / `compare` | an over-cap stream yielded an empty page, `ok` | **`--on-stream-error limit\|throw\|skip`** — `limit` (default) fails with `E_INPUT` naming both remedies, `throw` fails on any undecodable stream, `skip` keeps the old lenience; classified by the engine's `PdfStreamLimitError` instance, never by message; `compare` applies it to both PDFs (only `throw` rules out an equal verdict over an unread stream); `subs` / `sups` glyphs extract as their source characters |
| `ltv` | `collect --online` → JSON → `embed --data` | **`embed --cert <pem\|der> --ocsp <der> --crl <der>`** (repeatable, 16 MiB each) + **`--match all\|chain`** compose `/DSS` + `/VRI` through `composeLtvData` — no network, no `collect`; exclusive with `--data` (exit 2); unmatched material still ships in `/DSS` (no `/VRI` reference under `chain`), an empty set or an unsigned document → `E_INPUT`; `--dry-run` composes without writing; the envelope carries `match` |
| `annotate` / `inspect` / `compare` | CLI-built `/Link` body; `--check` repeated only; UTF-16 `/Info` only | `link` bodies from the engine's `buildAnnotationBody`; **`--check pdfa,pdfx`** (comma list next to the repeated form); `/Info` strings decoded through `decodePdfTextString` (PDFDocEncoding and UTF-16) |
| `render --variant table` | a string `infoItems` entry rendered `undefined :` | `infoItems` must be `{ label, value }` objects and rows must carry `cells` — refused with `E_INPUT` instead of an engine `TypeError` (`schema render` documents the shape) |
| Agent contract | 31 envelope fields <!-- verify-docs:allow stale-token (v1.5.0-era count) --> | **`schema status` pins 35 envelope fields** (`tagged`, `direction`, `actualText`, `match` new); `schema render` describes the new shapes; `$id` = `https://pdfnative.dev/schema/cli/<version>/<subject>.schema.json`; completions carry every new flag; `docs/AGENT_CONTRACT.md` covers the stream-limit policy, logical-order extraction, the offline B-LT rung and the compatibility promise |
| Quality | 1403 tests across 96 files, 86.06 % <!-- verify-docs:allow stale-token (pdfnative-cli's own suite) --> | **1555 tests across 103 files**, 86.86 % statement coverage; 99 sample PDFs (82 `render`), a 25-file PDF/A + PDF/X conformance corpus validated by veraPDF; nine fuzz targets under ClusterFuzzLite; the gate required on Ubuntu (Node 22 / 24), Windows and macOS <!-- verify-docs:allow stale-token (pdfnative-cli's own suite) --> |
| Compatibility | `pdfnative ^1.8.0`, Node ≥ 22 | `pdfnative ^1.9.0`, Node ≥ 22. **Bytes differ from v1.5.0** for every PDF that embeds a font (lean, compact subsets under the six-letter `ABCDEF+` tag), every untagged document with shaped or right-to-left text (`/Span /ActualText`), the watermarked and tagged samples and `annotate/linked.pdf`: hash-based consumers rebaseline once, then keep pinning with `--creation-date`. Over-cap streams are `E_INPUT` (were `E_PARSE`; `verify` keeps `E_PARSE`); the publish pipeline is guard → build → publish → attest (SLSA Build L2, SBOMs, Sigstore bundle) |

Full changelog: [pdfnative-cli release notes v1.6.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.6.0).

### What's new in v1.5.0

<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
v1.5.0 is built on **pdfnative 1.8.0** (pin `^1.8.0`) and exposes every 1.8.0 engine feature — the typography engine, CMYK colours and colour bars, PDF/X-4 output with a structural validator, five more scripts (27 in all) with `latin` aliases, custom fonts from disk, and UTC, pinnable creation dates that make output **byte-reproducible** — plus the roadmap items the engine unblocked. 21 commands, 19 schema subjects and 12 stable error codes are unchanged; the global flag count grows to 10 (`--creation-date`). **100 % backward-compatible command surface** — every envelope field is additive — but the *bytes* differ from v1.4.0 output (see *Compatibility*).

| Area | v1.4.0 | v1.5.0 |
|---|---|---|
| Typography | — | **`layout.typography`** (12 keys: widows/orphans, `splitParagraphs`, `keepHeadingsWithNext`, `opticalMargins`, `punctuationSpacing` `fr` / `fr-CA` / rules, `unitBinding`, `bindShortWords`, `hyphenationLanguage`, `kerning`, `fontFeatures`, `metrics`), paragraph `align: "justify"`, block `keepWithNext` / `splittable`; flags **`--split-paragraphs`**, **`--keep-headings-with-next`**, **`--kerning`**, **`--font-features <tag,…>`** |
| Print / PDF/X / CMYK | `layout.print`, RGB output intent, `/Trapped` via JSON | **`--pdfx pdfx4`**, **`--output-intent-icc`** (16 MiB cap, `acsp` check), `--output-intent-id`, `--trapped true\|false\|unknown`; CMYK colours (`"c m y k"` / `[c,m,y,k]`) everywhere; `layout.print.marks.colourBars`; `PDFX_NO_FONT_ENTRIES` / `PDFX_DEVICE_CMYK` / `PDFX_ANNOTATIONS` / `TYPOGRAPHY_FEATURE_INEFFECTIVE` join `--strict` (9 codes) |
| Fonts | 22 scripts <!-- verify-docs:allow stale-token (v1.4.0-era count) -->, bundled fonts only | **27 scripts** (`lo nod khb tdd cjm`), `ha yo ig sw` → `latin`, **`--font-file <path.ttf>[:name]`** (repeatable, 32 MiB cap, validated, never from JSON); `--variant table` embeds fonts |
| Reproducibility | no date pinning | global **`--creation-date <iso8601>`** / `SOURCE_DATE_EPOCH` pins `/CreationDate`, `xmp:CreateDate`, `{date}` and the trailer `/ID` in UTC → byte-identical output across hosts; `render --dry-run` runs the real build in memory |
| Global flags | 9, after the command | 10; may **precede the command** (`pdfnative --json --dry-run render …`); arguments without a command exit 2 (`E_USAGE`) |
| `inspect` | PDF/A, PDF/UA, signatures | **`--pdfx`**, **`--check pdfx`**, `pdfxConformance` (always present), **`--iso-dates`**, `metadata.modDate`, `--summary` gains `pdfx` |
| `annotate` / `sign` / `verify` | markup types; `--timestamp` | `annotate` type **`link`** (`rect` + `url`, http/https/mailto); **`sign --timestamp-timeout <ms>`** (`timestamp.timeoutMs`); `verify` reports `timestampDigest` and flags a SHA-1 `messageImprint` as a weak digest (fails under `--strict`) |
| `doctor` | `node`, `webcrypto`, `pdfnative`, `cli`, `commands` | adds `fonts` (the bundled modules and scripts, probed on disk), `unicode`, `conformance` (`pdfa1b,pdfa2b,pdfa2u,pdfa3b,pdfx4`) |
| Agent contract | AGENTS.md, envelope partly pinned | **`docs/AGENT_CONTRACT.md`**; `schema status` pins all **31 envelope fields** (`pdfx`, `creationDate`, `timestamp.timeoutMs`, `dryRun` new); `.pdfnativerc.json` per-command sections apply to all 21 commands |
| Fixes | — | `--layout` no longer clobbers a nested `typography` / `outputIntent` object from the document; `--font-file` derives the same default name on every platform; `inspect` / `compare` decode UTF-16BE `/Info` strings (an em dash in a title no longer yields `title: null`); an unknown `formField.fieldType` is refused with `E_INPUT` (the engine types are `text`, `multilineText`, `checkbox`, `radio`, `dropdown`, `listbox` — samples using `textarea` / `select` were renamed to `multilineText` / `dropdown`); a command flag before the command no longer swallows the command name |
| Compatibility | `pdfnative ^1.7.0`, Node ≥ 22 | `pdfnative ^1.8.0`, Node ≥ 22. **Bytes differ from v1.4.0** (UTC dates, hinting tables kept in TrueType subsets, corrected Thai and Lao mark ordering): hash-based consumers rebaseline once, then pin with `--creation-date`. `samples/run-all.js` removed (`npm run test:generate` replaces it). SSRF guard also blocks `198.18.0.0/15`, `192.0.2.0/24` and `64:ff9b::/96`; `--layout` files share the 50 MB cap |

Full changelog: [pdfnative-cli release notes v1.5.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.5.0). <!-- verify-docs:allow version-token (historical link) -->

### What's new in v1.4.0

v1.4.0 requires **pdfnative ≥ 1.7.0** (pin `^1.7.0`) and completes the signature story: the full **PAdES ladder** (B-B → B-T → B-LT → B-LTA) is now writable from the command line, alongside signature-safe metadata edits, a CI-grade document diff, and a declarative batch pipeline. **No contract change** — every flag, default, exit code, error code and envelope from 1.x behaves identically on Node ≥ 22.

| Area | v1.3.0 | v1.4.0 |
|---|---|---|
| Commands | 17 commands <!-- verify-docs:allow stale-token (v1.3.0-era count) --> | adds **`metadata`** (incremental `/Info` + XMP edits that keep signatures valid), **`ltv`** (PAdES B-LT — `collect` / `embed` / `add`, air-gap-friendly), **`doc-timestamp`** (PAdES B-LTA `/DocTimeStamp` revisions), and **`compare`** (text + structure diff with CI exit codes) |
| Signing | `--timestamp` reserved (`E_UNSUPPORTED`) | **`sign --timestamp <tsa-url>` works** (RFC 3161, PAdES B-T) with `--timestamp-digest` / `--timestamp-nonce`; plus `--digest sha384\|sha512` (RSA), `--profile pades`, `--allow-multiple`, `--field-name`, visible signatures (`--signature-rect` / `--signature-page`), `--placeholder-bytes` |
| Verification | RSA/ECDSA-SHA256 | adds **rsa-sha384 / rsa-sha512** and validates `/DocTimeStamp` revisions; per-signature `fieldName` and `isDocTimestamp` (additive) |
| Inspection | metadata, forms, encryption | adds `--signatures` (structural inventory), `--check "signatures>=N"`, print boxes (`cropBox` / `trimBox` / `bleedBox` / `artBox`, `userUnit`), `trapped`; **`--check signed` no longer counts unsigned placeholders** (correctness fix) |
| `render` | charts v1 (5 types) | **`--strict`** PDF/A gate, image blocks from JSON, print production (`layout.print`, output intent, viewer preferences, `/Trapped`), **charts v2** (9 types, dual axes, log/time scales, data labels), `--chunk-size` |
| Automation | per-directory `batch` | **`batch --manifest`** — declarative pipeline with `@id` references, a 14-command whitelist, `--allow-network` opt-in and `--continue-on-error` |
| Hardening | — | global **`--max-inflate-size`** (anti zip-bomb, default 100 MiB); all network paths opt-in behind the SSRF guard |
| Agent contract | 11 codes, 15 subjects <!-- verify-docs:allow count-tokens (migration history) --> | **`E_NETWORK`**; `schema` grows to 19 subjects (`metadata`, `ltv-data`, `compare`, `batch-manifest`); 600 tests on Node 22/24 |
| Compatibility | `pdfnative ^1.6.0`, Node ≥ 20 | `pdfnative ^1.7.0`, **Node ≥ 22** |

Full changelog: [pdfnative-cli release notes v1.4.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.4.0). <!-- verify-docs:allow version-token (historical link) -->

### What's new in v1.3.0

v1.3.0 is built on the **pdfnative 1.6 engine** (pin `^1.6.0`) and surfaces its engine additions as five new commands (`extract-text`, `fill`, `encrypt`, `decrypt`, `doctor`), native vector charts in `render`, and password / re-encryption / constant-memory streaming on the page-tree commands. Fixes a silent `render --encrypt` no-op. **100 % backward-compatible** with v1.2.0.

| Area | v1.2.0 | v1.3.0 |
|---|---|---|
| Commands | 12 commands <!-- verify-docs:allow stale-token (v1.2.0-era count) --> | adds **`fill`** (fill / flatten / **export** AcroForms via an incremental save), **`encrypt`**, **`decrypt`**, **`extract-text`** (reading-order Unicode text: `text` \| `json` \| `ndjson`), and **`doctor`** (offline environment / capability preflight) |
| Charts | — | the engine's `chart` document block (bar, barH, line, pie, donut — the pdfnative 1.6 set) renders as pure vector path operators through `render` |
| Encryption vocabulary | `--encrypt-*` flags on `render` only | **unified vocabulary** — `--encrypt [aes-128\|aes-256]`, `--owner-password`, `--user-password`, `--permissions print,copy,modify,extract` — shared by `render`, `merge`, `split` and `extract` (legacy `--encrypt-*` flags kept as aliases) |
| Page-tree commands | plaintext sources only | **`--password`** reads encrypted sources; **`--encrypt`** re-encrypts the output; **`--stream`** (+ `--chunk-size`) streams the output with constant memory |
| Inspection | metadata, PDF/UA, annotations | adds `inspect --form-fields`, `--encryption` and `--password` |
| Shell completion | bash, zsh, fish | adds **powershell** |
| Agent contract | `--json` / `E_*` / `--dry-run` / schemas | adds the stable **`E_PASSWORD`** code and an agent capability manifest (`schema manifest` + `llms.txt`) |
| Compatibility | `pdfnative ^1.5.0` | `pdfnative ^1.6.0` |

Full changelog: [pdfnative-cli release notes v1.3.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.3.0). <!-- verify-docs:allow version-token (historical link) -->

### What's new in v1.2.0

<!-- verify-docs:allow version-token (historical release entry) -->
v1.2.0 lands the **pdfnative 1.5.0** engine's page-tree and annotation APIs on the CLI as five new commands, adds document bookmarks, a math font, layout introspection, native constant-time signing, and — for autonomous agents — surfaces pdfnative's **AI-governance / Human-in-the-Loop (HITL)** contract. **100 % backward-compatible** with v1.1.0.

| Area | v1.1.0 | v1.2.0 |
|---|---|---|
| Commands | render, sign, inspect, verify, batch, schema | adds **`merge`**, **`split`**, **`extract`** (page-tree), **`annotate`** (markup), and **`govern`** (`rules` / `policy` / `verify-issue`) |
| Bookmarks | — | **`render --outline auto`** derives a `/Outlines` bookmark tree from headings; `--outline <tree.json>` supplies an explicit `OutlineItem[]` |
| Math font | — | **`render --font math`** registers the bundled Noto Sans Math font; pdfnative auto-routes math-operator / geometric-shape code points to it |
| Layout tooling | — | **`render --inspect-layout`** emits a `LayoutInspection` JSON report; **`--debug-layout [margins,content,cells]`** overlays layout guides on a normal PDF |
| Signing | pure-JS bignum CMS | **native `node:crypto` by default** (constant-time, side-channel-resistant RSA/ECDSA); **`--pure-crypto`** opts back into the portable pure-JS path |
| Inspection | metadata, PDF/UA | **`inspect --annotations`** lists markup + link annotations; `/PageLabels` are reported automatically when present |
| Agent / governance | `--json`/`E_*`/`--dry-run` | adds the stable **`E_POLICY`** code; `schema` gains `annotate` + `govern-verify` subjects; `--dry-run` now also covers `merge` / `split` / `extract` / `annotate` |
| Compatibility | `pdfnative ^1.3.0` | `pdfnative ^1.5.0` |

Full changelog: [pdfnative-cli release notes v1.2.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.2.0). <!-- verify-docs:allow version-token (historical link) -->

### Previously in v1.1.0

<!-- verify-docs:allow version-token (historical release entry) -->
v1.1.0 is built on **pdfnative 1.3.0** and surfaces its new engine capabilities through the CLI, plus a full agent-native automation contract. **100 % backward-compatible** with v0.3.0.

| Area | v0.3.0 | v1.1.0 |
|---|---|---|
| Fonts | `--font {latin,emoji}` | **Every bundled Unicode script + COLRv1 colour emoji** — `--font`/`--lang` allow-list covers every bundled font (`latin`, `emoji`, `color-emoji`, and the 22 script codes incl. Telugu `te`, Sinhala `si`, Tibetan `bo`, Khmer `km`, Myanmar `my`, Amharic `am`) |
| Streaming | `--stream` (single-pass), page-by-page | adds **`--stream-true`** — true constant-memory streaming via `buildDocumentPDFStreamTrue` / `buildPDFStreamTrue`; the joined binary never materialises |
| Block cap | hard-coded ceiling | **`--max-blocks <n>`** exposes `layout.maxBlocks` (default 100 000) for very large reports |
| Accessibility | — | **PDF/UA (ISO 14289-1) structural validator** — `inspect --pdfua` and `--check pdfua` as a CI accessibility gate |
| Agent contract | — | global **`--json`** status/error envelope on stderr, stable **`E_*` error codes**, **`--dry-run`**, token-economy **`--summary`** / **`--fields`** projection, compact JSON by default |
| Commands | render, sign, inspect, verify | adds **`batch`** (parallel directory render) and **`schema`** (JSON Schema export) |
| Supply chain | provenance | adds a CycloneDX **SBOM** (`sbom.cdx.json`) attached to every release + OpenSSF Scorecard badge |
| Compatibility | `pdfnative ^1.1.0` | `pdfnative ^1.3.0` |

Full changelog: [pdfnative-cli release notes v1.1.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.1.0). <!-- verify-docs:allow version-token (historical link) -->

### Previously in v0.3.0

v0.3.0 finished the digital-signature story and added three iteration-friendly `render` flags. **100 % backward-compatible** with v0.2.0.

| Area | v0.2.0 | v0.3.0 |
|---|---|---|
| `sign` algorithm | RSA-SHA256 only (ECDSA stub) | RSA-SHA256 **and** ECDSA-SHA256 — fully wired via `parseEcPrivateKey` (SEC1 / PKCS#8 P-256) |
| `sign` placeholder | Required a prior `prepare_signature_placeholder` call | **Auto-injection** — CLI detects PDFs with no AcroForm signature field and adds `/Sig` via a single incremental update |
| `verify` scope | Byte-range integrity + cert chain | Real CMS/PKCS#7 verification — signature value (RSA + ECDSA), message digest, certificate chain, trust roots, RFC 3161 timestamp detection |
| `render --watch` | — | Re-render on input change (200 ms debounce, stderr-only logs) |
| `render --template <file.json>` | — | Deep-merge a base template under stdin / `--input` |
| `render --font <name>` | — | Bundled font shortcut (`latin`, `emoji`) |
| Compatibility | `pdfnative ^1.0.5` | `pdfnative ^1.1.0` |

### Previously in v0.2.0

The v0.2.0 release expanded the CLI from ~10 flags to a near-complete projection of the `pdfnative` v1.0.5 surface, while remaining 100 % backward-compatible with v0.1.0.

| Area | v0.1.0 | v0.2.0 |
|---|---|---|
| Layout | `--conformance` only | Hybrid model — high-frequency knobs as flags, full `PdfLayoutOptions` via `--layout file.json` |
| PDF/A | `--conformance 1b\|2b\|3b` | `--tagged none\|pdfa1b\|pdfa2b\|pdfa2u\|pdfa3b` (`--conformance` deprecated) |
| Encryption | — | `--encrypt-owner-pass`, `--encrypt-user-pass`, `--encrypt-algorithm`, `--encrypt-permissions` (env-var precedence) |
| Watermarks | — | `--watermark-text`/`-image`/`-opacity`/`-angle`/`-color`/`-font-size`/`-position` |
| Headers / footers | — | `--header-{l,c,r}`, `--footer-{l,c,r}` with `{page}/{pages}/{date}/{title}` placeholders |
| PDF/A-3 attachments | — | `--attachment <path>[:mime[:rel[:desc]]]` (repeatable) |
| Multilingual fonts | — | `--lang th,ja,ar` (at the time, required a wrapper registering fonts via `registerFont()`; superseded by `--font` in v1.1.0) |
| `verify` command | n/a | byte-range integrity + cert chain + `--trust` roots

---

## Migration v1.5.0 → v1.6.0

**100 % backward-compatible command surface** — no flag, default, exit code or error code changed; every envelope field is additive and pinned by `schema status`, and the v1.5.0 test suite is replayed against the current sources on every pull request. What to plan for:

1. **Pin `pdfnative-cli@^1.6.0`** (it depends on `pdfnative ^1.9.0`, Node ≥ 22 unchanged). `doctor` reports `36 modules / 32 scripts` and `conformance` unchanged.
2. **Rebaseline hashes once, then keep pinning the date.** The 1.9.0 engine changes the bytes of every PDF that embeds a font (lean, compact subsets under the six-letter `ABCDEF+` tag — withheld under PDF/A-1), of every untagged document with shaped or right-to-left text (`/Span /ActualText`, one text object per line), of every watermarked or tagged document (a page transparency group; table `/Scope` / `/Headers` / `/IDTree`) and of `annotate/linked.pdf` (the engine's `/Link` body). Spec-valid throughout; `--creation-date` / `SOURCE_DATE_EPOCH` still make the new bytes reproducible.
3. **`extract-text` / `compare` now refuse an over-cap stream.** A content or font stream past `--max-inflate-size` is `E_INPUT` where v1.5.0 answered `ok` with an empty page. Pass `--on-stream-error skip` for the old answer, or raise the cap for a trusted file. On every other command that opens a PDF the same condition moved from `E_PARSE` to `E_INPUT` (with a message naming the flag); `verify` keeps its own `E_PARSE` — branch on the code, not the message.
4. **The dual claim succeeds where it was a usage error.** `--pdfx pdfx4 --tagged pdfa2b|pdfa2u` renders one file with both claims (exit 0); a script that relied on the exit-2 refusal must be revisited. `pdfa1b` / `pdfa3b` with `--pdfx` are still refused, now by the engine as `E_INPUT` (exit 1).
5. **`--variant table` validates `infoItems` and `rows[].cells`.** Plain-string `infoItems` (which rendered `undefined :` labels) are refused with `E_INPUT` naming the `{ "label", "value" }` shape; the shipped `table-variant` sample is corrected.
6. **Right-to-left is opt-in.** `--direction` has no CLI default: without it (and without `layout.direction`) nothing is set and the layout stays left-to-right as before (the bytes still move with pdfnative 1.9.0: compact subsets, one text object per line, `/ActualText` on right-to-left and reordered runs). `--actual-text false` removes those spans without restoring 1.8.0 bytes; it removes the logical-order guarantee of `extract-text` on that file.
7. **Logical-order extraction rides on the `/Span /ActualText` the 1.9.0 engine writes.** A file rendered by an earlier release carries none on its untagged shaped runs, so the upgrade alone does not change what `extract-text` returns for it; a re-render of the same JSON extracts as typed (Arabic, Hebrew, Khmer, Myanmar, Indic), and a `subs` / `sups` glyph extracts as its source character. Diff-based consumers of `extract-text` over a re-rendered corpus should expect that.
8. **Inventory strings and schemas grew, additively.** `doctor`, the `--font` allow-list error and `schema render` say 32 scripts / 36 modules and 13 diagnostic codes; `schema status` has 35 properties (`tagged`, `direction`, `actualText`, `match`); `inspect --check` accepts `pdfa,pdfx`; `ltv embed` gains `--cert` / `--ocsp` / `--crl` / `--match` (exclusive with `--data`). Consumers that parse those strings or validate against a captured 1.5.0 schema should refresh the capture — a minor only adds.

```diff
# 1. Right-to-left layout, logical-order extraction (opt-in; omitted = unchanged output)
- pdfnative render --input letter.json --output letter.pdf --font ar --font latin --lang ar,latin
+ pdfnative render --input letter.json --output letter.pdf --font ar --font latin --lang ar,latin --direction auto
+ pdfnative extract-text --input letter.pdf --format ndjson

# 2. The dual claim — was exit 2, now one file with both claims
- pdfnative render --input brochure.json --output brochure.pdf --pdfx pdfx4 --output-intent-icc press.icc --trapped false --font latin --lang latin
+ pdfnative render --input brochure.json --output brochure.pdf --pdfx pdfx4 --tagged pdfa2b --output-intent-icc press.icc --trapped false --font latin --lang latin
+ pdfnative inspect --input brochure.pdf --check pdfa,pdfx

# 3. An over-cap stream is E_INPUT by default — opt back into the old lenience, or raise the cap
  pdfnative extract-text --input scanned.pdf --format ndjson
+ pdfnative extract-text --input scanned.pdf --format ndjson --on-stream-error skip
+ pdfnative --max-inflate-size 536870912 extract-text --input big-but-trusted.pdf --format ndjson

# 4. --variant table: infoItems as { label, value } objects (plain strings are now E_INPUT)
-   "infoItems": ["Period: Q1 2026"]
+   "infoItems": [{ "label": "Period", "value": "Q1 2026" }]

# 5. PAdES B-LT from material you hold — no collect step, no network
- pdfnative ltv collect --input signed.pdf --online --output ltv-data.json
- pdfnative ltv embed --input signed.pdf --data ltv-data.json --output signed.lt.pdf
+ pdfnative ltv embed --input signed.pdf --output signed.lt.pdf --cert chain.pem --ocsp signer.ocsp.der --crl ca.crl --match chain
```

## Migration v1.4.0 → v1.5.0

<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
**100 % backward-compatible command surface** — no flag, default, exit code or error code changed. The *bytes* changed with the pdfnative 1.8.0 engine (UTC dates, hinting tables kept in TrueType subsets, corrected Thai and Lao mark ordering), so hash-based consumers rebaseline once and then pin the date:

```diff
# 1. Reproducible bytes: rebaseline once, then pin the creation instant (or SOURCE_DATE_EPOCH)
- pdfnative render --input doc.json --output doc.pdf
+ pdfnative render --input doc.json --output doc.pdf --creation-date 2026-01-01T00:00:00Z

# 2. formField blocks: the engine's six types only — unknown values are now E_INPUT
-   { "type": "formField", "fieldType": "textarea", "name": "notes" }
+   { "type": "formField", "fieldType": "multilineText", "name": "notes" }
-   { "type": "formField", "fieldType": "select", "name": "country" }
+   { "type": "formField", "fieldType": "dropdown", "name": "country" }

# 3. Global flags may now precede the command (both forms are equivalent)
  pdfnative render --input doc.json --output doc.pdf --json --dry-run
+ pdfnative --json --dry-run render --input doc.json --output doc.pdf

# 4. A font file of your own, no wrapper script
+ pdfnative render --input doc.json --output doc.pdf --font-file fonts/House.ttf:house --lang house

# 5. PDF/X-4 for print, re-checked structurally
+ pdfnative render --input brochure.json --output brochure.pdf --pdfx pdfx4 --output-intent-icc press.icc --trapped false --strict
+ pdfnative inspect --input brochure.pdf --check pdfx
```

`samples/run-all.js` no longer exists in the CLI repository — `npm run build && npm run test:generate` replaces it.

## Migration v0.3.0 → v1.1.0

**100 % backward-compatible.** Every v0.3.0 invocation continues to produce a byte-equivalent PDF. New, optional opportunities:

```diff
# 1. True constant-memory streaming for very large reports
- pdfnative render --input big.json --output big.pdf --stream
+ pdfnative render --input big.json --output big.pdf --stream-true

# 2. CI accessibility gate (PDF/UA)
+ pdfnative inspect --input report.pdf --check pdfua

# 3. Agent-native, token-frugal output
+ pdfnative inspect --input report.pdf --json --summary

# 4. Parallel directory render
+ pdfnative batch --input-dir inputs/ --output-dir outputs/ --concurrency 4
```

## Migration v0.2.0 → v0.3.0

**100 % backward-compatible.** Three forward-looking opportunities:

```diff
# 1. ECDSA signing now works without a workaround
- pdfnative sign -i in.pdf -o out.pdf --algorithm rsa-sha256 ...
+ pdfnative sign -i in.pdf -o out.pdf --algorithm ecdsa-sha256 \
+   --key ec-key.pem --cert ec-cert.pem

# 2. Sign without a prior placeholder step
- pdfnative sign -i with-placeholder.pdf -o signed.pdf ...
+ pdfnative sign -i any-pdf.pdf -o signed.pdf ...   # placeholder auto-injected
```

## Migration v0.1.0 → v0.2.0

**100 % backward-compatible** — every v0.1.0 invocation continues to produce a byte-equivalent PDF, modulo a one-line stderr notice for `--conformance`. All v0.1.0 exit codes and JSON shapes are preserved; new `inspect` JSON fields are additive only.

The only soft change you should plan for:

```diff
- pdfnative render --input doc.json --output report.pdf --conformance 2b
+ pdfnative render --input doc.json --output report.pdf --tagged pdfa2b
```

`--conformance` will be **removed in v1.0.0** of the CLI.

---

## Troubleshooting

### `command not found: pdfnative`
You installed via `npx` (one-shot) and not globally. Either prepend `npx` to every invocation, or run `npm install --global pdfnative-cli`.

### `JSON parse error: input too large`
The CLI caps input JSON at 50 MB to prevent memory exhaustion. For very large documents, either split the document into multiple PDFs or use the library directly with the streaming API.

### `Error: invalid private key`
Both RSA PKCS#1 and ECDSA P-256 keys are accepted, but they must be **PEM-encoded**. Convert DER to PEM with `openssl pkcs8 -topk8 -in key.der -out key.pem -nocrypt`. As of v0.3.0, ECDSA support in `sign` is fully wired (SEC1 / PKCS#8 P-256 via `parseEcPrivateKey`).

### `Encryption requires an owner password. Provide --owner-password <pass> or $PDFNATIVE_ENCRYPT_OWNER_PASS.`
Any encryption flag was set without an owner password. Provide it via `--owner-password <pass>` (legacy alias: `--encrypt-owner-pass`) or — recommended — the `PDFNATIVE_ENCRYPT_OWNER_PASS` env var so it never enters shell history.

### `Error: --tagged pdfa* and --encrypt-* are mutually exclusive`
ISO 19005-1 §6.3.2 forbids encryption in PDF/A. Pick one — either an archival PDF/A document, or an encrypted distribution copy, but not both.

### `E_NETWORK: opt-in network operation failed`
A TSA / OCSP / CRL fetch (`sign --timestamp`, `ltv --online`, `doc-timestamp`, `verify --revocation online`) failed at the transport level. The SSRF guard allows http/https only, blocks private / loopback / metadata addresses, follows no redirects, and enforces a 10 s timeout and a 5 MiB response cap — check the URL is public and reachable, or raise `--timeout` where the command exposes it (`ltv`, `doc-timestamp`; `sign --timestamp-timeout <ms>` since v1.5.0). Since v1.5.0 the guard also refuses `198.18.0.0/15`, `192.0.2.0/24` and `64:ff9b::/96`. A *malformed* TSA response is `E_PARSE` instead. There is never a silent fallback: either the token is embedded and verified, or the command fails.

### `E_PARSE` on a PDF that other tools open
If the message mentions an inflate cap, one of the PDF's compressed streams expands past the anti-zip-bomb ceiling (default 100 MiB). For a trusted file, raise it with the global `--max-inflate-size <bytes>` *(v1.4.0)*. Since v1.6.0 that condition is reported as `E_INPUT` with a message naming the flag on every command that opens a PDF — `verify` is the one command that keeps `E_PARSE` for it; a genuinely malformed file stays `E_PARSE` everywhere.

### `E_INPUT` ending in `(raise --max-inflate-size, or pass --on-stream-error skip to read the other streams)`
`extract-text` or `compare` *(v1.6.0)* met a content or font stream the engine refused to inflate (`PdfStreamLimitError`, code `PDF_STREAM_LIMIT`) and the default policy `--on-stream-error limit` turned it into a refusal rather than an empty page. Two remedies, both named in the message: raise the global `--max-inflate-size <bytes>` for a trusted large file (the right answer for untrusted input is to keep `limit`), or pass `--on-stream-error skip` to read the page without that stream's text. A corrupt stream is skipped under `limit` too, so `throw` — any undecodable stream fails — is the only policy under which `compare` cannot call two files equal over an unread stream.

### `--pdfx is mutually exclusive with --tagged` — but I need PDF/A **and** PDF/X
That usage error (exit 2) belonged to v1.5.0. Since v1.6.0 `--tagged pdfa2b` or `pdfa2u` next to `--pdfx pdfx4` is the supported **dual claim** (two OutputIntents, both identifications in the XMP; verify with `inspect --check pdfa,pdfx`). What is still refused — now by the engine, as `E_INPUT` with a level-specific message — is `pdfa1b` or `pdfa3b` with `--pdfx`: pick PDF/A-2 for the dual claim, or drop one of the two claims. Encryption remains exclusive with both (exit 2).

### `infoItems[0]: expected { label: string, value: string }` (`--variant table`)
Since v1.6.0 the table variant validates the `PdfParams` shape the engine types but does not check: `infoItems` is an array of `{ "label", "value" }` objects (a plain string such as `"Period: Q1"` rendered an `undefined :` label in earlier releases and crashes the 1.9.0 base-14 emitter with a `TypeError`), and every row carries `cells: string[]`. Rewrite `"Period: Q1"` as `{ "label": "Period", "value": "Q1" }`; `pdfnative schema render` documents the shape.

### `ENOENT: no such file or directory, 'D\'`  (Windows)
This was a v0.1.0 / pre-v0.2.0 regression: `--attachment D:\file.xml` was split at the drive-letter colon. Fixed in v0.2.0 — make sure you're on `pdfnative-cli@^0.2.0`.

### Layout file is ignored when I also pass CLI flags
That is the **intended precedence**: `CLI flags > --layout file > pdfnative defaults`. To merge nested objects (e.g. a watermark in the layout file plus a `--watermark-text` on the CLI), the CLI now correctly merges `params.layout` with CLI-derived flags as of v0.2.0 (previously the JSON-embedded layout could be silently dropped — fixed).

### `--lang th` does not produce Thai glyphs
`--lang` only *activates* fonts that are registered in the CLI process — pass `--font th` as well so the bundled Noto Thai module is registered (`--font` covers all 32 bundled scripts, `latin`, `emoji`, `color-emoji`, `math` — 36 bundled font modules). A wrapper script that registers fonts and then spawns the CLI does **not** work: in-memory registration does not cross a process boundary. For a font file you ship yourself, use `--font-file <path.ttf>[:name]` *(v1.5.0)*; for a custom loader, call the library directly — see *Recipes → Multilang fonts*.

### Signed PDF fails Adobe verification
Ensure your certificate's signing-key usage extension includes `digitalSignature` (key usage 0). Self-signed certificates work for testing but require the validator to trust the issuer — pass `--trust ca-root.pem` to `verify` for self-signed setups.

---

## Resources

- 📦 **npm:** [pdfnative-cli](https://www.npmjs.com/package/pdfnative-cli)
- 🏛️ **Repo:** [Nizoka/pdfnative-cli](https://github.com/Nizoka/pdfnative-cli)
- 📚 **Knowledge base:** [pdfnative-cli/docs/KNOWLEDGE_BASE.md](https://github.com/Nizoka/pdfnative-cli/blob/main/docs/KNOWLEDGE_BASE.md) — full architecture, integration patterns, FAQ
- 📁 **Samples:** [pdfnative-cli/samples](https://github.com/Nizoka/pdfnative-cli/tree/main/samples)
- 🧪 **Try it interactively:** [CLI playground](../playgrounds/cli.html) — build commands without leaving the browser
- 📐 **Use cases:** [CLI use cases](use-cases-cli.html) — reproducible builds, PDF/X-4 press handoff, house fonts, the process contract for any-language orchestrators
- 🤝 **Agent contract:** [pdfnative-cli/docs/AGENT_CONTRACT.md](https://github.com/Nizoka/pdfnative-cli/blob/main/docs/AGENT_CONTRACT.md) — `--json` envelope, `E_*` codes, `schema status`, the recommended agent loop
- 🔧 **Underlying library:** [`pdfnative`](https://github.com/Nizoka/pdfnative)
- 🤖 **AI integration:** [pdfnative-mcp guide](mcp.html) — same library exposed as a Model Context Protocol server
- 🐛 **Report a bug:** [Nizoka/pdfnative-cli/issues](https://github.com/Nizoka/pdfnative-cli/issues)
- 💬 **Discuss:** [Nizoka/pdfnative-cli/discussions](https://github.com/Nizoka/pdfnative-cli/discussions)

---

## Citation

If you use the CLI in research or academic pipelines, cite both repositories:

```bibtex
@software{pdfnative_cli_2026,
  title  = {pdfnative-cli: Official CLI for the pdfnative PDF generation library},
  author = {Nizoka},
  year   = {2026},
  url    = {https://github.com/Nizoka/pdfnative-cli},
  license = {MIT}
}
```
