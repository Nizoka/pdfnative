# Images — JPEG, PNG and JPEG 2000

> **JPEG and PNG since v1.0.0; JPEG 2000 since v1.9.0.** An `image` block embeds the file's own bytes — nothing is decoded, recompressed or rasterised: a JPEG travels as `/DCTDecode`, a PNG as `/FlateDecode` with its alpha channel split into a soft mask, a JPEG 2000 file as `/JPXDecode` with the colour and opacity the codestream declares. The library reads only the headers it needs to write the Image XObject.

## TL;DR

```ts
import { readFileSync } from 'node:fs';
import { buildDocumentPDFBytes } from 'pdfnative';

const pdf = buildDocumentPDFBytes({
  title: 'Product sheet',
  blocks: [
    { type: 'heading', text: 'Product sheet', level: 1 },
    { type: 'image', data: readFileSync('photo.jpg'), width: 320, height: 240, align: 'center', alt: 'The product, three-quarter view' },
    { type: 'image', data: readFileSync('logo.png'), width: 120 },
    { type: 'image', data: readFileSync('scan.jp2'), width: 400, alt: 'Scanned invoice, page 1' },
  ],
});
```

`width` and `height` are in points; give one and the other follows the image's aspect ratio. `align` places the image in the column; `alt` becomes the `/Alt` of the `/Figure` structure element in tagged mode and is what a screen reader announces.

## Formats

| Format | Detected by | Written as | What is read from the file |
|---|---|---|---|
| JPEG | `FF D8 FF` | `/DCTDecode`, the file's bytes as the stream | Width, height and component count from the SOF marker (1 = `/DeviceGray`, 3 = `/DeviceRGB`, 4 = `/DeviceCMYK`). |
| PNG | the 8-byte signature | `/FlateDecode` with a PNG predictor (`/Predictor 15`), the IDAT chunks concatenated | Width, height, bit depth and colour type from IHDR. Greyscale and RGB, with or without alpha; an alpha channel is separated into an `/SMask` image. 8-bit only; interlaced files are refused. |
| JPEG 2000 (v1.9.0) | the JP2 signature box, or a raw codestream (`FF 4F FF 51`) | `/JPXDecode`, the file's bytes as the stream | From the JP2 header (`ihdr`, `colr`, `cdef`) or the codestream's SIZ marker: width, height, channel count, bit depth, whether a colour space is declared, whether an opacity channel is present. |

A JPEG 2000 image is a pass-through in the strictest sense: ISO 32000-1 §7.4.9 lets the viewer take the colour space, bit depth and opacity from the codestream, so the XObject omits `/ColorSpace` and `/BitsPerComponent` when the file declares its colour (`colr` box) and sets `/SMaskInData 1` when it carries an opacity channel. A raw codestream without a `colr` box is written with the device space its channel count implies. The file header becomes `%PDF-1.5`, the version that introduced `/JPXDecode`.

What the library does **not** do: decode a JPEG 2000 codestream (no wavelet transform exists in pdfnative; viewers with JPX support — Acrobat, Chrome's PDFium, Firefox's pdf.js — draw it), convert formats, resample, or read TIFF and WebP (see the [roadmap](https://github.com/Nizoka/pdfnative/blob/main/ROADMAP.md)).

## Inspecting an image before embedding it

The parsers behind the block are exported:

```ts
import { detectImageFormat, parseImage, parseJPX } from 'pdfnative';

detectImageFormat(bytes);          // 'jpeg' | 'png' | 'jpx' | null
const img = parseImage(bytes);     // { width, height, colorSpace, bitsPerComponent, filter, data, smask, jpx? }
if (img.jpx) {
  img.jpx.channels;                // 1, 3 or 4 for a PDF/A-2 file
  img.jpx.alpha;                   // an opacity channel → /SMaskInData 1
  img.jpx.colourSpecified;         // a colr box: /ColorSpace is left to the codestream
  img.jpx.bitDepth;
}
```

`parseJPX(bytes)` reads a JPEG 2000 file directly; `parseImage` dispatches on the detected format and throws a plain `Error` naming the defect for a truncated or unsupported file (a 16-bit or interlaced PNG, an image with no header).

## Images under PDF/A and PDF/X

- **PDF/A-1** (`tagged: 'pdfa1b'`) forbids `/JPXDecode` (ISO 19005-1 §6.1.10): a JPEG 2000 image under PDF/A-1 raises `PDFA1_JPX_IMAGE` — a warning through `onDiagnostic` (the file is still written, with the PDF 1.4 header the claim demands, and veraPDF rejects it), an error that stops the build under `strict`.
- **PDF/A-2 and PDF/A-3** accept JPEG 2000 under ISO 19005-2 §6.2.8.3: one, three or four colour channels, and no opacity channel in the codestream. A file outside those rules raises `PDFA_JPX_IMAGE` (a warning through `onDiagnostic`, an error under `strict`), and the build still writes it. Both codes are catalogued in [`errors.json`](../data/errors.json).
- **PDF/A in general** requires every colour to resolve to the OutputIntent: a CMYK JPEG under the default sRGB intent raises `PDFA_DEVICE_CMYK_CONTENT`; see the [PDF/A guide](pdfa.html).
- **PDF/X-4**: `validatePdfX()` checks the `/ColorSpace` of every image, including images inside Form XObjects (v1.9.0), against the OutputIntent; a JPEG 2000 image that leaves its colour to the codestream passes the check as the specification allows.

## Watermark images

An image can also be the watermark of every page — `layout.watermark.image` with `opacity` and `angle`; the same three formats are accepted. See the [watermarks section](https://github.com/Nizoka/pdfnative#layout-customization) of the README.

## Samples and playground

`npm run test:generate` writes `test-output/images/image-jpx-jp2.pdf` (a JP2 file with a `colr` box and an opacity channel), `image-jpx-raw.pdf` (a raw codestream) and `image-formats-pdfa2b.pdf` (JPEG, PNG and JPEG 2000 on one PDF/A-2b page). The [images playground](../playgrounds/images.html) embeds a JPEG, a PNG or a JPEG 2000 file from your disk and shows the Image XObject it wrote.

## See also

- [PDF/A conformance](pdfa.html) — the image rules per level.
- [Print production](print.html) — colour spaces, OutputIntents, `validatePdfX()`.
- [Accessibility](accessibility.html) — `/Figure` and `alt`.
