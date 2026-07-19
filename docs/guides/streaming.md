# Streaming output

> pdfnative emits PDFs as `AsyncGenerator<Uint8Array>` so you can pipe them to disk, an HTTP response, or a Web Stream without buffering the whole document. **New in v1.3.0:** *true constant-memory* streaming, where the fully-joined PDF binary never exists in memory.

## Three streaming modes

| Function | Memory profile | When to use |
|---|---|---|
| `buildDocumentPDFStream` / `buildPDFStream` | Assembles full binary, then yields fixed-size chunks | Simple back-pressure-friendly piping |
| `buildDocumentPDFStreamPageByPage` / `buildPDFStreamPageByPage` | Assembles full binary, yields one PDF object per chunk | Object-granular persistence / diagnostics |
| **`buildDocumentPDFStreamTrue` / `buildPDFStreamTrue`** | **Never joins the binary — frees each part as it yields** | Large documents, constant memory |

All three produce **byte-identical** output to `buildDocumentPDFBytes()` /
`buildPDFBytes()`.

## True constant-memory streaming (v1.3.0)

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
and **freeing it (`parts[i] = ''`) as soon as it is emitted**. Peak memory is
bounded by the chunk size plus the single largest part — typically the biggest
content stream or embedded font subset — rather than the whole document.

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

const { bytesWritten, chunks } = await streamToFile(
  buildDocumentPDFStreamTrue(params),
  'report.pdf',
);
console.log(`Wrote ${bytesWritten} bytes in ${chunks} chunks`);
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
composes with `streamToFile`:

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
