# Benchmark results

The figures published on [pdfnative.dev#benchmarks](https://pdfnative.dev/#benchmarks) come
from this file, and `npm run verify:docs` fails the build if the two disagree.
Regenerate by running `npm run bench` and recording the `mean` column, the
hardware, and the date.

Numbers with no run context are not evidence, so every table here carries one.

## Run of 2026-07-30 — pdfnative 1.6.0

| | |
|---|---|
| Command | `npm run bench` (`vitest bench`, vitest 4.1.8) |
| Node.js | 22.17.0 |
| Platform | Windows 11, Intel Core i3 mini-PC |
| Metric | mean wall-clock milliseconds per document, `hz` = documents per second |

### `buildPDF` — Latin (WinAnsi, no embedded font)

| Rows | mean (ms) | p75 (ms) | hz | rme | samples |
|---|---|---|---|---|---|
| 100 | 3.34 | 4.29 | 299.8 | ±7.5% | 151 |
| 500 | 11.21 | 12.30 | 89.2 | ±6.0% | 45 |
| 1 000 | 18.67 | 19.72 | 53.6 | ±3.8% | 27 |
| 5 000 | 98.06 | 98.25 | 10.2 | ±8.6% | 10 |

### `buildPDF` — embedded-font path (mock TTF)

**This does not measure OpenType shaping or BiDi.** The fixture
(`makeUnicodeParams`, [pdf-benchmark.bench.ts:65](pdf-benchmark.bench.ts))
attaches a synthetic font — `ttfBase64: 'AAAAAAAAAA=='`, an empty `gsub` table,
no mark anchors, a cmap covering ASCII plus ten accented characters — to the
*same French Latin* row fixture. What it exercises is the CID/embedded-font
code path: subsetting bookkeeping, glyph-id mapping and the wider text-showing
operators. No non-Latin codepoint is involved.

Shaped-script throughput (Arabic, Devanagari, Thai…) is **not currently
benchmarked**. Do not quote these rows as a shaping measurement.

| Rows | mean (ms) | p75 (ms) | hz | rme | samples |
|---|---|---|---|---|---|
| 100 | 8.38 | 8.78 | 119.3 | ±4.1% | 60 |
| 500 | 36.16 | 36.73 | 27.7 | ±4.1% | 14 |
| 1 000 | 80.51 | 92.84 | 12.4 | ±13.1% | 10 |

### `buildPDFBytes` — full pipeline to `Uint8Array`

| Case | mean (ms) | p75 (ms) | hz | rme | samples |
|---|---|---|---|---|---|
| 500 rows, Latin | 10.31 | 10.86 | 97.0 | ±4.0% | 47 |
| 500 rows, embedded font | 36.60 | 37.90 | 27.3 | ±3.6% | 14 |

### Reading these numbers

- **The relative error reaches ±13%** on the smallest sample sets, on a
  low-power mini-PC. Treat them as an order of magnitude, not a specification.
- Faster hardware (Apple M-series, desktop i7/i9) typically runs 2–4× quicker.
- Nothing here compares pdfnative to another library. No such benchmark exists
  in this repository, so no such claim is made anywhere on the site.

## Large-document streaming — 2026-07-30

Measured with the same generator the [scale playground](../docs/playgrounds/scale.html)
uses: `buildDocumentPDFStreamTrue`, lean content of three blocks per page
(`heading`, `paragraph`, and a `pageBreak` between consecutive pages), 256 KB
chunks, an explicit `footerTemplate`, output counted and discarded. Page counts
are parsed from the emitted bytes rather than assumed.

| Pages requested | Pages measured | Output | Wall clock | Pages/s | Bytes/page |
|---|---|---|---|---|---|
| 1 000 | 1 000 | 484 KB | 0.08 s | 12 721 | 496 |
| 10 000 | 10 000 | 4.9 MB | 0.41 s | 24 517 | 501 |
| 50 000 | 50 000 | 24.7 MB | 2.09 s | 23 933 | 505 |
| 100 000 | 100 000 | 49.8 MB | 3.72 s | 26 884 | 509 |

Throughput is flat from 10 000 pages upwards, which is the point of the
measurement: the cost per page does not degrade with document length. Peak
memory still scales with output size — see
[the streaming guide](../docs/guides/streaming.md#what-this-does-and-does-not-buy-you).

An earlier run of this table reported roughly a third of this throughput. That
run counted pages with a per-byte `String.fromCharCode` loop, which cost more
than the generation it was measuring; the counter now uses `TextDecoder`. The
lesson is recorded here rather than quietly corrected: an instrument that
perturbs its measurement is worse than no instrument.

Denser pages cost proportionally more. This content is deliberately lean so that
the page count is exact and known before generation, which is what makes the
pages-per-second figure meaningful rather than derived from a byte estimate.
