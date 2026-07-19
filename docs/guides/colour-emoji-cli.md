# Colour-emoji font CLI (`pdfnative-build-emoji-font`)

> **New in v1.4.0, expanded in v1.6.0.** pdfnative ships a curated ~850-glyph
> colour-emoji module by default. When you need **more emoji — up to the full
> ~3 600-glyph set** — the
> `pdfnative-build-emoji-font` CLI generates a data module containing exactly the
> glyphs you choose. It's bundled with the `pdfnative` package, so any user can
> run it with `npx` — no extra install, no editing library source.

## Why a CLI instead of bundling everything?

The complete Noto Color Emoji font is ~24 MB and resolves to a ~32 MB data
module. Bundling that into the npm package would penalise **every** install,
including the vast majority of users who only ever need a handful of emoji. The
lean curated subset stays the default; the CLI lets you opt into precisely the
coverage you need, when you need it. This is the same deterministic build core
that produces the bundled module — you get identical, reproducible output.

## TL;DR

```bash
# Full coverage — download + checksum-verify the font, then build every glyph:
npx pdfnative-build-emoji-font --download --all --out ./emoji-full.js

# Exactly the emoji you need (hex scalars and/or inclusive ranges):
npx pdfnative-build-emoji-font --download \
  --ranges 1F600-1F64F,2600-27BF --codepoints 2764,1F680 --out ./emoji.js

# Offline: point at a font you already have on disk:
npx pdfnative-build-emoji-font --ttf ./NotoColorEmoji-Regular.ttf --all
```

Then register the module you generated and use emoji as usual:

```ts
import { registerFont, buildDocumentPDFBytes } from 'pdfnative';

registerFont('emoji', () => import('./emoji-full.js'));

const bytes = buildDocumentPDFBytes({
  title: 'Emoji',
  blocks: [{ type: 'paragraph', text: 'Ship it 🚀🎉🥳🦄🌈' }],
});
```

## Getting the source font

The CLI needs a COLRv1/CPAL colour font — the canonical one is
**NotoColorEmoji-Regular.ttf** (OFL-1.1). Two ways to provide it:

- **`--download`** fetches it from the official Google Fonts repository and
  verifies its SHA-256 against the build pdfnative was tested with. A mismatch is
  a transparent **warning** (Google periodically ships newer Unicode revisions),
  not a hard failure — the download is still used.
- **`--ttf <path>`** uses a font already on disk (fully offline, no network).

> Only the pinned official Google Fonts URL is ever contacted; the CLI never
> fetches arbitrary user-supplied URLs.

## Selecting glyphs

Combine these freely; selections are merged, de-duplicated and sorted. If you
pass none, the curated set is used.

| Flag | Meaning |
|---|---|
| `--all` | Every colour glyph in the font (large module). |
| `--preset curated` | pdfnative's lean ~850-glyph default set. |
| `--preset all` | Same as `--all`. |
| `--codepoints <list>` | Comma-separated hex scalars: `1F600,1F680,2764`. `U+`, `0x`, `#` prefixes are tolerated. |
| `--ranges <list>` | Comma-separated **inclusive** hex ranges: `1F600-1F64F,2600-27BF`. |

## Output options

| Flag | Default | Meaning |
|---|---|---|
| `--out <path>` | `./noto-color-emoji-data.js` | Output `.js` path. A sibling `.d.ts` is written next to it. |
| `--font-name <name>` | `NotoColorEmoji-Regular` | Embedded PostScript font name. |
| `--types <path>` | `pdfnative` | The type import used in the generated `.d.ts` (e.g. `'pdfnative'` or a relative path). |

The generated module exports the same shape as the bundled one
(`metrics`, `cmap`, `widths`, `pdfWidthArray`, `colorGlyphs`, `ttfBase64`, …),
so it drops straight into `registerFont('emoji', () => import('…'))`.

## Verifying the result

Pair the CLI with [`validateFontData()`](font-validation.html) to sanity-check a
freshly generated module before shipping it:

```ts
import { validateFontData } from 'pdfnative';
import * as emoji from './emoji-full.js';

const report = validateFontData(emoji);
if (!report.valid) console.error(report.errors);
```

## Full option reference

```text
pdfnative-build-emoji-font — colour-emoji font data module generator

Source font (one of):
  --ttf <path>            Path to a COLRv1/CPAL colour font.
  --download              Fetch the official Noto Color Emoji (OFL-1.1) and verify checksum.

Glyph selection (combine freely; default: --preset curated):
  --all                   Every colour glyph in the font.
  --preset <curated|all>  Named selection.
  --codepoints <list>     Comma-separated hex scalars, e.g. 1F600,1F680,2764.
  --ranges <list>         Comma-separated inclusive hex ranges, e.g. 1F600-1F64F.

Output:
  --out <path>            Output .js path (a sibling .d.ts is written).
  --font-name <name>      Embedded PostScript font name.
  --types <path>          Type import used in the generated .d.ts.

Other:
  -h, --help              Show this help.
```

## Licensing

Noto Color Emoji is licensed under the **SIL Open Font License 1.1 (OFL-1.1)**.
Generated modules embed a subset of that font; keep the OFL notice with any
redistributed module, exactly as you would for any other Noto data module that
pdfnative ships.

## See also

- [Colour emoji (COLRv1)](colour-emoji.html) — how colour glyphs render to PDF
- [Font-data validation](font-validation.html) — `validateFontData()`
- [PDF Toolkit playground](../playgrounds/toolkit.html)
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
