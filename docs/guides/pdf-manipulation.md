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

// Split into page ranges (0-based, end inclusive; end defaults to start)
const [intro, rest] = splitPdf(b, [
  { start: 0, end: 1 },   // pages 0–1
  { start: 2, end: 9 },   // pages 2–9
]);

// Extract specific pages (0-based)
writeFileSync('selected.pdf', extractPages(b, [0, 3, 7]));
```

All three accept and return `Uint8Array` PDF bytes.

> **New in v1.6.0.** Encrypted sources are now **decrypted on ingest** — pass a
> password (see [Encrypted sources](#encrypted-sources)) — the rebuilt output
> can be **re-encrypted** with `encrypt` (see
> [Re-encrypting the output](#re-encrypting-the-output)), and there are
> constant-memory **streaming** variants (`streamMergedPdfs` / `streamSplitPdf` /
> `streamExtractPages`, see [Streaming merge & split](#streaming-merge--split)).

## `mergePdfs(sources, options?)`

Concatenates multiple PDFs into one, in order.

```ts
function mergePdfs(
  sources: readonly PdfSourceInput[],
  options?: MergeOptions,
): Uint8Array;

// Raw bytes, or bytes + password for an encrypted source (v1.6.0):
type PdfSourceInput = Uint8Array | { bytes: Uint8Array; password?: string };

interface MergeOptions {
  /** Strip digital-signature widgets/fields from the result. Default false. */
  dropSignatures?: boolean;
  /** Strip all annotations (links, comments, …) from the result. Default false. */
  dropAnnotations?: boolean;
  /** Password used to decrypt encrypted sources (default for every source). v1.6.0 */
  password?: string;
  /**
   * Maximum size, in bytes, of the assembled output. The operation throws as
   * soon as the copied object graph would exceed this limit — even mid-copy,
   * before an oversized stream is materialised — so a malicious or accidentally
   * huge source cannot exhaust process memory. Defaults to **256 MiB**; pass
   * `Infinity` to disable (not recommended for untrusted input).
   */
  maxOutputSize?: number;
}
```

- Up to **50 source documents** per call (`MAX_MERGE_SOURCES`).
- Output is hard-capped at **256 MiB** by default (`maxOutputSize`) so a hostile
  source cannot OOM the process; raise it for legitimately large merges.
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
  options?: MergeOptions,
): Uint8Array[];

interface PageRange {
  /** 0-based first page (inclusive). */
  start: number;
  /** 0-based last page (inclusive). Defaults to `start` (single page). */
  end?: number;
}
```

Ranges may overlap and need not be contiguous. Each output is an independent,
fully-formed PDF. `options` (including `maxOutputSize`) applies to every emitted
document.

## `extractPages(source, indices)`

Builds a new PDF from an explicit list of **0-based** page indices, in the order
given — handy for reordering or cherry-picking.

```ts
function extractPages(
  source: Uint8Array,
  indices: readonly number[],
  options?: MergeOptions,
): Uint8Array;

extractPages(pdf, [4, 0, 1]); // page 5 first, then 1, then 2
```

`options` (including `maxOutputSize` and `dropAnnotations`) is honoured here too.

## Encrypted sources

Since **v1.6.0**, `mergePdfs` / `splitPdf` / `extractPages` decrypt encrypted
sources transparently (Standard Security Handler — RC4, AES-128, AES-256). Give
the password either per-source or as a shared default:

```ts
// Per-source password (only that source is encrypted):
mergePdfs([cover, { bytes: encryptedBody, password: 'secret' }]);

// Shared password for every source, via options:
mergePdfs([a, b], { password: 'secret' });

// splitPdf / extractPages take the password on options:
splitPdf(encrypted, [{ start: 0, end: 2 }], { password: 'secret' });
```

A wrong or missing password throws `PdfPasswordError`; an unsupported handler
(e.g. public-key) throws `PdfEncryptionUnsupportedError`. The rebuilt output is
unencrypted **unless you set `encrypt`** (below). See the
[reader guide](../guides/architecture.html) for `openPdf(bytes, { password })`.

## Re-encrypting the output

Since **v1.6.0**, `MergeOptions.encrypt` re-encrypts the rebuilt document —
closing the round trip: *open encrypted → edit → re-secure*. It takes the same
shape as the document builder's `encryption` option:

```ts
import { mergePdfs, splitPdf } from 'pdfnative';

// Merge, then protect the result (AES-256):
const secured = mergePdfs([a, b], {
  encrypt: {
    ownerPassword: 'owner-secret',      // required, non-empty
    userPassword: 'user-secret',        // optional (empty = opens freely)
    algorithm: 'aes256',                // 'aes128' (V4/R4, default) | 'aes256' (V5/R6)
    permissions: { print: true, copy: false, modify: false },
  },
});

// Change a document's password: decrypt on ingest, re-encrypt on output.
const rekeyed = mergePdfs(
  [{ bytes: oldPdf, password: 'old-password' }],
  { encrypt: { ownerPassword: 'new-password', algorithm: 'aes256' } },
);

// Works identically on splitPdf / extractPages and the streaming variants.
splitPdf(src, [{ start: 0, end: 4 }], { encrypt: { ownerPassword: 'o' } });
```

Notes:

- **AES only** — new output is never RC4-encrypted (legacy RC4 is read-only).
- **CSPRNG required** — a missing Web Crypto secure random source throws
  before any copying starts (encryption keys are never derived from
  `Math.random()`).
- **Fresh keys** — no key material, permissions, or passwords from any source
  document are reused; the caller states the new protection explicitly.
- **Non-deterministic output** — random IVs/salts and a random document `/ID`
  mean encrypted output is not byte-reproducible (the unencrypted path keeps
  its content-addressed deterministic `/ID`).

## Streaming merge & split

For large documents, the streaming variants emit the result as fixed-size
chunks while holding only the cross-reference offsets and small object dicts in
memory — stream payloads flow straight from the (in-memory) source bytes, so the
fully-joined document is never materialised. Each is **byte-identical** to its
buffered counterpart (except with `encrypt`, where fresh random IVs make each
invocation structurally — not byte — identical) and composes with
[`streamToFile`](streaming.html):

```ts
import { streamMergedPdfs, streamSplitPdf, streamToFile } from 'pdfnative';

// Constant-memory merge straight to disk:
await streamToFile(streamMergedPdfs([a, b]), 'combined.pdf');

// Split: one output stream per range (drain each fully before advancing):
for await (const part of streamSplitPdf(body, [{ start: 0, end: 1 }, { start: 2, end: 9 }])) {
  await streamToFile(part.pdf, `part-${part.index}.pdf`);
}
```

`StreamMergeOptions` adds `chunkSize` (1 KiB–16 MiB, default 64 KiB) on top of
`MergeOptions`. For multi-gigabyte merges pass `maxOutputSize: Infinity` — safe
with streaming because output bytes are never buffered (the sources themselves
are still in-memory `Uint8Array`s).

For freshly *built* (not merged) documents, combine the true streaming builders
with [`streamToFile`](streaming.html) so the binary never fully materialises:

```ts
import { buildDocumentPDFStreamTrue, streamToFile } from 'pdfnative';

await streamToFile(buildDocumentPDFStreamTrue(params), 'report.pdf');
```

## Safety & limits

- **Encrypted input is decrypted on ingest** (v1.6.0) when a valid password is
  supplied; a wrong/missing password throws `PdfPasswordError`. Output is
  unencrypted unless `encrypt` re-protects it (AES-128/AES-256, CSPRNG
  required, fresh keys only).
- **Annotations are filtered to URI `/Link` only** during the rebuild (plus the
  full strip when `dropAnnotations` is set), so interactive form/JS annotations
  don't leak across documents.
- **Bounded-depth copy.** The object-graph copy is capped at a fixed recursion
  depth, so a pathologically nested or adversarial source can never overflow the
  stack — it throws a descriptive error instead.
- **Bounded output size.** Cumulative output is capped at **256 MiB** by default
  (`maxOutputSize`), checked *before* each stream is materialised, so a source
  full of multi-gigabyte objects is rejected rather than allowed to exhaust
  memory. Tune or disable (`Infinity`) per call.
- **Deterministic output.** Every unencrypted result carries a
  content-addressed trailer `/ID` (ISO 32000-1 §7.5.5) derived from the
  assembled bytes, so the same inputs always produce a byte-identical PDF —
  friendly to caching, diffing, and reproducible builds. (With `encrypt`, the
  `/ID` is the encryption state's random document ID, as the file key is bound
  to it.)
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
