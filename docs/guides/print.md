# Print production — bleed, trim & printer's marks

> **New in v1.7.0.** Print-ready PDFs with zero dependencies: page geometry boxes (`/TrimBox`, `/BleedBox`, `/ArtBox`, `/CropBox`), crop and registration marks drawn as pure vector operators, `/Trapped` metadata with XMP parity, print-dialog defaults (duplex, tray, page range, copies), a caller-supplied OutputIntent ICC profile, and large-format `/UserUnit`. Everything is opt-in — output is byte-identical when unused.

## TL;DR

```ts
import { buildDocumentPDFBytes, PAGE_SIZES } from 'pdfnative';

const BLEED = 8.5; // 3 mm in points

const pdf = buildDocumentPDFBytes(params, {
  // Design the page at trim size + bleed on every side…
  pageWidth:  PAGE_SIZES.A4.width  + 2 * BLEED,
  pageHeight: PAGE_SIZES.A4.height + 2 * BLEED,
  margins: { t: 36 + BLEED, r: 36 + BLEED, b: 36 + BLEED, l: 36 + BLEED },
  // …declare the geometry and draw the marks:
  print: { bleed: BLEED, marks: true },
  viewerPreferences: { duplex: 'duplexFlipLongEdge', pickTrayByPDFSize: true },
});
```

Open the result in Acrobat with *Preferences → Page Display → Show art, trim & bleed boxes* to see the geometry.

## The box model (ISO 32000-1 §14.11.2)

```
┌─────────────────────────────┐  MediaBox — the physical page (sheet)
│  ┌───────────────────────┐  │  BleedBox — content clipped in production
│  │ ┌───────────────────┐ │  │  TrimBox — the finished page after cutting
│  │ │      ArtBox       │ │  │  ArtBox — meaningful-content extent
│  │ └───────────────────┘ │  │
│  │  backgrounds run here │  │  ← bleed zone: extend backgrounds into it
│  └───────────────────────┘  │
└─────────────────────────────┘
```

| Option | PDF key | Meaning |
|---|---|---|
| `print.bleed` | derives both | Shorthand: `TrimBox` = MediaBox inset by the bleed, `BleedBox` = MediaBox |
| `print.trimBox` | `/TrimBox` | Finished page size after cutting |
| `print.bleedBox` | `/BleedBox` | Clipping extent in production |
| `print.artBox` | `/ArtBox` | Meaningful-content extent |
| `print.cropBox` | `/CropBox` | Region viewers display/print |

Boxes are validated (within the MediaBox, trim within bleed) and are pure page-dictionary metadata — the layout engine is untouched, so design the page at *trim + 2×bleed* and enlarge the margins by the bleed, letting backgrounds run to the page edge.

`mergePdfs` / `splitPdf` / `extractPages` preserve all four boxes (and `/UserUnit`).

## Printer's marks (§14.11.3)

`print.marks: true` draws, on every page, strictly **outside** the TrimBox:

- **Crop marks** — 8 corner hairlines (default 0.25 pt, 14 pt long, 5 pt clear of the trim edge) showing where to cut.
- **Registration targets** — circle-and-cross targets on the four edge midpoints, used to align separations.

Fine-tune with an object: `marks: { crop, registration, length, offset, weight }`.

> Marks are stroked in RGB black. A true all-separation *registration colour* requires CMYK content support, which is on the roadmap together with PDF/X — see below.

## /Trapped and prepress metadata

```ts
buildDocumentPDFBytes({ ...params, metadata: { trapped: 'False' } }, { tagged: 'pdfa2b' });
```

Writes `/Info /Trapped /False` and mirrors it as `pdf:Trapped` in the XMP packet, telling the RIP whether trapping has been applied. Because `pdf:Trapped` is not part of the XMP-2005 Adobe PDF schema that PDF/A pins, pdfnative also emits the required PDF/A extension schema declaring the property (ISO 19005 §6.6.2.3.2) — the document stays veraPDF-compliant. Per ISO 32000-1 Table 317, `trapped: 'Unknown'` is written to `/Info` only: unknown maps to the *absence* of `pdf:Trapped` in XMP.

## Print-dialog defaults (`viewerPreferences`)

| Option | PDF key | Values |
|---|---|---|
| `duplex` | `/Duplex` | `'simplex'`, `'duplexFlipShortEdge'`, `'duplexFlipLongEdge'` |
| `pickTrayByPDFSize` | `/PickTrayByPDFSize` | boolean (Windows viewers) |
| `printPageRange` | `/PrintPageRange` | 1-based `[first, last]` pairs, e.g. `[[1, 4], [7, 7]]` |
| `numCopies` | `/NumCopies` | positive integer |

These join the existing v1.4.0 viewer preferences and remain PDF/A-safe metadata.

## Custom OutputIntent (tagged/PDF-A)

Replace the built-in minimal sRGB profile with a real ICC profile:

```ts
import { readFileSync } from 'node:fs';

buildDocumentPDFBytes(params, {
  tagged: 'pdfa2b',
  outputIntent: {
    iccProfile: new Uint8Array(readFileSync('sRGB-IEC61966-2.1.icc')),
    outputConditionIdentifier: 'sRGB IEC61966-2.1',
    outputCondition: 'sRGB display',
    info: 'IEC 61966-2.1 reference profile',
  },
});
```

RGB profiles only — pdfnative emits RGB content, and a mismatched intent fails PDF/A validation (a CMYK profile throws with an actionable message). Omitted, the historical built-in profile is used byte-identically.

## Large formats — `/UserUnit`

PDF user space caps pages at 14 400 units (200 in). For banners and plans, `print.userUnit` scales the unit (1 unit = `userUnit`/72 inch, up to 75 000):

```ts
// A 5 m × 1 m banner: 1417 × 283 units at 10/72 inch per unit.
buildDocumentPDFBytes(params, { pageWidth: 1417, pageHeight: 283, print: { userUnit: 10 } });
```

`/UserUnit` needs PDF 1.6+, so the header is raised to `%PDF-1.7` when the option is set — and it is rejected under `tagged: 'pdfa1b'` (PDF/A-1 is PDF 1.4; use `pdfa2b` or later).

## Limits & scope (v1.7.0)

- Marks are RGB black; **no CMYK content**, spot colours, colour bars or **PDF/X** conformance claims yet — all on the roadmap as one coherent CMYK workstream.
- One geometry per document (pages share the same boxes), matching the single-page-size layout model.
- The OutputIntent (custom or built-in) is emitted under `tagged` modes only.

See the [print samples](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/print-showcase.ts): `print/print-bleed-marks.pdf`, `print/print-explicit-boxes.pdf`, `print/print-large-format.pdf`.
