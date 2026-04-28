# pdfnative-cli — Command-Line Interface Guide

> **Tracks pdfnative-cli v0.2.0** (April 2026). Compatible with `pdfnative` ≥ 1.0.5. The CLI versions independently from the library — see the [release notes](https://github.com/Nizoka/pdfnative-cli/blob/main/release-notes/v0.2.0.md).

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface** for the [`pdfnative`](https://github.com/Nizoka/pdfnative) library. It exposes four commands — `render`, `sign`, `inspect`, and `verify` — that together cover the full document lifecycle from JSON to a signed, verified, archive-grade PDF.

> **Why a CLI?** Many real-world workflows live outside Node.js: shell scripts, CI pipelines, Docker containers, Makefiles, batch jobs, build tools written in other languages. The CLI lets all of them call `pdfnative` without writing JavaScript, and is fully composable through stdin/stdout pipelines.

The CLI is a **pure dispatch layer** over `pdfnative`. No PDF logic lives in the CLI itself — every command forwards to a public `pdfnative` API:

| CLI command | `pdfnative` API |
|---|---|
| `render` | `buildDocumentPDFBytes()` / `streamDocumentPdf()` / `buildPDFBytes()` (table variant) |
| `sign` | `signPdfBytes()` |
| `inspect` | `PdfReader.open()` / `getMetadata()` / `getPageCount()` |
| `verify` | `PdfReader` + `verifyCertSignature()` (byte-range + chain) |

This means **every feature of the library is one release away from the CLI**, and any bug fix in `pdfnative` is automatically picked up by `pdfnative-cli` on its next dependency bump.

---

## What's new in v0.2.0

The v0.2.0 release expands the CLI from ~10 flags to a near-complete projection of the `pdfnative` v1.0.5 surface, while remaining **100 % backward-compatible** with v0.1.0.

| Area | v0.1.0 | v0.2.0 |
|---|---|---|
| Layout | `--conformance` only | Hybrid model — high-frequency knobs as flags, full `PdfLayoutOptions` via `--layout file.json` |
| PDF/A | `--conformance 1b\|2b\|3b` | `--tagged none\|pdfa1b\|pdfa2b\|pdfa2u\|pdfa3b` (`--conformance` deprecated) |
| Encryption | — | `--encrypt-owner-pass`, `--encrypt-user-pass`, `--encrypt-algorithm`, `--encrypt-permissions` (env-var precedence) |
| Watermarks | — | `--watermark-text`/`-image`/`-opacity`/`-angle`/`-color`/`-font-size`/`-position` |
| Headers / footers | — | `--header-{l,c,r}`, `--footer-{l,c,r}` with `{page}/{pages}/{date}/{title}` placeholders |
| PDF/A-3 attachments | — | `--attachment <path>[:mime[:rel[:desc]]]` (repeatable) |
| Multilingual fonts | — | `--lang th,ja,ar` (requires `registerFontLoader()` wrapper) |
| Renderer variant | document only | `--variant document\|table` |
| Page geometry | — | `--page-size`, `--margin` |
| Compression | — | `--compress` |
| `sign` metadata | — | `--reason`, `--name`, `--location`, `--contact`, `--signing-time` |
| `sign` cert chains | — | `--cert-chain <pem>` (repeatable) + `PDFNATIVE_SIGN_CHAIN` env |
| `sign` algorithm | RSA implicit | `--algorithm rsa-sha256\|ecdsa-sha256` (ECDSA stub pending pdfnative `parseEcPrivateKey`, v0.3.0) |
| `inspect` depth | basic report | `--verbose`, `--pages`, `--check pdfa\|signed\|encrypted` (composable, ANDed, exit codes) |
| `verify` command | n/a | **NEW** — byte-range integrity + cert chain + `--trust` roots |
| Tests | 47 | 123 |

Full changelog: [pdfnative-cli release notes v0.2.0](https://github.com/Nizoka/pdfnative-cli/blob/main/release-notes/v0.2.0.md).

---

## Installation

```bash
# Run directly with npx — no global install required
npx pdfnative-cli render --input document.json --output report.pdf

# Or install globally
npm install --global pdfnative-cli
pdfnative render --input document.json --output report.pdf
```

**Requirements:** Node.js ≥ 20 · Bun · Deno (`node dist/cli.cjs`).

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

### 3. Verify embedded signatures _(new in v0.2.0)_

```bash
pdfnative verify --input report.signed.pdf --strict --trust ca-root.pem
```

`verify` checks byte-range integrity (SHA-256 recomputed against the CMS `messageDigest` attribute), validates the certificate chain via `pdfnative`'s `verifyCertSignature`, and evaluates trust against `--trust` roots and self-signed acceptance. Exit code is 0 on success, 1 on any failure under `--strict`.

### 4. Inspect any PDF

```bash
pdfnative inspect --input report.signed.pdf --format text
```

```
PDF version:        1.7
Pages:              2
Encrypted:          no
PDF/A conformance:  none
Signatures:         1
Title:              April 2026 Report
Author:             Finance Team
Created:            2026-04-28T10:00:00+00:00
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
| `--stream` | off | Streaming output via `streamDocumentPdf` (`AsyncGenerator<Uint8Array>`) — recommended for >100-page documents |
| `--layout <file.json>` | — | Load any subset of `PdfLayoutOptions` |

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

> Watermarks with transparency are **mutually exclusive** with PDF/A-1b (ISO 19005-1 §6.4). The CLI rejects this combination with exit 2.

#### Headers / footers

| Flag | Description |
|------|-------------|
| `--header-left <str>` / `--header-center` / `--header-right` | Page-template zones |
| `--footer-left <str>` / `--footer-center` / `--footer-right` | Page-template zones |

Supported placeholders: `{page}`, `{pages}`, `{date}`, `{title}`. The `{pages}` placeholder is rejected with `--stream` because the total page count is only known after multi-pass pagination.

#### Encryption

| Flag | Env var | Description |
|------|---------|-------------|
| `--encrypt-owner-pass <pass>` | `PDFNATIVE_ENCRYPT_OWNER_PASS` | **Required** if any `--encrypt-*` flag is set |
| `--encrypt-user-pass <pass>` | `PDFNATIVE_ENCRYPT_USER_PASS` | Optional |
| `--encrypt-algorithm <algo>` | — | `aes128` (default) or `aes256` |
| `--encrypt-permissions <list>` | — | Comma list: `print`, `copy`, `modify`, `extractText` |

Env vars take precedence over flags, ensuring secrets never appear in shell history. Encryption is **mutually exclusive** with `--tagged pdfa*` per ISO 19005-1 §6.3.2 — rejected with exit 2.

#### PDF/A-3 attachments

| Flag | Description |
|------|-------------|
| `--attachment <path>[:mime[:rel[:desc]]]` | Embed a file as `/EmbeddedFile`. Repeatable |

The Windows drive-letter colon (`D:\path`) is detected and not split — see *Troubleshooting*.

#### Multilingual fonts

| Flag | Description |
|------|-------------|
| `--lang <code,code>` | Activate font loaders for the listed languages (e.g. `th,ja,ar`) |

`--lang` activates a *programmatically registered* font loader via `loadFontData(code)`. Latin scripts are built-in; non-Latin scripts require the caller to invoke `registerFontLoader(lang, loader)` in a wrapper script before invoking the CLI. See *Recipes → Multilang via wrapper*.

### `pdfnative sign`

Applies a CMS/PKCS#7 digital signature to an existing PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | — *(required)* | Input PDF |
| `--output <file>` | stdout | Output signed PDF |
| `--key <file>` | `PDFNATIVE_SIGN_KEY` env | PEM-encoded private key (env var takes precedence) |
| `--cert <file>` | `PDFNATIVE_SIGN_CERT` env | PEM-encoded X.509 certificate (env var takes precedence) |
| `--cert-chain <file>` | `PDFNATIVE_SIGN_CHAIN` env | Intermediate-CA PEM (repeatable, concatenated into `certChain[]`) |
| `--algorithm <algo>` | `rsa-sha256` | `rsa-sha256` or `ecdsa-sha256` (ECDSA returns a clear stub error in v0.2.0; full support tracked for v0.3.0) |
| `--reason <str>` | — | `PdfSignOptions.reason` |
| `--name <str>` | — | `PdfSignOptions.name` |
| `--location <str>` | — | `PdfSignOptions.location` |
| `--contact <str>` | — | `PdfSignOptions.contact` |
| `--signing-time <ISO 8601>` | now | Explicit timestamp; validated up-front before any credential I/O |

Signing keys are **never logged** — not in error output, not in debug traces, not in stack traces. The CLI redacts them at every code path that surfaces error context.

### `pdfnative inspect`

Inspects metadata and conformance of an existing PDF. Read-only — never modifies the input.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | `json` or `text` |
| `--verbose` | off | Adds `verbose.{trailerKeys, catalogKeys, objectCount, xmpMetadata}`. Sanitised — no raw stream bytes |
| `--pages` | off | Adds `pages: [{ index, width, height, rotation, annotations, formFields }]` |
| `--check <assertion>` | — | Repeatable; ANDed. Values: `pdfa`, `signed`, `encrypted`. Sets exit 0 = pass, 1 = fail |

Composable example:

```bash
pdfnative inspect --input dist/q1.pdf \
  --check pdfa --check signed \
  --format json > dist/q1.report.json
echo "exit code: $?"   # 0 if both assertions hold
```

### `pdfnative verify` _(new in v0.2.0)_

Verifies CMS/PKCS#7 signatures embedded in a PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | `json` or `text` |
| `--strict` | off | Exit 1 on any failure or zero signatures |
| `--trust <pem>` | — | Trust-anchor certificate (repeatable) |

**Scope (v0.2.0):**

- ✅ Byte-range integrity (SHA-256 recomputed and compared with CMS `messageDigest` attribute)
- ✅ Certificate chain verification via `pdfnative`'s `verifyCertSignature`
- ✅ Trust evaluation against `--trust` roots, with self-signed acceptance for testing

**Out of scope (deferred):**

- ⚠️ Full CMS signature-value verification — v0.3.0
- ⚠️ OCSP / CRL revocation checks — v0.3.0+
- ⚠️ RFC 3161 timestamp tokens — v0.3.0+
- ⚠️ Long-Term Validation (LTV) — v0.3.0+

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

### Multilang via a wrapper script

`pdfnative-cli` does not bundle non-Latin fonts. Register a font loader in a wrapper before delegating to the CLI:

```javascript
// wrapper.mjs
import { registerFontLoader } from 'pdfnative';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

registerFontLoader('th', async () => JSON.parse(await readFile('./fonts/noto-thai-data.js', 'utf8')));
registerFontLoader('ja', async () => JSON.parse(await readFile('./fonts/noto-jp-data.js', 'utf8')));

spawnSync('npx', ['pdfnative-cli', ...process.argv.slice(2)], { stdio: 'inherit' });
```

```bash
node wrapper.mjs render --input multilang.json --output out.pdf --lang th,ja
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
- **NPM provenance** — every published version is signed via GitHub Actions OIDC. Verify with `npm audit signatures pdfnative-cli`.

The CLI **does not** open network connections, write to system directories outside the working directory, or load arbitrary code. It only reads the files you point it at.

---

## Comparison with the library API

The CLI now covers nearly the full library surface; only Web Worker offloading remains library-only.

| Feature | CLI v0.2.0 | Library |
|---|---|---|
| Document rendering (12 block types) | ✅ | ✅ |
| Streaming output | ✅ `--stream` | ✅ `streamDocumentPdf()` |
| PDF/A conformance (1b, 2b, 2u, 3b) | ✅ `--tagged` | ✅ `tagged: '…'` |
| Digital signatures (RSA) | ✅ | ✅ `signPdfBytes()` |
| Digital signatures (ECDSA) | ⚠️ stub error in v0.2.0; v0.3.0 | ✅ `signPdfBytes()` |
| Inspection / metadata | ✅ | ✅ `PdfReader` |
| **Signature verification** | ✅ `verify` (v0.2.0) | ✅ `verifyCertSignature` |
| **Encryption (AES-128/256)** | ✅ `--encrypt-*` | ✅ `encryption: {…}` |
| **Watermarks** | ✅ `--watermark-*` | ✅ `watermark: {…}` |
| **Custom page sizes** | ✅ `--page-size` | ✅ `pageSize: {…}` |
| **Custom headers/footers** | ✅ `--header-*` / `--footer-*` | ✅ `headerTemplate` / `footerTemplate` |
| **PDF/A-3 attachments** | ✅ `--attachment` | ✅ `attachments: [...]` |
| **Multilang fonts** | ✅ `--lang` (wrapper for non-Latin) | ✅ `registerFontLoader()` |
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
| `render/multilang/` | Latin-only registration guide; multilang scripts via wrapper |
| `sign/` | Bash + PowerShell signing scripts (basic + with metadata) |
| `inspect/` | JSON & text inspection, `--verbose --pages`, `--check pdfa` |
| `verify/` | Self-signed verification, strict-mode CI gating |
| `streaming/` | 200-section document via streaming render |

Render them all at once:

```bash
git clone https://github.com/Nizoka/pdfnative-cli
cd pdfnative-cli
node samples/run-all.js
```

---

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
Both RSA PKCS#1 and ECDSA P-256 keys are accepted, but they must be **PEM-encoded**. Convert DER to PEM with `openssl pkcs8 -topk8 -in key.der -out key.pem -nocrypt`. ECDSA support in `sign` returns a clear stub error in v0.2.0 — full support tracked for v0.3.0 once `pdfnative` exposes `parseEcPrivateKey`.

### `Error: --encrypt-* flag set without --encrypt-owner-pass`
Encryption requires an owner password. Provide it via `--encrypt-owner-pass <pass>` or — recommended — the `PDFNATIVE_ENCRYPT_OWNER_PASS` env var so it never enters shell history.

### `Error: --tagged pdfa* and --encrypt-* are mutually exclusive`
ISO 19005-1 §6.3.2 forbids encryption in PDF/A. Pick one — either an archival PDF/A document, or an encrypted distribution copy, but not both.

### `ENOENT: no such file or directory, 'D\'`  (Windows)
This was a v0.1.0 / pre-v0.2.0 regression: `--attachment D:\file.xml` was split at the drive-letter colon. Fixed in v0.2.0 — make sure you're on `pdfnative-cli@^0.2.0`.

### Layout file is ignored when I also pass CLI flags
That is the **intended precedence**: `CLI flags > --layout file > pdfnative defaults`. To merge nested objects (e.g. a watermark in the layout file plus a `--watermark-text` on the CLI), the CLI now correctly merges `params.layout` with CLI-derived flags as of v0.2.0 (previously the JSON-embedded layout could be silently dropped — fixed).

### `--lang th` does not produce Thai glyphs
`--lang` activates a *registered* font loader. The CLI process has an empty in-memory registry by default. Use a wrapper script that calls `registerFontLoader('th', loader)` before delegating to the CLI — see *Recipes → Multilang via a wrapper*.

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
