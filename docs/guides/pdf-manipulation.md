# PDF manipulation (merge / split / extract)

> **New in v1.4.0.** Combine, slice, and reorder existing PDFs with a
> production-safe page-tree API. Each operation **rebuilds a clean object graph**
> rather than patching bytes in place — inherited page attributes are resolved,
> dangling references are pruned, and the result is a fresh, well-formed PDF.

## TL;DR

```ts
import { mergePdfs, splitPdf, extractPages } from 'pdfnative';
import { readFileSync, writeFileSync } from 'node:fs';

const a = readFileSync('cover.pdf');
const b = readFileSync('body.pdf');

// Merge
writeFileSync('combined.pdf', mergePdfs([a, b]));

// Split into page ranges (0-based, end-exclusive)
const [intro, rest] = splitPdf(b, [
  { start: 0, end: 2 },   // pages 0–1
  { start: 2, end: 10 },  // pages 2–9
]);

// Extract specific pages (0-based)
writeFileSync('selected.pdf', extractPages(b, [0, 3, 7]));
```

All three accept and return `Uint8Array` PDF bytes.

## `mergePdfs(sources, options?)`

Concatenates multiple PDFs into one, in order.

```ts
function mergePdfs(
  sources: readonly Uint8Array[],
  options?: MergeOptions,
): Uint8Array;

interface MergeOptions {
  /** Strip digital-signature widgets/fields from the result. Default false. */
  dropSignatures?: boolean;
  /** Strip all annotations (links, comments, …) from the result. Default false. */
  dropAnnotations?: boolean;
}
```

- Up to **50 source documents** per call (`MAX_MERGE_SOURCES`).
- Page resources (`/Font`, `/XObject`, …) are deep-copied into a fresh
  object-number space, so there are no collisions between sources.
- Inherited attributes (`/MediaBox`, `/CropBox`, `/Rotate`, `/Resources`) are
  resolved from each page's ancestors and folded onto the page, so pages keep
  their geometry even when the original relied on inheritance.

> Merging a signed PDF invalidates its signature (the bytes change). Pass
> `dropSignatures: true` to remove the now-meaningless signature fields.

## `splitPdf(source, ranges)`

Splits one PDF into several, one output per range.

```ts
function splitPdf(
  source: Uint8Array,
  ranges: readonly PageRange[],
): Uint8Array[];

interface PageRange {
  /** 0-based first page (inclusive). */
  start: number;
  /** 0-based end page (exclusive). */
  end: number;
}
```

Ranges may overlap and need not be contiguous. Each output is an independent,
fully-formed PDF.

## `extractPages(source, indices)`

Builds a new PDF from an explicit list of **0-based** page indices, in the order
given — handy for reordering or cherry-picking.

```ts
function extractPages(source: Uint8Array, indices: readonly number[]): Uint8Array;

extractPages(pdf, [4, 0, 1]); // page 5 first, then 1, then 2
```

## Streaming the result to disk

For freshly *built* (not merged) documents, combine the true streaming builders
with [`streamToFile`](streaming.html) so the binary never fully materialises:

```ts
import { buildDocumentPDFStreamTrue, streamToFile } from 'pdfnative';

await streamToFile(buildDocumentPDFStreamTrue(params), 'report.pdf');
```

`mergePdfs`/`splitPdf`/`extractPages` return a `Uint8Array`, which you can write
directly with `node:fs` `writeFileSync`.

## Safety & limits

- **Encrypted input is rejected.** `assertNotEncrypted()` throws on any source
  carrying an `/Encrypt` dictionary — decrypt first.
- **Annotations are filtered to URI `/Link` only** during the rebuild (plus the
  full strip when `dropAnnotations` is set), so interactive form/JS annotations
  don't leak across documents.
- **Bounded-depth copy.** The object-graph copy is capped at a fixed recursion
  depth, so a pathologically nested or adversarial source can never overflow the
  stack — it throws a descriptive error instead.
- **Deterministic output.** Every result carries a content-addressed trailer
  `/ID` (ISO 32000-1 §7.5.5) derived from the assembled bytes, so the same
  inputs always produce a byte-identical PDF — friendly to caching, diffing, and
  reproducible builds.
- **Full rebuild, not in-place surgery.** The clean-graph approach trades a
  little speed for correctness and is safe to run on third-party PDFs.

## How it works

[`src/parser/pdf-pagetree.ts`](https://github.com/Nizoka/pdfnative/blob/main/src/parser/pdf-pagetree.ts)
opens each source with the built-in [PDF reader](architecture.html), walks the
page tree, and deep-copies every kept page plus its transitive object graph into
a new document (`obj 1` = Catalog, `obj 2` = Pages root, `obj 3+` = the copied
graph). The copy is **memoised per reader** and **cycle-safe**, and all values
are serialised binary-safe (Latin-1) so embedded fonts and image streams survive
intact.

## See also

- [Architecture](architecture.html) — the parser/reader internals
- [Streaming output](streaming.html) — `streamToFile`
- [Outlines & page labels](outlines.html)
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
