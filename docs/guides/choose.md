# Choosing your surface

> **Write application code → the library. Drive a shell, Makefile or CI job →
> `pdfnative-cli`. Give a conversational AI assistant tool access →
> `pdfnative-mcp`. Author documents inside a React 19 app →
> `pdfnative-react`.** All four surfaces sit on the same zero-dependency
> engine and produce the same ISO 32000-1 / PDF/A-conformant bytes, so the
> choice is about *who is calling*, not about what comes out — and you can
> switch later without re-authoring your documents.

## The decision, in prose

**You are writing application code** — a Node.js, Deno, Bun or browser
service, a worker, a script with logic around the PDF. Use the **library**
(`npm install pdfnative`). It is the full surface: synchronous builders, the
parser, signatures with long-term validation, streaming, Web Worker support.
Everything the other three surfaces do, they do by calling this package.

**You are driving a shell, a CI pipeline, a container, or a build tool in
another language.** Use the **CLI** (`pdfnative-cli`, binary `pdfnative`) —
17 commands over stdin/stdout pipelines, with an agent-native automation
contract: a `--json` envelope, stable `E_*` error codes, `--dry-run`, and
compact `--summary` / `--fields` output projection. No JavaScript required.

**You are (or you are building) a conversational assistant with tool
access** — Claude Desktop, Cursor, Continue, Zed, or any Model Context
Protocol client. Use the **MCP server** (`pdfnative-mcp`, `npx -y
pdfnative-mcp`) — 28 tools with strict JSON Schemas, read-back tools for
self-verification, and no outbound network access except the
operator-configured TSA/OCSP/CRL endpoints.

**Your host application is React 19.** Use the **React renderer**
(`pdfnative-react`) — declarative JSX compiled on-device to pdfnative blocks
by a custom reconciler (no DOM, no headless browser), with live-preview hooks
and the token-frugal `DocSpec` for agent authoring. React 19 is a peer
dependency of this package only; the engine stays zero-dependency.

## Capability × surface

The same facts in machine-readable form live in
[`docs/data/surfaces.json`](../data/surfaces.json); tool, command and export
names are verified against
[`docs/assets/ecosystem.json`](../assets/ecosystem.json) and the engine's
export surface by the documentation CI. Version annotations name the release
*of that surface's own package* which introduced the capability; an em-dash
means the surface does not offer it.

| Capability | Library (`pdfnative`) | CLI (`pdfnative-cli`) | MCP (`pdfnative-mcp`) | React (`pdfnative-react`) |
|---|---|---|---|---|
| Generate documents | `buildDocumentPDFBytes` / `buildPDFBytes` | `render` | `generate_basic_pdf` (+ the dedicated document tools) | `renderToBytes` and friends, `<Document>` tree |
| Smart tables | `table` block | `render` (`table` block, or `--variant table`) | `add_table` | `<Table>` |
| Native vector charts | `chart` block _(v1.6.0)_ | `render` (`chart` block) _(v1.3.0)_ | `add_chart` _(v1.5.0)_ | `<Chart>` |
| Digital signatures (PAdES CMS) | `addSignaturePlaceholder` + `signPdfBytes` | `sign` | `sign_pdf` (+ `prepare_signature_placeholder`) | — |
| LTV ladder (B-T → B-LTA) | `signPdfBytesWithTimestamp`, `addValidationInfo`, `addDocumentTimestamp` _(v1.7.0)_ | — (verification only: `verify --revocation`) | `add_ltv`, `timestamp_pdf` _(v1.6.0)_ | — |
| Encrypt / decrypt | build-time `encryption` layout option; existing PDFs via the page-tree `encrypt` option and `openPdf` with a password | `encrypt` / `decrypt` _(v1.3.0)_ | `encrypt_pdf` / `decrypt_pdf` _(v1.5.0)_ | build-time only, via the `layout` render option |
| Fill / flatten forms | `readFormFields`, `fillForm`, `flattenForm` _(v1.6.0)_ | `fill` _(v1.3.0)_ | `read_form_fields`, `fill_form` _(v1.5.0)_ | — |
| Extract text | `extractText` _(v1.6.0)_ | `extract-text` _(v1.3.0)_ | `extract_text` | — |
| Merge / split / extract pages | `mergePdfs`, `splitPdf`, `extractPages` _(v1.4.0)_ | `merge` / `split` / `extract` _(v1.2.0)_ | `merge_pdfs` / `split_pdf` / `extract_pages` _(v1.3.0)_ | — |
| Markup annotations | `buildAnnotation` + `PdfModifier.addAnnotation` _(v1.5.0)_ | `annotate` _(v1.2.0)_ | `annotate_pdf` _(v1.4.0)_ | — |
| Inspect layout (pagination dry run) | `inspectDocumentLayout` _(v1.5.0)_ | `render --inspect-layout` _(v1.2.0)_ | `inspect_layout` _(v1.6.0)_ | `inspectDocument` |
| Validate PDF/UA | `validatePdfUA` | `inspect --pdfua` _(v1.1.0)_ | `validate_pdf` _(v1.1.0)_ | — (`lintDocument` checks the authoring model before rendering, not the emitted PDF) |

## Honest notes

- **LTV differs by surface on purpose.** The engine opens no socket: in the
  **library**, the RFC 3161 / OCSP / CRL transport is *injected by your code*
  (`setTimestampProvider` / `setRevocationProvider`). On **MCP**, the transport
  is *operator-configured* through environment variables
  (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, an allow-list) — never
  from tool arguments. The **CLI** currently *verifies* LTV material
  (`verify --revocation`, RFC 3161 timestamp validation) but does not create
  it — sign-side LTV is documented as out of scope there.
- **The engine ships no cryptographic signature verifier.** `listSignatures`
  is an inventory; full verification (digest, CMS, chain, trust, timestamps,
  revocation) lives in `pdfnative-cli verify` and the MCP `verify_pdf` tool.
- **React is an authoring surface.** It generates documents (including charts,
  barcodes, SVG, form *widgets* and build-time encryption via the `layout`
  render option) but does not operate on existing PDFs — no fill, extract,
  merge or signing. When a React app needs those, call the library directly:
  it is already installed as the renderer's peer dependency.
- **The MCP tool names, CLI commands and library exports in the table are the
  complete story for these capabilities**, not a sample — where a cell is an
  em-dash, the surface genuinely lacks the capability today rather than
  hiding it under another name.

## You can switch later

All four surfaces call the same engine, so the artefacts are interchangeable:
a PDF rendered by the React reconciler can be signed by the CLI, inspected by
an MCP tool, and have its text extracted by the library. Document *inputs*
travel too — the CLI's `render` consumes the same `DocumentParams` JSON the
library takes, the MCP `generate_basic_pdf` blocks mirror the engine's block
kinds, and `pdfnative-react` compiles JSX (or a `DocSpec`) into that same
model. Starting on the "wrong" surface costs a call-site migration, not a
document rewrite.

## Further reading

- [Onboarding](onboarding.html) — the 90-second install-and-first-call for
  each surface.
- [Self-verifying generation](self-verify.html) — the generate → inspect →
  assert → correct loop on every surface.
- [Architecture](architecture.html) — how the four packages relate.
- [CLI guide](cli.html) · [MCP guide](mcp.html) · [React guide](react.html) —
  the complete per-surface references.
- [Agent brief](../agent-brief.md) — the same decision tree in
  paste-into-context form for AI agents.
