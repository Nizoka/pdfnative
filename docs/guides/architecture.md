# Architecture Guide

## Two Builders

pdfnative provides two PDF builders for different use cases:

### `buildPDF()` / `buildPDFBytes()` — Table-Centric

Best for: financial statements, reports, tabular data.

```typescript
import { buildPDFBytes } from 'pdfnative';

const pdf = buildPDFBytes({
  title: 'Monthly Report',
  headers: ['Date', 'Description', 'Amount'],
  rows: [
    { cells: ['01/15', 'Grocery', '-$45.00'], type: 'debit', pointed: false },
  ],
  // ... infoItems, balanceText, countText, footerText
});
```

Produces a structured table layout with title, info items, balance line, column headers, data rows, and footer. Supports pagination, tagged PDF, encryption, compression.

### `buildDocumentPDF()` / `buildDocumentPDFBytes()` — Free-Form

Best for: reports, manuals, invoices, any document with mixed content.

```typescript
import { buildDocumentPDFBytes } from 'pdfnative';

const pdf = buildDocumentPDFBytes({
  title: 'Project Report',
  blocks: [
    { type: 'heading', text: 'Introduction', level: 1 },
    { type: 'paragraph', text: 'This report covers...' },
    { type: 'table', headers: ['Q', 'Revenue'], rows: [...] },
    { type: 'image', data: pngBytes, width: 300 },
    { type: 'barcode', format: 'qr', data: 'https://example.com' },
  ],
});
```

Supports 12 block types: heading, paragraph, list, table, image, link, spacer, pageBreak, toc, barcode, svg, formField.

## Generation Pipeline

```
Input (params + options)
  │
  ├─ resolveLayout()         → page dimensions, margins, column positions
  ├─ normalizeColors()       → validate & normalize color values
  ├─ createEncodingContext()  → font encoding (WinAnsi + CIDFont)
  │
  ├─ Content Loop ─────────────────────────────────
  │   ├─ Text rendering      → BT/ET operators, font selection
  │   ├─ Image embedding     → XObject + Do operator
  │   ├─ Barcode rendering   → PDF path operators (re f)
  │   ├─ SVG rendering       → PDF path operators (m l c)
  │   └─ Page breaks         → new page object
  │
  ├─ Font subsetting         → TTF subset per used font
  ├─ Tagged PDF (optional)   → structure tree, /ActualText, MCID
  ├─ PDF/A (optional)        → XMP metadata, ICC OutputIntent
  ├─ Encryption (optional)   → AES-128/256, key derivation
  ├─ Compression (optional)  → FlateDecode on content streams
  │
  └─ Assembly ─────────────────────────────────────
      ├─ createPdfWriter()   → binary writer with offset tracking
      ├─ Object emission     → N 0 obj ... endobj
      └─ writeXrefTrailer()  → xref table + trailer + startxref
```

## Module Dependency Flow

```
types/ → core/ ← fonts/ ← shaping/ ← worker/
              ↑
          crypto/ (standalone)
          parser/ (standalone, imports core/compress for inflate)
```

- **No circular dependencies** — strict unidirectional flow
- **crypto/** is fully standalone — zero imports from other src/ modules
- **parser/** imports only from `core/pdf-compress.ts` for FlateDecode inflate
- **fonts/** imports from `shaping/` for script detection
- **shaping/** imports from `fonts/` encoding context (via `core/encoding-context.ts` to break cycle)

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No classes | Pure functions — easier to test, tree-shake, and reason about |
| String-based PDF operators | Direct control over output, no AST overhead |
| Lazy font loading | `registerFonts()` + `loadFontData()` — load only needed scripts |
| Shared assembler | `pdf-assembler.ts` eliminates xref/trailer duplication between builders |
| Extracted renderers | `pdf-renderers.ts` — block renderers, text wrapping, constants extracted from `pdf-document.ts` for maintainability |
| Encoding context in core/ | Dependency inversion — breaks fonts/ → shaping/ cycle |

## Ecosystem

The architecture diagram above shows the **internal library modules**. External consumers sit above the library and import from `pdfnative` like any npm package.

### pdfnative-cli

[pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface**. It exposes three commands — `render`, `sign`, `inspect` — that map directly to public `pdfnative` APIs:

```
[shell / Makefile / GitHub Actions / Docker]
              │ argv + stdin/stdout
     ┌──────────────────────────┐
     │  pdfnative-cli (npm)     │  ← thin dispatch layer, 3 commands
     └──────────────────────────┘
              │ import { buildDocumentPDFBytes, signPdfBytes, PdfReader } from 'pdfnative'
     ┌──────────────────────────┐
     │      pdfnative (npm)     │  ← core library (this repo)
     └──────────────────────────┘
```

Like `pdfnative-mcp`, the CLI lives in a separate repository and depends on `pdfnative` only via the public API surface. See the [CLI Guide](cli.html) for usage and the security model.

### pdfnative-mcp

[pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) is a **Model Context Protocol server** that wraps the pdfnative public API and exposes it as 8 structured tools to any MCP-compatible AI client (Claude Desktop, Cursor, Continue, Zed, ChatGPT, …).

```
[Claude Desktop / Cursor / Continue / Zed]
              │ MCP stdio protocol
     ┌──────────────────────────┐
     │  pdfnative-mcp (npm)     │  ← MCP server, 8 tools
     └──────────────────────────┘
              │ import { buildDocumentPDFBytes, … } from 'pdfnative'
     ┌──────────────────────────┐
     │      pdfnative (npm)     │  ← core library (this repo)
     └──────────────────────────┘
```

pdfnative-mcp is **not an internal module** — it is a separate npm package with its own repository, versioning, and release cadence. It references `pdfnative` only through the public API.

For setup instructions, tool reference, and per-client configuration, see the [MCP Integration Guide](mcp.html).
