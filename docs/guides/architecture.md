# Architecture Guide

> **Two builders, one strict dependency flow.** `buildPDFBytes` is the table-centric builder, `buildDocumentPDFBytes` the free-form document builder; beneath them the modules flow types → core ← fonts ← shaping ← worker, with standalone crypto and parser modules — no circular imports anywhere.

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

Supports 13 block types: heading, paragraph, list, table, image, link, spacer, pageBreak, toc, barcode, svg, formField, chart.

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
          crypto/ (near-standalone, imports core/pdf-encrypt for sha256)
          parser/ (imports core/pdf-compress, pdf-encrypt, pdf-tags)
```

- **No circular dependencies** — strict unidirectional flow, with **one
  sanctioned, documented reverse edge**: the signature-workflow core modules
  (`pdf-dss`, `pdf-sig-utils`, `pdf-doc-timestamp`, `pdf-sig-placeholder`,
  `pdf-form-fill`) import the parser to read existing documents before
  appending incremental revisions
- **crypto/** is near-standalone — its only cross-module import is `sha256` from `core/pdf-encrypt.ts` (re-exported by `crypto/sha.ts`)
- **parser/** imports from `core/pdf-compress.ts` (FlateDecode), `core/pdf-encrypt.ts` (decryption, incremental `/ID`) and `core/pdf-tags.ts` (XMP resync in `updateMetadata`)
- **fonts/** imports from `shaping/` for script detection
- **shaping/** imports from `fonts/` encoding context (via `core/encoding-context.ts` to break cycle)

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| No classes | Pure functions — easier to test, tree-shake, and reason about |
| String-based PDF operators | Direct control over output, no AST overhead |
| Lazy font loading | `registerFonts()` + `loadFontData()` — load only needed scripts |
| Shared assembler | `pdf-assembler.ts` eliminates xref/trailer duplication between builders |
| Extracted renderers | `pdf-renderers.ts` — block renderers, text wrapping, constants extracted from `pdf-document.ts` for maintainability. `planTable()` and `TableSlice` provide planner-driven multi-page table rendering — `_paginateBlocks()` measures once then slices at row boundaries, keeping `renderTable()` page-lifecycle-free. See [Smart tables guide](tables.md). |
| Encoding context in core/ | Dependency inversion — breaks fonts/ → shaping/ cycle |

## Ecosystem

The architecture diagram above shows the **internal library modules**. External consumers sit above the library and import from `pdfnative` like any npm package. Three official companion packages — a CLI, an MCP server, and a React renderer — cover the most common non-library workflows. All live in separate repositories, version independently, and depend on `pdfnative` only through its public API, so the core engine stays zero-dependency.

```
                         ┌─────────────────────────────────────────────┐
   [shell / CI / Docker] │  pdfnative-cli (npm) — 21 commands          │
                         └─────────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
    [Claude / Cursor / …] │  pdfnative-mcp (npm) — 28 AI tools          │
                         └───────────────────────────────────────────┘
                         ┌─────────────────────────────────────────────┐
   [React / Next.js app] │  pdfnative-react (npm) — declarative JSX    │
                         └─────────────────────────────────────────────┘
                            │  import { … } from 'pdfnative'  (public API only)
                         ┌─────────────────────────────────────────────┐
                         │  pdfnative (npm) — zero-dependency engine   │  ← this repo
                         └─────────────────────────────────────────────┘
```

### pdfnative-cli

[pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) is the **official command-line interface**. It exposes twenty-one commands — `render`, `fill`, `annotate`, `metadata`, `merge`, `split`, `extract`, `sign`, `verify`, `ltv`, `doc-timestamp`, `encrypt`, `decrypt`, `inspect`, `extract-text`, `compare`, `batch`, `doctor`, `schema`, `completion`, `govern` — that map directly to public `pdfnative` APIs, with an agent-native `--json`/`E_*`/`--dry-run` automation contract:

```
[shell / Makefile / GitHub Actions / Docker]
              │ argv + stdin/stdout
     ┌──────────────────────────┐
     │  pdfnative-cli (npm)     │  ← dispatch layer, 21 commands + agent contract
     └──────────────────────────┘
              │ import { buildDocumentPDFBytes, signPdfBytes, openPdf, validatePdfUA } from 'pdfnative'
     ┌──────────────────────────┐
     │      pdfnative (npm)     │  ← core library (this repo)
     └──────────────────────────┘
```

Like `pdfnative-mcp` and `pdfnative-react`, the CLI lives in a separate repository and depends on `pdfnative` only via the public API surface. See the [CLI Guide](cli.html) for usage and the security model.

### pdfnative-mcp

[pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) is a **Model Context Protocol server** that wraps the pdfnative public API and exposes it as 28 structured tools to any MCP-compatible AI client (Claude Desktop, Cursor, Continue, Zed, ChatGPT, …). It commits to API stability via a per-tool `_meta.apiVersion` field.

```
[Claude Desktop / Cursor / Continue / Zed]
              │ MCP stdio protocol
     ┌──────────────────────────┐
      │  pdfnative-mcp (npm)     │  ← MCP server, 28 tools
     └──────────────────────────┘
              │ import { buildDocumentPDFBytes, … } from 'pdfnative'
     ┌──────────────────────────┐
     │      pdfnative (npm)     │  ← core library (this repo)
     └──────────────────────────┘
```

pdfnative-mcp is **not an internal module** — it is a separate npm package with its own repository, versioning, and release cadence. It references `pdfnative` only through the public API.

For setup instructions, tool reference, and per-client configuration, see the [MCP Integration Guide](mcp.html).

### pdfnative-react

[pdfnative-react](https://github.com/Nizoka/pdfnative-react) v1.2.0 is the **declarative React renderer**. A custom React reconciler compiles a JSX component tree — synchronously, with no DOM — into the pdfnative `DocumentParams` model, which the engine renders to bytes:

```
[React / Next.js / Remix component tree]
              │ custom react-reconciler (no DOM, no headless browser)
     ┌──────────────────────────┐
     │  pdfnative-react (npm)   │  ← <Document>/<Table>/<Barcode> → pdfnative blocks
     └──────────────────────────┘
              │ import { buildDocumentPDFBytes, … } from 'pdfnative'
     ┌──────────────────────────┐
     │      pdfnative (npm)     │  ← core library (this repo)
     └──────────────────────────┘
```

**React 19 is a peer dependency of `pdfnative-react` only** — the core `pdfnative` engine remains zero-dependency. Components map 1:1 onto pdfnative blocks, and the token-frugal `DocSpec` lets AI agents author the same documents with a fraction of the tokens. See the [React Guide](react.html) for the component reference and the [React playground](../playgrounds/react.html) to try it in your browser.
