# pdfnative-cli — Command-Line Interface Guide

> **Tracks the latest published `pdfnative-cli`** (v1.4.0, built on pdfnative 1.7.0 — pins `^1.7.0`). The CLI versions independently from the library. Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html). Full history: [pdfnative-cli releases](https://github.com/Nizoka/pdfnative-cli/releases).

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface** for the [`pdfnative`](https://github.com/Nizoka/pdfnative) library. It exposes 21 commands in five groups — create & edit (`render`, `fill`, `annotate`, `metadata`), page tree (`merge`, `split`, `extract`), security (`sign`, `verify`, `ltv`, `doc-timestamp`, `encrypt`, `decrypt`), read & extract (`inspect`, `extract-text`, `compare`), and automation & meta (`batch`, `doctor`, `schema`, `completion`, `govern`) — that together cover the full document lifecycle from JSON to a signed, timestamped, archive-grade PDF with the complete PAdES ladder (B-B → B-T → B-LT → B-LTA), plus page-tree editing, markup annotations, document comparison, and an AI-governance gate, with an agent-native automation contract for autonomous AI and CI pipelines.

> **Why a CLI?** Many real-world workflows live outside Node.js: shell scripts, CI pipelines, Docker containers, Makefiles, batch jobs, build tools written in other languages. The CLI lets all of them call `pdfnative` without writing JavaScript, and is fully composable through stdin/stdout pipelines.

The CLI is a **pure dispatch layer** over `pdfnative`. No PDF logic lives in the CLI itself — every command forwards to a public `pdfnative` API:

| CLI command | `pdfnative` API |
|---|---|
| `render` | `buildDocumentPDFBytes()` / `buildDocumentPDFStream()` / `buildDocumentPDFStreamTrue()` / `buildPDFBytes()` (table variant = `buildPDFBytes`, the table-centric builder; document variant = `buildDocumentPDFBytes`, the free-form block builder) |
| `fill` | `readFormFields()` / `fillForm()` / `flattenForm()` |
| `encrypt` / `decrypt` | `openPdf(bytes, { password })` + `MergeOptions.encrypt` |
| `extract-text` | `extractText()` |
| `doctor` | — (environment probe, no library equivalent) |
| `sign` | `signPdfBytes()` / `addSignaturePlaceholder()` — the native constant-time provider is implemented in the CLI (`createNativeCryptoProvider` is a CLI utility, not a pdfnative API) and passed per call as `options.provider` (pdfnative also exposes a global `setCryptoProvider()`, which the CLI does not use) |
| `inspect` | `openPdf()` / `getInfo()` / `pageCount` / `getPageLabels()` / `getAnnotations()` / `validatePdfUA()` |
| `verify` | `openPdf()` + `verifyCertSignature()` (X.509 certificate-signature checks); the CMS/PKCS#7, RFC 3161 timestamp and OCSP/CRL revocation verification is implemented in the CLI itself |
| `merge` | `mergePdfs()` |
| `split` | `splitPdf()` |
| `extract` | `extractPages()` |
| `annotate` | `PdfModifier.addAnnotation()` / `buildAnnotationBody()` |
| `metadata` | `PdfModifier.updateMetadata()` — incremental `/Info` + XMP edits that keep existing signatures valid for their revision |
| `ltv` | `collectValidationInfo()` / `embedValidationInfo()` / `addValidationInfo()` (PAdES B-LT `/DSS`) |
| `doc-timestamp` | `addDocumentTimestamp()` — an RFC 3161 `/DocTimeStamp` revision (PAdES B-LTA) |
| `compare` | `openPdf()` / `extractText()` / `readFormFields()` / `getAnnotations()` / `listSignatures()` — text + structure diff, implemented in the CLI |
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

**Requirements:** Node.js ≥ 22 *(v1.4.0 — Node 20 reached end-of-life on 2026-04-30)* · Bun · Deno (`node dist/cli.cjs`).

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
| `--input <file>` | stdin | JSON file ([`DocumentParams`](https://pdfnative.dev/#api) for `--variant document`, `PdfParams` for `--variant table`) |
| `--output <file>` | stdout | Output PDF path |
| `--variant document\|table` | `document` | Selects `buildDocumentPDFBytes` (free-form) or `buildPDFBytes` (table-centric) |
| `--stream` | off | Streaming output via `buildDocumentPDFStream` (`AsyncGenerator<Uint8Array>`) — recommended for >100-page documents |
| `--stream-page-by-page` | off | Streaming chunked at PDF object boundaries. Assembles the full document first, so TOC blocks and `{pages}` **are** supported. Mutually exclusive with `--stream` |
| `--stream-true` *(v1.1.0)* | off | Streaming via `buildDocumentPDFStreamTrue` / `buildPDFStreamTrue` — PDF parts are emitted and freed as they go, so the joined binary never materialises. Byte-identical to the buffered builders. Same constraints as `--stream` (no TOC, no `{pages}`); mutually exclusive with the other `--stream*` flags |
| `--max-blocks <n>` *(v1.1.0)* | `100000` | Exposes `layout.maxBlocks` so very large multi-thousand-page reports no longer hit a spurious ceiling |
| `--layout <file.json>` | — | Load any subset of `PdfLayoutOptions` |
| `--chunk-size <n>` *(v1.4.0)* | `65536` | Chunk size in bytes for the `--stream` / `--stream-true` output (not applicable to `--stream-page-by-page`) |
| `--strict` *(v1.4.0)* | off | Escalate PDF/A diagnostics (`PDFA_NO_FONT_ENTRIES`, `PDFA_UNEMBEDDED_FORM_FONT`, `PDFA_DEVICE_CMYK_IMAGE`) into a hard failure **before the first output byte** — exit 1, `E_CHECK_FAILED`. Without it they are `warning:` lines on stderr (hidden by `--quiet`) plus an additive `diagnostics[]` array in the `--json` envelope |

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
| `--tagged <level>` | `none` | Unified PDF/A flag: `none`, `pdfa1b`, `pdfa2b`, `pdfa2u`, `pdfa3b` |
| `--conformance <level>` | — | **Deprecated.** Maps to `--tagged pdfa<level>` with a one-line stderr notice. Removed in v1.0.0 |

#### Watermarks

| Flag | Description |
|------|-------------|
| `--watermark-text <str>` | Diagonal text watermark |
| `--watermark-image <path>` | Image watermark (PNG/JPEG, centered, aspect-preserved) |
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
| `--lang <code,code>` | Activate font loaders for the listed languages (e.g. `th,ja,ar,te,si,km`) |
| `--font <name>` *(v1.1.0)* | Register a bundled pdfnative font shortcut. Repeatable. Allow-list covers every bundled font: `latin`, `emoji`, `color-emoji`, `math` *(v1.2.0)*, and the 22 script codes (`ar hy bn ru hi am ka el he ja km ko my pl zh si ta te th bo tr vi`). Each shortcut name doubles as its `--lang` code |

`--lang` activates a *programmatically registered* font loader via `loadFontData(code)`. Latin scripts are built-in. With v1.1.0, every bundled font is registrable directly through `--font` — no wrapper script needed for the 22 bundled scripts, colour emoji, or Latin. pdfnative routes each code point to the font whose cmap covers it. See *Recipes → Multilang fonts* only for fonts you ship yourself (those require calling the library directly).

#### Bookmarks, math &amp; layout tooling _(v1.2.0)_

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

#### Print production, images from JSON &amp; charts v2 _(v1.4.0)_

Everything here rides on the pdfnative 1.7.0 engine and is reachable through the existing `--layout` file and the document JSON — no new flags needed:

- **Image blocks in the document JSON** — `{ "type": "image", "src": "logo.png" }` (path resolved relative to the `--input` JSON, same validation as `--attachment`) or `{ "type": "image", "dataBase64": "…" }` for inline JPEG/PNG.
- **`layout.print`** — `bleed`, `trimBox` / `bleedBox` / `artBox` / `cropBox`, vector printer's marks (`print.marks`), and `/UserUnit` (1–75 000). `merge` / `split` / `extract` now preserve these boxes too.
- **`layout.outputIntent`** — a custom RGB ICC output intent; **`layout.viewerPreferences`** — `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`.
- **`params.metadata`** — `author`, `subject`, `keywords`, and `trapped: True|False|Unknown`, written to `/Info` and XMP.
- **Charts v2** — the `chart` block now covers 9 types (adds `stackedBar`, `stackedBarH`, `area`, `scatter`), a secondary Y axis (`series.yAxis: "right"` + `axis2`), `category` / `linear` / `time` X axes, log scale, `dataLabels`, `labelStride`, and `labelRotation`.

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
| `--timestamp <tsa-url>` *(v1.4.0)* | — | Embed an **RFC 3161 timestamp token** from the given TSA (PAdES **B-T**). The only network opt-in on `sign` — SSRF-guarded, no fallback: transport failure is `E_NETWORK`, a malformed response is `E_PARSE`. `--dry-run` never touches the network |
| `--timestamp-digest <algo>` *(v1.4.0)* | `sha256` | TSA digest: `sha256`, `sha384`, or `sha512` |
| `--timestamp-nonce <hex>` *(v1.4.0)* | random | Explicit RFC 3161 nonce (testing / reproducibility) |
| `--digest <algo>` *(v1.4.0)* | `sha256` | CMS digest for RSA keys: `sha256`, `sha384`, or `sha512`. Combining `sha384`/`sha512` with `--algorithm ecdsa-sha256` is a usage error (exit 2) — ECDSA is SHA-256 only |
| `--profile <p>` *(v1.4.0)* | `pkcs7` | `pkcs7` or `pades` — `pades` emits `ETSI.CAdES.detached` with the ESS signing-certificate-v2 attribute and omits signing-time |
| `--allow-multiple` *(v1.4.0)* | off | Add a signature to an already-signed PDF instead of refusing (the 1.x idempotent default is preserved) |
| `--field-name <name>` *(v1.4.0)* | auto | Explicit signature field name (auto-suffixed on collision) |
| `--signature-rect <x1,y1,x2,y2>` / `--signature-page <n>` *(v1.4.0)* | invisible | Place a visible signature widget |
| `--placeholder-bytes <n>` *(v1.4.0)* | auto | Reserve a larger `/Contents` placeholder (e.g. for long chains or large timestamp tokens) |

> **Native constant-time signing (v1.2.0).** `sign` now routes CMS signing through Node's `node:crypto` by default (via `createNativeCryptoProvider`), for side-channel-resistant RSA/ECDSA. Pass **`--pure-crypto`** to select the portable pure-JS path (e.g. on a runtime without `node:crypto`).

> **PAdES B-T (v1.4.0).** `--timestamp <tsa-url>` — previously a reserved flag that failed with `E_UNSUPPORTED` — is now functional: the CLI POSTs an RFC 3161 request through its SSRF guard, verifies the token, and embeds it in the CMS unsigned attributes via `signPdfBytesWithTimestamp`. Continue the ladder with [`ltv`](#pdfnative-ltv-v140) (B-LT) and [`doc-timestamp`](#pdfnative-doc-timestamp-v140) (B-LTA).

Signing keys are **never logged** — not in error output, not in debug traces, not in stack traces. The CLI redacts them at every code path that surfaces error context.

### `pdfnative inspect`

Inspects metadata and conformance of an existing PDF. Read-only — never modifies the input.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | `json` or `text` |
| `--verbose` | off | Adds `verbose.{trailerKeys, catalogKeys, objectCount, xmpMetadata}`. Sanitised — no raw stream bytes |
| `--pages` | off | Adds `pages: [{ index, width, height, rotation, annotations, formFields }]` — since v1.4.0 also `cropBox` / `trimBox` / `bleedBox` / `artBox` and `userUnit` when present. (`metadata.trapped` is reported unconditionally since v1.4.0, with or without `--pages`) |
| `--pdfua` *(v1.1.0)* | off | Adds a `pdfua: { valid, errors, warnings }` report from `validatePdfUA()` (ISO 14289-1 structural checks: MarkInfo, StructTree, ParentTree, Lang, per-page MCID uniqueness) |
| `--annotations` *(v1.2.0)* | off | Lists markup + link annotations per page (from `getAnnotations()`). `/PageLabels` are reported automatically when present |
| `--form-fields` *(v1.3.0)* | off | Lists AcroForm fields (name, type, value, required/read-only) |
| `--encryption` *(v1.3.0)* | off | Reports the encryption scheme (algorithm, revision, opened-as) |
| `--password <pass>` *(v1.3.0)* | — | Password for an encrypted PDF (env `PDFNATIVE_PASSWORD`) |
| `--signatures` *(v1.4.0)* | off | Structural signature inventory via `listSignatures()` — `fieldName`, `subFilter`, `byteRange`, `isDocTimestamp`, `isPlaceholder`, `sigObjNum`, `contentsLength`. Never emits the signature bytes themselves |
| `--check <assertion>` | — | Repeatable; ANDed. Values: `pdfa`, `signed`, `encrypted`, `pdfua` *(v1.1.0)*, `signatures>=N` *(v1.4.0)*. Sets exit 0 = pass, 1 = fail |
| `--summary` *(v1.1.0)* | off | Under `--json`, emit a canonical minimal verdict (`{ pages, encrypted, signatures, pdfa }`) |
| `--fields <a,b.c>` *(v1.1.0)* | — | Project the JSON result to named dot-paths (array segments map over elements; unknown paths omitted) |
| `--pretty` | off | Force indented JSON even under the global `--json` (agent mode is compact) |

Composable example:

```bash
pdfnative inspect --input dist/q1.pdf \
  --check pdfa --check signed \
  --format json > dist/q1.report.json
echo "exit code: $?"   # 0 if both assertions hold
```

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

> Since v1.4.0 the CLI also **creates** LTV material — `sign --timestamp` (B-T), [`ltv`](#pdfnative-ltv-v140) (B-LT `/DSS`), and [`doc-timestamp`](#pdfnative-doc-timestamp-v140) (B-LTA) — so `verify` and the write side now cover the same PAdES ladder.

### `pdfnative ltv` _(v1.4.0)_

Embeds long-term-validation material — certificates, OCSP responses, CRLs — into a signed PDF's `/DSS` dictionary (PAdES **B-LT**), via the engine's `collectValidationInfo` / `embedValidationInfo` / `addValidationInfo`.

```bash
# Connected machine: gather the revocation evidence as replayable JSON
pdfnative ltv collect --input signed.pdf --online --output ltv-data.json

# Air-gapped machine: embed it — no network I/O is even possible here
pdfnative ltv embed --input signed.pdf --data ltv-data.json --output signed.lt.pdf

# Or both in one pass on a connected machine
pdfnative ltv add --input signed.pdf --online --output signed.lt.pdf
```

| Flag | Default | Description |
|------|---------|-------------|
| `collect` \| `embed` \| `add` | — *(required)* | Subcommand: gather evidence, embed evidence, or both |
| `--input <file>` | stdin | Signed source PDF |
| `--output <file>` | stdout | Destination — `collect` writes the evidence JSON, `embed`/`add` write the PDF |
| `--online` | off | **Required for `collect` / `add`** — the explicit network opt-in (refused with exit 2 without it). `embed` is 100 % offline by design |
| `--data <file>` | — | Evidence JSON produced by `collect` (for `embed`) |
| `--prefer <src>` | — | `ocsp` or `crl` when both are available |
| `--extra-cert <pem>` | — | Additional certificate for the `/DSS` (repeatable) |
| `--timeout <ms>` | `10000` | Per-fetch network timeout |
| `--dry-run` | off | Validate without writing |

The evidence JSON (`schema ltv-data`, versioned, DER as base64) is the air-gap bridge: `collect` on a connected machine, transfer the JSON, `embed` inside the enclave. Network fetches go through the same SSRF guard as `verify --revocation online`; failures surface as `E_NETWORK`.

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

Supported types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Only known fields are forwarded (no dictionary injection). Read them back with `inspect --annotations`. Since v1.4.0, `--password <pass>` (env `PDFNATIVE_PASSWORD`) lets you annotate an encrypted PDF — the added objects are encrypted under the document's existing scheme.

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
| `--summary` | off | (json) Emit only `{ pages, characters }` |
| `--fields <paths>` | — | (json) Comma-separated dot-paths to keep |

Text comes from the `/ToUnicode` mapping, so it is real Unicode rather than
glyph indices. A page whose content decodes entirely to U+FFFD is reported as
not extractable rather than returning noise.

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
| `--pretty` | off | Indented JSON |

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

Prints a versioned **JSON Schema (Draft 2020-12)** for a CLI input/output shape, so agents can self-validate before invoking a command. The `$id` embeds the CLI version.

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

v1.1.0 makes the CLI deterministic to drive from autonomous AI agents and CI pipelines. The full contract is documented in [pdfnative-cli AGENTS.md](https://github.com/Nizoka/pdfnative-cli/blob/main/AGENTS.md).

- **Global `--json` envelope.** Any command run with `--json` emits a single machine-readable object on **stderr**: `{ ok: false, command, error: { code, message } }` on failure, and a `{ ok: true, … }` status line for `render` / `sign` / `batch` on success (since v1.3.0, every write command emits the success line). stdout stays reserved for the primary artifact (PDF, report, schema, script).
- **Stable `E_*` error codes** on every failure: `E_USAGE`, `E_INPUT`, `E_PARSE`, `E_IO`, `E_SIGN`, `E_VERIFY_FAILED`, `E_CHECK_FAILED`, `E_POLICY` *(v1.2.0 — governance-gate failure)*, `E_UNSUPPORTED`, `E_PASSWORD` *(v1.3.0 — encrypted PDF: password missing or incorrect)*, `E_NETWORK` *(v1.4.0 — an opt-in network operation failed: TSA / OCSP / CRL fetch)*, `E_RUNTIME`. Numeric exit codes (0/1/2) are unchanged.
- **`--dry-run`** for `render`, `sign`, `batch`, and — since v1.2.0 — `merge`, `split`, `extract`, and `annotate` (v1.3.0 extends it to `fill`, `encrypt` and `decrypt`; v1.4.0 to `metadata`, `ltv` and `doc-timestamp`) — fully validate inputs (and, for `sign`, parse credentials and prepare the PDF) without producing output. A dry run never touches the network.
- **Global `--max-inflate-size <bytes>`** *(v1.4.0)* caps the decompressed size of each PDF stream when parsing untrusted inputs (anti zip-bomb; default 100 MiB).
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

For the 22 bundled scripts (plus `latin`, `emoji`, `color-emoji`, `math`), no wrapper is needed — `--font` registers each bundled font inside the CLI process:

```bash
echo '{"blocks":[{"type":"paragraph","text":"สวัสดี こんにちは"}]}' \
  | pdfnative render --font th --font ja --lang th,ja -o out.pdf
```

For a font you ship yourself (not bundled), the CLI cannot use it: in-memory font registration does not cross a process boundary, so a wrapper that registers fonts and then *spawns* the CLI does not work. Call the library directly instead:

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

---

## Security model

`pdfnative-cli` is built with the same zero-trust posture as the underlying library:

- **No `eval`, no `Function`, no dynamic code** — input JSON is parsed via the standard `JSON.parse` with a 50 MB cap to prevent memory exhaustion.
- **Path traversal protection** — all `--input` / `--output` / `--key` / `--cert` / `--cert-chain` / `--trust` / `--layout` / `--attachment` / `--watermark-image` paths are validated against `..` segments before any file system access.
- **Secrets never logged** — `loadPem` / `loadPemChain` surface only generic error messages on parse failure; raw key material never appears in `CliError` messages or stderr. Encryption passwords are never echoed.
- **Layout-file injection blocked** — `attachments[].data` fields embedded in `--layout` JSON are **stripped on load**. Binary attachment payloads must come from `--attachment <path>` so the CLI can apply path validation.
- **Env-var precedence for secrets** — `PDFNATIVE_SIGN_KEY` / `PDFNATIVE_SIGN_CERT` / `PDFNATIVE_SIGN_CHAIN` / `PDFNATIVE_ENCRYPT_OWNER_PASS` / `PDFNATIVE_ENCRYPT_USER_PASS` are preferred over file-path flags so secrets never enter shell history.
- **Stdin/stdout safe** — binary streams are passed through without interpretation; no shell-quoting issues.
- **Zip-bomb cap** *(v1.4.0)* — the global `--max-inflate-size` bounds the decompressed size of every PDF stream (default 100 MiB).
- **NPM provenance** — every published version is signed via GitHub Actions OIDC. Verify with `npm audit signatures`.

The CLI opens **no network connection unless you explicitly opt in** — the only network paths are `verify --revocation online`, `sign --timestamp <url>`, `ltv --online`, `doc-timestamp --url <url>`, and `batch --allow-network`, and all of them go through the same SSRF guard: http/https only, private / loopback / metadata addresses blocked, DNS pinning, 10 s timeout, 5 MiB response cap, no redirects. Response bodies are never echoed into CLI output. It never writes to system directories outside the working directory or loads arbitrary code.

---

## Comparison with the library API

The CLI now covers nearly the full library surface; only Web Worker offloading remains library-only.

| Feature | CLI v1.4.0 | Library |
|---|---|---|
| Document rendering (13 block types) | ✅ | ✅ |
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
| **22 scripts + COLRv1 emoji + math** | ✅ `--font` / `--lang` | ✅ `registerFont()` / `loadFontData()` |
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

The [`samples/`](https://github.com/Nizoka/pdfnative-cli/tree/main/samples) directory in the CLI repository ships **40+ ready-to-run examples** organized by feature:

| Category | What it shows |
|---|---|
| `render/document/` | Minimal document, all blocks reference, invoice, technical spec, multi-page report |
| `render/table/` | Project status, financial summary |
| `render/table-variant/` | `PdfParams`-shaped financial ledger via `--variant table` |
| `render/barcode/` | QR code, Code 128, EAN-13 |
| `render/form/` | Contact form, survey |
| `render/toc/` | Auto-generated table of contents with `/GoTo` links |
| `render/link/` | Resource directory with hyperlinks |
| `render/watermark/` | Draft / Confidential watermarks |
| `render/layout/` | US Letter, A5 portrait, A4 landscape |
| `render/pdfa/` | PDF/A-1b, 2b, 3b archival conformance |
| `render/encryption/` | AES-128 password-protected PDF |
| `render/headers-footers/` | Page templates with `{page}/{pages}/{date}/{title}` |
| `render/attachments/` | PDF/A-3 hybrid invoice with embedded XML (Factur-X / ZUGFeRD) |
| `render/multilang/` | Multilang rendering via the bundled `--font` shortcuts |
| `render/chart/` | Native vector charts (bar, line, pie, donut) *(v1.3.0)* |
| `render/math/` | Noto Sans Math font routing *(v1.2.0)* |
| `render/outline/` | `/Outlines` bookmark trees (`--outline auto` and explicit JSON) *(v1.2.0)* |
| `render/table-smart/` | Smart-table flags (`--table-wrap`, `--zebra`, …) *(v1.3.0)* |
| `render/font/`, `render/template/`, `render/watch/`, `render/inspect-layout/` | Font shortcuts, templates, watch mode, layout introspection |
| `fill/` | AcroForm fill / flatten / export round trip *(v1.3.0)* |
| `encrypt/` | Encrypt / decrypt an existing PDF *(v1.3.0)* |
| `extract-text/` | Reading-order text extraction (`text` / `json` / `ndjson`) *(v1.3.0)* |
| `merge/`, `split/`, `extract/`, `annotate/` | Page-tree editing and markup annotations *(v1.2.0)* |
| `sign/` | Bash + PowerShell signing scripts (basic + with metadata) |
| `inspect/` | JSON & text inspection, `--verbose --pages`, `--check pdfa` |
| `verify/` | Self-signed verification, strict-mode CI gating |
| `batch/`, `doctor/`, `govern/`, `completion/`, `agent/`, `config/` | Automation, preflight, governance, shell completion, agent patterns |
| `streaming/` | 200-section document via streaming render |

Render them all at once:

```bash
git clone https://github.com/Nizoka/pdfnative-cli
cd pdfnative-cli
node samples/run-all.js
```

---

## Release history

### What's new in v1.4.0

v1.4.0 is built on **pdfnative 1.7.0** (pin `^1.7.0`) and completes the signature story: the full **PAdES ladder** (B-B → B-T → B-LT → B-LTA) is now writable from the command line, alongside signature-safe metadata edits, a CI-grade document diff, and a declarative batch pipeline. **No contract change** — every flag, default, exit code, error code and envelope from 1.x behaves identically on Node ≥ 22.

| Area | v1.3.0 | v1.4.0 |
|---|---|---|
| Commands | 17 commands <!-- verify-docs:allow stale-token (v1.3.0-era count) --> | adds **`metadata`** (incremental `/Info` + XMP edits that keep signatures valid), **`ltv`** (PAdES B-LT — `collect` / `embed` / `add`, air-gap-friendly), **`doc-timestamp`** (PAdES B-LTA `/DocTimeStamp` revisions), and **`compare`** (text + structure diff with CI exit codes) |
| Signing | `--timestamp` reserved (`E_UNSUPPORTED`) | **`sign --timestamp <tsa-url>` works** (RFC 3161, PAdES B-T) with `--timestamp-digest` / `--timestamp-nonce`; plus `--digest sha384\|sha512` (RSA), `--profile pades`, `--allow-multiple`, `--field-name`, visible signatures (`--signature-rect` / `--signature-page`), `--placeholder-bytes` |
| Verification | RSA/ECDSA-SHA256 | adds **rsa-sha384 / rsa-sha512** and validates `/DocTimeStamp` revisions; per-signature `fieldName` and `isDocTimestamp` (additive) |
| Inspection | metadata, forms, encryption | adds `--signatures` (structural inventory), `--check "signatures>=N"`, print boxes (`cropBox` / `trimBox` / `bleedBox` / `artBox`, `userUnit`), `trapped`; **`--check signed` no longer counts unsigned placeholders** (correctness fix) |
| `render` | charts v1 (5 types) | **`--strict`** PDF/A gate, image blocks from JSON, print production (`layout.print`, output intent, viewer preferences, `/Trapped`), **charts v2** (9 types, dual axes, log/time scales, data labels), `--chunk-size` |
| Automation | per-directory `batch` | **`batch --manifest`** — declarative pipeline with `@id` references, a 14-command whitelist, `--allow-network` opt-in and `--continue-on-error` |
| Hardening | — | global **`--max-inflate-size`** (anti zip-bomb, default 100 MiB); all network paths opt-in behind the SSRF guard |
| Agent contract | 11 codes, 15 subjects | **`E_NETWORK`**; `schema` grows to 19 subjects (`metadata`, `ltv-data`, `compare`, `batch-manifest`); 600 tests on Node 22/24 |
| Compatibility | `pdfnative ^1.6.0`, Node ≥ 20 | `pdfnative ^1.7.0`, **Node ≥ 22** |

Full changelog: [pdfnative-cli release notes v1.4.0](https://github.com/Nizoka/pdfnative-cli/releases/tag/v1.4.0).

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
| Fonts | `--font {latin,emoji}` | **22 Unicode scripts + COLRv1 colour emoji** — `--font`/`--lang` allow-list covers every bundled font (`latin`, `emoji`, `color-emoji`, and the 22 script codes incl. Telugu `te`, Sinhala `si`, Tibetan `bo`, Khmer `km`, Myanmar `my`, Amharic `am`) |
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
A TSA / OCSP / CRL fetch (`sign --timestamp`, `ltv --online`, `doc-timestamp`, `verify --revocation online`) failed at the transport level. The SSRF guard allows http/https only, blocks private / loopback / metadata addresses, follows no redirects, and enforces a 10 s timeout and a 5 MiB response cap — check the URL is public and reachable, or raise `--timeout` where the command exposes it (`ltv`, `doc-timestamp`). A *malformed* TSA response is `E_PARSE` instead. There is never a silent fallback: either the token is embedded and verified, or the command fails.

### `E_PARSE` on a PDF that other tools open
If the message mentions an inflate cap, one of the PDF's compressed streams expands past the anti-zip-bomb ceiling (default 100 MiB). For a trusted file, raise it with the global `--max-inflate-size <bytes>` *(v1.4.0)*.

### `ENOENT: no such file or directory, 'D\'`  (Windows)
This was a v0.1.0 / pre-v0.2.0 regression: `--attachment D:\file.xml` was split at the drive-letter colon. Fixed in v0.2.0 — make sure you're on `pdfnative-cli@^0.2.0`.

### Layout file is ignored when I also pass CLI flags
That is the **intended precedence**: `CLI flags > --layout file > pdfnative defaults`. To merge nested objects (e.g. a watermark in the layout file plus a `--watermark-text` on the CLI), the CLI now correctly merges `params.layout` with CLI-derived flags as of v0.2.0 (previously the JSON-embedded layout could be silently dropped — fixed).

### `--lang th` does not produce Thai glyphs
`--lang` only *activates* fonts that are registered in the CLI process — pass `--font th` as well so the bundled Noto Thai module is registered (`--font` covers all 22 bundled scripts, `latin`, `emoji`, `color-emoji`, `math`). A wrapper script that registers fonts and then spawns the CLI does **not** work: in-memory registration does not cross a process boundary. For a non-bundled font you ship yourself, call the library directly — see *Recipes → Multilang fonts*.

### Signed PDF fails Adobe verification
Ensure your certificate's signing-key usage extension includes `digitalSignature` (key usage 0). Self-signed certificates work for testing but require the validator to trust the issuer — pass `--trust ca-root.pem` to `verify` for self-signed setups.

---

## Resources

- 📦 **npm:** [pdfnative-cli](https://www.npmjs.com/package/pdfnative-cli)
- 🏛️ **Repo:** [Nizoka/pdfnative-cli](https://github.com/Nizoka/pdfnative-cli)
- 📚 **Knowledge base:** [pdfnative-cli/docs/KNOWLEDGE_BASE.md](https://github.com/Nizoka/pdfnative-cli/blob/main/docs/KNOWLEDGE_BASE.md) — full architecture, integration patterns, FAQ
- 📁 **Samples:** [pdfnative-cli/samples](https://github.com/Nizoka/pdfnative-cli/tree/main/samples)
- 🧪 **Try it interactively:** [CLI playground](../playgrounds/cli.html) — build commands without leaving the browser
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
