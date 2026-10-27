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
  onStreamError?: 'limit' | 'throw' | 'skip'; // v1.9.0 — what an undecodable stream does (see Safety bounds)
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

Since pdfnative **1.7.0** the `/ToUnicode` coverage is complete across both <!-- verify-docs:allow version-token (historical: the release that completed it) -->
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

### Undecodable streams (v1.9.0)

A content stream that cannot be decoded is reported, not silently dropped: a stream whose inflated size would exceed the cap (`setMaxInflateOutputSize`) throws `PdfStreamLimitError` (`code: 'PDF_STREAM_LIMIT'`) from `extractText()` — the default, `onStreamError: 'limit'`, since an over-cap stream is the one case where a page without its text would hide an attack rather than a defect. `'throw'` reports any stream that fails to decode (a corrupt Flate stream, an unsupported filter); `'skip'` restores the pre-1.9.0 lenience and returns the page without that stream's text. The same error class is thrown by `inflateSync()` and the other decode filters, and by the native zlib wrapper when Node's buffer limit is hit.

## Limitations

By design (documented, not bugs):

- **No OCR** — image-only/scanned pages yield empty text.
- Type3 fonts are decoded via their encoding/`ToUnicode` only (glyph
  procedures are not interpreted).
- Non-Identity CMap `/Encoding`s (e.g. predefined UTF-16 CJK CMaps) are
  decoded best-effort as 2-byte codes through `/ToUnicode`.
- Vertical writing mode is treated as horizontal.
- The structure tree is not consulted — order is geometric. `/ActualText`
  on marked content **is** honoured (v1.8.0): a `/Span` that declares
  the characters behind a ligature, a shaped cluster or a justified line
  extracts as those characters, outermost span first. Without it,
  ligature reversal is only as good as the embedded `/ToUnicode`. Since
  v1.8.0 the Indic engine (Devanagari, Bengali, Tamil, Telugu, Sinhala)
  and the Latin combining-mark shaper report the code points behind every
  glyph they emit, and pdfnative writes them into `/ToUnicode` as
  multi-code-point entries, so a conjunct such as क्ष or a composed ẹ́
  extracts as its letters even in an untagged document. Since v1.9.0
  **every shaper** reports the code points behind every glyph it emits —
  Thai, Lao, Khmer, Myanmar, Tibetan, Tai Tham, Cham, the Arabic
  positional forms and lam-alef ligatures — and the code point that was
  actually encoded has priority over the font's inverted cmap, so a CJK
  glyph reachable from U+2E80 and U+4E00 is named by the one typed and
  Persian digits stay Persian. A run whose glyphs are not in the order of
  its text — an Indic pre-base vowel sign drawn before its consonant, a
  reph moved after the base, a split vowel sign set as its two parts, a
  Khmer or Myanmar pre-base vowel, Thai and Lao sara am (ำ U+0E33, ຳ U+0EB3)
  set as nikhahit + sara aa, a Thai tone mark set before a below vowel —
  carries its text as `/Span /ActualText` even in untagged output (opt out
  with `layout.actualText: false`), which is what Chrome and Skia write,
  so extraction of an untagged Hindi, Tamil or Khmer document returns the
  words as typed rather than in drawing order. Every right-to-left run
  carries its logical text the same way (what Skia writes for every
  reversed cluster), so an untagged Arabic or Hebrew line comes back as
  typed from `extractText()`, Acrobat Reader and Chrome alike; a line
  mixing directions returns its runs in geometric order, each one
  logical. Every such span wraps a single text
  object: since v1.9.0 a line or cell is one `BT … ET` and a shaped run one
  `TJ` array, because Acrobat applies `/ActualText` once per text object
  — a cell drawn as one text object per glyph pasted its text once per
  glyph in Acrobat Reader, while pdfnative's own extractor and Chrome,
  which apply the span once, never showed it. Under `tagged: 'pdfa2u'`
  the `PDFA_GLYPH_WITHOUT_UNICODE` diagnostic names any glyph that still
  has no mapping (a character the font does not cover) — see the
  [PDF/A guide](pdfa.html). What remains geometric is the **order of the
  runs**: they are sorted by position, so a line that mixes a Latin
  island with Arabic comes back island and runs in visual order, each
  run logical, and a tagged document returns the whole line as its
  structure span wrote it — see the [right-to-left guide](rtl.html).

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
