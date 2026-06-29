# Font-data validation

> **New in v1.4.0.** `validateFontData()` is an opt-in, read-only structural
> sanity check for **custom** font-data modules built from an untrusted or
> unfamiliar TTF/OTF. It catches the common failure modes early and returns
> `{ valid, errors, warnings }` instead of letting a cryptic `.notdef`/`NaN`
> surface deep inside the encoding/subsetting pipeline. The bundled
> `pdfnative/fonts/*` modules are already trusted — this is for fonts **you**
> build via `tools/build-font-data.cjs` or by hand.

## TL;DR

```ts
import { validateFontData } from 'pdfnative';
import type { FontValidationResult } from 'pdfnative';

const result: FontValidationResult = validateFontData(myFontData);
if (!result.valid) {
  console.error('Font rejected:', result.errors);
}
for (const w of result.warnings) console.warn('Font warning:', w);
```

## What it checks

| Area | Rule |
|---|---|
| Metrics | `unitsPerEm > 0`, finite; `bbox` is 4 finite numbers |
| Identity | `fontName` non-empty |
| Coverage | `cmap` non-empty; every glyph id is an integer in `[0, numGlyphs)` |
| Widths | `widths` present (missing → **warning**); `pdfWidthArray` non-empty |
| Binary | `ttfBase64` decodes as valid base64 and begins with an SFNT magic (`0x00010000`, `OTTO`, `true`, `ttcf`) |

Blocking problems land in `errors`; suspicious-but-survivable ones land in
`warnings`. It **never throws** — even on completely malformed input.

## It is opt-in by design

`validateFontData()` is **not** invoked automatically by `registerFont()`:
running it on every load would add cost and risk false-rejecting edge-valid
fonts. Call it yourself once when ingesting third-party font data, e.g. in a
build step or a test:

```ts
import { validateFontData, registerFont } from 'pdfnative';
import myFont from './my-font-data.js';

const { valid, errors } = validateFontData(myFont);
if (!valid) throw new Error(`Bad font data: ${errors.join('; ')}`);
registerFont('mylang', () => Promise.resolve(myFont));
```

## Sample

[font-validation-showcase.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/font-validation-showcase.ts)
validates a bundled font plus deliberately broken payloads and renders the
verdicts into a report PDF.
