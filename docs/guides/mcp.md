# pdfnative-mcp — AI Client Integration Guide

> **Tracks the latest published `pdfnative-mcp`** (v1.5.0, built on pdfnative 1.6.0). Full release notes: [pdfnative-mcp releases](https://github.com/Nizoka/pdfnative-mcp/releases). Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html).

[pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) is an **MCP server** that exposes the full pdfnative library to any AI client supporting the [Model Context Protocol](https://modelcontextprotocol.io) — Claude Desktop, Cursor, Continue, Zed, ChatGPT, and more.

> **What is MCP?** The Model Context Protocol is an open standard (originally developed by Anthropic) that lets AI assistants call external tools in a structured, safe way. An MCP server declares a set of tools with typed inputs and outputs; the AI client invokes those tools on your behalf during a conversation.

With `pdfnative-mcp` installed, you can say to your AI assistant:

> _"Generate a Q1 2026 financial report as PDF/A-2b with a QR code pointing to our dashboard, then inspect the result to confirm it's archive-grade."_

…and the AI will call the right combination of `generate_basic_pdf`, `add_barcode`, `add_table`, and `inspect_pdf` tools, returning a ready-to-download PDF.

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
        "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
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
        "PDFNATIVE_MCP_OUTPUT_DIR": "/path/to/pdf-output"
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
        "PDFNATIVE_MCP_OUTPUT_DIR": "/path/to/pdf-output"
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
          "PDFNATIVE_MCP_OUTPUT_DIR": "/path/to/pdf-output"
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
| `PDFNATIVE_MCP_OUTPUT_DIR` | Absolute path to the sandbox directory. **Required to enable `outputMode: "file"`**. When unset, only `base64` output is available. (The misspelt `PDFNATIVE_MPC_OUTPUT_DIR` still works as a deprecated alias.) |
| `PDFNATIVE_MCP_CACHE_DIR` | Absolute path to enable the persistent SHA-256-keyed result cache (1 h TTL, 256 MiB LRU). When unset, the cache is disabled. |
| `PDFNATIVE_MCP_PORT` | When set to a valid port (1–65535), starts an HTTP server on `http://127.0.0.1:<port>/mcp` instead of stdio. |

---

## Tool reference

`pdfnative-mcp` exposes **24 tools**:

| Tool | Purpose |
|---|---|
| `generate_basic_pdf` | Multi-page A4 documents from structured blocks (headings, paragraphs, lists, spacers, charts, page breaks). Accepts optional `pdfA`. |
| `add_table` | Tabular PDF reports from column headers and data rows. Optional `autoFitColumns` and `clipCells`. Accepts `pdfA`. |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF. Accepts `pdfA`. |
| `add_international_text` | 24 `lang` font codes — the 22 writing systems plus `latin` and `emoji` — with BiDi & OpenType shaping, plus the explicit `math` script (Noto Sans Math, on-demand). `lang` accepts `string`, `string[]`, or comma-separated. |
| `add_form` | Interactive AcroForm PDFs with text fields, checkboxes, radio buttons, and dropdowns. Accepts `pdfA`. |
| `embed_image` | Embed a JPEG or PNG image (base64-encoded) into a titled PDF document. Accepts `pdfA`. |
| `prepare_signature_placeholder` | Create a PDF with a `/Sig` AcroForm placeholder ready to be signed. Accepts `pdfA`. |
| `sign_pdf` | PAdES-style CMS digital signatures (RSA-SHA256 / ECDSA-SHA256 P-256). |
| `inspect_pdf` | Read-only inspection. Returns `version`, `pageCount`, `encryption`, `pdfA`, `signatureCount`, `info`, optional `perPage`, optional `pageLabels[]` (when `/PageLabels` is declared), optional `checks` + `checksPassed`. |
| `validate_pdf` | Read-only PDF/UA structural validation (`valid`, `errors`, `warnings`). |
| `verify_pdf` | Real CMS/PKCS#7 signature verification — RSA & ECDSA, message digest, certificate chain. (RFC 3161 timestamp validation is a `pdfnative-cli verify` feature, not part of this server.) |
| `add_attachment` | Embed files (e.g. Factur-X / ZUGFeRD e-invoice XML) into PDF/A-3b output. |
| `extract_attachments` | Extract embedded files from an existing PDF (optionally metadata-only). |
| `extract_text` | Extract text content from an existing PDF via the native parser. |
| `merge_pdfs` | Concatenate 2–50 PDFs into one document via the page-tree API (drops signatures/`/AcroForm`, keeps URI links). |
| `split_pdf` | Split one PDF into one document per page range — multi-output `{ mode, count, totalBytes, parts[] }`. In-memory assembly is capped by `maxOutputSizeBytes`, default **256 MiB**; each emitted PDF is separately capped at 50 MiB. |
| `extract_pages` | Pull an arbitrary, order-preserving page subset (max 5000) into a single PDF. |
| `annotate_pdf` | Overlay markup annotations (text / highlight / underline / strikeout / squiggly / square / circle / line / freetext) on an existing PDF via incremental update. A visual review layer, **not** a redaction. |
| `draft_governance_issue` | Assemble a governance-compliant GitHub-issue draft plus a structured `compliance` report **locally** — network-free by construction; never submits. |
| `add_chart` _(v1.5.0)_ | Render a bar, horizontal-bar, line, pie or donut chart as **native PDF vector paths** — no rasterisation and no image round-trip. Tagged as `/Figure` with alt text when `pdfA` is set. |
| `read_form_fields` _(v1.5.0)_ | List an existing AcroForm's fields with their types, current values and available options — the read half of the fill round-trip. Accepts `password`. |
| `fill_form` _(v1.5.0)_ | Fill AcroForm field values and optionally `flatten` them into static page content. Works on encrypted PDFs via incremental update. |
| `encrypt_pdf` _(v1.5.0)_ | Re-secure an existing PDF with AES-128 or AES-256 — owner/user passwords and an explicit permission set. |
| `decrypt_pdf` _(v1.5.0)_ | Remove encryption from a password-protected PDF **in-server** — RC4, AES-128 and AES-256 sources. |

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

**Block types supported:** `heading` (levels 1–3), `paragraph`, `list` (`bullet` / `numbered`, nested items to depth 6), `pageBreak`, `spacer` (`height` in points), and `chart` (same body as `add_chart`).

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

`autoFitColumns` and `clipCells` transparently switch to the document-block backend so cell content fits its column or is clipped at the boundary, leveraging pdfnative's `TableBlock` props. Optional `pdfA` produces an archive-grade variant.

> **Smart-table fields (v1.0.0).** `add_table` exposes the six pdfnative 1.2 `TableBlock` fields: `wrap` (`'auto'` | `'always'` | `'never'`, default `'auto'`), `repeatHeader` (default `true`), `zebra`, `caption`, `minRowHeight`, `cellPadding`. Multi-page tables reprint headers and wrap on overflow by default — agent-driven invoice/report workflows get multi-page-safe output out of the box. See the [Smart tables guide](tables.md) for full semantics.

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

**Supported `lang` codes:** `ar` (Arabic), `he` (Hebrew), `th` (Thai), `ja` (Japanese), `zh` (Chinese Simplified), `ko` (Korean), `el` (Greek), `hi` (Devanagari/Hindi), `bn` (Bengali), `ta` (Tamil), `te` (Telugu), `si` (Sinhala), `bo` (Tibetan), `km` (Khmer), `my` (Myanmar), `am` (Ethiopic), `ru` (Cyrillic/Russian), `ka` (Georgian), `hy` (Armenian), `tr` (Turkish), `vi` (Vietnamese), `pl` (Polish), plus **`latin`** (Noto Sans VF), **`emoji`** (Noto Emoji/COLRv1) and the explicit **`math`** symbols font *(v1.4.0)*.

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

**Field types:** `text`, `textarea`, `checkbox`, `radio`, `dropdown`.

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

Signs any PDF. When the input already contains a `/Sig` placeholder (e.g. produced by `prepare_signature_placeholder`) it is signed in place; otherwise the placeholder is auto-injected first (`autoInjectPlaceholder` defaults to `true`; set it to `false` to require an existing placeholder).

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

For ECDSA P-256: use `"algorithm": "ecdsa-sha256"` and supply either `ecPrivateScalarHex` (64 hex chars, raw scalar `d`) or `ecPrivateKeyDerBase64` (SEC1 / PKCS#8 DER, base64 — signed through the constant-time `node:crypto` path) instead of `rsaKeyPkcs1DerBase64`. The two EC inputs are mutually exclusive.

---

### `inspect_pdf`

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
- `password` — password for an encrypted PDF *(v1.5.0)*.
- `pages` — when `true`, includes per-page `index`, `width`, `height`.
- `check` — array of CI assertions. Allowed values: `pdfa`, `signed`, `encrypted`, `placeholder`, `attachments`. The response includes `checks` (per-assertion result) and `checksPassed` (boolean AND).
- `verbosity` — `'full'` (default) or `'summary'` (token-frugal scalar subset).
- `fields` — optional dot-path projection of the result.

**Outputs:** `version`, `pageCount`, `encryption` (`'none'` / `'aes-128'` / `'aes-256'` / `'rc4'` / `'unknown'`), optional `encryptionInfo` (`{ algorithm, revision, authenticatedAs }`, present when the document is encrypted and opened successfully), `pdfA` (`null` or the detected claim string), `signatureCount`, `hasSignaturePlaceholder`, `attachments[]` (embedded-file summaries), `info` (decoded `/Info` entries), optional `perPage[]`, optional `pageLabels[]` (when `/PageLabels` is declared), optional `checks` + `checksPassed`.

Useful in CI as a final assertion step before publishing a PDF artifact:

```jsonc
{ "tool": "inspect_pdf",
  "input": { "pdfBase64": "<...>", "check": ["pdfa", "signed"] } }
// → { ..., "checks": { "pdfa": true, "signed": true }, "checksPassed": true }
```

---

### `merge_pdfs`

Concatenates **2–50** PDFs into a single document via pdfnative's page-tree API. Encrypted sources are supported since v1.5.0 via `password` (a single password applied to every encrypted source), and the output can be re-encrypted via `encrypt`. Signatures and `/AcroForm` are dropped because page edits invalidate `/ByteRange`; self-contained URI `/Link` annotations are kept.

```jsonc
{
  "pdfsBase64": ["<base64 PDF 1>", "<base64 PDF 2>", "<base64 PDF 3>"],
  "outputMode": "base64"
}
```

**Errors:** `PASSWORD_REQUIRED` / `PASSWORD_INVALID` (encrypted source without / with the wrong `password`), `OUTPUT_TOO_LARGE` (50 MiB per emitted PDF; assembly capped by `maxOutputSizeBytes`, default 256 MiB), `PDF_PARSE_FAILED`.

---

### `split_pdf`

Splits one PDF into one document per page range, returning a **multi-output** shape. Ranges are **0-based and inclusive**; `end` defaults to `start` (a single page).

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "ranges": [{ "start": 0, "end": 2 }, { "start": 3, "end": 9 }],
  "outputMode": "base64"
}
// → { "mode": "base64", "count": 2, "totalBytes": 123456, "parts": [ { "index": 0, "sizeBytes": 61000, "base64": "..." }, ... ] }
```

Each part is capped at **50 MiB**; the aggregate output is capped at **200 MiB**.

---

### `extract_pages`

Pulls an arbitrary, order-preserving page subset (**max 5000** pages) into a single PDF.

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "pages": [0, 2, 4, 1],
  "outputMode": "base64"
}
```

Page indices are **0-based**; the output preserves the order you request.

### `annotate_pdf`

Overlays markup annotations on an existing PDF via **incremental update**, so the original bytes — and any existing signature — stay intact.

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "annotations": [
    { "type": "highlight", "page": 0, "rect": [72, 700, 520, 715], "color": "#ffe066", "contents": "Review this clause" },
    { "type": "text",      "page": 1, "rect": [80, 640, 100, 660], "contents": "Sticky note" }
  ],
  "outputMode": "base64"
}
```

Types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Each takes a **0-based** `page`, a `rect: [x1, y1, x2, y2]`, and optional `color` / `contents`. Encrypted sources → `ENCRYPTED_SOURCE`; an out-of-range `page` → a validation error.

> **Overlay, not redaction.** `annotate_pdf` is a *visual review layer*; the underlying bytes remain. It does **not** remove or obscure content — see the deferred `redact_pdf` note under *What's new in v1.4.0*.

### `draft_governance_issue`

Assembles a governance-compliant GitHub-issue draft plus a structured `compliance` report **locally** and returns them. It **never submits** and makes **no** network call — there is no HTTP client, no GitHub SDK, and no `fetch` anywhere in the server.

```jsonc
{
  "title": "SVG <text> word-wrap not supported",
  "issueType": "feature",
  "summary": "renderSvg() emits <text> on a single line with no automatic wrapping.",
  "reproduction": {
    "command": "node repro.mjs",
    "result": "Long <text> overflows the viewport instead of wrapping."
  },
  "expectedBehavior": "Optional word-wrap for SVG <text>.",
  "targetRepo": "pdfnative",
  "affectedPackages": ["pdfnative"],
  "duplicateSearchPerformed": true,
  "outputMode": "inline"
}
```

`duplicateSearchPerformed` **must be `true`**. A draft that proposes a runtime dependency, omits a reproduction, or sets it to `false` is rejected with `GOVERNANCE_VIOLATION`. Present the returned `draftMarkdown` + `compliance` to the user; a **human** submits it. Read the `governance_contract` / `draft_issue_workflow` prompts first.

### `add_chart` _(v1.5.0)_

Renders a bar, horizontal-bar, line, pie or donut chart as **native PDF vector paths** — no rasterisation, no image round-trip. Multi-series bar/line, legends, gridlines and negative values are supported; the chart is tagged `/Figure` with `/Alt` (auto-generated when `altText` is omitted).

```jsonc
{
  "chartType": "bar",
  "title": "Revenue by quarter",
  "series": [{ "label": "2026", "values": [1.2, 1.5, 1.4, 1.9] }],
  "intro": "Quarterly revenue in $M.",
  "pdfA": "pdfa2b",
  "outputMode": "base64"
}
```

**Inputs:** `chartType` (`bar` / `barH` / `line` / `pie` / `donut`) and `series` (required; pie/donut take exactly one series), plus `title`, `legend` (`'bottom'` / `'none'`), `markers` (line series), `colors` (hex palette override), `altText`, `intro` (paragraph above the chart), `pdfA`, `outputMode` / `outputPath`. For a chart amongst headings/paragraphs/tables, use a `chart` block inside `generate_basic_pdf` — both build identical pdfnative blocks.

### `read_form_fields` _(v1.5.0)_

Read-only enumeration of an existing PDF's AcroForm — the discovery half of the fill round-trip.

```jsonc
{ "pdfBase64": "<base64 PDF bytes>", "verbosity": "full" }
```

**Inputs:** `pdfBase64` (required), `password` (encrypted sources), `verbosity` (`'full'` default / `'summary'` = `{ fieldCount }` only), `fields` (dot-path projection).  
**Outputs:** `fieldCount` and `fields[]` — each with `name` (fully-qualified), `type` (`text` / `checkbox` / `radio` / `dropdown` / `listbox` / `button` / `signature` / `unknown`), current `value`, `readOnly` / `required` / `multiline` flags, `options[]` (`{ export, label }` for choice fields), `maxLen`, `onState`, and `widgets[]` (0-based page + rect).

### `fill_form` _(v1.5.0)_

Fills (and optionally flattens) the AcroForm of an *existing* PDF via a non-destructive **incremental update**, so a prior signature stays valid for its revision. Works on encrypted documents via `password` (appended objects are encrypted under the document's existing scheme).

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "values": { "fullName": "Alice Dupont", "agree": true },
  "flatten": false,
  "outputMode": "base64"
}
```

**Inputs:** `pdfBase64` (required), `values` (name → string | boolean | string[]; omit with `flatten: true` for a pure flatten), `flatten` (default `false`), `onUnknownField` (`'throw'` default / `'ignore'`), `nonWinAnsi` (`'throw'` default / `'needAppearances'`), `password`, `outputMode` / `outputPath`.  
**Errors:** `FORM_FIELD_NOT_FOUND`, `FORM_VALUE_TYPE_ERROR`, `FORM_UNSUPPORTED` (signature fields cannot be filled/flattened), `PASSWORD_REQUIRED` / `PASSWORD_INVALID`.

### `encrypt_pdf` _(v1.5.0)_

Re-secures an existing PDF with AES-128 (default, widest compatibility) or AES-256 via the page-tree re-encryption path. An already-encrypted source can be rotated to a new password by supplying its current `password`.

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "ownerPassword": "s3cret-owner",
  "userPassword": "open-me",
  "algorithm": "aes256",
  "permissions": { "print": true, "copy": false, "modify": false, "extractText": false },
  "outputMode": "base64"
}
```

**Inputs:** `pdfBase64` and `ownerPassword` (required), `userPassword` (omitted/empty = opens without a prompt), `algorithm` (`'aes128'` default / `'aes256'`), `permissions` (`{ print?, copy?, modify?, extractText? }`, each allowed when omitted), `password` (current password of an encrypted source), `outputMode` / `outputPath`.

> Like merge/split/extract, encryption rebuilds the page tree: existing signatures and `/AcroForm` are **dropped**, and only self-contained URI link annotations are kept. Encrypt **before** signing, not after. Excluded from the response cache.

### `decrypt_pdf` _(v1.5.0)_

Opens an encrypted PDF (RC4, AES-128 or AES-256) and emits an unencrypted copy **in-server** — no external tool needed.

```jsonc
{ "pdfBase64": "<base64 encrypted PDF>", "password": "open-me", "outputMode": "base64" }
```

**Inputs:** `pdfBase64` (required), `password` (user or owner; omit only for documents with an empty user password), `outputMode` / `outputPath`.

> The rebuild drops signatures and `/AcroForm`. To *read* an encrypted PDF without rebuilding it, pass `password` to `inspect_pdf` / `extract_text` / `extract_attachments` instead. Excluded from the response cache.

---

## MCP prompts

Since v1.4.0 the server advertises the MCP **`prompts`** capability with two prompts, sourced from the same governance contract the tools enforce:

| Prompt | Purpose |
|---|---|
| `governance_contract` | The full AI-governance / Human-in-the-Loop contract. |
| `draft_issue_workflow` | The step-by-step recipe for producing a compliant issue draft with `draft_governance_issue`. |

## Error codes

| `code` | Raised by | Meaning / fix |
|---|---|---|
| `ENCRYPTED_SOURCE` | `annotate_pdf` | The source PDF is encrypted; `annotate_pdf` has no `password` parameter (nor do `sign_pdf` and `validate_pdf`). Use `decrypt_pdf` first (note: that rebuild drops signatures/forms), or pass `password` to the tools that accept it. |
| `PASSWORD_REQUIRED` *(v1.5.0)* | password-aware tools (`inspect_pdf`, `verify_pdf`, `extract_text`, `extract_attachments`, `read_form_fields`, `fill_form`, page-tree trio, `encrypt_pdf`, `decrypt_pdf`) | The source is encrypted and no `password` was supplied. |
| `PASSWORD_INVALID` *(v1.5.0)* | password-aware tools | The supplied `password` does not open the document. |
| `ENCRYPTION_UNSUPPORTED` *(v1.5.0)* | password-aware tools | The document uses an encryption scheme the reader does not support. |
| `FORM_FIELD_NOT_FOUND` *(v1.5.0)* | `fill_form` | A `values` key matches no field (with `onUnknownField: 'throw'`, the default). |
| `FORM_VALUE_TYPE_ERROR` *(v1.5.0)* | `fill_form` | A value's type does not match the field (e.g. a boolean for a text field). |
| `FORM_UNSUPPORTED` *(v1.5.0)* | `fill_form` | The field cannot be filled/flattened (e.g. a signature field). |
| `OUTPUT_TOO_LARGE` | PDF-emitting tools | An emitted PDF exceeds 50 MiB (for `split_pdf`, also the 200 MiB aggregate), or assembly exceeds `maxOutputSizeBytes` (default 256 MiB). |
| `PDF_PARSE_FAILED` | page-tree tools | The source bytes are not a parseable PDF. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` | The draft breaks the AI-governance contract (proposes a runtime dependency, omits a reproduction, or `duplicateSearchPerformed: false`). Fix the draft and retry. |

---

## The `pdfA` flag

Every document tool (`generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `prepare_signature_placeholder`, `add_international_text`, `add_chart` *(v1.5.0)*) accepts an optional `pdfA` field. `add_attachment` is the special case: it always produces **PDF/A-3b** (the only conformance level that allows arbitrary embedded files), so it has no `pdfA` input.

| `pdfA` value | PDF version | Notes |
|---|---|---|
| `"pdfa1b"` | 1.4 | Most conservative — no transparency, no AES |
| `"pdfa2b"` | 1.7 | Default archive target |
| `"pdfa2u"` | 1.7 | 2b + Unicode mapping for every glyph |
| `"pdfa3b"` | 1.7 | 2b + arbitrary `/EmbeddedFile` attachments |

When set on `add_international_text`, the `latin` font auto-registers so non-WinAnsi Latin characters validate cleanly. Mutually exclusive with the underlying pdfnative encryption layer (ISO 19005-1 §6.3.2).

---

## Output modes

Every document-producing tool accepts an `outputMode` field. The read-only
tools (`inspect_pdf`, `validate_pdf`, `verify_pdf`, `extract_text`,
`extract_attachments`, `read_form_fields`) return JSON only and have no
`outputMode`:

| Mode | Behaviour |
|---|---|
| `"base64"` *(default)* | The PDF bytes are returned inline in the MCP response as a base64 string. Suitable for pipelines that immediately consume or display the bytes. |
| `"file"` | The PDF is written to the sandbox directory configured via `PDFNATIVE_MCP_OUTPUT_DIR`. An `outputPath` (relative, `.pdf` extension) is required. **Disabled unless the environment variable is set.** |

> **Exception:** `draft_governance_issue` uses `outputMode: "inline" | "file"` (not `base64`) and writes a **`.md`** draft — not a PDF — when `file` mode is selected.

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
- **Sandboxed file writes** — `file` output mode is gated by `PDFNATIVE_MCP_OUTPUT_DIR`. When unset, file writes are rejected with a `SecurityError`.
- **Path traversal protection** — absolute paths, `..` sequences, NUL bytes, and non-`.pdf` extensions are all rejected.
- **Output size cap** — PDF output is capped at **50 MiB** per call. `split_pdf` additionally enforces **50 MiB per part** and a **200 MiB aggregate** ceiling across its parts, returning `OUTPUT_TOO_LARGE` when exceeded.
- **HTTP transport hardening** — when bound to `PDFNATIVE_MCP_PORT`, the Streamable HTTP transport is loopback-only and rejects foreign `Host` / `Origin` headers with **403** (DNS-rebinding protection).
- **Input validation** — every tool validates inputs against strict JSON Schemas and Zod runtime checks at the boundary.

See [SECURITY.md](https://github.com/Nizoka/pdfnative-mcp/blob/main/SECURITY.md) for responsible disclosure.

---

## Troubleshooting

**The server does not appear in my AI client.**  
Verify that Node.js ≥ 22 is installed (`node --version`) and that the config file path is correct for your OS. Restart the client after any config change.

**`file` output mode returns a SecurityError.**  
Set the `PDFNATIVE_MCP_OUTPUT_DIR` environment variable to an existing absolute path in the client config.

**`add_international_text` produces blank text.**  
The Noto fonts ship bundled with `pdfnative` — no network access is needed. Blank text usually means an unsupported `lang` code or a corrupted install; check the `lang` value against the supported list and reinstall `pdfnative` if needed.

**`sign_pdf` fails with "invalid placeholder".**  
By default `sign_pdf` auto-injects a `/Sig` placeholder when the input has none (`autoInjectPlaceholder: true`), so this error normally only appears when `autoInjectPlaceholder` was set to `false` — either drop that flag or call `prepare_signature_placeholder` first, and make sure the placeholder PDF was not modified between creation and signing.

**Output PDF exceeds 50 MB.**  
Split the content across multiple tool calls or reduce image/barcode count.

---

## Release history

The current release is **v1.5.0** (24 tools, built on pdfnative 1.6.0 — see the header note). Per-release notes, oldest first:

### What's new in v1.0.0

v1.0.0 is the **first stable release**, built on `pdfnative` 1.2.0, and commits to API stability via a per-tool `_meta.apiVersion` field. New fields are optional and backward-compatible — omitting them produces byte-identical output. Tool count: **12** (was 9).

- **Three new tools:**
  - **`verify_pdf`** — read-only verification of every PAdES Baseline / `adbe.pkcs7.detached` signature: recomputes the `ByteRange` SHA-256, validates the CMS `messageDigest`, and verifies the `signatureValue` with the embedded signer certificate (RSA-SHA256 + ECDSA-SHA256 P-256). Optional `trustedRootsDerBase64` enables chain trust.
  - **`add_attachment`** — generate a **PDF/A-3 (ISO 19005-3)** document with one or more embedded files. Primary use case: **Factur-X / ZUGFeRD** electronic invoices (XML payload with `relationship: 'Source'`). 8 MiB per-file cap.
  - **`extract_text`** — best-effort plain-text extraction from a non-encrypted PDF (operands of `Tj` / `'` / `"` / `TJ`). Reports `extractable: false` when a page yields no text; encrypted PDFs are rejected.
- **Smart-table fields on `add_table`** — `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding` (pdfnative 1.2 `TableBlock` props). Multi-page tables reprint headers and wrap on overflow by default.
- **Signing ergonomics** — `sign_pdf` accepts ECDSA SEC1 / PKCS#8 DER keys and `autoInjectPlaceholder: true` (default) transparently calls `addSignaturePlaceholder()` when the input lacks a `/Sig` widget (one-call signing of any PDF).
- **`inspect_pdf`** now reports `hasSignaturePlaceholder` and an `attachments[]` summary; two new `check` values: `placeholder`, `attachments`. The `signed` check is now `signatureCount > 0 && !hasSignaturePlaceholder`.
- **Opt-in result cache** (`PDFNATIVE_MCP_CACHE_DIR`) — SHA-256 keyed over canonical JSON of `{tool, apiVersion, input}`, 1 h TTL, 256 MiB LRU. Skips `outputMode: 'file'` calls.
- **`_meta.apiVersion = '1.0.0'`** and per-tool **`_meta.examples`** on every tool listing for AI-agent discovery — anchored to [`docs/API_STABILITY.md`](https://github.com/Nizoka/pdfnative-mcp/blob/main/docs/API_STABILITY.md).
- **`pdfA` flag on every document tool** — values `pdfa1b`, `pdfa2b`, `pdfa2u`, `pdfa3b`, mapping to pdfnative's `tagged` option (spread straight from pdfnative's exported `PDF_A_CONFORMANCE_TARGETS`).
- **Env-var rename:** the canonical name is `PDFNATIVE_MCP_OUTPUT_DIR` (was the misspelt `PDFNATIVE_MPC_OUTPUT_DIR`, which still works as a deprecated alias with a one-shot stderr warning, scheduled for removal in v2.0.0).

**Deferred to v1.1:** `merge_pdfs`, `split_pdf`, `redact_pdf` — require pdfnative page-tree primitives not yet exported.

### What's new in v1.1.0

v1.1.0 upgrades the server to the `pdfnative` 1.3.0 engine and adds accessibility-first read tooling:

- **New tool: `validate_pdf`** — read-only PDF/UA structural conformance checks (ISO 14289-1).
- **Six additional scripts** in `add_international_text`: Telugu (`te`), Sinhala (`si`), Tibetan (`bo`), Khmer (`km`), Myanmar (`my`), Ethiopic (`am`).
- **COLRv1 colour emoji support** through the upgraded engine.
- **Paragraph newline sanitization** to avoid malformed text blocks when callers send embedded `\n`.

### What's new in v1.2.0

v1.2.0 keeps full backward compatibility and extends MCP ergonomics for AI workflows:

- **New tool: `extract_attachments`** — read embedded files from PDF/A-3 documents (Factur-X / ZUGFeRD round-trip).
- **Watermark support** on `generate_basic_pdf` and `add_table` (text, opacity, angle, color, position).
- **Opt-in Unicode normalization** (`normalize`: `NFC` / `NFD` / `NFKC` / `NFKD`) on international/document flows.
- **Token-frugal read modes** on read-only tools via `verbosity: 'summary'` and selective `fields` projection.
- **Base64 payload deduplication**: generated bytes are returned once via `resource` in base64 mode.

### What's new in v1.3.0

<!-- verify-docs:allow version-token (historical release entry) -->
v1.3.0 upgrades the engine to **pdfnative 1.4.0**, adds a page-tree tool trio, and stays fully backward-compatible — tool count rises to **17**:

- **Three new page-tree tools:**
  - **`merge_pdfs`** — concatenate **2–50** source PDFs into one document via pdfnative's page-tree API. Encrypted sources are rejected; signatures and `/AcroForm` are dropped (page edits invalidate `/ByteRange`); self-contained URI `/Link` annotations are preserved.
  - **`split_pdf`** — split one PDF into one document per page range, returning a **multi-output** shape `{ mode, count, totalBytes, parts[] }`. Caps: **50 MiB per part**, **200 MiB aggregate**.
  - **`extract_pages`** — pull an arbitrary, order-preserving page subset (**max 5000** pages) into a single PDF.
- **Enriched authoring options** (from pdfnative 1.4.0): <!-- verify-docs:allow version-token (historical) -->
  - `generate_basic_pdf` gains `outline` (`'auto'` or an explicit nested tree), `pageLabels`, **nested `list` items** (max depth 6), and `viewerPreferences`.
  - `add_table` gains `cellBorders` (top/right/bottom/left, color, width, style), `cellVAlign` (`'top'` / `'middle'` / `'bottom'`), and `viewerPreferences`.
  - `add_international_text` gains `viewerPreferences`.
- **Constant-time signing** — `sign_pdf` now signs RSA and EC-DER keys through a per-call `node:crypto` provider (constant-time) with a transparent pure-JS fallback; pure-scalar `ecPrivateScalarHex` remains pure-JS.
- **HTTP transport hardening** — the `PDFNATIVE_MCP_PORT` Streamable HTTP transport now rejects foreign `Host` / `Origin` headers with **403** (DNS-rebinding protection). `serverInfo` advertises a human-readable `title` + `description` (MCP 2025-11-25 alignment).
- **New error codes** on the page-tree tools: `ENCRYPTED_SOURCE`, `OUTPUT_TOO_LARGE`, `PDF_PARSE_FAILED`.
- **Spec alignment** — MCP SDK `^1.29` (2025-11-25 revision), JSON Schema 2020-12, and `_meta.apiVersion` bumped to `1.3.0` on every tool.

---

### What's new in v1.4.0

v1.4.0 upgrades the engine to **pdfnative 1.5.0**, brings the pdfnative **AI-governance / Human-in-the-Loop (HITL)** system to the MCP surface, and adds markup annotations — taking the catalogue to **19 tools** at that release.<!-- verify-docs:allow stale-token (historical: v1.4.0 total) --> Fully backward-compatible: every v1.3.0 call works unchanged and default responses are byte-identical.

- **Two new tools:**
  - **`draft_governance_issue`** — an agent drafts a fully compliant GitHub issue **locally** (a draft `.md` plus a machine-readable `compliance` report) and stops. The agent is a **draftsman, never an autonomous submitter**: a human is the only gate, and — by construction, not just policy — the server makes **zero** GitHub writes and **no** outbound network call. A draft that proposes a runtime dependency, omits a reproduction, or sets `duplicateSearchPerformed: false` is rejected with the new `GOVERNANCE_VIOLATION` error.
  - **`annotate_pdf`** — overlay `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, and `freetext` annotations on an existing PDF via incremental update. A **visual review layer, not a redaction** — the underlying bytes remain. Encrypted sources → `ENCRYPTED_SOURCE`.
- **MCP `prompts` capability** — the server now advertises two prompts: `governance_contract` (the full HITL contract) and `draft_issue_workflow` (the step-by-step recipe).
- **Page labels in `inspect_pdf`** — read-only surfacing of `/PageLabels` ranges via a new optional `pageLabels[]` output field (present only when the PDF declares them).
- **Math / scientific script** — `add_international_text` accepts the explicit `math` lang (Noto Sans Math), embedded on demand only (e.g. `lang: ['latin', 'math']`); there is **no** global auto-routing.
- **Engine upgrade** — pdfnative `^1.4.0` → `^1.5.0` (additive, no breaking changes); `_meta.apiVersion` bumped to `1.4.0` on every tool.

> **`redact_pdf` is deferred by design.** pdfnative's annotation writer can only *overlay* content; an overlay-only “redaction” would leave the original bytes intact and create **false security**. It is intentionally **not** shipped and is tracked as an upstream true content-removal request — a fitting first use of `draft_governance_issue`.

### What's new in v1.5.0

v1.5.0 upgrades the engine to **pdfnative 1.6.0** and takes the catalogue to **24 tools**, closing the read/modify loop on documents the assistant did not create.

- **Five new tools:**
  - `add_chart` — bar, horizontal-bar, line, pie and donut charts drawn as **native PDF vector paths**. No rasterisation and no image round-trip, so the output stays sharp at any zoom and tags as `/Figure` with alt text. If you were previously asking an agent to render a chart to PNG and push it through `embed_image`, stop — this replaces that.
  - `read_form_fields` — list an AcroForm's fields with types, current values and options.
  - `fill_form` — fill values and optionally `flatten` them into static page content. Works on encrypted documents via incremental update.
  - `encrypt_pdf` — re-secure with AES-128 or AES-256, setting owner/user passwords and a permission set.
  - `decrypt_pdf` — remove encryption **in-server**, for RC4, AES-128 and AES-256 sources.
- **Passwords on the read tools.** `inspect_pdf`, `verify_pdf`, `extract_text` and `extract_attachments` accept a `password`, as do the page-tree trio. Encrypted sources are no longer rejected outright.
- **New error codes:** `PASSWORD_REQUIRED`, `PASSWORD_INVALID`, `ENCRYPTION_UNSUPPORTED`, `FORM_FIELD_NOT_FOUND`, `FORM_VALUE_TYPE_ERROR`, `FORM_UNSUPPORTED`.
- **Generated PDFs are exposed as MCP resources** (`pdfnative://output/{path}`), so a client can list and re-read them without a second tool call. File-mode results carry a `resource_link`.
- **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are published in `tools/list`, letting a client reason about which calls are safe to retry.
- The encryption tools are deliberately **excluded from the response cache**.

---

## Further reading

- [pdfnative-mcp on GitHub](https://github.com/Nizoka/pdfnative-mcp) — source, issues, CHANGELOG
- [pdfnative-mcp on npm](https://www.npmjs.com/package/pdfnative-mcp) — version history, install stats
- [pdfnative Quick Start](quickstart.html) — pdfnative library directly in Node.js / browser
- [Architecture guide](architecture.html) — how pdfnative-mcp sits in the ecosystem
- [Model Context Protocol specification](https://modelcontextprotocol.io) — MCP standard reference
