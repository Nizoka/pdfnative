# pdfnative — agent brief

> A compact, paste-into-your-context briefing for AI agents writing code with
> [pdfnative](https://pdfnative.dev). Everything here is declarative and
> verified against the source tree by the repository's documentation CI.
> Longer forms: [llms.txt](https://pdfnative.dev/llms.txt) (index),
> [llms-full.txt](https://pdfnative.dev/llms-full.txt) (full corpus),
> [llms-index.json](https://pdfnative.dev/llms-index.json) (per-page sizes and anchors).
> _Verified on 2026-09-27 against the source tree by `npm run verify:docs`._

## What it is

pdfnative is a zero-runtime-dependency TypeScript library that generates and
parses ISO 32000-1 (PDF 1.7) and ISO 19005 (PDF/A) conformant PDFs on-device —
Node ≥ 22, browsers, Deno, Bun, Web Workers. No SaaS round-trip, no telemetry,
no sockets. Current version: 1.8.0. It writes (documents, tables, charts,
barcodes, SVG, forms, watermarks, signatures with long-term validation,
typeset paragraphs, CMYK and PDF/X-4 print production) and reads (parse,
decrypt, extract text, read/fill/flatten forms, merge/split/extract pages,
verify PDF/UA and PDF/X-4 structure) — 27 Unicode scripts, with
OpenType GSUB/GPOS shaping for the complex ones (Thai, Arabic, Devanagari,
Bengali, Tamil, Telugu, Sinhala, Tibetan, Khmer, Myanmar, Lao, Tai Tham,
New Tai Lue, Tai Le, Cham; the five Indic scripts on one OpenType engine
since 1.8.0), Latin combining marks (Yoruba, Igbo, NFD text) on the
bundled `latin` module, and full UAX #9 BiDi.

## Choose your surface

- **Writing application code** → the library: `npm install pdfnative`, `import { … } from 'pdfnative'`.
- **Driving a shell, CI, or Makefile** → `pdfnative-cli` (21 commands, JSON-in/JSON-out agent contract with stable `E_*` error codes). New in v1.5.0: typography flags (`--split-paragraphs`, `--keep-headings-with-next`, `--kerning`, `--font-features`), PDF/X-4 output (`--pdfx pdfx4`, `--output-intent-icc`, `--trapped`) checked by `inspect --check pdfx`, your own fonts via `--font-file`, and byte-reproducible builds (global `--creation-date` or `SOURCE_DATE_EPOCH`; global flags may precede the command). Since v1.4.0: the complete PAdES ladder — `sign --timestamp <tsa-url>` (B-T), `ltv collect`/`embed` (B-LT, air-gap-friendly: evidence travels as replayable JSON), `doc-timestamp` (B-LTA) — plus signature-safe `metadata` edits and `compare` (text + structure diff with CI exit codes).
- **You are a conversational assistant with tool access** → `pdfnative-mcp` (28 tools, seven prompts, MCP 2026-07-28 spec; config: `npx -y pdfnative-mcp`). New in v1.7.0: a `typography` object on every document tool and `inspect_layout`, CMYK colours, `pdfx: 'pdfx4'` with `validate_pdf` `standard: 'pdf-x-4'`, 27 scripts in `add_international_text`, and `PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH` for reproducible bytes.
- **The host app is React 19** → `pdfnative-react` (declarative JSX compiled on-device to pdfnative blocks). New in v1.3.0: `<Document typography pdfx outputIntent creationDate>`, `<Paragraph align="justify" keepWithNext splittable>`, CMYK `Color` values, 37 lint rules (`lintDocument` / `lintSpec`). Since v1.2.0: charts v2 (9 kinds, secondary axis), print production via `<Document print>`, and HTTP caching (`etag`/`cacheControl`) on `renderToResponse`.
- Still undecided? The capability × surface matrix decides for you, cell by cell: [choose your surface](https://pdfnative.dev/guides/choose.md).
- Worked architectures combining the surfaces (store-the-spec, air-gapped B-LTA, CI compare gate, edge caching, zipnative as the DEFLATE codec): [use cases](https://pdfnative.dev/guides/use-cases.md); per-surface cases: [CLI](https://pdfnative.dev/guides/use-cases-cli.md), [MCP](https://pdfnative.dev/guides/use-cases-mcp.md), [React](https://pdfnative.dev/guides/use-cases-react.md).

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
| `validatePdfX(bytes)` | Read-only PDF/X-4 structural check → `{ valid, errors, warnings }` (v1.8.0). |
| `setDefaultCreationDate(date)` | Pin every date the writer emits (and so the trailer `/ID`) for reproducible bytes; or pass `layout.creationDate` per build (v1.8.0). |
| `setHyphenationProvider(fn)` | Install a `(word, lang?) => number[]` break-point provider for `typography` (v1.8.0). |

## What 1.8.0 adds (all opt-in, byte-identical when absent)

```ts
const bytes = buildDocumentPDFBytes({
  title: 'Annual report',
  metadata: { trapped: 'False' },                             // PDF/X needs a known trapping state
  blocks: [
    { type: 'heading', text: '1. Results', level: 2 },
    { type: 'paragraph', text: longText, align: 'justify' },   // justification is per paragraph
  ],
  layout: {
    typography: {
      splitParagraphs: true, widows: 2, orphans: 2,           // paragraphs may break across pages
      keepHeadingsWithNext: { minLines: 3 },                  // or true (= 2 lines)
      opticalMargins: true, unitBinding: true,                // hanging punctuation; "12 kg" never splits
      punctuationSpacing: 'fr',                               // needs a registered font for U+202F
      bindShortWords: true,                                   // no line ends on "a" / "I"
      metrics: 'exact', kerning: true, fontFeatures: ['onum'],
      hyphenationLanguage: 'en',                              // passed to the provider
    },
    // Print: CMYK colours are [c, m, y, k] in percent on any color field.
    print: { bleed: 14.17, marks: { colourBars: true } },     // 5 mm bleed; bars are off by default
    // pressProfileBytes: your printer's .icc (an output / prtr profile). For tests, the synthetic
    // profile at https://pdfnative.dev/assets/synthetic-cmyk.icc validates but characterises no press.
    outputIntent: { iccProfile: pressProfileBytes, outputConditionIdentifier: 'FOGRA39' },
    pdfx: 'pdfx4',                                            // exclusive with tagged and encryption
  },
});
const report = validatePdfX(bytes);                           // { valid, errors, warnings }
```

Option types are exported: `TypographyOptions`, `PrintOptions`,
`PrinterMarksOptions`, `ColourBarOptions`, `CustomOutputIntent`,
`PdfXConformanceTarget`. Every option's default and diagnostic is in the
[typography guide](https://pdfnative.dev/guides/typography.md) and the
[print guide](https://pdfnative.dev/guides/print.md); the eight diagnostic
codes (`PDFA_*`, `PDFX_*`, `TYPOGRAPHY_FEATURE_INEFFECTIVE`) and the
build-time error messages (`buildErrors`: PDF/X coherence, print geometry,
OutputIntent profile) are in
[errors.json](https://pdfnative.dev/data/errors.json), each with its remedy.

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
6. **The second argument REPLACES `params.layout` — it does not merge with it.**
   `buildDocumentPDFBytes(params, layoutOptions)` resolves layout as
   `layoutOptions ?? params.layout`, so passing any second argument — even just
   `{ creationDate }` — discards `params.layout` entirely. A `tagged: 'pdfa2b'`
   set inside `params.layout` then vanishes silently: no error, no diagnostic,
   just a PDF that is no longer PDF/A. Put everything in one object, or spread:
   `buildDocumentPDFBytes(params, { ...params.layout, creationDate })`. The
   same rule applies in `inspectDocumentLayout` and every streaming variant.
   The table-centric `buildPDFBytes` is the mirror image: `PdfParams` has no
   `layout` field at all, so there the second argument is the only channel.
7. **This is not pdfkit / jsPDF / pdf-lib.** There is no `new PDFDocument()`,
   no `doc.text(…)`, no `pdf.save()`, no `doc.pipe(…)` — documents are plain
   data (`blocks` arrays) passed to pure functions.
   <!-- verify-docs:allow api-exists (deliberately naming the ghost identifiers to warn against them) -->
   `streamDocumentPdf`, `streamPdf` and `buildPdfStream` have never existed;
   <!-- verify-docs:allow api-exists (same warning, continued) -->
   the streaming exports are `buildDocumentPDFStream`, `buildPDFStream` and their `…True` variants.
8. **`setDeflateImpl()` wants zlib-wrapped output (RFC 1950), not raw DEFLATE.**
   Since 1.8.0 it validates the function at build time and throws on raw
   output; fflate's `deflateSync` is raw — pass `zlibSync`, or give the raw
   function to `setDeflateRawImpl()`. Code written against the 1.7.0 README
   snippet breaks at the first build with `compress: true`.
9. **Four numbers are CMYK.** `parseColor([0, 0, 0, 100])` and
   `parseColor('0 0 0 1')` return a DeviceCMYK operand string since 1.8.0;
   both threw in 1.7.0. Code that relied on the throw to reject four-element
   input must check the length itself.
10. **`extractText()` returns `/ActualText`, not the shown glyphs.** Since
    1.8.0 a tagged span extracts as the characters the writer declared — what
    a RAG pipeline receives from tagged pdfnative output (or any tagged PDF)
    can differ from 1.7.0, and now matches the source text.
11. **`{date}` in a header or footer follows `layout.creationDate`** (or the
    pinned default) since 1.8.0, not the wall clock; a pinned build renders
    the pinned date. Every date is written in UTC (`+00'00'`), so a pinned
    build is byte-identical across machines without a `TZ` pin.

## Verify your own output

pdfnative can read what it writes — use that to close the loop instead of
shipping blind:

```ts
import { buildDocumentPDFBytes, inspectDocumentLayout, extractText, validatePdfUA, validatePdfX } from 'pdfnative';

// tagged: true makes the file PDF/UA-checkable (an untagged file fails validatePdfUA by
// construction); under a tagged claim, register a font (pitfall 3) or the PDF/A diagnostic fires.
const params = { title: 'Report', blocks: [/* … */], fontEntries, layout: { tagged: true, creationDate: new Date('2026-01-01T00:00:00Z') } };

// Before generating: how will it paginate?
const layout = inspectDocumentLayout(params);
if (layout.totalPages > 3) { /* tighten the layout */ }

const bytes = buildDocumentPDFBytes(params);   // same bytes on every run: the date is pinned

// After generating: is the content really there? Is the structure valid?
const pages = extractText(bytes);          // → ExtractedPageText[], one per page
if (!pages[0].text.includes('Report')) throw new Error('content missing');
const ua = validatePdfUA(bytes);
if (!ua.valid) console.warn(ua.errors);
// For a print file built with layout.pdfx: 'pdfx4' (never tagged — PDF/X and tagged are exclusive):
const x = validatePdfX(bytes);             // structural PDF/X-4 prerequisites, not a certified preflight
if (!x.valid) console.warn(x.errors);
```

The same loop exists on every surface: `pdfnative-cli inspect --check … --json`
(exit 1 on failure), and the MCP tools `inspect_pdf`, `inspect_layout`,
`validate_pdf`, `verify_pdf`. A byte-regression gate for your own documents
is the pattern the repository uses on itself: pin the date, hash the output,
compare on every build (`npm run verify:samples` in the pdfnative tree).

## Try it without installing

Fourteen zero-install playgrounds run the engine in the browser from a CDN;
each is described for agents — URL, purpose, DOM control ids, the options it
exercises, preconditions — in
[playgrounds.json](https://pdfnative.dev/data/playgrounds.json). The
[typography](https://pdfnative.dev/playgrounds/typography.html) and
[print](https://pdfnative.dev/playgrounds/print.html) playgrounds cover the
1.8.0 options with a with/without toggle and show the code to reproduce
each result outside the browser; the
[reproducible output](https://pdfnative.dev/playgrounds/reproducible.html)
playground builds twice under a pinned `creationDate` and compares the
SHA-256 digests, and the
[DocSpec lint](https://pdfnative.dev/playgrounds/docspec-lint.html)
playground runs pdfnative-react's 37 rules on a JSON document spec.

## Where to read more

- [Quick start](https://pdfnative.dev/guides/quickstart.md) · [Onboarding](https://pdfnative.dev/guides/onboarding.md) — first PDF in each surface.
- [MCP guide](https://pdfnative.dev/guides/mcp.md) — the 28 tools, schemas, error codes.
- [CLI guide](https://pdfnative.dev/guides/cli.md) — 21 commands and the `--json` / `E_*` agent contract.
- [surfaces.json](https://pdfnative.dev/data/surfaces.json) — the capability × surface matrix as machine-readable JSON: one row per capability, one cell per surface, with `since` versions and an honest note on every unsupported cell.
- [errors.json](https://pdfnative.dev/data/errors.json) — every diagnostic code with meaning and remedy, and every build-time error message a tool must classify (`buildErrors`).
- [api.json](https://pdfnative.dev/assets/api.json) — the public API surface derived from `src/index.ts`: name, kind, module, signature, TSDoc summary.
- Every guide serves raw Markdown at the same URL with `.md`; sizes, SHA-256 and anchors are in [llms-index.json](https://pdfnative.dev/llms-index.json).
