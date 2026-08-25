# Text extraction

> **New in v1.6.0.** Extract Unicode text from **any PDF** — including
> encrypted ones — with `extractText()`: per-page reading-order text plus
> optional positioned runs. Pure content-stream decoding, zero
> dependencies, no OCR engine, no rasterisation.

## TL;DR

```ts
import { extractText } from 'pdfnative';
import { readFileSync } from 'node:fs';

const bytes = readFileSync('report.pdf');

for (const page of extractText(bytes)) {
  console.log(`--- page ${page.pageIndex + 1} ---`);
  console.log(page.text);
}

// Encrypted documents: pass the password (decryption is transparent).
const secret = extractText(readFileSync('locked.pdf'), { password: 'hunter2' });

// Positioned runs for layout-aware consumers (search hit boxes, RAG chunking).
const [first] = extractText(bytes, { includeRuns: true, pages: [0] });
for (const run of first.runs ?? []) {
  console.log(run.text, `@ (${run.x.toFixed(1)}, ${run.y.toFixed(1)})`, run.fontSize);
}
```

## `extractText(bytes, options?)`

Returns one `ExtractedPageText` per requested page, in ascending page order:

```ts
interface ExtractTextOptions {
  password?: string;        // for encrypted documents (delegated to openPdf)
  pages?: number[];         // 0-based page indices; default: all pages
  includeRuns?: boolean;    // also return positioned runs (default false)
  maxTextLength?: number;   // hard cap on total characters (default 16 000 000)
}

interface ExtractedPageText {
  pageIndex: number;        // 0-based index in the source document
  text: string;             // reading-order text, '\n' between lines
  runs?: ExtractedTextRun[];// content-stream order, when includeRuns is true
}

interface ExtractedTextRun {
  text: string;             // decoded text of one show operation
  x: number; y: number;     // device-space origin of the run (points)
  fontSize: number;         // effective size (Tf size scaled by Tm × CTM)
  fontName: string;         // font resource name, e.g. 'F1'
}
```

## How text is decoded

For every shown string, the extractor resolves each character code in
this order:

| Source | Used for | Notes |
| --- | --- | --- |
| `/ToUnicode` CMap | any font that embeds one | `bfchar`, `bfrange` (both destination forms), surrogate pairs |
| `/Encoding /Differences` | simple fonts | glyph names resolved through a compact AGL subset + `uniXXXX` / `uXXXX[XX]` patterns |
| Base encoding | simple fonts | `WinAnsiEncoding` (CP-1252) or `MacRomanEncoding` tables |
| Fallback | no `/Encoding` at all | WinAnsi heuristic (covers pdfnative's own base-14 output and most western PDFs) |
| No mapping anywhere | — | U+FFFD `�` per code |

Type0 (CID) fonts are decoded as 2-byte codes (`Identity-H`/`Identity-V`),
mapped through their `/ToUnicode` CMap — which pdfnative's own CIDFont
output always embeds, so **pdfnative-generated documents round-trip
losslessly**, including CJK, Arabic, and emoji.

Since pdfnative **1.7.0** the `/ToUnicode` coverage is complete across both
builders: base-14 font dictionaries are reached under tagged mode and the
AcroForm `/Helv` dictionary carries a CMap in every mode — so base-14 text in
tagged documents and **text typed into form fields** now extract cleanly too.

## Reading order and runs

`page.text` is assembled geometrically: runs are grouped into lines by
baseline (tolerance scales with font size), lines are sorted top→bottom,
runs within a line left→right, and a space is inserted where a visible
horizontal gap separates two runs. Large negative `TJ` kerning
adjustments (≤ −180/1000 em) are treated as word spaces.

`page.runs` (opt-in) preserves **content-stream order** — useful when you
need the emitter's sequence rather than the geometric one. Positions are
device-space points: `Tm × CTM` is tracked through `q`/`Q`/`cm`, so
rotated and scaled content reports its true placement. Text inside Form
XObjects is extracted too (`Do` recursion, depth-capped).

## Encrypted documents

`extractText` rides on `openPdf`: RC4, AES-128 and AES-256 documents
decrypt transparently with `options.password`. A missing or wrong
password throws `PdfPasswordError`; a document with an empty user
password opens without one.

## Safety bounds

Designed to be safe on untrusted input:

- `maxTextLength` (default 16 M characters) hard-caps the total output —
  exceeding it throws rather than exhausting memory.
- Decompressed stream sizes are bounded by the parser's global inflate
  cap (`setMaxInflateOutputSize`).
- The interpreter is recursion-free with capped stacks (graphics state,
  operands, CMap entries, Form-XObject depth) and never throws on
  malformed content streams — unknown operators are skipped, unbalanced
  `BT`/`q` tolerated, inline images (`BI…EI`) byte-skipped.

## Limitations

By design (documented, not bugs):

- **No OCR** — image-only/scanned pages yield empty text.
- Type3 fonts are decoded via their encoding/`ToUnicode` only (glyph
  procedures are not interpreted).
- Non-Identity CMap `/Encoding`s (e.g. predefined UTF-16 CJK CMaps) are
  decoded best-effort as 2-byte codes through `/ToUnicode`.
- Vertical writing mode is treated as horizontal.
- The structure tree / `/ActualText` is not consulted — order is
  geometric, and ligature reversal is only as good as the embedded
  `/ToUnicode`. In practice this means **shaped Indic scripts**
  (Devanagari, Bengali, Tamil, Telugu, Sinhala, …) extract with U+FFFD
  for conjunct/ligature glyphs that have no single-codepoint mapping —
  the PDF *renders* correctly; only extraction of those clusters is
  lossy. Latin, CJK, Arabic and emoji round-trip cleanly.

## Samples

Generated by `npm run test:generate`:

- `parser/text-extract-source.pdf` — a rich source document.
- `parser/text-extract-report.pdf` — its extraction rendered back to PDF
  (text + positioned-run table).
- `parser/text-extract-encrypted-report.pdf` — AES-256 encrypted source,
  extracted with a password.

## See also

- [PDF manipulation](pdf-manipulation.html) — merge / split / extract pages.
- [Form filling](form-filling.html) — read and fill AcroForm fields.
- [Debugging & layout inspection](debugging.html) — geometry the writer
  side reports.
