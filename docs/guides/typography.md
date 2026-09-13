# Typography — page breaks, justification, kerning & OpenType features

> **New in v1.8.0.** Typeset-quality text with zero dependencies: paragraphs that break across pages under widow and orphan rules, headings kept with what follows, justification and optical margin alignment, soft hyphens and a hyphenation seam, number–unit binding and punctuation spacing, exact base-14 metrics, pair kerning, and OpenType single-substitution features such as tabular figures. Every option is opt-in under `layout.typography` — output is byte-identical when it is unset.

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';

const pdf = buildDocumentPDFBytes(
  {
    title: 'Annual report',
    fontEntries, // a registered font: kerning and features read its tables
    blocks: [
      { type: 'heading', text: 'Results', level: 1 },
      { type: 'paragraph', text: longText, align: 'justify' },
    ],
  },
  {
    typography: {
      splitParagraphs: true,        // break long paragraphs at line boundaries
      orphans: 2, widows: 2,        // …never leaving a single stranded line
      keepHeadingsWithNext: true,   // no heading alone at the foot of a page
      opticalMargins: true,         // hang punctuation past the measure
      unitBinding: true,            // "150 €" and "12 kg" never break
      kerning: true,                // AV, To, Yo set with the font's pair kerning
      fontFeatures: ['tnum'],       // tabular figures: amounts line up
    },
  },
);
```

Why opt-in: each option moves glyphs or line breaks, so turning one on changes an existing document's output. Nothing changes until you ask.

## Page breaking

| Option | Default | Effect |
|---|---|---|
| `splitParagraphs` | `false` | A paragraph that does not fit breaks at a line boundary instead of moving to the next page whole. A paragraph taller than a page continues instead of running off the bottom. |
| `orphans` | `2` | Minimum lines left at the foot of a page for a break to be allowed there. Requires `splitParagraphs`. |
| `widows` | `2` | Minimum lines carried to the next page; the break is pulled earlier otherwise. Requires `splitParagraphs`. |
| `keepHeadingsWithNext` | `false` | A heading that would end a page moves to the next one with its content. Works without `splitParagraphs`. |

Blocks override the document setting: a heading or paragraph accepts `keepWithNext`, and a paragraph accepts its own split permission. Under a PDF/A claim a paragraph split across pages remains one `/P` structure element.

## Justification and optical margins

`align: 'justify'` on a paragraph spans every line except the last across the full measure by placing each word at its own position. A line that would need an implausible stretch is left ragged rather than opened into rivers of white space.

`opticalMargins: true` lets punctuation hang past the edge it sits against. An opening quote at the start of a line, or a full stop at the end, is mostly white space inside its own box, so a column whose glyph origins sit exactly on the margin still looks indented. Hanging the mark back out makes the optical edge straight. It applies to the leading mark of left-aligned and justified lines and the trailing mark of justified and right-aligned ones, with conservative offsets.

## Hyphenation

Two sources of break opportunities inside a word:

- **Soft hyphens** (U+00AD) you write in the text. They stay invisible unless the line breaks there, and they need no data.
- **A hyphenation provider** you install. The library bundles no dictionary — Liang pattern sets are hundreds of kilobytes per language — so the algorithm stays in your code and the library provides the seam:

```ts
import { setHyphenationProvider } from 'pdfnative';

// Return the indices inside `word` where a hyphen may go.
setHyphenationProvider((word) => myHyphenator.positions(word));
```

The provider must be synchronous and pure: it may be called many times for the same word during layout, and a changing answer would make output irreproducible. A word that already contains soft hyphens keeps the author's choice, and a provider that throws is ignored for that word. Pass `null` to remove it.

## Spacing rules

**Unit binding** — `unitBinding: true` replaces the space between a number and the unit symbol that follows with a no-break space, so `150 €`, `12 kg` or `30 %` never split across lines. ISO 80000-1 asks for this in every language, so it carries no locale assumption. Only an existing plain space before a recognised symbol standing on its own is converted — "150 personnes" stays breakable. Pass `{ units: [...] }` to replace the built-in symbol list.

**Punctuation spacing** — conventions differ by language, so this is never automatic. `punctuationSpacing` takes a preset the library can state precisely, or a list of rules for any other convention. `'fr'` sets a narrow no-break space before `;` `!` `?` and a no-break space before `:` and inside guillemets; `'fr-CA'` keeps only the colon and guillemet spaces, as Canadian French usage does.

```ts
typography: {
  punctuationSpacing: [
    { char: ':', side: 'before', space: 'nbsp' },
    { char: '»', side: 'before', space: 'narrow' },
  ],
}
```

Only existing spaces are converted; nothing is inserted where the author wrote none. It applies to headings, paragraphs, lists, link labels and table content. `bindUnits()` and `applyPunctuationSpacing()` expose the same transforms for text you lay out yourself.

## Metrics

Text set in the non-embedded base-14 faces is measured with a historical estimate that buckets digits at 556 units, capitals at 680 and lowercase at 500 — and every accented letter and most punctuation at 556. French lines and currency columns therefore wrap and align slightly wrong. `metrics: 'exact'` reads the Adobe Core 14 AFM advances instead. It is opt-in because correct measurement moves line breaks. Registered fonts always measure from their own `hmtx` table.

## Kerning

`kerning: true` applies the font's pair kerning, so "AV", "To" and "Yo" are set as the type designer intended. Adjustments are written as `TJ` arrays, so a kerned run stays one text-showing operator and selection and extraction are unaffected. It needs a registered font that carries kerning data; the base-14 faces have none.

## OpenType features

`fontFeatures` applies OpenType features by tag. Only single substitutions are supported — one glyph in, one glyph out — which is what makes them safe without a full shaping engine:

| Tag | Effect |
|---|---|
| `tnum` / `pnum` | Tabular (equal-width) / proportional figures |
| `lnum` / `onum` | Lining / old-style figures |
| `zero` | Slashed zero |
| `ordn`, `sups`, `subs` | Ordinals, superiors, inferiors |
| `smcp`, `c2sc` | Small capitals from lowercase / from capitals |
| `case` | Case-sensitive forms |

`tnum` earns its keep in financial tables: proportional digits make a column of amounts ragged because `1` is narrower than `8`. Asking for a tag the font does not declare is a silent no-op, since the same document may be built with different fonts, and later tags win where two touch the same glyph. Ligatures and contextual features (`liga`, `calt`, `frac`) are out of scope. Features need a registered font.

## Limits & scope

- No automatic hyphenation dictionary — install a provider, or write soft hyphens.
- Justification distributes space between words only; there is no letter-spacing or glyph scaling.
- Kerning and features read the registered font's tables: base-14 text gets neither.
- Features are single substitutions; complex-script shaping is handled by the script shapers, independently of this option.

See the [typography samples](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/typography-showcase.ts): each pairs the default behaviour with the typographic option on identical content — `typography/breaks-atomic.pdf` against `breaks-split.pdf`, `align-ragged.pdf` against `align-justified.pdf` and `align-optical.pdf`, `kerning-off.pdf` against `kerning-on.pdf`, and more.

## See also

- [Tables](tables.html) — column alignment, where `tnum` matters most
- [Print production](print.html) — boxes, marks, CMYK and PDF/X-4
- [Choosing your surface](choose.html)
