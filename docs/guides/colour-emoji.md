# Colour emoji (COLRv1)

> **New in v1.3.0.** pdfnative renders colour emoji natively — no rasterisation, no external dependency. Glyph colour layers become PDF Form XObjects with solid fills and axial/radial gradients. The monochrome emoji font is unchanged and remains the default.

## TL;DR

```ts
import { registerFont, loadFontData, buildDocumentPDFBytes } from 'pdfnative';

// Opt in to the curated colour-emoji subset (1167 glyphs + 73 sequences, ~4.5 MB).
registerFont('emoji', () => import('pdfnative/fonts/noto-color-emoji-data.js'));

const emoji = await loadFontData('emoji');
if (!emoji) throw new Error('emoji font failed to load');

const bytes = buildDocumentPDFBytes({
  title: 'Colour emoji',
  blocks: [
    { type: 'paragraph', text: 'Status: 🟢 online · 🔴 offline · 🎉 launch day!' },
  ],
  fontEntries: [{ fontData: emoji, fontRef: '/F3', lang: 'emoji' }], // /F1 and /F2 are reserved
});
```

The `registerFont('emoji', …)` call swaps the monochrome Noto Emoji font for
the COLR/CPAL colour build — but registration alone embeds nothing: you must
`await loadFontData('emoji')` and pass the result in `fontEntries` (as above)
or the emoji render as tofu. With the entry in place, everything else —
detection, multi-font run splitting, line breaking — is automatic.

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
> Xor / …) and `PaintMask` fall back to the documented monochrome path — except
> that since **v1.7.0**, a composite whose *source* subtree alone is unsupported
> keeps its backdrop layers (this is what makes flags render flat instead of
> monochrome).

## Opt-in, not default

Colour emoji is **opt-in** for two reasons:

1. **Module size.** The curated subset is ~4.5 MB (expanded to 1167 glyphs in
   v1.6.0, plus 73 flag/ZWJ sequences in v1.7.0); bundling it by default would
   bloat every consumer. Register it only when you need colour.
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
block** (U+1F680–1F6FF). Since v1.7.0 it also carries **73 multi-codepoint
sequences** — 51 flags and 22 ZWJ sequences (see the next section). Symbols &
Pictographs Extended-A (U+1FA70–1FAFF) is
not bundled — use the CLI below. It ships pre-built because every file under the package
`files` allowlist is included in the npm tarball regardless of tree-shaking — the
full Noto Color Emoji build (thousands of glyphs, ~32 MB) would weigh down
*every* `npm install`, even for consumers who never touch emoji. The subset keeps
the install within a 5120 KB budget (actual: ~4.5 MB) while the lazy
`() => import(...)` keeps it out of bundles that don't reference it.

> **Out of scope for the bundled subset:** skin-tone-modified forms
> (`👍🏽`, `👩🏻‍🚀`, …) and any flag or ZWJ sequence beyond the curated 73. The
> combinatorial skin-tone set is deliberately CLI territory — build a module
> with `--sequences` / `--sequence-list` below to cover exactly the forms you
> need. An uncovered sequence degrades to the per-codepoint behaviour
> described further down (base emoji render, joiners drop) — never worse.

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

## Flag & ZWJ sequences (v1.7.0)

Multi-codepoint emoji now render as **single colour glyphs**. The bundled
module resolves the font's GSUB ligature lookups at build time into a
`sequences` table (first codepoint → resolved ligature glyph), and the text
pipeline runs a longest-match pre-pass over it, so a flag pair or a ZWJ
sequence produces exactly one COLR Form XObject:

- **51 flags** — 🇪🇺 EU, 🇺🇳 UN, the G20 members, and other widely used
  locales (regional-indicator pairs).
- **22 ZWJ sequences** — families (`👨‍👩‍👧`), professions (`👩‍🚀`, `👨‍💻`),
  `❤️‍🔥`, `🏳️‍🌈`, `🏳️‍⚧️`, `🏴‍☠️`, `🐻‍❄️`, `😮‍💨`, and friends —
  in their skin-tone-free RGI forms.

No API change is required: register the bundled colour-emoji module as usual
and write the sequences in your text. Three behaviours worth knowing:

- **VS-16 tolerance.** Both the VS-16 spelling and the VS-16-free spelling of
  a sequence match the same glyph — real-world text is inconsistent about
  presentation selectors, so `❤️‍🔥` works with or without the invisible
  U+FE0F.
- **Fallback is never worse.** A sequence absent from the table degrades to
  exactly the historical per-codepoint behaviour: unmatched joiners,
  variation selectors, and skin-tone modifiers are dropped, and unmatched
  regional indicators pass through the normal cmap lookup. A module without a
  `sequences` table renders byte-identically to v1.6.0.
- **Flags render flat.** Noto's flag glyphs stack a wave-shading overlay on
  the flat artwork via a COLRv1 `PaintComposite` SRC_IN mask that has no PDF
  equivalent. pdfnative degrades the composite to its supported backdrop, so
  every flag renders as its flat (unwaved) artwork rather than falling back
  to monochrome.

Skin-tone-modified sequences stay CLI-only — generate a module with
`--sequences` / `--sequence-list` (see the [CLI guide](colour-emoji-cli.html)).

## Advanced compositing (v1.4.0)

COLRv1 includes two paint types beyond solid + axial/radial gradients, and
pdfnative now maps both where a faithful PDF translation exists:

| COLRv1 feature | PDF mapping (v1.4.0) |
|---|---|
| Sweep / conic gradient (`PaintSweepGradient`, format 8) | Flat-shaded triangular **wedges** fanned around the centre — no `/Shading` resource, pure path fills. Matrix rotation is folded into the start/end angles via `Math.atan2`. |
| Composite (`PaintComposite`, format 32) — *separable* blend modes | Backdrop + source layers, with the source tagged via a `/BM` (blend mode) `/ExtGState`: Normal, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion, Hue, Saturation, Color, Luminosity. |
| Composite — *structural* Porter-Duff modes (`SrcOver`, `DestIn`, clipping masks, …) | No exact PDF equivalent → the glyph falls back to the **monochrome** outline. Since v1.7.0, when only the composite's *source* subtree is unsupported, its partial layers roll back and the **backdrop renders alone** (best-effort) — Noto's flags degrade to their flat artwork this way. |

Sweep wedges approximate the smooth conic sweep with a fan of flat-colour
triangles whose count scales with the angular span — close enough for emoji at
text sizes while staying within plain PDF path operators. Separable blend modes
are exactly the set PDF defines in ISO 32000-1 §11.3.5, so they round-trip
faithfully in any conformant viewer.

> **PDF/A note:** blend modes and constant-alpha `/ExtGState` are transparency
> features that PDF/A-1b forbids. Use solid-layer emoji for archival documents.

## Limitations

- **`PaintMask`** and COLRv1 variable (animated) paints are not yet rendered;
  glyphs using them fall back gracefully — to the backdrop layers when the
  unsupported paint sits inside a composite's source subtree (v1.7.0), to the
  monochrome outline otherwise. Tracked for a future release.
- **PDF/A:** gradient transparency uses `/ExtGState` alpha, which PDF/A-1b
  forbids. Use solid-layer emoji or a non-PDF/A document for colour gradients.

## Variation selectors & skin-tone modifiers (v1.3.0)

Text such as `❤️` carries an invisible **VS-16** variation selector
(U+FE0F), and `👍🏽` carries a **Fitzpatrick** skin-tone modifier
(U+1F3FB–U+1F3FF); ZWJ sequences (`👨‍👩‍👧`) join several codepoints. Before
v1.3.0 these zero-width formatting characters could route to the Latin font and
render as `.notdef` tofu (the  box). As of v1.3.0 they are **dropped during
run-splitting** when no registered font covers them, so the base emoji renders
cleanly. (Internally this is the `isZeroWidthFormat(cp)` predicate in the
shaping engine — it is not part of the published API surface.) Joiners are
still preserved when an Indic shaper font maps them.

Since **v1.7.0**, sequences covered by the registered font's `sequences` table
take a different path entirely: the whole sequence — joiners, selectors and
all — resolves to a single colour ligature glyph before run-splitting (see
[Flag & ZWJ sequences](#flag--zwj-sequences-v170) above). The drop-during-run-splitting
behaviour described here remains the fallback for uncovered sequences.

Colour-glyph Form `/BBox` is also now computed from the glyph's transformed
contour bounds (v1.3.0), so emoji that dip below the baseline are no longer
clipped at the top or bottom.

## See also

- [Quick start](quickstart.html)
- [Troubleshooting](troubleshooting.html) — missing glyphs / tofu
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
