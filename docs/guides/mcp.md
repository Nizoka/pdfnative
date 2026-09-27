# pdfnative-mcp — AI Client Integration Guide

> **Tracks the latest published `pdfnative-mcp`** (v1.7.0, requires pdfnative ≥ 1.8.0). Full release notes: [pdfnative-mcp releases](https://github.com/Nizoka/pdfnative-mcp/releases). Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html).

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
| `PDFNATIVE_MCP_HTTP_TOKEN` _(v1.6.0)_ | Opt-in bearer token for the HTTP transport (≥ 16 characters, no whitespace — a weaker value aborts startup). When set, `/mcp` requires `Authorization: Bearer <token>`; otherwise requests get `401` + `WWW-Authenticate`. Without it the loopback endpoint has **no authentication**. Never logged. |
| `PDFNATIVE_MCP_MAX_INFLATE_BYTES` _(v1.6.0)_ | Operator override of the engine's 100 MiB per-stream decompression cap (integer ≥ 1024, read once at startup; an invalid value refuses to start with one clean `fatal:` line). |
| `PDFNATIVE_MCP_TSA_URL` _(v1.6.0)_ | RFC 3161 timestamp authority endpoint. Required by `sign_pdf timestamp: true` and `timestamp_pdf` (`TSA_NOT_CONFIGURED` otherwise). |
| `PDFNATIVE_MCP_TSA_AUTH` _(v1.6.0)_ | Optional `Authorization` header value sent to the TSA. Treated as a secret; never logged. |
| `PDFNATIVE_MCP_REVOCATION` _(v1.6.0)_ | Revocation sources for `add_ltv mode: 'online'` — `ocsp`, `crl`, or `ocsp,crl` (`REVOCATION_NOT_CONFIGURED` otherwise). |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` _(v1.6.0)_ | Mandatory allow-list of hosts the OCSP/CRL fetcher may contact. A certificate-supplied URL outside the list fails with `NETWORK_HOST_NOT_ALLOWED`. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` _(v1.6.0)_ | Network timeout for TSA/OCSP/CRL requests (1000–120000 ms, default 10000). |
| `PDFNATIVE_MCP_CREATION_DATE` _(v1.7.0)_ | ISO 8601 instant **with a time zone** (e.g. `2026-01-01T00:00:00Z`) that pins the creation instant of every document the process builds — `/CreationDate`, the XMP dates, the trailer `/ID` and the `{date}` header / footer placeholder. Read once at startup; an invalid value refuses to start; the source of the pin is logged on stderr. |
| `SOURCE_DATE_EPOCH` _(v1.7.0)_ | The [reproducible-builds.org](https://reproducible-builds.org/docs/source-date-epoch/) convention: integer seconds since the Unix epoch, used when `PDFNATIVE_MCP_CREATION_DATE` is unset. An invalid value refuses to start. |

**Creation-date precedence** _(v1.7.0)_, highest first: the per-call `creationDate` → `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → the wall clock. Dates are always written in UTC, so pinned output is byte-identical on every host and in every time zone. Many build environments already export `SOURCE_DATE_EPOCH`: from v1.7.0 it pins every document's creation date — unset it for the server process if that is not wanted. The pin does not cover `signingTime`, `modDate`, the regenerated second `/ID` of incremental writers, RFC 3161 tokens, revocation data, encryption or ECDSA signatures.

For the shared-server architecture — one HTTP server behind `PDFNATIVE_MCP_PORT` + `PDFNATIVE_MCP_HTTP_TOKEN`, with one file sandbox whose outputs are exposed as MCP resources — see [MCP use cases](use-cases-mcp.html).

> **Network charter** _(v1.6.0)_. The server still makes **no outbound request by default**. The only egress it can ever perform goes to the TSA / OCSP / CRL endpoints the **operator** configures via the variables above — URLs never come from tool arguments, and certificate-supplied OCSP/CRL URLs pass an SSRF guard (allow-list, http(s) only, no credentials, no redirects, internal address literals rejected, size caps, timeouts).

---

## Tool reference

`pdfnative-mcp` exposes **28 tools**:

| Tool | Purpose |
|---|---|
| `generate_basic_pdf` | Multi-page documents from structured blocks — all **13 block kinds** since v1.6.0 (headings, paragraphs, lists, tables, images, links, TOC, barcodes, SVG, form fields, charts, page breaks, spacers). Accepts optional `pdfA`, layout options, build-time `encrypt`, print-production fields, and — _(v1.7.0)_ — `typography` and `pdfx: 'pdfx4'`. |
| `add_table` | Tabular PDF reports from column headers and data rows. Optional `autoFitColumns` and `clipCells`. Accepts `pdfA`, `typography` and `pdfx` _(v1.7.0)_. |
| `add_barcode` | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF. Accepts `pdfA`, `typography` and `pdfx` _(v1.7.0)_. |
| `add_international_text` | The **27 writing systems** of pdfnative 1.8.0 — `lo`, `nod`, `khb`, `tdd`, `cjm` join in _(v1.7.0)_ — plus `latin`, `emoji`, the explicit `math` script (Noto Sans Math, on-demand) and the `latin` aliases `ha`, `yo`, `ig`, `sw` _(v1.7.0)_ — with BiDi & OpenType shaping. `lang` accepts `string`, `string[]`, or comma-separated. Accepts `typography` and `pdfx` _(v1.7.0)_. |
| `add_form` | Interactive AcroForm PDFs with text fields, text areas, checkboxes, radio buttons, dropdowns, and list boxes _(v1.6.0)_. Accepts `pdfA`. Accepts `typography` _(v1.7.0)_. |
| `embed_image` | Embed a JPEG or PNG image (base64-encoded) into a titled PDF document, with `align` and `alt` _(v1.6.0)_. Accepts `pdfA`, `typography` and `pdfx` _(v1.7.0)_. |
| `prepare_signature_placeholder` | Create a PDF with a `/Sig` AcroForm placeholder ready to be signed; `subFilter`, `reserveTimestamp` and frozen signer metadata _(v1.6.0)_. Accepts `pdfA`. Accepts `typography` _(v1.7.0)_. |
| `sign_pdf` | PAdES CMS digital signatures — RSA-SHA256/384/512 and ECDSA-SHA256 P-256, `profile: 'pades'`, RFC 3161 `timestamp` (B-T), certificate chains, named fields and multiple signatures _(v1.6.0)_. |
| `add_ltv` _(v1.6.0)_ | Embed long-term-validation material (`/DSS` + `/VRI`) into a signed PDF — PAdES **B-LT** — online through the operator-configured revocation provider or offline from caller-supplied material. |
| `timestamp_pdf` _(v1.6.0)_ | Append a `/DocTimeStamp` (ETSI.RFC3161) through the operator TSA — PAdES **B-LTA** — with auto-suffixed field names for periodic re-timestamping. |
| `inspect_pdf` | Read-only inspection. Returns `version`, `pageCount`, `encryption`, `pdfA`, `signatureCount`, `info`, optional `perPage`, optional `pageLabels[]`, and — _(v1.6.0)_ — an optional `signatures[]` inventory, `annotations[]`, page boxes + `userUnit`, `dss` / `docTimestampCount` / `trapped`, plus `checks` + `checksPassed`. Since v1.7.0 also `pdfX` (the PDF/X claim) and `check: 'pdfx'`. |
| `inspect_layout` _(v1.6.0)_ | Read-only pagination **dry run** — page count, page geometry and each block's position for a prospective document, with no PDF produced. Accepts `typography` _(v1.7.0)_. |
| `validate_pdf` | Read-only structural validation (`valid`, `errors`, `warnings`): `standard: 'pdf-ua-1'` (default, PDF/UA) or `'pdf-x-4'` _(v1.7.0)_ with `caveats[]`. |
| `verify_pdf` | Real CMS/PKCS#7 signature verification — RSA & ECDSA, message digest, certificate chain. Since v1.6.0, `/DocTimeStamp` entries are verified as RFC 3161 tokens and `ltv: true` reports the achieved PAdES level (B-B → B-LTA). |
| `add_attachment` | Embed files (e.g. Factur-X / ZUGFeRD e-invoice XML) into PDF/A-3b output. Accepts `typography` _(v1.7.0)_. |
| `extract_attachments` | Extract embedded files from an existing PDF (optionally metadata-only). |
| `extract_text` | Extract text content from an existing PDF via the native parser. |
| `merge_pdfs` | Concatenate 2–50 PDFs into one document via the page-tree API (drops signatures/`/AcroForm`, keeps URI links). |
| `split_pdf` | Split one PDF into one document per page range — multi-output `{ mode, count, totalBytes, parts[] }`. In-memory assembly is capped by `maxOutputSizeBytes`, default **256 MiB**; each emitted PDF is separately capped at 50 MiB. |
| `extract_pages` | Pull an arbitrary, order-preserving page subset (max 5000) into a single PDF. |
| `annotate_pdf` | Overlay markup annotations (text / highlight / underline / strikeout / squiggly / square / circle / line / freetext) on an existing PDF via incremental update. A visual review layer, **not** a redaction. |
| `draft_governance_issue` | Assemble a governance-compliant GitHub-issue draft plus a structured `compliance` report **locally** — network-free by construction; never submits. |
| `add_chart` _(v1.5.0)_ | Render a chart as **native PDF vector paths** — nine types since v1.6.0 (`bar`, `barH`, `stackedBar`, `stackedBarH`, `line`, `area`, `scatter`, `pie`, `donut`), with a secondary axis, log and time scales, and data labels. Tagged as `/Figure` with alt text when `pdfA` is set. |
| `read_form_fields` _(v1.5.0)_ | List an existing AcroForm's fields with their types, current values and available options — the read half of the fill round-trip. Accepts `password`. |
| `fill_form` _(v1.5.0)_ | Fill AcroForm field values and optionally `flatten` them into static page content. Works on encrypted PDFs via incremental update. |
| `encrypt_pdf` _(v1.5.0)_ | Re-secure an existing PDF with AES-128 or AES-256 — owner/user passwords and an explicit permission set. |
| `decrypt_pdf` _(v1.5.0)_ | Remove encryption from a password-protected PDF **in-server** — RC4, AES-128 and AES-256 sources. |
| `update_metadata` _(v1.6.0)_ | Rewrite an existing PDF's `/Info` dictionary (+ XMP) — title, author, subject, keywords, pinned `modDate` — as a non-destructive incremental update. |

Every tool publishes an `outputSchema` advertised in `tools/list`. Since v1.6.0 the server speaks the [MCP 2026-07-28 spec](https://modelcontextprotocol.io/specification/2026-07-28) (stateless envelope, `server/discover`, `resultType`, cache hints) on SDK v2, while 2025-era clients (2025-11-25 / 2025-06-18 / 2025-03-26) keep working through the automatic legacy fallback. In v1.7.0 the catalogue grows to about 306 kB (the `typography` fragment and the widened colour schemas are inlined in every tool that carries them), within the server's 320 KiB budget.

> **Still deferred in v1.7.0.** Custom fonts through an operator variable (`PDFNATIVE_MCP_FONT_DIR` — the variable does not exist yet; it needs a font sandbox designed with the same care as the output sandbox), a `link` annotation in `annotate_pdf` (the engine's `MarkupAnnotation` union has no `link` member; the `link` block of `generate_basic_pdf` covers new documents) and `redact_pdf` (overlay ≠ content removal) are on the roadmap, not in this release.

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

**Block types supported:** all **13 engine block kinds** since v1.6.0 — `heading` (levels 1–3), `paragraph`, `list` (`bullet` / `numbered`, nested items to depth 6), `table`, `image`, `link` (`http:` / `https:` / `mailto:` only), `toc` (a contents page with internal `/GoTo` links, pairs with `outline: 'auto'`), `barcode`, `svg` (a safe subset: paths, shapes and text — no XML parser, no external reference ever fetched), `formField`, `chart` (same body as `add_chart`), `pageBreak`, and `spacer` (`height` in points). The `table` / `image` / `barcode` / `formField` blocks share their body with the dedicated tools, so a standalone artefact and an inline block validate and render identically.

**Layout options** _(v1.6.0)_, available on all nine document tools: `pageSize` (`A4` default, `Letter`, `Legal`, `A3`, `Tabloid`), `margins` (all four sides, 0–200 pt), running `headerTemplate` / `footerTemplate` (`left` / `center` / `right` zones with `{page}` `{pages}` `{title}` `{date}` placeholders — a `footerTemplate` replaces the default footer, so `footerText` is then ignored), `compress`, and `debug`.

**Build-time `encrypt`** _(v1.6.0)_, on `generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode` and `add_chart`: AES-128 (default) or AES-256 with owner/user passwords and permissions — and unlike `encrypt_pdf`, it **keeps the AcroForm**, making encrypted fillable forms reachable. Exclusive with `pdfA` (ISO 19005-1 §6.3.2); never cached.

**Print production** _(v1.6.0)_, on the nine document tools: `print` (TrimBox / BleedBox / ArtBox / CropBox, a `bleed` shorthand, crop + registration `marks`, `/UserUnit`), `metadata` (`/Author`, `/Subject`, `/Keywords`, `/Trapped` with XMP parity), and `outputIntent` (custom RGB ICC profile; CMYK and Gray profiles since v1.7.0). `viewerPreferences` gains `duplex`, `pickTrayByPDFSize`, `printPageRange` (1-based), `numCopies`. Boxes survive `merge_pdfs` / `split_pdf` / `extract_pages` and are reported by `inspect_pdf`. Since v1.7.0 `print.marks` also takes the object form `{ colourBars: true | { tints, size } }` (`size` 4–72 pt): a C M Y K control strip with 50 % tints in the bleed — off by default, needs a bleed of about 5 mm (14.17 pt), skipped when the strip would not fit.

**Honest PDF/A** _(v1.6.0)_: text rendered through the viewer's base-14 Helvetica is not embedded, so a PDF/A claim on such a file is rejected by veraPDF. `embedFonts: true` embeds Noto Sans Latin for a valid claim; `strict: true` fails instead of producing a non-conformant file; `includeDiagnostics: true` echoes the engine's diagnostics (`PDFA_NO_FONT_ENTRIES`, `PDFA_UNEMBEDDED_FORM_FONT`, `PDFA_DEVICE_CMYK_IMAGE`).

**Reproducible output** _(v1.6.0)_: `creationDate` (ISO-8601) on all nine document tools pins `/Info /CreationDate`, the XMP dates and therefore the trailer `/ID` — byte-identical output on any host since the engine writes dates in UTC (pdfnative 1.8.0; on 1.7.0 the host time zone had to match). Since v1.7.0 a `{date}` placeholder in a header / footer follows the pinned instant, and the operator can pin the whole process with `PDFNATIVE_MCP_CREATION_DATE` or `SOURCE_DATE_EPOCH` (see *Environment variables*; a call's own `creationDate` still wins).

**Typography** _(v1.7.0)_: `typography` is one opt-in object — **12 keys, all off by default**; omitted means unchanged bytes — on the nine document tools (`generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_form`, `add_international_text`, `add_attachment`, `prepare_signature_placeholder`) and on `inspect_layout`:

```jsonc
{
  "title": "Annual report",
  "embedFonts": true,
  "typography": {
    "splitParagraphs": true, "orphans": 3, "widows": 3,
    "keepHeadingsWithNext": { "minLines": 3 },
    "opticalMargins": true, "kerning": true, "fontFeatures": ["onum", "smcp"],
    "unitBinding": true, "bindShortWords": true, "punctuationSpacing": "fr"
  },
  "blocks": [
    { "type": "heading", "text": "Outlook", "level": 2, "keepWithNext": true },
    { "type": "paragraph", "text": "A long justified paragraph…", "align": "justify" },
    { "type": "paragraph", "text": "Figures by region:", "keepWithNext": true, "splittable": false }
  ]
}
```

- Keys: `splitParagraphs`, `orphans` / `widows` (1–10, default 2, need `splitParagraphs`), `keepHeadingsWithNext` (`true` or `{ minLines }`), `unitBinding` (`true` or `{ units }`), `bindShortWords` (`true` or `{ maxLength, words }`), `punctuationSpacing` (`'fr'`, `'fr-CA'` or an array of `{ char, side, space }` rules), `opticalMargins`, `metrics` (`'approximate'` default / `'exact'`), `fontFeatures` (`tnum`, `pnum`, `lnum`, `onum`, `zero`, `ordn`, `sups`, `subs`, `smcp`, `c2sc`, `case`), `kerning`, `hyphenationLanguage`.
- Block inputs: a `paragraph` takes `align` (`left` default / `right` / `center` / `justify`), `keepWithNext` and `splittable` (overrides `typography.splitParagraphs` for that block); a `heading` takes `keepWithNext` (overrides `typography.keepHeadingsWithNext` for that block).
- Limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need an embedded font (`embedFonts: true`; on base-14 Helvetica `'fr'` degrades to `'fr-CA'`); `metrics: 'exact'` acts on base-14 text only; `tnum` / `lnum` change nothing on the bundled Noto Sans (diagnostic `TYPOGRAPHY_FEATURE_INEFFECTIVE`); **no hyphenation dictionary is installed**, so `hyphenationLanguage` has no effect on this server — soft hyphens (U+00AD) in the text are honoured. The server's `typography` prompt and its [TYPOGRAPHY guide](https://github.com/Nizoka/pdfnative-mcp/blob/main/docs/guides/TYPOGRAPHY.md) carry the long form; the engine side is the [Typography guide](typography.html).

**CMYK colours** _(v1.7.0)_: every colour input keeps the form it has always accepted (hex on charts, templates, `link` and `svg` blocks; a 0–1 RGB triple on watermarks and `annotate_pdf`; a free string on outline entries and table cell borders) and gains DeviceCMYK beside it — an operand string `'c m y k'` with components 0–1 (`'0 0.6 1 0'`) and a percent tuple `[c, m, y, k]` with components 0–100 (`[0, 60, 100, 0]`). Under a PDF/A claim against the default sRGB intent a CMYK colour reports `PDFA_DEVICE_CMYK_CONTENT` — keep colours RGB there, or supply a CMYK `outputIntent`.

**PDF/X-4** _(v1.7.0)_: `pdfx: 'pdfx4'` on `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image` and `add_international_text` writes a PDF/X-4 (ISO 15930-7) file — `%PDF-1.6` header, the PDF/X-4 XMP identification, a `/GTS_PDFX` output intent, a TrimBox on every page and `/Trapped`.

```jsonc
{
  "title": "Spring catalogue",
  "pdfx": "pdfx4",
  "embedFonts": true,
  "outputIntent": { "iccProfileBase64": "<the printer's CMYK ICC profile, base64>", "outputConditionIdentifier": "FOGRA39" },
  "metadata": { "trapped": "False" },
  "print": { "bleed": 14.17, "marks": { "colourBars": true } },
  "blocks": [{ "type": "paragraph", "text": "Four-colour job exchanged as PDF/X-4." }]
}
```

It **requires** `outputIntent` with the ICC profile of the printing condition (device class `prtr`, CMYK or Gray — no press profile is bundled) and needs `embedFonts: true` for a conformant file (`PDFX_NO_FONT_ENTRIES` otherwise; `strict: true` refuses with `PDF_X_COMPLIANCE_VIOLATION`); it is exclusive with `pdfA` and `encrypt`; `metadata.trapped` must not be `'Unknown'` (omitted = `'False'`); a page carries a TrimBox or an ArtBox, not both. Incoherent requests are refused with `VALIDATION_ERROR` before any work is done. The profile must be a real ICC file (`acsp` signature, consistent size field) — a hand-made stub is rejected with `PRINT_ERROR`. Check the result with `validate_pdf { standard: 'pdf-x-4' }` — a structural check, **not a certified preflight**; the `print_ready` prompt walks through the recipe.

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

**Supported `lang` codes:** `ar` (Arabic), `he` (Hebrew), `th` (Thai), `ja` (Japanese), `zh` (Chinese Simplified), `ko` (Korean), `el` (Greek), `hi` (Devanagari/Hindi), `bn` (Bengali), `ta` (Tamil), `te` (Telugu), `si` (Sinhala), `bo` (Tibetan), `km` (Khmer), `my` (Myanmar), `am` (Ethiopic), `ru` (Cyrillic/Russian), `ka` (Georgian), `hy` (Armenian), `tr` (Turkish), `vi` (Vietnamese), `pl` (Polish), and — _(v1.7.0)_ — `lo` (Lao), `nod` (Tai Tham), `khb` (New Tai Lue), `tdd` (Tai Le), `cjm` (Cham): the **27 scripts** of pdfnative 1.8.0. Plus **`latin`** (Noto Sans VF), **`emoji`** (Noto Emoji/COLRv1) and the explicit **`math`** symbols font *(v1.4.0)*. Since v1.7.0, `ha` (Hausa), `yo` (Yoruba), `ig` (Igbo) and `sw` (Swahili) are aliases of `latin`: the bundled Noto Sans anchors their tone marks, no extra font is embedded.

`lang` accepts `string`, `string[]`, or a comma-separated value — e.g. `"ar,emoji"` or `["ar", "emoji"]`. When `pdfA` is set on this tool, the `latin` font is auto-registered so curly quotes, em-dashes, and ellipses validate cleanly under PDF/A. The tool also accepts `typography` and `pdfx` _(v1.7.0)_ — see [`generate_basic_pdf`](#generate_basic_pdf).

> **Tai Tham under PDF/A** _(v1.7.0)_: use `pdfA: 'pdfa2b'` with `lang: 'nod'`, not `pdfa2u` — one glyph lacks a `ToUnicode` entry in the engine, which veraPDF rejects under PDF/A-2u (tracked upstream).

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

**Field types:** `text`, `textarea`, `checkbox`, `radio`, `dropdown`, and `listbox` _(v1.6.0)_. Text fields accept an optional `placeholder` _(v1.6.0)_. Since v1.6.0, `textarea` maps to the engine's true multi-line field (`/Ff 4096`) — in v1.5.0 it rendered as a single-line widget.

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

Since v1.6.0 the tool also accepts `align` (horizontal placement) and `alt` (accessibility text written as `/Figure /Alt` in tagged output).

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

Since v1.6.0 the placeholder also takes `subFilter`, `reserveTimestamp` (extra `/Contents` room for a later RFC 3161 token), `placeholderBytes`, and `signingTime` — and the signer metadata (`signerName`, `reason`, `location`, `contactInfo`, `signingTime`) is **baked into the `/Sig` dictionary at placeholder time**, fixing a pre-1.7 engine bug where those values never reached the signed document.

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

**PAdES and timestamps** _(v1.6.0)_:

- `algorithm` also accepts `rsa-sha384` and `rsa-sha512`.
- `profile: 'pades'` produces an ETSI.CAdES.detached signature (PAdES **B-B**).
- `timestamp: true` requests an RFC 3161 timestamp from the operator-configured TSA (`PDFNATIVE_MCP_TSA_URL`) and embeds it in the CMS — PAdES **B-T**. Fails with `TSA_NOT_CONFIGURED` when no TSA is set, `TSA_REJECTED` when the authority declines.
- `certChainDerBase64` embeds intermediate certificates alongside the signer certificate.
- `fieldName` targets a specific `/Sig` field (`SIGNATURE_FIELD_NOT_FOUND` when absent, `PLACEHOLDER_AMBIGUOUS` when several placeholders exist and none is named); `allowMultiple: true` adds a signature next to existing ones instead of rejecting.
- The default placeholder reservation is now `max(16384, estimated CMS size)` — plus 8192 bytes when `timestamp: true` — instead of a flat 16384 bytes. To pin it exactly, build the placeholder with `prepare_signature_placeholder` and its `placeholderBytes` input.

To climb the rest of the PAdES ladder, follow with [`add_ltv`](#add_ltv-v160) (B-LT) and [`timestamp_pdf`](#timestamp_pdf-v160) (B-LTA), then check the achieved level with `verify_pdf ltv: true`. The server's `pades_ladder` prompt walks through the full recipe.

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
- `pages` — when `true`, includes per-page `index`, `width`, `height` — and, since v1.6.0, the declared page boxes and `userUnit`.
- `signatures` *(v1.6.0)* — when `true`, a per-signature inventory: `subFilter`, `isDocTimestamp`, `isPlaceholder`, `byteRange`, `vriKey`.
- `annotations` *(v1.6.0)* — when `true`, an `annotations[]` list (0-based `page`, `subtype`, `rect`, and when present `contents`, `title`, `color`, `quadPoints`, link `url`) plus `annotationCount`.
- `check` — array of CI assertions. Allowed values: `pdfa`, `signed`, `encrypted`, `placeholder`, `attachments`, — *(v1.6.0)* — `dss`, `docTimestamp`, `trapped`, `annotations`, and — *(v1.7.0)* — `pdfx` (the XMP claims PDF/X — the claim, not its validity; that is `validate_pdf standard: 'pdf-x-4'`). The response includes `checks` (per-assertion result) and `checksPassed` (boolean AND). Since v1.6.0, `checks` contains **only the requested keys**.
- `verbosity` — `'full'` (default) or `'summary'` (token-frugal scalar subset).
- `fields` — optional dot-path projection of the result.

**Outputs:** `version`, `pageCount`, `encryption` (`'none'` / `'aes-128'` / `'aes-256'` / `'rc4'` / `'unknown'`), optional `encryptionInfo` (`{ algorithm, revision, authenticatedAs }`, present when the document is encrypted and opened successfully), `pdfA` (`null` or the detected claim string), `signatureCount`, `hasSignaturePlaceholder`, `attachments[]` (embedded-file summaries), `info` (decoded `/Info` entries), optional `perPage[]`, optional `pageLabels[]` (when `/PageLabels` is declared), optional `checks` + `checksPassed` — plus, presence-gated since v1.6.0, `dss`, `docTimestampCount` and `trapped`, and — *(v1.7.0)* — `pdfX`, present only when the XMP claims PDF/X (kept by `verbosity: 'summary'`).

Useful in CI as a final assertion step before publishing a PDF artifact:

```jsonc
{ "tool": "inspect_pdf",
  "input": { "pdfBase64": "<...>", "check": ["pdfa", "signed"] } }
// → { ..., "checks": { "pdfa": true, "signed": true }, "checksPassed": true }
```

---

### `validate_pdf`

Read-only structural conformance check. `standard` picks the rule set: `'pdf-ua-1'` (default — PDF/UA, ISO 14289-1, for a Tagged PDF) or, since v1.7.0, `'pdf-x-4'` (PDF/X-4, ISO 15930-7).

```jsonc
{ "pdfBase64": "<base64 PDF bytes>", "standard": "pdf-x-4" }
// → { "standard": "pdf-x-4", "valid": true, "errors": [], "warnings": [], "summary": "…", "caveats": ["…"] }
```

The default rule set verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. `'pdf-x-4'` _(v1.7.0)_ checks the structural prerequisites of ISO 15930-7: PDF 1.6 header, no encryption, trailer `/ID`, the PDF/X-4 XMP identification, a `/GTS_PDFX` output intent with an embedded `prtr` ICC profile, a TrimBox or ArtBox per page nested in the BleedBox and MediaBox, every font embedded, no annotation on the printed area, no JavaScript, no embedded file, device colour consistent with the output intent. The PDF/X result has the same shape plus `caveats[]`, which states what a `valid: true` verdict does **not** establish: this is **not a certified preflight**, and veraPDF does not cover PDF/X — confirm a press job with a dedicated preflight tool. The default (`pdf-ua-1`) response is byte-identical to v1.6.0 and carries no `caveats`. Unparsable bytes are an error (`PDF_PARSE_FAILED`), not a verdict.

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

Types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Each takes a **0-based** `page`, a `rect: [x1, y1, x2, y2]`, and optional `color` / `contents`. `color` / `interiorColor` take a hex or operand string (including a CMYK operand string), a 0–1 RGB triple (`[1, 1, 0]`) or, since v1.7.0, a CMYK percent tuple (`[0, 0, 100, 0]`); v1.7.0 also fixes the 0–1 triple, which used to render almost black. Encrypted sources → `ENCRYPTED_SOURCE`; an out-of-range `page` → a validation error.

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

Renders a chart as **native PDF vector paths** — no rasterisation, no image round-trip. Multi-series bar/line, legends, gridlines and negative values are supported; the chart is tagged `/Figure` with `/Alt` (auto-generated when `altText` is omitted).

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

**Inputs:** `chartType` (`bar` / `barH` / `line` / `pie` / `donut`, plus — _(v1.6.0)_ — `stackedBar` / `stackedBarH` / `area` / `scatter`) and `series` (required; pie/donut take exactly one series), plus `title`, `legend` (`'bottom'` / `'none'`), `markers` (line series), `colors` (hex palette override), `altText`, `intro` (paragraph above the chart), `pdfA`, `outputMode` / `outputPath`. For a chart amongst headings/paragraphs/tables, use a `chart` block inside `generate_basic_pdf` — both build identical pdfnative blocks.

**Charts v2** _(v1.6.0)_: per-series `xValues` with `xAxis.type: 'linear' | 'time'` (UTC-deterministic time axes), a secondary right axis (`axis2`), `axis.scale: 'log'`, `dataLabels`, and `labelStride` / `labelRotation` for crowded x labels. Engine cross-field rules surface as `CHART_ERROR` with a remedy.

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

### `add_ltv` _(v1.6.0)_

Embeds long-term-validation material — a `/DSS` (Document Security Store) with `/VRI` entries — into an already-signed PDF via incremental update, taking a PAdES B-T document to **B-LT**.

```jsonc
{
  "pdfBase64": "<base64 signed PDF>",
  "mode": "online",
  "preferOcsp": true,
  "outputMode": "base64"
}
```

**Inputs:** `pdfBase64` (required), `mode` (`'online'` default — fetches OCSP responses / CRLs through the operator-configured revocation provider; `'offline'` — embeds parse-validated caller-supplied material), `preferOcsp`, `certificatesDerBase64[]` / `ocspResponsesDerBase64[]` / `crlsDerBase64[]` (offline material), `outputMode` / `outputPath`. The structured result includes a `summary` of what was embedded.

**Errors:** `LTV_NO_SIGNATURE` (nothing to validate), `LTV_EMPTY` (no material gathered), `LTV_MATERIAL_INVALID`, `LTV_ERROR`, `REVOCATION_NOT_CONFIGURED` (online mode without `PDFNATIVE_MCP_REVOCATION`), `NETWORK_HOST_NOT_ALLOWED`, `NETWORK_ERROR`, `ENCRYPTED_SOURCE` (decrypting would destroy the signatures — sign before encrypting).

> Online mode is the **only** network-touching path in the server besides the TSA, and it only ever contacts operator-allow-listed hosts. See *Environment variables* above.

### `timestamp_pdf` _(v1.6.0)_

Appends a `/DocTimeStamp` signature field (ETSI.RFC3161) through the operator-configured TSA, taking a B-LT document to **B-LTA**. The token's status, message imprint and nonce are checked before embedding; its own CMS signature is verified by `verify_pdf`.

```jsonc
{
  "pdfBase64": "<base64 signed PDF>",
  "outputMode": "base64"
}
```

**Inputs:** `pdfBase64` (required), `fieldName` (auto-suffixed `DocTimeStamp1`, `DocTimeStamp2`, … when omitted — supporting periodic re-timestamping), `placeholderBytes` (4096–65536), `outputMode` / `outputPath`.

**Errors:** `TSA_NOT_CONFIGURED`, `TSA_REJECTED`, `NETWORK_ERROR`, `ENCRYPTED_SOURCE`.

### `update_metadata` _(v1.6.0)_

Rewrites an existing PDF's `/Info` dictionary — and its XMP packet when present — via a non-destructive **incremental update**, so earlier revisions stay a byte-exact prefix.

```jsonc
{
  "pdfBase64": "<base64 PDF bytes>",
  "title": "Quarterly Report — Final",
  "author": "Finance Team",
  "keywords": "finance, Q1, 2026",
  "modDate": "2026-08-25T09:00:00+02:00",
  "outputMode": "base64"
}
```

**Inputs:** `pdfBase64` (required), `title`, `author`, `subject`, `keywords` (≤ 1000 characters), `modDate` (ISO-8601 with offset — pinned for reproducible bytes), `outputMode` / `outputPath`.

**Errors:** `ENCRYPTED_SOURCE` (use `decrypt_pdf` → `update_metadata` → `encrypt_pdf`), `METADATA_ERROR`, `PDF_PARSE_FAILED`.

### `inspect_layout` _(v1.6.0)_

A read-only pagination **dry run**: measures how a prospective document would paginate — without producing a PDF and without consuming output tokens on base64 bytes. The seventh read tool with `verbosity` / `fields`.

```jsonc
{
  "title": "Q1 2026 Report",
  "blocks": [
    { "type": "heading", "text": "Executive Summary", "level": 1 },
    { "type": "paragraph", "text": "Revenue grew 24 % year over year." }
  ],
  "verbosity": "summary"
}
// → { "pageWidth": 595.28, "pageHeight": 841.89, "totalPages": 1, "blockCount": 2 }
```

**Inputs:** `title` and `blocks` (required), plus every input that moves a block — `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, and since v1.7.0 `typography` (with the block-level `align`, `keepWithNext` and `splittable`) — and `verbosity` / `fields`. Pass exactly what you will give `generate_basic_pdf` and `totalPages` matches.

**Outputs (full):** `pageWidth`, `pageHeight`, `margins`, `totalPages`, and `pages[].blocks[]` with each block's `type`, `page`, `x`, `top`, `width`, `height` (2-decimal points).

> **Engine gap closed in v1.7.0:** in v1.6.0 a `toc` block was measured as 0 pt, so a document with a printed contents page could paginate one page later than previewed. Since pdfnative 1.8.0 the dry run and the build share one pagination planner (pdfnative #75), so every block kind — `toc` included — is measured exactly as it is laid out.

---

## MCP prompts

Since v1.4.0 the server advertises the MCP **`prompts`** capability; v1.6.0 grew it to six and v1.7.0 grows it to **seven prompts** — the two governance prompts plus five recipe prompts:

| Prompt | Purpose |
|---|---|
| `governance_contract` | The full AI-governance / Human-in-the-Loop contract. |
| `draft_issue_workflow` | The step-by-step recipe for producing a compliant issue draft with `draft_governance_issue`. |
| `pades_ladder` _(v1.6.0)_ | The B-B → B-T → B-LT → B-LTA recipe: `sign_pdf` → `add_ltv` → `timestamp_pdf`, verified with `verify_pdf ltv: true`. |
| `print_ready` _(v1.6.0)_ | Producing press-ready output: bleed, printer's marks and colour bars, `/UserUnit`, metadata, CMYK colours, an RGB / CMYK / Gray OutputIntent and PDF/X-4 — with what `validate_pdf` can and cannot establish. |
| `reproducible_output` _(v1.6.0)_ | Byte-stable output via pinned `creationDate` / `signingTime` / `modDate`, what stays non-deterministic, and how to prove it. |
| `typography` _(v1.7.0)_ | Book-quality text: paragraph breaking with widows and orphans, keeping headings with their text, justification with optical margins, unit and short-word binding, French punctuation spacing, kerning and OpenType features — with what needs an embedded font and what is not available (no hyphenation dictionary). |
| `pdfa_valid` _(v1.6.0)_ | Producing a PDF/A file that veraPDF actually accepts (`embedFonts`, `strict`, diagnostics, level choice, attachments under PDF/A-3). |

In v1.7.0, `print_ready`, `reproducible_output` and `pdfa_valid` were rewritten for CMYK, PDF/X-4, colour bars and the UTC / operator pin.

## Error codes

| `code` | Raised by | Meaning / fix |
|---|---|---|
| `ENCRYPTED_SOURCE` | `annotate_pdf`, `update_metadata`, `add_ltv`, `timestamp_pdf` | The source PDF is encrypted and the tool has no `password` parameter. Remedies are tool-specific since v1.6.0: for `annotate_pdf` / `update_metadata`, `decrypt_pdf` → edit → `encrypt_pdf`; for `add_ltv` / `timestamp_pdf`, decrypting would destroy the signatures — sign before encrypting. |
| `PASSWORD_REQUIRED` *(v1.5.0)* | password-aware tools (`inspect_pdf`, `verify_pdf`, `extract_text`, `extract_attachments`, `read_form_fields`, `fill_form`, page-tree trio, `encrypt_pdf`, `decrypt_pdf`) | The source is encrypted and no `password` was supplied. |
| `PASSWORD_INVALID` *(v1.5.0)* | password-aware tools | The supplied `password` does not open the document. |
| `ENCRYPTION_UNSUPPORTED` *(v1.5.0)* | password-aware tools | The document uses an encryption scheme the reader does not support. |
| `FORM_FIELD_NOT_FOUND` *(v1.5.0)* | `fill_form` | A `values` key matches no field (with `onUnknownField: 'throw'`, the default). |
| `FORM_VALUE_TYPE_ERROR` *(v1.5.0)* | `fill_form` | A value's type does not match the field (e.g. a boolean for a text field). |
| `FORM_UNSUPPORTED` *(v1.5.0)* | `fill_form` | The field cannot be filled/flattened (e.g. a signature field). |
| `OUTPUT_TOO_LARGE` | PDF-emitting tools | An emitted PDF exceeds 50 MiB (for `split_pdf`, also the 200 MiB aggregate), or assembly exceeds `maxOutputSizeBytes` (default 256 MiB). |
| `PDF_PARSE_FAILED` | page-tree tools | The source bytes are not a parseable PDF. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` | The draft breaks the AI-governance contract (proposes a runtime dependency, omits a reproduction, or `duplicateSearchPerformed: false`). Fix the draft and retry. |
| `TSA_NOT_CONFIGURED` *(v1.6.0)* | `sign_pdf` (`timestamp: true`), `timestamp_pdf` | No `PDFNATIVE_MCP_TSA_URL` is set. Configure the TSA in the server environment. |
| `TSA_REJECTED` *(v1.6.0)* | `sign_pdf`, `timestamp_pdf` | The timestamp authority declined the request. |
| `REVOCATION_NOT_CONFIGURED` *(v1.6.0)* | `add_ltv` (`mode: 'online'`) | No `PDFNATIVE_MCP_REVOCATION` sources are set. Configure them, or use `mode: 'offline'` with caller-supplied material. |
| `NETWORK_HOST_NOT_ALLOWED` *(v1.6.0)* | `add_ltv` | A certificate-supplied OCSP/CRL URL points outside `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`. |
| `NETWORK_ERROR` *(v1.6.0)* | TSA/LTV tools | The TSA/OCSP/CRL request failed (timeout, refusal, size cap). |
| `LTV_NO_SIGNATURE` / `LTV_EMPTY` / `LTV_MATERIAL_INVALID` / `LTV_ERROR` *(v1.6.0)* | `add_ltv` | No signature to validate / no material gathered / supplied DER material does not parse / embedding failed. |
| `METADATA_ERROR` *(v1.6.0)* | `update_metadata` | The incremental `/Info` + XMP rewrite failed. |
| `PRINT_ERROR` *(v1.6.0)* | document tools with `print` | The requested page boxes are inconsistent (e.g. do not fit `pageSize`). |
| `CHART_ERROR` *(v1.6.0)* | `add_chart`, `chart` blocks | An engine cross-field chart rule failed (the message carries the remedy). |
| `PLACEHOLDER_AMBIGUOUS` *(v1.6.0)* | `sign_pdf` | Several unsigned placeholders exist and no `fieldName` was given. |
| `SIGNATURE_FIELD_NOT_FOUND` *(v1.6.0)* | `sign_pdf` | The named `fieldName` does not exist. |
| `CMS_PARSE_FAILED` *(v1.6.0)* | `verify_pdf` | A CMS structure is shorter or more malformed than the parser expects. |
| `PDF_X_COMPLIANCE_VIOLATION` *(v1.7.0)* | document tools with `pdfx: 'pdfx4'` and `strict: true` | The engine raised a `PDFX_*` diagnostic (`PDFX_NO_FONT_ENTRIES` — text not embedded; `PDFX_DEVICE_CMYK` — CMYK content under a non-CMYK printing condition; `PDFX_ANNOTATIONS` — a `link` or `formField` block on a print page). Add `embedFonts: true`, match the colours to the `outputIntent`, remove the offending blocks; `includeDiagnostics: true` echoes the codes without failing. |
| `DIAGNOSTIC_ESCALATED` *(v1.7.0)* | document tools with `strict: true` | The engine raised a diagnostic that is neither `PDFA_*` nor `PDFX_*` — today `TYPOGRAPHY_FEATURE_INEFFECTIVE` (`typography.fontFeatures` `tnum` / `lnum` on Noto Sans, or a feature without an embedded font). The message starts with `[CODE]`: drop the ineffective feature, add `embedFonts: true`, or drop `strict` and read the diagnostic with `includeDiagnostics: true`. |

> **`strict` escalates by code** *(v1.7.0)*: `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`. The two new codes can only be returned by a call that sets `strict: true`; a client that matched `PDF_A_COMPLIANCE_VIOLATION` for *every* strict failure should match the three. Since v1.7.0 any unexpected failure of a tool that takes PDF input is classified as `PDF_PARSE_FAILED` at the `tools/call` boundary instead of surfacing uncoded.

> **Protocol errors** *(v1.6.0)*: calling an unknown tool or prompt name is now a JSON-RPC `-32602` error (`[UNKNOWN_TOOL]` / `[UNKNOWN_PROMPT]`), not an `isError` result. Likewise, an unknown or misspelt input key — top-level or nested — fails with `VALIDATION_ERROR` ("Unrecognized key") instead of being silently stripped.

---

## The `pdfA` flag

Every document tool (`generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `prepare_signature_placeholder`, `add_international_text`, `add_chart` *(v1.5.0)*) accepts an optional `pdfA` field. `add_attachment` is the special case: it always produces **PDF/A-3b** (the only conformance level that allows arbitrary embedded files), so it has no `pdfA` input.

| `pdfA` value | PDF version | Notes |
|---|---|---|
| `"pdfa1b"` | 1.4 | Most conservative — no transparency, no AES |
| `"pdfa2b"` | 1.7 | Default archive target |
| `"pdfa2u"` | 1.7 | 2b + Unicode mapping for every glyph |
| `"pdfa3b"` | 1.7 | 2b + arbitrary `/EmbeddedFile` attachments |

When set on `add_international_text`, the `latin` font auto-registers so non-WinAnsi Latin characters validate cleanly. Mutually exclusive with the underlying pdfnative encryption layer (ISO 19005-1 §6.3.2) and, since v1.7.0, with `pdfx: 'pdfx4'` — a document claims PDF/A or PDF/X-4, not both.

---

## Output modes

Every document-producing tool accepts an `outputMode` field. The seven read-only
tools (`inspect_pdf`, `inspect_layout`, `validate_pdf`, `verify_pdf`, `extract_text`,
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
    "creationDate": "2026-04-26T09:00:00Z",          // pins /CreationDate, XMP dates and the trailer /ID
    "typography":   { "keepHeadingsWithNext": true }, // v1.7.0 — opt-in, off by default
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

- **No network access by default** — the server opens no outbound connection unless the **operator** configures TSA/OCSP/CRL endpoints for the PAdES tools (see the network charter under *Environment variables*). URLs never come from tool arguments, and certificate-supplied OCSP/CRL URLs pass an SSRF guard.
- **Sandboxed file writes** — `file` output mode is gated by `PDFNATIVE_MCP_OUTPUT_DIR`. When unset, file writes are rejected with a `SecurityError`.
- **Path traversal protection** — absolute paths, `..` sequences, NUL bytes, and non-`.pdf` extensions are all rejected.
- **Output size cap** — PDF output is capped at **50 MiB** per call. `split_pdf` additionally enforces **50 MiB per part** and a **200 MiB aggregate** ceiling across its parts, returning `OUTPUT_TOO_LARGE` when exceeded.
- **HTTP transport hardening** — when bound to `PDFNATIVE_MCP_PORT`, the HTTP transport is loopback-only and rejects foreign `Host` / `Origin` headers with **403** (DNS-rebinding protection). An opt-in bearer token (`PDFNATIVE_MCP_HTTP_TOKEN`) adds authentication _(v1.6.0)_ — without it, the loopback endpoint has none.
- **Input validation** — every tool validates inputs against strict JSON Schemas and Zod runtime checks at the boundary. Since v1.6.0 every schema is `.strict()` at every nesting level, so an unknown or misspelt key is a `VALIDATION_ERROR` instead of being silently stripped, and PEM armour where DER base64 is expected fails with the exact `openssl … -outform DER` remedy.
- **Decompression cap** — the engine's 100 MiB per-stream inflate cap is operator-tunable via `PDFNATIVE_MCP_MAX_INFLATE_BYTES` _(v1.6.0)_.

See [SECURITY.md](https://github.com/Nizoka/pdfnative-mcp/blob/main/SECURITY.md) for responsible disclosure.

---

## Fonts come from the local `pdfnative` install

`pdfnative-mcp` bundles **no font data of its own**: at runtime it resolves the
locally installed `pdfnative` package and lazily imports the Noto font modules
from that package's `fonts/` directory, embedding a font only when a request
actually uses it. Two practical consequences:

- **Upgrading the local `pdfnative` upgrades the server's font coverage** —
  nothing to configure, nothing re-downloaded.
- **The local install is an extension point for agents.** A coding agent on the
  host can compile a font with `compileFontData` (`pdfnative/tools`) into the
  resolved local install and the next tool call serves it — the pattern that
  closed the mathematical-symbols gap locally before Noto Sans Math shipped in
  the engine. The published `lang` enum is closed and there is no operator-level
  fonts variable yet (a roadmap candidate), so this is a local code-level
  pattern — see [Agentic workflows → Via the MCP server](agentic-workflows.html#via-the-mcp-server--the-local-install-is-the-extension-point)
  for the honest, step-by-step version.

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

The current release is **v1.7.0** (28 tools, requires pdfnative ≥ 1.8.0 — see the header note). Per-release notes, oldest first:

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

v1.5.0 upgrades the engine to **pdfnative 1.6.0** and takes the catalogue to **24 tools** at that release,<!-- verify-docs:allow stale-token (historical: v1.5.0 total) --> closing the read/modify loop on documents the assistant did not create.

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

### What's new in v1.6.0

v1.6.0 aligns the server with the **MCP 2026-07-28** specification and grows the catalogue to **28 tools**, exposing the engine's full document model and completing the PAdES baseline ladder. No breaking changes: every v1.5.0 call keeps its inputs, error codes and response shape, and a superset gate against the published 1.5.0 catalogue proves it.

- **Four new tools:**
  - `add_ltv` — embed `/DSS` + `/VRI` long-term-validation material (PAdES **B-LT**), online through the operator-configured revocation provider or offline from caller-supplied material.
  - `timestamp_pdf` — append a `/DocTimeStamp` through the operator TSA (PAdES **B-LTA**), with auto-suffixed field names for periodic re-timestamping.
  - `update_metadata` — rewrite `/Info` (+ XMP) of an existing PDF as an incremental update.
  - `inspect_layout` — a read-only pagination dry run: page count and block positions with no PDF produced.
- **Full engine coverage** — `generate_basic_pdf` composes all **13 block kinds** (`table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField` join the six existing ones); `pageSize`, `margins`, running `headerTemplate` / `footerTemplate`, `compress` and `debug` on the nine document tools; build-time `encrypt` that **keeps the AcroForm**; image watermarks with `position`.
- **PAdES signing** — `sign_pdf` gains `profile: 'pades'`, `timestamp: true` (RFC 3161, B-T), RSA-SHA384/512, `certChainDerBase64`, `fieldName` / `allowMultiple`; `verify_pdf ltv: true` reports profile, timestamp, embedded revocation status and the achieved level; `prepare_signature_placeholder` gains `subFilter` / `reserveTimestamp` and freezes signer metadata into the `/Sig` dictionary (fixing a pre-1.7 engine bug where those values were silently dropped).
- **Network charter** — still **no outbound request by default**; the single permitted egress class is the operator-configured TSA / OCSP / CRL endpoints, never a URL from a tool argument, behind an SSRF guard. Seven new environment variables configure the HTTP bearer token, the inflate cap and the network providers.
- **Print production** — `print` page boxes, `bleed`, printer's `marks`, `/UserUnit`, `metadata` with `/Trapped`, custom `outputIntent`; boxes survive the page-tree tools and are reported by `inspect_pdf`.
- **Charts v2** — `stackedBar` / `stackedBarH` / `area` / `scatter`, per-series `xValues` with linear or time axes, secondary `axis2`, `axis.scale: 'log'`, `dataLabels`, `labelStride` / `labelRotation`.
- **Honest PDF/A** — `embedFonts: true` (embed Noto Sans Latin for a claim veraPDF accepts), `strict: true` (fail instead of emitting a non-conformant file), `includeDiagnostics: true`; two new diagnostics; an advisory veraPDF corpus runs locally and in CI.
- **MCP 2026-07-28 transport** — SDK v2 (`@modelcontextprotocol/server`), `server/discover`, `resultType`, cache hints, per-result `serverInfo`, deterministic `tools/list`; 2025-era clients keep working via the automatic legacy fallback.
- **Four new recipe prompts** — `pades_ladder`, `print_ready`, `reproducible_output`, `pdfa_valid` — taking the prompt catalogue to six.
- **Reproducible output** — `creationDate` on all nine document tools, `signingTime` on the placeholder, `modDate` on `update_metadata`.

**Migrating from v1.5.0** — six behaviour changes, all on error paths or on inputs the published schema already declared invalid:

1. **Stray keys fail.** An unknown or misspelt key, top-level or nested, is now `VALIDATION_ERROR` ("Unrecognized key") instead of being silently stripped — the schemas always declared `additionalProperties: false`.
2. **Page-index mistakes are `VALIDATION_ERROR`.** Out-of-range pages / ranges on `merge_pdfs` / `split_pdf` / `extract_pages` were `PDF_PARSE_FAILED`; the message now carries a 0-based hint.
3. **`validate_pdf` on unparsable bytes is an error, not a verdict.** v1.5.0 returned `{ valid: false }`; v1.6.0 returns `isError: true` `[PDF_PARSE_FAILED]` — a parse failure is not a PDF/UA verdict.
4. **Unknown tool or prompt names are protocol errors** — JSON-RPC `-32602` (`[UNKNOWN_TOOL]` / `[UNKNOWN_PROMPT]`), no `isError` result.
5. **`inspect_pdf.checks` holds only the keys you asked for** — read `checksPassed` or the requested key, never an absent one.
6. **`add_form` text areas change bytes.** `fieldType: 'textarea'` now produces a real multi-line field (`/Ff 4096`).

### What's new in v1.7.0

v1.7.0 (released 2026-09-21) aligns the server with **pdfnative 1.8.0** (`^1.8.0`, Node ≥ 22) and keeps the catalogue at **28 tools** — what grows is what each of them can do. No breaking changes to the tool API: every v1.6.0 input is still accepted, every tool, property, enum value and bound is still there (a superset gate against the published 1.5.0 catalogue proves it), and default outputs are byte-identical except where pdfnative 1.8.0 corrected previously-wrong output. All new behaviour is opt-in.

- **Fine typography** — `typography` (12 keys, all off by default) on the nine document tools and on `inspect_layout`: `splitParagraphs` with `orphans` / `widows`, `keepHeadingsWithNext`, `unitBinding`, `bindShortWords`, `punctuationSpacing` (`'fr'`, `'fr-CA'` or explicit rules), `opticalMargins`, `metrics: 'exact'`, `fontFeatures` (11 OpenType tags), `kerning`, `hyphenationLanguage` (no dictionary installed — soft hyphens are honoured). Paragraph blocks gain `align` (`left` / `right` / `center` / `justify`), `keepWithNext` and `splittable`; heading blocks gain `keepWithNext`.
- **CMYK everywhere a colour is accepted** — `'c m y k'` operand strings (0–1) and `[c, m, y, k]` percent tuples (0–100) beside the existing hex / RGB forms, on watermarks, header / footer templates, table cell borders, outline entries, charts, `link` and `svg` blocks and `annotate_pdf`.
- **PDF/X-4** — `pdfx: 'pdfx4'` on `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image` and `add_international_text`; requires an `outputIntent` with a `prtr` ICC profile and `embedFonts: true`, exclusive with `pdfA` / `encrypt`. `outputIntent` accepts CMYK and Gray profiles beside RGB; `print.marks` accepts `{ colourBars: true | { tints, size } }`.
- **`validate_pdf standard`** — `'pdf-ua-1'` (default, unchanged) or `'pdf-x-4'`, whose result adds `caveats[]` (structural prerequisites, not a certified preflight).
- **`inspect_pdf`** reports `pdfX` when the XMP claims PDF/X and accepts `check: 'pdfx'`.
- **27 scripts** — `add_international_text.lang` gains `lo`, `nod`, `khb`, `tdd`, `cjm`; `ha`, `yo`, `ig`, `sw` are aliases of `latin`.
- **Reproducible on every host** — every date is written in UTC; `{date}` in a header or footer follows the pinned instant; the operator can pin the whole process with `PDFNATIVE_MCP_CREATION_DATE` or `SOURCE_DATE_EPOCH` (precedence: per-call `creationDate` → `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → clock). `server.json` declares all twelve operator variables.
- **A seventh MCP prompt**, `typography`; `print_ready`, `reproducible_output` and `pdfa_valid` rewritten for CMYK, PDF/X-4, colour bars and the UTC / operator pin.
- **Two new error codes** — `strict` escalates by diagnostic code: `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`.
- **`TOOL_API_VERSION` 1.7.0** (new optional inputs, two new error codes); the response-cache namespace changes with it, so no v1.6.0 cache entry is served.
- **Catalogue size** — `tools/list` grows from about 246 kB to about 306 kB, within the 320 KiB budget the server's own check enforces; hosts that cache `tools/list` are unaffected.
- **Tests and docs** — 1631 tests in 96 files <!-- verify-docs:allow stale-token (pdfnative-mcp's own suite, not the engine's) --> (v1.6.0: 937); eleven new executable examples (43 in total); new guides `TYPOGRAPHY.md` and `REPRODUCIBLE.md`.
- **Fixed** — a 0–1 RGB triple (`watermark.color`, the `annotate_pdf` colours) was read by the engine as 0–255 and `[1, 0, 0]` rendered almost black; a damaged PDF could surface an uncoded failure (`inspect_pdf failed: parseDict…`) — any unexpected failure of a tool that takes PDF input is now `PDF_PARSE_FAILED`; `strict` no longer loses the diagnostic code (the server escalates from its own sink instead of forwarding `strict` to the engine).
- **Inherited from pdfnative 1.8.0** — [#74](https://github.com/Nizoka/pdfnative/issues/74): a PDF/A form (`add_form` / a `formField` block with `pdfA` and `embedFonts: true`) embeds the AcroForm default-resources font and validates under veraPDF; [#75](https://github.com/Nizoka/pdfnative/issues/75): `inspect_layout` and the build share one pagination planner, so a `toc` block reports its real height.

**Migrating from v1.6.0** — no breaking changes; a drop-in replacement. Eight things to know:

1. **Rebaseline once if you compare bytes.** pdfnative 1.8.0 changes the bytes of every document that embeds a TrueType subset (hinting tables kept, `head.checkSumAdjustment` computed), of every document drawing `print.marks` (marks stop 0.5 pt short of the trim line), and of shaped text in every script with mark positioning — in each case the previous output was wrong or incomplete. Documents on base-14 fonts without those features are byte-identical on a UTC host; elsewhere item 2 changes `/CreationDate`, the XMP dates and the trailer `/ID` of every document that pins an instant.
2. **Dates are UTC.** `/CreationDate` and the XMP dates end in `+00'00'` / `+00:00` whatever the host zone. A consumer that parsed a local offset out of `/CreationDate` sees UTC; the instant is the same.
3. **`{date}` follows the pinned instant.** A header or footer template using `{date}` on a call that sets `creationDate` now prints that date (it printed the wall-clock date). A call that pins nothing is unchanged.
4. **Hand-made ICC stubs are rejected.** `outputIntent.iccProfileBase64` must carry the ICC `acsp` signature and a size field no larger than the buffer — real profiles do. The failure is `PRINT_ERROR` (a profile whose device class is not `prtr` under `pdfx` is `VALIDATION_ERROR`).
5. **`extract_text` returns `/ActualText`.** Text extracted from a tagged PDF is what the writer declared for a marked-content span, not the glyphs inside it; for tagged pdfnative output this makes complex-script extraction exact.
6. **Two new error codes.** `PDF_X_COMPLIANCE_VIOLATION` and `DIAGNOSTIC_ESCALATED` can only be returned by a call that sets `strict: true`. A client that matched `PDF_A_COMPLIANCE_VIOLATION` for *every* strict failure should match the three.
7. **A 0–1 RGB triple renders the colour it names** (see *Fixed* above).
8. **Operators:** `PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH` are honoured from this release. A shell that already exports `SOURCE_DATE_EPOCH` (many build environments do) now pins every document's creation date — unset it for the server process if that is not wanted. An invalid value refuses to start.

---

## Further reading

- [pdfnative-mcp on GitHub](https://github.com/Nizoka/pdfnative-mcp) — source, issues, CHANGELOG
- [pdfnative-mcp on npm](https://www.npmjs.com/package/pdfnative-mcp) — version history, install stats
- [MCP use cases](use-cases-mcp.html) — shared-server, bearer-token and file-sandbox deployment patterns
- [pdfnative Quick Start](quickstart.html) — pdfnative library directly in Node.js / browser
- [CLI guide](cli.html) — the same engine from shell scripts and CI (`pdfnative-cli`)
- [React guide](react.html) — JSX → pdfnative blocks (`pdfnative-react`)
- [Typography guide](typography.html) — the engine side of the `typography` object
- [Architecture guide](architecture.html) — how pdfnative-mcp sits in the ecosystem
- [Model Context Protocol specification](https://modelcontextprotocol.io) — MCP standard reference
