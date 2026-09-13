# Print production — bleed, trim & printer's marks

> **New in v1.7.0, extended in v1.8.0.** Print-ready PDFs with zero dependencies: page geometry boxes (`/TrimBox`, `/BleedBox`, `/ArtBox`, `/CropBox`), crop and registration marks drawn as pure vector operators, `/Trapped` metadata with XMP parity, print-dialog defaults (duplex, tray, page range, copies), a caller-supplied OutputIntent ICC profile, and large-format `/UserUnit`. Since v1.8.0: CMYK colours, CMYK and Gray OutputIntents, marks in the registration colour, a PDF/X-4 conformance claim and `validatePdfX()`. Everything is opt-in — output is byte-identical when unused.

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

> Marks are stroked in black. Under a CMYK OutputIntent (v1.8.0) they use the *registration colour* instead — the `All` separation, which a RIP puts on every plate, so the marks register cyan, magenta, yellow and black against each other.

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

RGB profiles since v1.7.0; **CMYK and Gray profiles since v1.8.0**. The profile's ICC header decides the stream's `/N`. Omitted, the historical built-in sRGB profile is used byte-identically.

pdfnative ships no CMYK profile — press profiles (ISO Coated v2, GRACoL, SWOP) are large and often licensed. Use the one your printer names.

Under a CMYK or Gray intent, the colours pdfnative draws in RGB — default text, rules, charts, emoji, RGB images, form fields — are remapped through a calibrated sRGB `/DefaultRGB` in every resource dictionary that paints. Device RGB under a CMYK intent would otherwise break the conformance claim (ISO 19005-2 §6.2.4.3); remapping tells the print workflow what the colours mean rather than rewriting them as naive CMYK. veraPDF accepts the result under PDF/A-1b and PDF/A-2b.

The reverse has no inline remedy: a CMYK colour under an RGB or Gray intent raises `PDFA_DEVICE_CMYK_CONTENT` (or `PDFX_DEVICE_CMYK` under PDF/X).

## CMYK colours (v1.8.0)

Every colour option accepts two CMYK forms besides the RGB ones:

| Form | Example | Unit |
|---|---|---|
| Tuple | `[100, 60, 0, 10]` | ink coverage in percent, 0–100 — the unit print software states |
| Operand string | `'1 0.6 0 0.1'` | PDF's own 0.0–1.0 |

```ts
buildDocumentPDFBytes({
  title: 'Press sheet',
  blocks: [
    { type: 'paragraph', text: 'Process cyan', color: [100, 0, 0, 0] },
    { type: 'paragraph', text: 'Rich black', color: [60, 40, 40, 100] },
  ],
}, layout);
```

The component count decides the space: three components write `rg`/`RG`, four write `k`/`K`. Every input accepted before v1.8.0 is RGB and renders as it did. Two places adapt: chart tints remove ink rather than mixing toward white, and an outline item's `/C` — DeviceRGB by definition — receives a device-formula RGB approximation. `resolveColor()`, `fillOp()` and `strokeOp()` expose the same resolution to your own content.

## PDF/X-4 (v1.8.0)

`pdfx: 'pdfx4'` claims PDF/X-4 (ISO 15930-7), the exchange format presses expect for colour-managed jobs with transparency:

```ts
import { readFileSync } from 'node:fs';
import { buildDocumentPDFBytes, validatePdfX } from 'pdfnative';

const pdf = buildDocumentPDFBytes({ ...params, fontEntries }, {
  pdfx: 'pdfx4',
  outputIntent: {
    iccProfile: new Uint8Array(readFileSync('ISOcoated_v2_eci.icc')),
    outputConditionIdentifier: 'FOGRA39',
    registryName: 'http://www.color.org',
  },
  print: { bleed: 8.5, marks: true },
});

const report = validatePdfX(pdf); // { valid, errors, warnings }
```

What the claim writes:

- a `%PDF-1.6` header (PDF/X-4 is based on PDF 1.6);
- an XMP packet with `pdfxid:GTS_PDFXVersion` = `PDF/X-4`, `xmpMM:DocumentID`, `VersionID` and `RenditionClass`, and the XMP dates — and no PDF/A identification;
- a `/GTS_PDFX` OutputIntent carrying your profile;
- a TrimBox on every page — the MediaBox when `print` sets none;
- `/Trapped` in `/Info` and XMP: `False` unless `metadata.trapped` says `True`.

What throws before any byte is written: `pdfx` with a PDF/A `tagged` level (one claim per file), with `encryption`, without `outputIntent`, with a profile that is not an output (`prtr`) profile, with `trapped: 'Unknown'`, or with both a TrimBox and an ArtBox.

What raises a diagnostic: `PDFX_NO_FONT_ENTRIES` (every font must be embedded — pass `fontEntries`), `PDFX_DEVICE_CMYK` (CMYK colour under a non-CMYK profile) and `PDFX_ANNOTATIONS` (links and form fields have no place in a print file).

### Checking the result

`validatePdfX(bytes)` checks what the structure can prove: header, encryption and `/ID`; the XMP identification and trapping, consistent with `/Info`; the OutputIntent and its embedded output profile; page boxes; embedded fonts; annotations in the print area; and device colour in page content against the intent. It does not inspect colour inside Form XObjects or images, and it does not render. veraPDF does not cover PDF/X, so confirm a file bound for press with a certified preflight (callas pdfToolbox, Acrobat Preflight).

## Large formats — `/UserUnit`

PDF user space caps pages at 14 400 units (200 in). For banners and plans, `print.userUnit` scales the unit (1 unit = `userUnit`/72 inch, up to 75 000):

```ts
// A 5 m × 1 m banner: 1417 × 283 units at 10/72 inch per unit.
buildDocumentPDFBytes(params, { pageWidth: 1417, pageHeight: 283, print: { userUnit: 10 } });
```

`/UserUnit` needs PDF 1.6+, so the header is raised to `%PDF-1.7` when the option is set — and it is rejected under `tagged: 'pdfa1b'` (PDF/A-1 is PDF 1.4; use `pdfa2b` or later).

## Limits & scope (v1.8.0)

- **Not yet:** spot colours (`/Separation` inks other than registration), colour bars, PDF/X-1a, PDF/X-3 and PDF/X-4p, and a single file carrying both a PDF/A and a PDF/X claim.
- Colour emoji and CPAL palettes stay RGB; under a CMYK intent they are covered by `/DefaultRGB`.
- One geometry per document (pages share the same boxes), matching the single-page-size layout model.
- The OutputIntent (custom or built-in) is emitted under `tagged` modes and under `pdfx` only.

See the [print samples](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/print-showcase.ts): `print/print-bleed-marks.pdf`, `print/print-explicit-boxes.pdf`, `print/print-large-format.pdf`, `print/print-cmyk-pdfx4.pdf`, `print/print-cmyk-pdfa2b.pdf`. The CMYK samples embed a synthetic stand-in profile generated by the sample script; it characterises no printing condition.
