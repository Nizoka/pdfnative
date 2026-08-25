# pdfnative — agent brief

> A compact, paste-into-your-context briefing for AI agents writing code with
> [pdfnative](https://pdfnative.dev). Everything here is declarative and
> verified against the source tree by the repository's documentation CI.
> Longer forms: [llms.txt](https://pdfnative.dev/llms.txt) (index),
> [llms-full.txt](https://pdfnative.dev/llms-full.txt) (full corpus),
> [llms-index.json](https://pdfnative.dev/llms-index.json) (per-page sizes and anchors).

## What it is

pdfnative is a zero-runtime-dependency TypeScript library that generates and
parses ISO 32000-1 (PDF 1.7) and ISO 19005 (PDF/A) conformant PDFs on-device —
Node ≥ 22, browsers, Deno, Bun, Web Workers. No SaaS round-trip, no telemetry,
no sockets. Current version: 1.7.0. It writes (documents, tables, charts,
barcodes, SVG, forms, watermarks, signatures with long-term validation, print
production) and reads (parse, decrypt, extract text, read/fill/flatten forms,
merge/split/extract pages, verify structure) — 22 Unicode scripts, with
OpenType GSUB/GPOS shaping for the complex ones (Thai, Arabic, Devanagari,
Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar) and full UAX #9 BiDi.

## Choose your surface

- **Writing application code** → the library: `npm install pdfnative`, `import { … } from 'pdfnative'`.
- **Driving a shell, CI, or Makefile** → `pdfnative-cli` (17 commands, JSON-in/JSON-out agent contract with stable `E_*` error codes).
- **You are a conversational assistant with tool access** → `pdfnative-mcp` (28 tools, MCP 2026-07-28 spec; config: `npx -y pdfnative-mcp`).
- **The host app is React 19** → `pdfnative-react` (declarative JSX compiled on-device to pdfnative blocks).

All four produce the same PDFs from the same engine. Details: [onboarding](https://pdfnative.dev/guides/onboarding.md).

## The core API (library)

```ts
import { buildDocumentPDFBytes } from 'pdfnative';

// Synchronous — returns a Uint8Array, not a Promise.
const bytes = buildDocumentPDFBytes({
  title: 'Invoice 42',                    // top-level, not inside metadata
  metadata: { author: 'Me' },             // author / subject / keywords / trapped (v1.7.0)
  blocks: [
    { type: 'heading', text: 'Invoice 42', level: 1 },
    { type: 'paragraph', text: 'Thank you for your order.' },
    { type: 'table', headers: ['Item', 'Price'], rows: [{ cells: ['Widget', '€10'] }] },
  ],
  layout: { tagged: 'pdfa2b' },           // optional PDF/A claim lives in layout
});
// Node:    await fs.writeFile('out.pdf', bytes);
// Browser: new Blob([bytes], { type: 'application/pdf' });
```

Thirteen block kinds: `heading`, `paragraph`, `list`, `table`, `image`, `link`,
`toc`, `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer`.

Functions an agent reaches for most, all exported from `'pdfnative'`:

| Export | Role |
|---|---|
| `buildDocumentPDFBytes(params)` | Document builder (blocks) → `Uint8Array`. Synchronous. |
| `buildPDFBytes(params)` | Table-centric builder (headers/rows) → `Uint8Array`. |
| `registerFont(lang, loader)` / `loadFontData(lang)` | Enable a non-Latin script; pass the result via `fontEntries`. |
| `downloadBlob(bytes, name)` | Browser download helper. |
| `inspectDocumentLayout(params)` | Pagination dry run — page count and block geometry, no PDF produced. |
| `extractText(bytes, options?)` | Reading-order Unicode text (+ positioned runs) from an existing PDF. |
| `openPdf(bytes, { password? })` | Parse (and decrypt) an existing PDF — metadata, pages, encryption info. |
| `validatePdfUA(bytes)` | Read-only PDF/UA structural check → `{ valid, errors, warnings }`. |
| `readFormFields` / `fillForm` / `flattenForm` | AcroForm round-trip on existing PDFs (incremental update; encrypted sources supported). |
| `mergePdfs` / `splitPdf` / `extractPages` | Page-tree manipulation (with streaming variants). |
| `signPdfBytes(bytes, options)` | PAdES CMS signature (RSA-SHA256/384/512, ECDSA P-256); `addSignaturePlaceholder` prepares the `/Sig` field. |
| `listSignatures(bytes)` | Inventory of signatures and document timestamps. |
| `buildDocumentPDFStreamTrue(params)` | Constant-memory streaming for very large documents. |

## What agents get wrong (verified pitfalls)

1. **`buildDocumentPDFBytes` is synchronous.** It returns a `Uint8Array`, not a
   Promise — do not `await` it (harmless) and do not `.then()` it (breaks).
2. **`title` is top-level**, not inside `metadata` (`metadata` takes
   `author` / `subject` / `keywords`, plus `trapped` since v1.7.0).
3. **`registerFont` alone is a no-op.** You must also `await loadFontData(lang)`
   and pass the result in `fontEntries: [{ fontData, fontRef, lang }]`.
4. **`/F1` and `/F2` are reserved font refs** — start custom `fontRef` at `/F3`.
5. **The PDF/A claim lives in `layout`** (`layout: { tagged: 'pdfa2b' }`), not at
   the top level; it is mutually exclusive with encryption. A claim on base-14
   text needs embedded fonts to pass veraPDF (see the
   [PDF/A guide](https://pdfnative.dev/guides/pdfa.md)).
6. **This is not pdfkit / jsPDF / pdf-lib.** There is no `new PDFDocument()`,
   no `doc.text(…)`, no `pdf.save()`, no `doc.pipe(…)` — documents are plain
   data (`blocks` arrays) passed to pure functions.
   <!-- verify-docs:allow api-exists (deliberately naming the ghost identifiers to warn against them) -->
   `streamDocumentPdf`, `streamPdf` and `buildPdfStream` have never existed;
   <!-- verify-docs:allow api-exists (same warning, continued) -->
   the streaming exports are `buildDocumentPDFStream`, `buildPDFStream` and their `…True` variants.

## Verify your own output

pdfnative can read what it writes — use that to close the loop instead of
shipping blind:

```ts
import { buildDocumentPDFBytes, inspectDocumentLayout, extractText, validatePdfUA } from 'pdfnative';

const params = { title: 'Report', blocks: [/* … */] };

// Before generating: how will it paginate?
const layout = inspectDocumentLayout(params);
if (layout.totalPages > 3) { /* tighten the layout */ }

const bytes = buildDocumentPDFBytes(params);

// After generating: is the content really there? Is the structure valid?
const pages = extractText(bytes);          // → ExtractedPageText[], one per page
if (!pages[0].text.includes('Report')) throw new Error('content missing');
const ua = validatePdfUA(bytes);
if (!ua.valid) console.warn(ua.errors);
```

The same loop exists on every surface: `pdfnative-cli inspect --check … --json`
(exit 1 on failure), and the MCP tools `inspect_pdf`, `inspect_layout`,
`validate_pdf`, `verify_pdf`.

## Where to read more

- [Quick start](https://pdfnative.dev/guides/quickstart.md) · [Onboarding](https://pdfnative.dev/guides/onboarding.md) — first PDF in each surface.
- [MCP guide](https://pdfnative.dev/guides/mcp.md) — the 28 tools, schemas, error codes.
- [CLI guide](https://pdfnative.dev/guides/cli.md) — 17 commands and the `--json` / `E_*` agent contract.
- Every guide serves raw Markdown at the same URL with `.md`; sizes and anchors are in [llms-index.json](https://pdfnative.dev/llms-index.json).
