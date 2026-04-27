# pdfnative-cli — Command-Line Interface Guide

[`pdfnative-cli`](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface** for the [`pdfnative`](https://github.com/Nizoka/pdfnative) library. It exposes three commands — `render`, `sign`, `inspect` — that together cover the full document lifecycle from JSON to a signed, validated PDF.

> **Why a CLI?** Many real-world workflows live outside Node.js: shell scripts, CI pipelines, Docker containers, Makefiles, batch jobs, build tools written in other languages. The CLI lets all of them call `pdfnative` without writing JavaScript, and is fully composable through stdin/stdout pipelines.

The CLI is a **pure dispatch layer** over `pdfnative`. No PDF logic lives in the CLI itself — every command forwards to a public `pdfnative` API:

| CLI command | `pdfnative` API |
|---|---|
| `render` | `buildDocumentPDFBytes()` / `streamDocumentPdf()` |
| `sign` | `signPdfBytes()` |
| `inspect` | `PdfReader.open()` / `getMetadata()` / `getPageCount()` |

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

**Requirements:** Node.js ≥ 20 · Bun · Deno (`node dist/cli.cjs`).

The CLI ships with **NPM provenance** — verify the published artifact with `npm audit signatures` or on [npmjs.com](https://www.npmjs.com/package/pdfnative-cli).

---

## When to use the CLI vs the library

| Use the **CLI** when… | Use the **library** when… |
|---|---|
| You write shell scripts, Makefiles, or Bash/PowerShell pipelines | You need full control over the API surface |
| Your CI/CD job runs in Docker or GitHub Actions | You build a Node.js / Bun / Deno service |
| You want to compose with `cat`, `jq`, `tee`, `gzip`, etc. | You need encryption, watermarks, custom page sizes, custom headers/footers (not yet exposed via the JSON CLI) |
| You sign or inspect PDFs ad-hoc from the terminal | You need fine-grained streaming control or Web Worker offloading |
| You want a one-liner instead of a 30-line Node.js script | Browser, Web Worker, or Deno Deploy targets |

The two are **complementary**. A typical full-stack project uses the library at runtime and the CLI in CI scripts.

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

### 2. Sign the rendered PDF

```bash
# Set keys via environment variables (recommended for CI/CD — never logged)
export PDFNATIVE_SIGN_KEY="$(cat private.pem)"
export PDFNATIVE_SIGN_CERT="$(cat cert.pem)"

pdfnative sign --input report.pdf --output report.signed.pdf
```

The CLI accepts both **RSA PKCS#1 v1.5** and **ECDSA P-256** keys, both with SHA-256 digests. The signed PDF carries a CMS/PKCS#7 signature embedded as ISO 32000-1 §12.8 prescribes, validatable by Adobe Acrobat, MuPDF, and any other PAdES-compatible reader.

### 3. Inspect any PDF

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
Created:            2026-04-27T12:00:00+00:00
```

JSON output (default) is suited for piping into `jq` or storing as a CI artifact.

---

## Command reference

### `pdfnative render`

Renders a JSON document into a PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Path to a JSON file containing [`DocumentParams`](https://pdfnative.dev/#api) |
| `--output <file>` | stdout | Output PDF path |
| `--stream` | off | Use streaming output (`AsyncGenerator<Uint8Array>`) — recommended for >100-page documents |
| `--conformance <level>` | none | PDF/A conformance: `1b`, `2b`, `3b` |

The JSON document accepts every public block type: `heading`, `paragraph`, `list`, `table`, `image`, `link`, `spacer`, `pageBreak`, `toc`, `barcode`, `svg`, `formField`. See the [Quick Start guide](quickstart.html) for full block schemas.

### `pdfnative sign`

Applies a CMS/PKCS#7 digital signature to an existing PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | — *(required)* | Input PDF |
| `--output <file>` | stdout | Output signed PDF |
| `--key <file>` | `PDFNATIVE_SIGN_KEY` env | PEM-encoded private key (env var takes precedence) |
| `--cert <file>` | `PDFNATIVE_SIGN_CERT` env | PEM-encoded X.509 certificate (env var takes precedence) |

Signing keys are **never logged** — not in error output, not in debug traces, not in stack traces. The CLI redacts them at every code path that surfaces error context.

### `pdfnative inspect`

Inspects metadata and conformance of an existing PDF.

| Flag | Default | Description |
|------|---------|-------------|
| `--input <file>` | stdin | Input PDF |
| `--format <fmt>` | `json` | Output format: `json` or `text` |

Inspection is **read-only** — the CLI never modifies the input PDF. The implementation uses `pdfnative`'s incremental parser (`src/parser/`), which means encrypted PDFs are reported but their content is not decrypted.

---

## Composability — pipelines & batches

The CLI is designed to compose. Every command reads from stdin and writes to stdout when no `--input`/`--output` is given. This allows expressive shell pipelines:

### Render → sign → inspect, in a single chain

```bash
cat report.json \
  | pdfnative render \
  | pdfnative sign \
  | pdfnative inspect --format text
```

### Render to gzipped output

```bash
pdfnative render --input doc.json | gzip > report.pdf.gz
```

### Batch-render a directory of JSON files

```bash
for f in inputs/*.json; do
  pdfnative render --input "$f" --output "outputs/$(basename "$f" .json).pdf"
done
```

### CI pipeline (GitHub Actions)

```yaml
- name: Render reports
  run: |
    pdfnative render --input data/q1.json --output dist/q1.pdf --conformance 2b
    pdfnative inspect --input dist/q1.pdf --format json > dist/q1.metadata.json

- name: Verify PDF/A
  run: |
    test "$(jq -r .pdfaConformance dist/q1.metadata.json)" = "2b"
```

---

## Security model

`pdfnative-cli` is built with the same zero-trust posture as the underlying library:

- **No `eval`, no `Function`, no dynamic code** — input JSON is parsed via the standard `JSON.parse` with a 50 MB cap to prevent memory exhaustion.
- **Path traversal protection** — all `--input` / `--output` / `--key` / `--cert` paths are validated against `..` segments before any file system access.
- **Secrets never logged** — error messages and stack traces are redacted to remove key/cert contents at the boundary.
- **Stdin/stdout safe** — binary streams are passed through without interpretation; no shell-quoting issues.
- **NPM provenance** — every published version is signed via GitHub Actions OIDC. Verify with `npm audit signatures pdfnative-cli`.

The CLI **does not** open network connections, write to system directories outside the working directory, or load arbitrary code. It only reads the files you point it at.

---

## Comparison with the library API

The CLI is a **strict subset** of the library's surface. Some advanced features remain library-only:

| Feature | CLI | Library |
|---|---|---|
| Document rendering (12 block types) | ✅ | ✅ |
| Streaming output | ✅ `--stream` | ✅ `streamDocumentPdf()` |
| PDF/A conformance (1b, 2b, 3b) | ✅ `--conformance` | ✅ `tagged: '…'` |
| Digital signatures (RSA, ECDSA) | ✅ | ✅ `signPdfBytes()` |
| Inspection / metadata | ✅ | ✅ `PdfReader` |
| **Encryption (AES-128/256)** | ⚠️ library only | ✅ `encryption: {…}` |
| **Watermarks** | ⚠️ library only | ✅ `watermark: {…}` |
| **Custom page sizes** | ⚠️ library only | ✅ `pageSize: {…}` |
| **Custom headers/footers** (templates) | ⚠️ library only | ✅ `headerTemplate` / `footerTemplate` |
| **Web Worker offloading** | ❌ N/A | ✅ `pdfWorker.ts` |

Any feature with ⚠️ can be added to the CLI when there is concrete demand — open an issue at [Nizoka/pdfnative-cli/issues](https://github.com/Nizoka/pdfnative-cli/issues).

---

## Examples — ready-to-run

The [`samples/`](https://github.com/Nizoka/pdfnative-cli/tree/main/samples) directory in the CLI repository ships **22 ready-to-run examples** organized by feature:

| Category | Files | What it shows |
|---|---|---|
| `render/document/` | 5 | Minimal document, all blocks reference, invoice, technical spec, multi-page report |
| `render/table/` | 2 | Project status, financial summary |
| `render/barcode/` | 3 | QR code, Code 128 shipping label, EAN-13 product |
| `render/form/` | 2 | Contact form, survey |
| `render/toc/` | 1 | Auto-generated table of contents with `/GoTo` links |
| `render/link/` | 1 | Resource directory with hyperlinks |
| `render/watermark/` | 2 | Draft / Confidential watermarks |
| `render/layout/` | 3 | US Letter, A5 portrait, A4 landscape |
| `render/pdfa/` | 3 | PDF/A-1b, 2b, 3b archival conformance |
| `sign/` | 2 | Bash + PowerShell signing scripts |
| `inspect/` | 4 | JSON & text inspection (Bash + PowerShell) |
| `streaming/` | 1 | 200-section document via streaming render |

Render them all at once:

```bash
git clone https://github.com/Nizoka/pdfnative-cli
cd pdfnative-cli
node samples/run-all.js
```

---

## Troubleshooting

### `command not found: pdfnative`
You installed via `npx` (one-shot) and not globally. Either prepend `npx` to every invocation, or run `npm install --global pdfnative-cli`.

### `JSON parse error: input too large`
The CLI caps input JSON at 50 MB to prevent memory exhaustion. For very large documents, either split the document into multiple PDFs (then concat with `pdfnative-merge` — coming in v0.2) or use the library directly with the streaming API.

### `Error: invalid private key`
Both RSA PKCS#1 and ECDSA P-256 keys are accepted, but they must be **PEM-encoded**. Convert DER to PEM with `openssl pkcs8 -topk8 -in key.der -out key.pem -nocrypt`.

### `Error: PDF/A conformance level 'X' is not supported`
The CLI accepts `1b`, `2b`, `3b`. PDF/A-2u is library-only as of pdfnative 1.0.5 — open an issue at [Nizoka/pdfnative-cli](https://github.com/Nizoka/pdfnative-cli/issues) if you need it.

### Signed PDF fails Adobe verification
Ensure your certificate's signing-key usage extension includes `digitalSignature` (key usage 0). Self-signed certificates work for testing but require the validator to trust the issuer.

---

## Resources

- 📦 **npm:** [pdfnative-cli](https://www.npmjs.com/package/pdfnative-cli)
- 🏛️ **Repo:** [Nizoka/pdfnative-cli](https://github.com/Nizoka/pdfnative-cli)
- 📚 **Knowledge base:** [pdfnative-cli/docs/KNOWLEDGE_BASE.md](https://github.com/Nizoka/pdfnative-cli/blob/main/docs/KNOWLEDGE_BASE.md) — full architecture, integration patterns, FAQ
- 📁 **Samples:** [pdfnative-cli/samples](https://github.com/Nizoka/pdfnative-cli/tree/main/samples)
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
