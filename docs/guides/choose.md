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
21 commands over stdin/stdout pipelines, with an agent-native automation
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
| Native vector charts | `chart` block _(v1.6.0)_ | `render` (`chart` block) _(v1.3.0)_ | `add_chart` _(v1.5.0)_ | `<Chart>` _(v1.1.0; charts v2 — nine kinds, secondary axis, log/time scales, data labels — since v1.2.0)_ |
| Digital signatures (PAdES CMS) | `addSignaturePlaceholder` _(v1.2.0)_ + `signPdfBytes` | `sign` | `sign_pdf` (+ `prepare_signature_placeholder`) | — |
| LTV ladder (B-T → B-LTA) | `signPdfBytesWithTimestamp`, `addValidationInfo`, `addDocumentTimestamp` _(v1.7.0)_ | `sign --timestamp`, `ltv`, `doc-timestamp` _(v1.4.0)_ | `add_ltv`, `timestamp_pdf` _(v1.6.0)_ | — |
| Encrypt / decrypt | build-time `encryption` layout option; existing PDFs via the page-tree `encrypt` option and `openPdf` with a password | `encrypt` / `decrypt` _(v1.3.0)_ | `encrypt_pdf` / `decrypt_pdf` _(v1.5.0)_ | build-time only, via the `layout` render option |
| Fill / flatten forms | `readFormFields`, `fillForm`, `flattenForm` _(v1.6.0)_ | `fill` _(v1.3.0)_ | `read_form_fields`, `fill_form` _(v1.5.0)_ | — |
| Extract text | `extractText` _(v1.6.0)_ | `extract-text` _(v1.3.0)_ | `extract_text` | — |
| Merge / split / extract pages | `mergePdfs`, `splitPdf`, `extractPages` _(v1.4.0)_ | `merge` / `split` / `extract` _(v1.2.0)_ | `merge_pdfs` / `split_pdf` / `extract_pages` _(v1.3.0)_ | — |
| Markup annotations | `buildAnnotation` + `PdfModifier.addAnnotation` _(v1.5.0)_ | `annotate` _(v1.2.0)_ | `annotate_pdf` _(v1.4.0)_ | — |
| Inspect layout (pagination dry run) | `inspectDocumentLayout` _(v1.5.0)_ | `render --inspect-layout` _(v1.2.0)_ | `inspect_layout` _(v1.6.0)_ | `inspectDocument` |
| Validate PDF/UA | `validatePdfUA` _(v1.3.0)_ | `inspect --pdfua` _(v1.1.0)_ | `validate_pdf` _(v1.1.0)_ | — (`lintDocument` checks the authoring model before rendering, not the emitted PDF) |
| Update metadata (signature-safe) | `PdfModifier.updateMetadata` _(v1.7.0)_ | `metadata` _(v1.4.0)_ | `update_metadata` _(v1.6.0)_ | — |
| Compare two PDFs (text + structure) | — (compose `openPdf` / `extractText` / the readers) | `compare` _(v1.4.0)_ | — | — |
| Runtime font registration | `registerFont` / `registerFonts` _(v1.5.0, any loader — incl. fonts you compile with `compileFontData`)_ | `render --font` (bundled fonts only) _(v1.1.0)_ | — (fixed `lang` enum; fonts resolved from the local `pdfnative` install) | `registerFont` / `registerFonts` (re-exported) |
| Typography (paragraph breaking, justification, hyphenation, kerning, OpenType features) | `layout.typography` (`TypographyOptions`) + `setHyphenationProvider` / `bindUnits` / `bindShortWords` / `applyPunctuationSpacing` _(v1.8.0; every option opt-in and byte-identical when absent)_ | `render --split-paragraphs` / `--keep-headings-with-next` / `--kerning` / `--font-features`, or the full `layout.typography` object in the document JSON / a `--layout` file _(v1.5.0)_ | `typography` object on the nine document tools and `inspect_layout`; paragraph `align: 'justify'` / `keepWithNext` / `splittable`, heading `keepWithNext` _(v1.7.0)_ | `<Document typography>` · `<Paragraph align="justify" keepWithNext splittable>` · `<Heading keepWithNext>` _(v1.3.0)_ |
| CMYK content colours | `[c, m, y, k]` tuples (percent) or `'c m y k'` strings on any colour field; `parseColor` / `resolveColor` / `fillOp` / `strokeOp` _(v1.8.0)_ | `render` (`"c m y k"` or `[c, m, y, k]` colour fields in the document JSON) _(v1.5.0)_ | `'0 0.6 1 0'` or `[0, 60, 100, 0]` on every colour input _(v1.7.0)_ | `Color` accepts a CMYK tuple or string on every colour prop; `L_CMYK_INTENT_MISMATCH` _(v1.3.0)_ |
| CMYK / Gray OutputIntent with RGB content kept conforming | `layout.outputIntent` with a CMYK or Gray ICC profile _(v1.8.0; RGB content routed through a calibrated `/DefaultRGB`; no press profile shipped)_ | `render --output-intent-icc <file.icc> --output-intent-id <s>` _(v1.5.0)_ | `outputIntent` accepts CMYK and Gray profiles on the document tools _(v1.7.0)_ | `<Document outputIntent>` (also a DocSpec field) _(v1.3.0)_ |
| PDF/X-4 conformance claim | `layout: { pdfx: 'pdfx4', outputIntent, metadata.trapped }` _(v1.8.0; exclusive with `tagged` and encryption)_ | `render --pdfx pdfx4 --output-intent-icc <file.icc> --trapped true\|false\|unknown` (coherence errors → `E_INPUT`, `PDFX_*` diagnostics fail under `--strict`) _(v1.5.0)_ | `pdfx: 'pdfx4'` on six document tools (needs a `prtr` `outputIntent` and `embedFonts: true`; exclusive with `pdfA` / `encrypt`) _(v1.7.0)_ | `<Document pdfx="pdfx4" outputIntent metadata={{ trapped }}>` with eight `L_PDFX_*` lint rules _(v1.3.0)_ |
| Validate PDF/X-4 | `validatePdfX` _(v1.8.0; structural ISO 15930-7 prerequisites, not a certified preflight)_ | `inspect --pdfx` / `--check pdfx` _(v1.5.0)_ | `validate_pdf` with `standard: 'pdf-x-4'` (result carries `caveats[]`); `inspect_pdf` reports `pdfX` _(v1.7.0)_ | — (import `validatePdfX` from the `pdfnative` peer and run it on the rendered bytes) |
| Printer's marks: registration colour and colour control bars | `layout.print.marks` (`true`, or `{ colourBars: true \| { tints, size } }`) _(v1.8.0; bars off by default and byte-neutral when off)_ | `render` (`print.marks` incl. `colourBars` in the document JSON or a `--layout` file) _(v1.5.0)_ | `print.marks: true` _(v1.6.0)_ or `{ colourBars: true \| { tints, size } }` _(v1.7.0)_ | `<Document print={{ marks: { colourBars: true } }}>` (`ColourBarOptions`, `L_PRINT_COLOUR_BARS`) _(v1.3.0)_ |
| Reproducible bytes | `layout.creationDate`, or `setDefaultCreationDate(date)` once per process; `getDefaultCreationDate` _(v1.8.0; pin `TZ` too for cross-host identity)_ | global `--creation-date <iso8601>` (`SOURCE_DATE_EPOCH` fallback), echoed in the `--json` envelope _(v1.5.0)_ | `creationDate` on all nine document tools _(v1.6.0)_; server-wide `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → clock _(v1.7.0)_ | `<Document creationDate>` (also a DocSpec field); `setDefaultCreationDate` / `getDefaultCreationDate` re-exported; no environment variable is read _(v1.3.0)_ |

## Honest notes

- **LTV transport differs by surface on purpose.** The engine opens no socket:
  in the **library**, the RFC 3161 / OCSP / CRL transport is *injected by your
  code* (`setTimestampProvider` / `setRevocationProvider`). On **MCP**, the
  transport is *operator-configured* through environment variables
  (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, an allow-list) — never
  from tool arguments. On the **CLI** (since v1.4.0, which completes the
  write-side ladder), every network touch is an *explicit per-invocation
  opt-in* — `sign --timestamp <url>`, `ltv --online`, `doc-timestamp --url` —
  behind an SSRF guard, and `ltv collect` / `ltv embed` split the ladder across
  an air gap: evidence is gathered as replayable JSON on a connected machine
  and embedded fully offline.
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
- [Ecosystem use cases](use-cases.html) — five production architectures that
  compose these surfaces, with diagrams, plus per-surface cases for the
  [CLI](use-cases-cli.html), the [MCP server](use-cases-mcp.html) and the
  [React renderer](use-cases-react.html).
- [Self-verifying generation](self-verify.html) — the generate → inspect →
  assert → correct loop on every surface.
- [Architecture](architecture.html) — how the four packages relate.
- [CLI guide](cli.html) · [MCP guide](mcp.html) · [React guide](react.html) —
  the complete per-surface references.
- [Agent brief](../agent-brief.md) — the same decision tree in
  paste-into-context form for AI agents.
