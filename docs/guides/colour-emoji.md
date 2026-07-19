# Colour emoji (COLRv1)

> **New in v1.3.0.** pdfnative renders colour emoji natively — no rasterisation, no external dependency. Glyph colour layers become PDF Form XObjects with solid fills and axial/radial gradients. The monochrome emoji font is unchanged and remains the default.

## TL;DR

```ts
import { registerFont, buildDocumentPDFBytes } from 'pdfnative';

// Opt in to the curated colour-emoji subset (1167 glyphs, ~4.0 MB).
registerFont('emoji', () => import('pdfnative/fonts/noto-color-emoji-data.js'));

const bytes = buildDocumentPDFBytes({
  title: 'Colour emoji',
  blocks: [
    { type: 'paragraph', text: 'Status: 🟢 online · 🔴 offline · 🎉 launch day!' },
  ],
});
```

That single `registerFont('emoji', …)` call swaps the monochrome Noto Emoji
font for the COLR/CPAL colour build. Everything else — detection, multi-font
run splitting, line breaking — is automatic.

## How it works

Noto Color Emoji is an OpenType **COLR/CPAL** font: each emoji codepoint maps
to a base glyph plus a *colour glyph* describing ordered paint layers. pdfnative
parses these tables with self-written, zero-dependency readers
([`src/fonts/colr-parser.ts`](https://github.com/Nizoka/pdfnative/blob/main/src/fonts/colr-parser.ts),
[`src/fonts/glyf-outline.ts`](https://github.com/Nizoka/pdfnative/blob/main/src/fonts/glyf-outline.ts))
and renders each colour glyph as a **PDF Form XObject**:

| COLR feature | PDF mapping |
|---|---|
| Solid layer (COLR v0 / `PaintSolid`) | `rg` fill of the layer's `glyf` outline, clipped with `W n` |
| Linear gradient (`PaintLinearGradient`) | `/ShadingType 2` axial shading + `/ExtGState` constant alpha |
| Radial gradient (`PaintRadialGradient`) | `/ShadingType 3` radial shading |
| Sweep gradient (`PaintSweepGradient`) | flat-colour triangular wedges fanned around the centre (**v1.4.0**) |
| Compositing (`PaintComposite`) | separable blend modes mapped to PDF `/BM` (Multiply, Screen, Overlay, Darken, Lighten, …) (**v1.4.0**) |
| CPAL palette | per-stop RGB(A) colours |

Each unique emoji produces **one indirect Form XObject**, deduplicated and
forward-referenced into every page's `/XObject` resource dictionary. The text
run emits `q s 0 0 s x y cm /CEm0 Do Q` to place the glyph.

> **Advanced compositing (v1.4.0).** COLRv1 **sweep (conic) gradients** render as
> native flat-shaded wedges, and `PaintComposite` **separable blend modes** map to
> PDF `/BM` ExtGState operators. Structural Porter-Duff modes (Clear / Src / Dest /
> Xor / …) and `PaintMask` fall back to the documented monochrome path.

## Opt-in, not default

Colour emoji is **opt-in** for two reasons:

1. **Module size.** The curated subset is ~4.0 MB (expanded to 1167 glyphs in
   v1.6.0); bundling it by default would bloat every consumer. Register it only
   when you need colour.
2. **Byte stability.** When no colour-emoji font is registered, documents are
  byte-identical to the pre-colour-emoji path — the colour path is fully gated.

To keep monochrome emoji instead, register the monochrome font:

```ts
registerFont('emoji', () => import('pdfnative/fonts/noto-emoji-data.js'));
```

## Coverage & limits

The bundled module is a **curated subset** of **1167 common single-codepoint
emoji** (expanded from 221 in v1.6.0): the complete Emoticons and Supplemental
Symbols & Pictographs blocks, Miscellaneous Symbols & Pictographs through
U+1F53D (nature, food, objects, hearts, office, av/ui symbols) plus clocks and
the emoji-presentation stragglers, and the **complete assigned Transport & Map
block** (U+1F680–1F6FF). Symbols & Pictographs Extended-A (U+1FA70–1FAFF) is
not bundled — use the CLI below. It ships pre-built because every file under the package
`files` allowlist is included in the npm tarball regardless of tree-shaking — the
full Noto Color Emoji build (thousands of glyphs, ~32 MB) would weigh down
*every* `npm install`, even for consumers who never touch emoji. The subset keeps
the install within a ~4 MB budget while the lazy `() => import(...)` keeps it
out of bundles that don't reference it.

> **Out of scope for the bundled subset:** flag sequences (regional-indicator
> pairs), ZWJ sequences (families, professions, etc.), and skin-tone-modified
> forms. These are multi-codepoint emoji that require GSUB ligature lookups the
> single-codepoint module does not carry, so they render as monochrome/tofu.
> Build a full module with the CLI below to cover them.

To cover the **full** Noto Color Emoji set — or any custom selection — pdfnative
ships an official generator CLI, `pdfnative-build-emoji-font`, so you never have
to edit library source:

```bash
# Every colour glyph (~3 600), fetched + checksum-verified from Google Fonts:
npx pdfnative-build-emoji-font --download --all --out ./emoji-full.js

# Or exactly the emoji you need (hex scalars and/or inclusive ranges):
npx pdfnative-build-emoji-font --download \
  --ranges 1F600-1F64F,2600-27BF --codepoints 2764,1F680 --out ./emoji.js
```

Then register the module you generated:

```ts
registerFont('emoji', () => import('./emoji-full.js'));
```

See the [colour-emoji CLI guide](colour-emoji-cli.html) for every flag, offline
usage with `--ttf`, and the checksum/licensing details.

## Advanced compositing (v1.4.0)

COLRv1 includes two paint types beyond solid + axial/radial gradients, and
pdfnative now maps both where a faithful PDF translation exists:

| COLRv1 feature | PDF mapping (v1.4.0) |
|---|---|
| Sweep / conic gradient (`PaintSweepGradient`, format 8) | Flat-shaded triangular **wedges** fanned around the centre — no `/Shading` resource, pure path fills. Matrix rotation is folded into the start/end angles via `Math.atan2`. |
| Composite (`PaintComposite`, format 32) — *separable* blend modes | Backdrop + source layers, with the source tagged via a `/BM` (blend mode) `/ExtGState`: Normal, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion, Hue, Saturation, Color, Luminosity. |
| Composite — *structural* Porter-Duff modes (`SrcOver`, `DestIn`, clipping masks, …) | No exact PDF equivalent → the glyph falls back to the **monochrome** outline. |

Sweep wedges approximate the smooth conic sweep with a fan of flat-colour
triangles whose count scales with the angular span — close enough for emoji at
text sizes while staying within plain PDF path operators. Separable blend modes
are exactly the set PDF defines in ISO 32000-1 §11.3.5, so they round-trip
faithfully in any conformant viewer.

> **PDF/A note:** blend modes and constant-alpha `/ExtGState` are transparency
> features that PDF/A-1b forbids. Use solid-layer emoji for archival documents.

## Limitations

- **`PaintMask`** and COLRv1 variable (animated) paints are not yet rendered;
  glyphs using them fall back gracefully to the monochrome outline. Tracked for
  a future release.
- **PDF/A:** gradient transparency uses `/ExtGState` alpha, which PDF/A-1b
  forbids. Use solid-layer emoji or a non-PDF/A document for colour gradients.

## Variation selectors & skin-tone modifiers (v1.3.0)

Text such as `❤️` carries an invisible **VS-16** variation selector
(U+FE0F), and `👍🏽` carries a **Fitzpatrick** skin-tone modifier
(U+1F3FB–U+1F3FF); ZWJ sequences (`👨‍👩‍👧`) join several codepoints. Before
v1.3.0 these zero-width formatting characters could route to the Latin font and
render as `.notdef` tofu (the  box). As of v1.3.0 they are **dropped during
run-splitting** when no registered font covers them, so the base emoji renders
cleanly. The `isZeroWidthFormat(cp)` predicate is exported for callers who want
to detect them. Joiners are still preserved when an Indic shaper font maps them.

Colour-glyph Form `/BBox` is also now computed from the glyph's transformed
contour bounds (v1.3.0), so emoji that dip below the baseline are no longer
clipped at the top or bottom.

## See also

- [Quick start](quickstart.html)
- [Troubleshooting](troubleshooting.html) — missing glyphs / tofu
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
