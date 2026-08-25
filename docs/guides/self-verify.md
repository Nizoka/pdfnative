# Self-verifying generation

> **pdfnative can read what it writes, so a generated PDF never has to ship
> unchecked.** Plan pagination with `inspectDocumentLayout()` *before* building,
> then run `extractText()`, `validatePdfUA()` and `listSignatures()` /
> `openPdf()` against the emitted bytes, assert what matters, and correct the
> input until every assertion holds. The same generate → inspect → assert →
> correct loop runs on all four surfaces: in the library, on the CLI
> (`inspect --check`, stable exit codes and `E_*` error classes), and on MCP
> (`inspect_pdf` check assertions) — so a test suite, a CI job or an AI agent
> can close the loop without a human ever opening a viewer.

## Why a PDF is normally a blind artefact

Most PDF generators are write-only: the library that produced the file cannot
parse it back. The only verification available is a human opening the result in
a viewer — which no pipeline, test suite or autonomous agent can do. So defects
ship silently: a table that slipped onto a second page, a template placeholder
that was never substituted, a PDF/A claim the file cannot honour, a signature
placeholder that was never actually signed.

pdfnative bundles a parser next to the writer, in the same zero-dependency
package. The read side (`openPdf()`, `extractText()`, `validatePdfUA()`,
`listSignatures()`) consumes exactly what the write side emits — and any other
PDF — which turns generation into a closed loop:

1. **Plan** — measure pagination with `inspectDocumentLayout()` before a single
   byte is produced.
2. **Generate** — build the document.
3. **Inspect** — read the emitted bytes back with the parser.
4. **Assert & correct** — check the facts you care about; on failure, fix the
   *input* and regenerate. Never patch the output bytes.

The rest of this guide walks the four verifiers with realistic
failure → fix examples, then shows the identical loop on the CLI and on MCP.

## Verifier 1 — `inspectDocumentLayout()`: geometry, before generating

_(v1.5.0)_ A pagination dry run: the same planning logic as the builder, but it
returns data instead of PDF bytes — no rendering, no font embedding.

```ts
import { buildDocumentPDFBytes, inspectDocumentLayout } from 'pdfnative';

const params = {
  title: 'Invoice #2026-041',
  blocks: [
    { type: 'heading', level: 1, text: 'Invoice #2026-041' },
    { type: 'paragraph', text: intro },
    { type: 'table', headers: ['Item', 'Qty', 'Total'], rows },
  ],
};

// Plan — no PDF is produced.
const layout = inspectDocumentLayout(params);

// Assert: a one-page invoice.
if (layout.totalPages !== 1) {
  throw new Error(`expected 1 page, planned ${layout.totalPages}`);
}

// Assert: the table starts on page 1, not after a stray break.
const table = layout.pages[0].blocks.find((b) => b.type === 'table');
if (!table) throw new Error('table was pushed off page 1');

// Only now generate.
const bytes = buildDocumentPDFBytes(params);
```

**Failure → fix.** `totalPages` comes back as `2` because this month's `rows`
grew by three entries. Fixes live in the input: shorten `intro`, reduce the
margins in the layout options, or accept the second page and change the
assertion — the table planner repeats headers on continuation pages by default,
so a deliberate two-pager stays readable. Re-run the inspection until the
assertion holds, then build.

> **Honest caveat.** `inspectDocumentLayout()` shares the builder's measurement
> code (`estimateBlockHeight` / `planTable` and its constants) — that is
> precisely why its geometry matches where the renderer places each block,
> including table slicing across page breaks. But it is a *prediction from the
> shared engine*, not an independent re-parse of the emitted bytes. For
> verification of the actual output, pair it with `extractText()` below. See
> [Layout debugging & inspection](debugging.html) for the full data shape and
> the visual overlay variant.

## Verifier 2 — `extractText()`: is the content actually in the file?

_(v1.6.0)_ Reading-order Unicode text per page, decoded from the content
streams of the emitted bytes — pdfnative-generated documents round-trip
losslessly, including CJK, Arabic and emoji.

```ts
import { buildDocumentPDFBytes, extractText } from 'pdfnative';

const bytes = buildDocumentPDFBytes(params);

const pages = extractText(bytes);               // ExtractedPageText[]
// Each entry: { pageIndex: number, text: string, runs?: ExtractedTextRun[] }
const flat = pages.map((p) => p.text).join('\n');

for (const required of ['Invoice #2026-041', 'Total', '1 240,00 €']) {
  if (!flat.includes(required)) {
    throw new Error(`missing from the emitted PDF: "${required}"`);
  }
}
if (flat.includes('{{')) {
  throw new Error('an unresolved template placeholder reached the PDF');
}
```

**Failure → fix.** The total is missing: the value never entered `blocks` —
typically a renamed data field, or a templating step that ran after the build
instead of before it. The `{{` guard catches the classic half-rendered
template. Fix the data flow and regenerate. Positioned runs
(`{ includeRuns: true }`) additionally give each string's `x` / `y` /
`fontSize` when you need to assert *where* something landed, not just that it
exists.

Extraction has documented limits (no OCR on image content, lossy conjuncts in
shaped Indic scripts) — see [Text extraction](text-extraction.html) before
asserting on those cases.

## Verifier 3 — `validatePdfUA()`: structural PDF/UA

Read-only ISO 14289-1 structural checks over the emitted bytes: `/MarkInfo`,
the structure tree, the parent tree, a document `/Lang`, per-page MCID
uniqueness.

```ts
import { buildDocumentPDFBytes, validatePdfUA } from 'pdfnative';

const bytes = buildDocumentPDFBytes(params, { tagged: true });

const report = validatePdfUA(bytes);   // { valid, errors, warnings }
if (!report.valid) {
  throw new Error(`PDF/UA structure: ${report.errors.join('; ')}`);
}
```

**Failure → fix.** The most common failure is building without `tagged` — the
document then has no structure tree at all, and every structural check fires.
Set `layout: { tagged: true }` (or a `'pdfa*'` level) and regenerate. Warnings
are non-blocking best-practice notes; decide explicitly whether your pipeline
tolerates them.

> **Honest caveat.** This is a *structural* validation, not an accessibility
> audit. A passing report means the machine-checkable structure is present and
> consistent — it cannot judge whether the reading order makes sense to a
> human, whether alt text is meaningful, or whether colour contrast is
> adequate. And it is not a PDF/A validator: for archival conformance, run
> veraPDF as described in [PDF/A conformance](pdfa.html).

## Verifier 4 — `listSignatures()` + `openPdf()`: signatures, encryption, metadata

`listSignatures()` _(v1.7.0)_ inventories every signature field in the
document; `openPdf()` (available since v1.0.0) exposes page count, encryption
state and the `/Info` dictionary.

```ts
import { openPdf, listSignatures } from 'pdfnative';

const sigs = listSignatures(signedBytes);
if (sigs.length === 0) throw new Error('no signature field found');
if (sigs.some((s) => s.isPlaceholder)) {
  throw new Error('a /Sig field is still an unsigned placeholder');
}
// Per entry: fieldName?, subFilter, byteRange, isDocTimestamp, isPlaceholder.
const pades = sigs.filter((s) => s.subFilter === 'ETSI.CAdES.detached');

const reader = openPdf(signedBytes);
if (reader.encryption !== null) throw new Error('expected an unencrypted document');
if (reader.pageCount < 2) throw new Error('terms page missing');
const info = reader.getInfo();
```

**Failure → fix.** `isPlaceholder: true` means `addSignaturePlaceholder()` ran
but `signPdfBytes()` never filled that field — usually a skipped signing step,
or a `fieldName` selector that targeted a different placeholder. Sign the
document (or the right field) and re-check. `isDocTimestamp` distinguishes
`/DocTimeStamp` entries when you assert on the PAdES ladder.

> **Honest caveat.** `listSignatures()` is an inventory, not a cryptographic
> verdict — the pdfnative engine deliberately ships no signature verifier.
> Full verification (byte-range digest, CMS signature value, certificate
> chain, trust, timestamps, revocation) lives in `pdfnative-cli verify` and in
> the MCP `verify_pdf` tool, below. See
> [Long-term validation (LTV)](ltv.html).

## The same loop on the CLI

`pdfnative-cli` turns the assertions into exit codes, which is what a shell or
CI step branches on:

```bash
# Plan (pre-flight): pagination report instead of a PDF   (v1.2.0)
pdfnative render --input invoice.json --inspect-layout > layout.json

# Generate, then assert — exit 0 when every --check holds, 1 otherwise
pdfnative render  --input invoice.json --output invoice.pdf --tagged pdfa2b
pdfnative inspect --input invoice.pdf --check pdfa --check pdfua --json --summary
echo $?   # 0 = all assertions hold, 1 = at least one failed

# Content presence, pipeline-style
pdfnative extract-text --input invoice.pdf --format text | grep -q 'Invoice #2026-041'
```

- `inspect --check` takes repeatable, ANDed assertions — `pdfa`, `signed`,
  `encrypted`, `pdfua` _(v1.1.0)_ — and sets the exit code accordingly; under
  `--json`, a failed assertion also emits the stable error class
  `E_CHECK_FAILED` in the machine-readable envelope on stderr
  (`{ ok: false, command, error: { code, message } }`).
- `--summary` _(v1.1.0)_ shrinks the stdout verdict to
  `{ pages, encrypted, signatures, pdfa }`; `--fields a,b.c` projects arbitrary
  dot-paths — both exist so agents branch on facts without paying for the full
  report.
- `pdfnative verify --strict` performs the cryptographic half: byte-range
  digest, CMS signature value (RSA and ECDSA), certificate chain and trust
  against `--trust` roots, RFC 3161 timestamps, OCSP/CRL revocation — exit 1
  and `E_VERIFY_FAILED` on any failure *or on zero signatures*.

The full command reference, including every `--check` flag and the `E_*`
catalogue, is in the [CLI guide](cli.html).

## The same loop on MCP

`pdfnative-mcp` gives a conversational agent the identical verifiers as
read-only tools — the natural final step after any document tool call:

| Tool | Verifies |
|---|---|
| `inspect_pdf` | Version, page count, encryption, PDF/A claim, signatures, attachments, `/Info` — plus `check` assertions with a boolean verdict. |
| `inspect_layout` _(v1.6.0)_ | Pagination dry run for a prospective document — page count and block geometry, no PDF produced, no base64 output tokens spent. |
| `validate_pdf` | Structural PDF/UA — `{ valid, errors, warnings }`. |
| `verify_pdf` | Cryptographic signature verification; `ltv: true` _(v1.6.0)_ reports the achieved PAdES level (B-B → B-LTA). |

```jsonc
{ "tool": "inspect_pdf",
  "input": { "pdfBase64": "<...>", "check": ["pdfa", "signed"] } }
// → { ..., "checks": { "pdfa": true, "signed": true }, "checksPassed": true }
```

- `check` accepts `pdfa`, `signed`, `encrypted`, `placeholder`, `attachments`,
  and — _(v1.6.0)_ — `dss`, `docTimestamp`, `trapped`, `annotations`.
  `checksPassed` is the AND of all requested assertions; since v1.6.0 `checks`
  contains **only** the requested keys, so branch on `checksPassed` or on a key
  you asked for, never on an absent one.
- `inspect_layout` accepts the same `title` / `blocks` (plus every input that
  moves a block) as `generate_basic_pdf`, so an agent can iterate on pagination
  before spending output tokens on real bytes. Known engine gap: a `toc` block
  is measured as 0 pt, so a document with a printed contents page may paginate
  one page later than previewed.
- `validate_pdf` on unparsable bytes is an error (`PDF_PARSE_FAILED`), not a
  `{ valid: false }` verdict, since v1.6.0 — a parse failure is not a PDF/UA
  result.

Tool-by-tool inputs and error codes are in the [MCP guide](mcp.html).

## Wire it into CI and agent loops

**CI.** Chain the loop with `set -e` so any failed assertion fails the job —
no PDF-viewing human in the path:

```bash
set -e
pdfnative render  --input report.json --output report.pdf --tagged pdfa2b
pdfnative sign    --input report.pdf  --output signed.pdf --key k.pem --cert c.pem
pdfnative inspect --input signed.pdf  --check pdfa --check signed --json --summary
pdfnative verify  --input signed.pdf  --strict --trust ca-root.pem
```

`--dry-run` on the write commands validates inputs without producing output,
which makes a cheap first CI stage; `--summary` / `--fields` keep logs and
agent context small.

**Agent loops.** Treat every generation as unfinished until a read tool
confirms it: after `generate_basic_pdf` (or any document tool), call
`inspect_pdf` with the `check` list that encodes the user's requirements and
branch on `checksPassed`; on failure, correct the tool input and regenerate
rather than apologising with an unverified file. Use `inspect_layout` before
generating and `verbosity: "summary"` on the read tools to keep token spend
proportional. The [agent brief](../agent-brief.md) condenses this contract
into a paste-into-context form.

## Further reading

- [Agent brief](../agent-brief.md) — the compact form of this loop for AI
  agents, verified by the documentation CI.
- [Layout debugging & inspection](debugging.html) — the visual overlay and the
  full `LayoutInspection` data shape.
- [Text extraction](text-extraction.html) — decoding rules, positioned runs,
  documented limits.
- [PDF/A conformance](pdfa.html) — validating archival claims with veraPDF,
  and the build-time `PDFA_*` diagnostics.
- [Long-term validation (LTV)](ltv.html) — the PAdES ladder the signature
  assertions climb.
- [CLI guide](cli.html) · [MCP guide](mcp.html) — the complete surface
  references.
