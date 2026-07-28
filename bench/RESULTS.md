# Benchmark results

The figures published on [pdfnative.dev#benchmarks](https://pdfnative.dev/#benchmarks) come
from this file. Regenerate it by running `npm run bench` and recording the `mean`
column, the hardware, and the date.

Numbers with no run context are not evidence, so every table here carries one.

## Run of 2026-07-28 — pdfnative 1.6.0

| | |
|---|---|
| Command | `npm run bench` (`vitest bench`, vitest 4.1.8) |
| Node.js | 22.17.0 |
| Platform | Windows 11, Intel Core i3 mini-PC |
| Metric | mean wall-clock milliseconds per document, `hz` = documents per second |

### `buildPDF` — Latin (WinAnsi, no embedded font)

| Rows | mean (ms) | p75 (ms) | hz | rme | samples |
|---|---|---|---|---|---|
| 100 | 4.01 | 4.36 | 249.5 | ±20.3% | 125 |
| 500 | 16.50 | 19.33 | 60.6 | ±23.4% | 31 |
| 1 000 | 21.74 | 23.66 | 46.0 | ±7.0% | 23 |
| 5 000 | 113.34 | 140.22 | 8.8 | ±17.5% | 10 |

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
| 100 | 7.58 | 8.22 | 132.0 | ±3.1% | 66 |
| 500 | 38.36 | 34.56 | 26.1 | ±27.9% | 14 |
| 1 000 | 83.16 | 70.74 | 12.0 | ±34.2% | 10 |

### `buildPDFBytes` — full pipeline to `Uint8Array`

| Case | mean (ms) | p75 (ms) | hz | rme | samples |
|---|---|---|---|---|---|
| 500 rows, Latin | 9.64 | 9.97 | 103.8 | ±3.2% | 53 |
| 500 rows, embedded font | 35.17 | 36.65 | 28.4 | ±2.4% | 15 |

### Reading these numbers

- **The relative error is large on several rows** (up to ±34%), because the
  sample counts are small and the machine is a low-power mini-PC. Treat them as
  an order of magnitude, not a specification.
- Faster hardware (Apple M-series, desktop i7/i9) typically runs 2–4× quicker.
- Nothing here compares pdfnative to another library. No such benchmark exists
  in this repository, so no such claim is made anywhere on the site.

## Large-document streaming — 2026-07-28

Measured with the same generator the [scale playground](../docs/playgrounds/scale.html)
uses: `buildDocumentPDFStreamTrue`, lean content of two blocks per page, 256 KB
chunks, output counted and discarded. Page counts are parsed from the emitted
bytes rather than assumed.

| Pages requested | Pages measured | Output | Wall clock | Pages/s | Bytes/page |
|---|---|---|---|---|---|
| 1 000 | 1 000 | 781 KB | 0.17 s | 5 856 | 799 |
| 10 000 | 10 000 | 7.9 MB | 1.23 s | 8 146 | 806 |
| 50 000 | 50 000 | 39.6 MB | 6.33 s | 7 895 | 811 |
| 100 000 | 100 000 | 79.6 MB | 12.66 s | 7 900 | 815 |

Throughput is essentially flat from 10 000 pages upwards, which is the point of
the measurement: the cost per page does not degrade with document length. Peak
memory still scales with output size — see
[the streaming guide](../docs/guides/streaming.md#what-this-does-and-does-not-buy-you).

Denser pages cost proportionally more. This content is deliberately lean so that
the page count is exact and known before generation, which is what makes the
pages-per-second figure meaningful rather than derived from a byte estimate.
