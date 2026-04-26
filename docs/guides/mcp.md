# pdfnative-mcp — AI Client Integration Guide

[pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) is an **MCP server** that exposes the full pdfnative library to any AI client supporting the [Model Context Protocol](https://modelcontextprotocol.io) — Claude Desktop, Cursor, Continue, Zed, ChatGPT, and more.

> **What is MCP?** The Model Context Protocol is an open standard (originally developed by Anthropic) that lets AI assistants call external tools in a structured, safe way. An MCP server declares a set of tools with typed inputs and outputs; the AI client invokes those tools on your behalf during a conversation.

With `pdfnative-mcp` installed, you can say to your AI assistant:

> _"Generate a Q1 2026 financial report as PDF with a QR code pointing to our dashboard"_

…and the AI will call the right combination of `generate_basic_pdf`, `add_barcode`, or `add_table` tools, returning a ready-to-download PDF.

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

`pdfnative-mcp` exposes **8 tools**:

| Tool | Purpose |
|---|---|
| `generate_basic_pdf` | Multi-page A4 documents from structured blocks (headings, paragraphs, lists, page breaks) |
| `add_table` | Tabular PDF reports from column headers and data rows |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF |
| `add_international_text` | 16 non-Latin scripts (Arabic, Thai, CJK, Devanagari, Bengali, Tamil, …) with BiDi & OpenType shaping |
| `add_form` | Interactive AcroForm PDFs with text fields, checkboxes, radio buttons, and dropdowns |
| `embed_image` | Embed a JPEG or PNG image (base64-encoded) into a titled PDF document |
| `prepare_signature_placeholder` | Create a PDF with a `/Sig` AcroForm placeholder ready to be signed |
| `sign_pdf` | PAdES-style CMS digital signatures (RSA-SHA256 / ECDSA-SHA256 P-256) |

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
  "infoItems":  [{ "label": "Period", "value": "January 2026" }],
  "footerText": "Internal use only",
  "outputMode": "base64"
}
```

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
  "title":      "مرحبا بالعالم",
  "lang":       "ar",
  "paragraphs": [
    "هذا اختبار للنص العربي مع تشكيل OpenType ومحارف ثنائية الاتجاه.",
    "Mixed content: العربية + English ✓"
  ]
}
```

**Supported `lang` codes:** `ar` (Arabic), `he` (Hebrew), `th` (Thai), `ja` (Japanese), `zh` (Chinese Simplified), `ko` (Korean), `el` (Greek), `hi` (Devanagari/Hindi), `bn` (Bengali), `ta` (Tamil), `ru` (Cyrillic/Russian), `ka` (Georgian), `hy` (Armenian), `tr` (Turkish), `vi` (Vietnamese), `pl` (Polish).

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
