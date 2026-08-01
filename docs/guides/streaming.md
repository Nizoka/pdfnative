# Streaming output

> pdfnative emits PDFs as `AsyncGenerator<Uint8Array>` so you can pipe them to disk, an HTTP response, or a Web Stream without buffering the whole document. **New in v1.3.0:** a mode in which the fully-joined PDF binary never exists in memory — see [what this does and does not buy you](#what-this-does-and-does-not-buy-you) for the exact profile.

## Three streaming modes

| Function | Memory profile | When to use |
|---|---|---|
| `buildDocumentPDFStream` / `buildPDFStream` | Assembles full binary, then yields fixed-size chunks | Simple back-pressure-friendly piping |
| `buildDocumentPDFStreamPageByPage` / `buildPDFStreamPageByPage` | Assembles full binary, yields one PDF object per chunk | Object-granular persistence / diagnostics |
| **`buildDocumentPDFStreamTrue` / `buildPDFStreamTrue`** | **Never joins the binary — frees each part as it yields** | Large documents, and anything over ~512 MB of output |

All three produce **byte-identical** output to `buildDocumentPDFBytes()` /
`buildPDFBytes()`.

## Streaming without joining the binary (v1.3.0)

```ts
import { createWriteStream } from 'node:fs';
import { buildDocumentPDFStreamTrue } from 'pdfnative';

const out = createWriteStream('report.pdf');
for await (const chunk of buildDocumentPDFStreamTrue(params, layout, { chunkSize: 65536 })) {
  out.write(chunk);
}
out.end();
```

Internally, the builder assembles the PDF into an array of raw parts (objects,
xref, trailer) and the generator walks that array, encoding each part to bytes
and **freeing it (`parts[i] = ''`) as soon as it is emitted**.

### What this does and does not buy you

Being precise here matters, because the two claims are often conflated.

**What it avoids.** The joined PDF binary never exists. That removes a full
second copy of the document, and it lifts the hard ceiling that
`buildDocumentPDFStream` hits: that variant joins everything into one JavaScript
string, and V8 caps a single string at roughly 512 MB. Past that point it throws
regardless of how much RAM the machine has. `buildDocumentPDFStreamTrue` has no
such ceiling.

**What it does not avoid.** `assembleDocumentParts()` runs to completion before
the first chunk is yielded, so every part is resident at that moment. Peak memory
is therefore still proportional to total output size — roughly 2 bytes per output
character, since JavaScript strings are UTF-16. From the first yield onwards
memory falls monotonically as parts are freed, but the peak has already happened.

Two practical consequences:

- Budget for about twice your expected output size, not for a fixed ceiling.
  A 300 MB PDF wants roughly 600 MB of headroom.
- **There is no progress signal during assembly.** Most of the wall-clock time is
  spent inside `assembleDocumentParts()`, which yields nothing, so a percentage
  bar covering that phase would be invented rather than measured. Report an
  indeterminate state until the first chunk arrives, then switch to a byte
  counter. The [scale playground](../playgrounds/scale.html) does exactly this.

True page-by-page assembly — where peak memory is bounded by one page rather than
the whole document — is not implemented yet.

### HTTP response (Node)

```ts
import { buildDocumentPDFStreamTrue } from 'pdfnative';

app.get('/report.pdf', async (req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  for await (const chunk of buildDocumentPDFStreamTrue(params)) {
    res.write(chunk);
  }
  res.end();
});
```

### Web Streams (browser / Deno / edge)

```ts
const stream = new ReadableStream({
  async pull(controller) {
    for await (const chunk of buildDocumentPDFStreamTrue(params)) {
      controller.enqueue(chunk);
    }
    controller.close();
  },
});
return new Response(stream, { headers: { 'Content-Type': 'application/pdf' } });
```

## Options

```ts
interface StreamOptions {
  /** Bytes per yielded chunk. Default 65536 (64 KB). Clamped to 1 KB–16 MB. */
  chunkSize?: number;
}
```

## Draining to a file: `streamToFile` (v1.4.0)

`streamToFile()` drains **any** `AsyncGenerator<Uint8Array>` — including all
three streaming modes above — straight to a file on disk in Node.js. It honours
the OS write back-pressure (awaiting the `'drain'` event when the kernel buffer
fills) and supports cancellation via an `AbortSignal`, so a single call covers
the common "generate a large PDF to disk without buffering it" case.

```ts
import { buildDocumentPDFStreamTrue, streamToFile } from 'pdfnative';

const { bytesWritten, path } = await streamToFile(
  buildDocumentPDFStreamTrue(params),
  'report.pdf',
);
console.log(`Wrote ${bytesWritten} bytes to ${path}`);
```

### Cancellation

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000); // give up after 5s

await streamToFile(buildDocumentPDFStreamTrue(params), 'report.pdf', {
  signal: ac.signal,
}); // rejects with the abort reason; the partial file is closed
```

On abort — or on any write error — `streamToFile` releases the file descriptor
and **removes the partially-written file** (best-effort), so a cancelled or
failed run never leaves an orphaned half-written PDF on disk.

`streamToFile` is Node-only — it loads `node:fs` lazily via a dynamic import,
so importing it in a browser or Deno bundle adds no static Node dependency. In
non-Node runtimes, drive the generator yourself with the Web Streams snippet
above.

## Streaming merge & split (v1.6.0)

The page-tree API has constant-memory variants —
`streamMergedPdfs` / `streamSplitPdf` / `streamExtractPages` — that emit the
assembled document as fixed-size chunks while holding only the cross-reference
offsets in memory. Each is byte-identical to its buffered counterpart and
composes with `streamToFile`. (Exception: with `MergeOptions.encrypt` the
output is AES-encrypted with fresh random IVs/salts, so repeated invocations
are structurally — not byte — identical.)

```ts
import { streamMergedPdfs, streamSplitPdf, streamToFile } from 'pdfnative';

await streamToFile(streamMergedPdfs([a, b]), 'combined.pdf');

for await (const part of streamSplitPdf(body, ranges)) {
  await streamToFile(part.pdf, `part-${part.index}.pdf`);   // drain each fully, in order
}
```

Note the honest memory profile: **output** bytes are never buffered, but the
**source** PDFs are still in-memory `Uint8Array`s. See the
[PDF manipulation guide](pdf-manipulation.html#streaming-merge--split) for the
full API.

## Constraints

Streaming is incompatible with two features that need a second pass over the
whole document. Both are validated at the boundary and throw a descriptive
error:

- **TOC blocks** — the table of contents requires multi-pass pagination to
  resolve page numbers.
- **`{pages}` placeholder** in header/footer templates — the total page count
  is unknown during progressive emission. Use `{page}` instead, or fall back to
  `buildDocumentPDFBytes()`.

## See also

- [Quick start](quickstart.html)
- [Architecture](architecture.html)
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
