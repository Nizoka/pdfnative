# pdfnative-mcp — AI Client Integration Guide

> **Tracks pdfnative-mcp v0.3.0** (April 2026). Compatible with `pdfnative` ≥ 1.1.0. Full release notes: [v0.3.0](https://github.com/Nizoka/pdfnative-mcp/releases/tag/v0.3.0).

[pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) is an **MCP server** that exposes the full pdfnative library to any AI client supporting the [Model Context Protocol](https://modelcontextprotocol.io) — Claude Desktop, Cursor, Continue, Zed, ChatGPT, and more.

> **What is MCP?** The Model Context Protocol is an open standard (originally developed by Anthropic) that lets AI assistants call external tools in a structured, safe way. An MCP server declares a set of tools with typed inputs and outputs; the AI client invokes those tools on your behalf during a conversation.

With `pdfnative-mcp` installed, you can say to your AI assistant:

> _"Generate a Q1 2026 financial report as PDF/A-2b with a QR code pointing to our dashboard, then inspect the result to confirm it's archive-grade."_

…and the AI will call the right combination of `generate_basic_pdf`, `add_barcode`, `add_table`, and `inspect_pdf` tools, returning a ready-to-download PDF.

---

## What's new in v0.3.0

100 % backward-compatible with v0.2.0 — every new field is optional, and omitting them produces byte-identical output.

- **9th tool: `inspect_pdf`** — read-only inspection over `openPdf()`. Reports version, page count, encryption, PDF/A claim, signature count, info dict; optional per-page sizes; optional CI-style `check: ('pdfa'|'signed'|'encrypted')[]` assertions.
- **`pdfA` flag on every document tool** — `generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `prepare_signature_placeholder`, `add_international_text`. Values: `pdfa1b`, `pdfa2b`, `pdfa2u`, `pdfa3b`. Maps to pdfnative's `tagged` layout option.
- **Multi-script `add_international_text`** — `lang` now accepts `string`, `string[]`, or comma-separated values, e.g. `["ar", "emoji"]` or `"ar,emoji"`.
- **Latin & Emoji font packs** — two new `lang` codes (`latin`, `emoji`) backed by Noto Sans VF and Noto Emoji from pdfnative v1.1. The `latin` font auto-registers when `pdfA` is set so curly quotes, em-dashes, and ellipses validate cleanly.
- **`add_table` autoFit + clipCells** — transparently switches to the document-block backend when set (pdfnative v1.1 `TableBlock` props).
- **MCP `outputSchema`** — every tool now publishes a JSON Schema for its response, enabling client-side static validation per the MCP 2025-06-18 spec.
- **Server bootstrap** — `initCrypto()` is awaited at startup so the first signing/inspection call no longer pays an init penalty.

Deferred to v0.4.0: `verify_pdf` (no high-level CMS verify primitive in pdfnative 1.1 yet), `sign_pdf` placeholder auto-injection, ECDSA DER private-key input, encrypted-PDF fixtures.

---

## Installation

```bash
# Run directly with npx — no global install required (recommended)
npx -y pdfnative-mcp

# Or install globally
npm install -g pdfnative-mcp
pdfnative-mcp
```

**Requirements:** Node.js ≥ 22.

---

## Configuration by client

### Claude Desktop

Edit the config file for your OS:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MPC_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

Restart Claude Desktop after saving. The `pdfnative` server will appear in the tools panel.

### Cursor

In your project `.cursor/mcp.json` (or global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MPC_OUTPUT_DIR": "/path/to/pdf-output"
      }
    }
  }
}
```

### Continue

In your `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "pdfnative",
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MPC_OUTPUT_DIR": "/path/to/pdf-output"
      }
    }
  ]
}
```

### Zed

In your Zed `settings.json`:

```json
{
  "context_servers": {
    "pdfnative": {
      "command": {
        "path": "npx",
        "args": ["-y", "pdfnative-mcp"],
        "env": {
          "PDFNATIVE_MPC_OUTPUT_DIR": "/path/to/pdf-output"
        }
      }
    }
  }
}
```

---

## Environment variables

| Variable | Purpose |
|---|---|
| `PDFNATIVE_MPC_OUTPUT_DIR` | Absolute path to the sandbox directory. **Required to enable `outputMode: "file"`**. When unset, only `base64` output is available. |
| `PDFNATIVE_MCP_PORT` | When set to a valid port (1–65535), starts an HTTP server on `http://127.0.0.1:<port>/mcp` instead of stdio. |

---

## Tool reference

`pdfnative-mcp` exposes **9 tools**:

| Tool | Purpose |
|---|---|
| `generate_basic_pdf` | Multi-page A4 documents from structured blocks (headings, paragraphs, lists, page breaks). Accepts optional `pdfA`. |
| `add_table` | Tabular PDF reports from column headers and data rows. Optional `autoFitColumns` and `clipCells` (pdfnative v1.1). Accepts `pdfA`. |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF. Accepts `pdfA`. |
| `add_international_text` | 16 non-Latin scripts plus `latin` and `emoji` font codes, with BiDi & OpenType shaping. `lang` accepts `string`, `string[]`, or comma-separated. |
| `add_form` | Interactive AcroForm PDFs with text fields, checkboxes, radio buttons, and dropdowns. Accepts `pdfA`. |
| `embed_image` | Embed a JPEG or PNG image (base64-encoded) into a titled PDF document. Accepts `pdfA`. |
| `prepare_signature_placeholder` | Create a PDF with a `/Sig` AcroForm placeholder ready to be signed. Accepts `pdfA`. |
| `sign_pdf` | PAdES-style CMS digital signatures (RSA-SHA256 / ECDSA-SHA256 P-256). |
| `inspect_pdf` *(new in v0.3.0)* | Read-only inspection. Returns `version`, `pageCount`, `encryption`, `pdfA`, `signatureCount`, `info`, optional `perPage`, optional `checks` + `checksPassed`. |

Every tool now publishes an `outputSchema` advertised in `tools/list` per the [MCP 2025-06-18 spec](https://modelcontextprotocol.io/specification/2025-06-18), enabling clients to statically validate responses.

---

### `generate_basic_pdf`

Produces a multi-page document from a list of content blocks.

```jsonc
{
  "title": "Q1 2026 Report",
  "blocks": [
    { "type": "heading",   "text": "Executive Summary", "level": 1 },
    { "type": "paragraph", "text": "Revenue grew 24 % year over year." },
    { "type": "list",      "style": "bullet", "items": ["Strong APAC", "Stable EU", "Soft NA"] },
    { "type": "pageBreak" },
    { "type": "heading",   "text": "Details", "level": 2 }
  ],
  "footerText": "Confidential — Internal use only",
  "outputMode": "base64"
}
```

**Block types supported:** `heading` (levels 1–3), `paragraph`, `list` (`bullet` / `numbered`), `pageBreak`.

---

### `add_table`

Generates a tabular report from column headers and rows.

```jsonc
{
  "title": "Monthly Sales",
  "headers": ["Region", "Units", "Revenue"],
  "rows": [
    ["APAC", "1 200", "$240,000"],
    ["EMEA", "800",   "$160,000"]
  ],
  "infoItems":      [{ "label": "Period", "value": "January 2026" }],
  "footerText":     "Internal use only",
  "autoFitColumns": true,
  "clipCells":      true,
  "pdfA":           "pdfa2b",
  "outputMode":     "base64"
}
```

`autoFitColumns` and `clipCells` (added in v0.3.0) transparently switch to the document-block backend so cell content fits its column or is clipped at the boundary, leveraging pdfnative v1.1's `TableBlock` props. Optional `pdfA` produces an archive-grade variant.

---

### `add_barcode`

```jsonc
{
  "format":     "qr",
  "data":       "https://pdfnative.dev",
  "caption":    "Scan to learn more",
  "ecLevel":    "H",
  "outputMode": "file",
  "outputPath": "tickets/event-42.pdf"
}
```

**Supported formats:** `qr`, `code128`, `ean13`, `datamatrix`, `pdf417`.  
**Error correction levels** (QR only): `L`, `M`, `Q`, `H`.

---

### `add_international_text`

```jsonc
{
  "title":      "مرحبا بالعالم 👋",
  "lang":       ["ar", "emoji"],
  "paragraphs": [
    "هذا اختبار للنص العربي مع تشكيل OpenType ومحارف ثنائية الاتجاه.",
    "Mixed content: العربية + English + emoji 🚀 ✓"
  ]
}
```

**Supported `lang` codes:** `ar` (Arabic), `he` (Hebrew), `th` (Thai), `ja` (Japanese), `zh` (Chinese Simplified), `ko` (Korean), `el` (Greek), `hi` (Devanagari/Hindi), `bn` (Bengali), `ta` (Tamil), `ru` (Cyrillic/Russian), `ka` (Georgian), `hy` (Armenian), `tr` (Turkish), `vi` (Vietnamese), `pl` (Polish), plus **`latin`** (Noto Sans VF) and **`emoji`** (Noto Emoji) added in v0.3.0.

`lang` accepts `string`, `string[]`, or a comma-separated value — e.g. `"ar,emoji"` or `["ar", "emoji"]`. When `pdfA` is set on this tool, the `latin` font is auto-registered so curly quotes, em-dashes, and ellipses validate cleanly under PDF/A.

---

### `add_form`

Creates an interactive AcroForm PDF.

```jsonc
{
  "title": "Employee Onboarding",
  "fields": [
    { "fieldType": "text",     "name": "fullName", "label": "Full Name",   "required": true },
    { "fieldType": "dropdown", "name": "dept",     "label": "Department",  "options": ["Engineering", "Sales", "HR"] },
    { "fieldType": "checkbox", "name": "agree",    "label": "I agree to the terms", "checked": false }
  ],
  "outputMode": "base64"
}
```

**Field types:** `text`, `multiline`, `checkbox`, `radio`, `dropdown`, `listbox`.

---

### `embed_image`

```jsonc
{
  "title":       "Product Photo",
  "imageBase64": "<base64-encoded JPEG bytes>",
  "mimeType":    "image/jpeg",
  "caption":     "Front view of Model X",
  "width":       400,
  "outputMode":  "base64"
}
```

> **Note:** Alpha-channel PNGs (color type 6) are not supported. Pre-process such images to remove the alpha channel before embedding.

---

### `prepare_signature_placeholder`

Creates a PDF pre-wired with an AcroForm `/Sig` field, ready to be signed by `sign_pdf`.

```jsonc
{
  "title":      "Service Agreement",
  "signerName": "Alice Dupont",
  "reason":     "Approved",
  "location":   "Paris, FR",
  "blocks": [
    { "type": "paragraph", "text": "By signing below, I accept the terms and conditions." }
  ],
  "outputMode": "base64"
}
```

---

### `sign_pdf`

Signs a PDF that already contains a `/Sig` placeholder (produced by `prepare_signature_placeholder`).

```jsonc
{
  "pdfBase64":           "<base64 PDF bytes>",
  "algorithm":           "rsa-sha256",
  "certDerBase64":       "<base64 X.509 certificate in DER format>",
  "rsaKeyPkcs1DerBase64":"<base64 PKCS#1 RSAPrivateKey in DER format>",
  "signerName":          "Alice",
  "reason":              "Approval",
  "location":            "Paris, FR",
  "signingTime":         "2026-01-15T10:30:00Z"
}
```

For ECDSA P-256: use `"algorithm": "ecdsa-sha256"` and supply `ecPrivateScalarHex` (64 hex chars) instead of `rsaKeyPkcs1DerBase64`.

---

### `inspect_pdf` *(new in v0.3.0)*

Read-only PDF inspection over `openPdf()`. Never modifies the input.

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "pages":     true,
  "check":     ["pdfa", "signed"]
}
```

**Inputs:**
- `pdfBase64` — base64 PDF bytes (required).
- `pages` — when `true`, includes per-page `width`, `height`, `rotation`.
- `check` — array of CI assertions. Allowed values: `pdfa`, `signed`, `encrypted`. The response includes `checks` (per-assertion result) and `checksPassed` (boolean AND).

**Outputs:** `version`, `pageCount`, `encryption` (`null` or `{ algorithm, keyLength, version, revision }`), `pdfA` (`null` or `{ part, conformance }`), `signatureCount`, `info` (`{ title?, author?, subject?, keywords?, creator?, producer?, creationDate?, modDate? }`), optional `perPage[]`, optional `checks` + `checksPassed`.

Useful in CI as a final assertion step before publishing a PDF artifact:

```jsonc
{ "tool": "inspect_pdf",
  "input": { "pdfBase64": "<...>", "check": ["pdfa", "signed"] } }
// → { ..., "checks": { "pdfa": true, "signed": true }, "checksPassed": true }
```

---

## The `pdfA` flag

Every document tool (`generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `prepare_signature_placeholder`, `add_international_text`) accepts an optional `pdfA` field in v0.3.0:

| `pdfA` value | PDF version | Notes |
|---|---|---|
| `"pdfa1b"` | 1.4 | Most conservative \u2014 no transparency, no AES |
| `"pdfa2b"` | 1.7 | Default archive target |
| `"pdfa2u"` | 1.7 | 2b + Unicode mapping for every glyph |
| `"pdfa3b"` | 1.7 | 2b + arbitrary `/EmbeddedFile` attachments |

When set on `add_international_text`, the `latin` font auto-registers so non-WinAnsi Latin characters validate cleanly. Mutually exclusive with the underlying pdfnative encryption layer (ISO 19005-1 \u00a76.3.2).

---

## Output modes

Every tool accepts an `outputMode` field:

| Mode | Behaviour |
|---|---|
| `"base64"` *(default)* | The PDF bytes are returned inline in the MCP response as a base64 string. Suitable for pipelines that immediately consume or display the bytes. |
| `"file"` | The PDF is written to the sandbox directory configured via `PDFNATIVE_MPC_OUTPUT_DIR`. An `outputPath` (relative, `.pdf` extension) is required. **Disabled unless the environment variable is set.** |

---

## End-to-end example: signed document

This workflow uses two tools in sequence:

```jsonc
// Step 1 — create the placeholder
{
  "tool": "prepare_signature_placeholder",
  "input": {
    "title":      "Purchase Order #42",
    "signerName": "Jane Smith",
    "reason":     "CFO approval",
    "location":   "London, UK",
    "blocks": [
      { "type": "paragraph", "text": "Total amount: $128,000" }
    ],
    "outputMode": "base64"
  }
}

// Step 2 — sign the returned PDF
{
  "tool": "sign_pdf",
  "input": {
    "pdfBase64":            "<result from step 1>",
    "algorithm":            "rsa-sha256",
    "certDerBase64":        "<your DER certificate>",
    "rsaKeyPkcs1DerBase64": "<your PKCS#1 private key>",
    "signerName":           "Jane Smith",
    "reason":               "CFO approval",
    "location":             "London, UK",
    "signingTime":          "2026-04-26T09:00:00Z",
    "outputMode":           "base64"
  }
}
```

---

## Security model

`pdfnative-mcp` is designed to run safely inside your AI client:

- **No network access** — the server does not open outbound connections.
- **Sandboxed file writes** — `file` output mode is gated by `PDFNATIVE_MPC_OUTPUT_DIR`. When unset, file writes are rejected with a `SecurityError`.
- **Path traversal protection** — absolute paths, `..` sequences, NUL bytes, and non-`.pdf` extensions are all rejected.
- **Output size cap** — PDF output is capped at **50 MB** per call.
- **Input validation** — every tool validates inputs against strict JSON Schemas and Zod runtime checks at the boundary.

See [SECURITY.md](https://github.com/Nizoka/pdfnative-mcp/blob/main/SECURITY.md) for responsible disclosure.

---

## Troubleshooting

**The server does not appear in my AI client.**  
Verify that Node.js ≥ 22 is installed (`node --version`) and that the config file path is correct for your OS. Restart the client after any config change.

**`file` output mode returns a SecurityError.**  
Set the `PDFNATIVE_MPC_OUTPUT_DIR` environment variable to an existing absolute path in the client config.

**`add_international_text` produces blank text.**  
The required Noto font is downloaded lazily on first use. Ensure the process has network access (or pre-install `pdfnative` with fonts cached).

**`sign_pdf` fails with "invalid placeholder".**  
Pass a PDF produced by `prepare_signature_placeholder`. The placeholder must not have been modified since creation.

**Output PDF exceeds 50 MB.**  
Split the content across multiple tool calls or reduce image/barcode count.

---

## Further reading

- [pdfnative-mcp on GitHub](https://github.com/Nizoka/pdfnative-mcp) — source, issues, CHANGELOG
- [pdfnative-mcp on npm](https://www.npmjs.com/package/pdfnative-mcp) — version history, install stats
- [pdfnative Quick Start](quickstart.html) — pdfnative library directly in Node.js / browser
- [Architecture guide](architecture.html) — how pdfnative-mcp sits in the ecosystem
- [Model Context Protocol specification](https://modelcontextprotocol.io) — MCP standard reference
