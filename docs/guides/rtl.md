# Right-to-left documents — Arabic, Hebrew and bidirectional text

> **New in v1.9.0.** pdfnative resolves bidirectional text with the whole Unicode Bidirectional Algorithm (UAX #9): explicit embeddings, overrides and isolates, bracket pairing, the neutral rules that put punctuation on the right side of a right-to-left run, and per-paragraph resolution so a wrapped line reorders like the line a browser would draw. A `direction` option on the layout or on a paragraph aligns right-to-left paragraphs to the right margin and justifies them in visual order. Nothing changes for a document that never sets it, except where the previous output was wrong — see the release note's Upgrade section.

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';
import type { FontData } from 'pdfnative';
import * as notoArabic from 'pdfnative/fonts/noto-arabic-data.js';
import * as notoHebrew from 'pdfnative/fonts/noto-hebrew-data.js';

const pdf = buildDocumentPDFBytes(
  {
    title: 'تقرير ربع سنوي',
    fontEntries: [
      { fontData: notoArabic as unknown as FontData, fontRef: '/F3', lang: 'arabic' },
      { fontData: notoHebrew as unknown as FontData, fontRef: '/F4', lang: 'hebrew' },
    ],
    blocks: [
      { type: 'heading', text: 'الفصل الأول (المقدمة)', level: 1 },
      { type: 'paragraph', text: 'بلغت الإيرادات 1,250 مليون ريال في عام 2026، أي بزيادة 12% مقارنة بالعام السابق.' },
      { type: 'paragraph', text: 'Mixed line: the product name "pdfnative" stays Latin inside the Arabic sentence — المنتج pdfnative يعمل بلا تبعيات.', direction: 'rtl' },
      { type: 'paragraph', text: 'שלום עולם — a Hebrew paragraph detected as right-to-left from its first letter.' },
    ],
  },
  { direction: 'auto' },
);
```

`direction: 'auto'` reads each paragraph's base direction from its first strong character (UAX #9 P2–P3); a right-to-left paragraph is aligned to the right margin and, when justified, its lines keep their visual order. Set `direction` on one `ParagraphBlock` to force a paragraph, or leave the option out for the 1.8.0 behaviour (left alignment, left-to-right base).

## What the algorithm does for you

The resolver (`src/shaping/bidi.ts`) implements UAX #9 for Unicode 17.0.0, with the `Bidi_Class` and `Bidi_Paired_Bracket` properties generated from the Unicode Character Database (`scripts/data/DerivedBidiClass.txt`, `BidiBrackets.txt`; drift is checked by `npm run verify:unicode`):

| Rules | Effect in a document |
|---|---|
| P2–P3 | The paragraph's base direction comes from its first strong letter (Arabic, Hebrew, Syriac, Thaana, N'Ko… are R or AL; Latin, Cyrillic, CJK… are L). |
| X1–X10 | `LRE`/`RLE`/`PDF` embeddings, `LRO`/`RLO` overrides and `LRI`/`RLI`/`FSI`/`PDI` isolates nest to the standard's depth of 125; isolating run sequences are resolved as one unit. |
| W1–W7 | European and Arabic-Indic digits keep their reading order inside a right-to-left run (`1405` never becomes `5041`), and a currency sign or separator attaches to its number. |
| N0 | Paired brackets — `( )`, `[ ]`, `{ }`, `« »` and the other 63 pairs of BidiBrackets.txt — resolve as a pair, so `(abc)` inside Arabic keeps both brackets around its content. |
| N1–N2 | Neutral punctuation between two right-to-left letters, or between a letter and the paragraph edge, follows the paragraph: a full stop ending a Hebrew sentence is drawn at its left end, where a Hebrew reader expects it. |
| I1–I2 | Embedding levels are assigned; the resolver passes every line of the Unicode BidiCharacterTest (the gate runs a stratified subset, `BIDI_CHARACTER_TEST=<path to the full file>` runs all of it). |
| L1–L4 | Resolved once per paragraph, reordered per line after wrapping: trailing whitespace takes the paragraph level, runs are reversed from the highest level down, and glyphs with a mirrored counterpart (`(` ↔ `)`, `<` ↔ `>`, `«` ↔ `»`) are swapped in right-to-left runs. |

Before 1.9.0 the resolver was a lighter implementation: punctuation attached to the preceding Latin word, brackets inside a Latin run of an Arabic paragraph were not paired, and every line was resolved on its own, so a word wrapped onto the next line could change its neighbours' order. All three are gone; the samples that showed them are re-anchored in the byte manifest (release note, ledger entries C1–C3).

## Directional controls

Every control of UAX #9 is honoured and none is drawn:

- **Marks** — `U+200E` LEFT-TO-RIGHT MARK, `U+200F` RIGHT-TO-LEFT MARK, `U+061C` ARABIC LETTER MARK: a strong character of zero width, the usual way to force a trailing punctuation mark or an isolated number to one side.
- **Embeddings and overrides** — `U+202A`–`U+202E` (`LRE`, `RLE`, `PDF`, `LRO`, `RLO`): an override forces the characters it encloses into one direction regardless of their class.
- **Isolates** — `U+2066`–`U+2069` (`LRI`, `RLI`, `FSI`, `PDI`): an isolate keeps a quoted string, a user name or a product name from influencing the text around it; `FSI` detects the inner direction from the first strong character.

The controls never reach the glyph stream (they have no glyph and no width), and `extractText()` does not return them; the joiners the shapers need — `U+200D` ZERO WIDTH JOINER, `U+200C` ZERO WIDTH NON-JOINER, `U+00AD` SOFT HYPHEN — stay in the run so Arabic shaping and hyphenation see them.

## Alignment and justification

`direction` decides the default alignment of a paragraph: `'rtl'` (set, or detected by `'auto'`) aligns to the right margin, `'ltr'` to the left. An explicit `align` on the block wins. Justified text (`layout.typography.justify`, see the [typography guide](typography.html)) in a right-to-left paragraph distributes the slack over the word gaps of the visual line, so the last line of a paragraph stays ragged on the left where a right-to-left reader expects it.

Headings, list items and table cells reorder their text with the same resolver; alignment inside table cells follows `ColumnDef.align`.

## Text extraction of right-to-left output

`extractText()` returns text in **geometric** order — runs sorted by their position on the page, left to right. For a right-to-left line that is the visual order, so a logical sentence comes back reversed, as it does from any PDF reader's copy-and-paste. Two things make the text usable all the same:

- The `/ToUnicode` CMap maps every glyph the Arabic shaper produced — positional forms, the lam-alef ligatures — back to its source letters (v1.9.0, every shaper), so the letters are right even where the order is visual.
- A tagged document (`tagged: true` or any PDF/A level) carries the paragraph's logical text as `/ActualText`, and `extractText()` returns that text in logical order.

See the [text-extraction guide](text-extraction.html) for the rules.

## Programmatic access

The resolver is exported for tools that lay out text themselves:

```ts
import { resolveBidiLevels, bidiLineLevels, resolveBidiRuns, stripBidiControls } from 'pdfnative';

const levels = resolveBidiLevels('abc אבג 123', 'auto');   // UAX #9 P2–I2 on the whole paragraph
const line = bidiLineLevels('abc אבג 123', levels.levels, levels.paragraphLevel); // L1 for one wrapped line
const runs = resolveBidiRuns('abc אבג 123');               // ordered visual runs with their levels
```

`resolveBidiRuns(text)` runs the whole pipeline on one string; `resolveBidiLevels(text, direction)` resolves a paragraph once so the lines of a wrapped paragraph can be reordered against the same levels; `bidiLineLevels(line, levels, paragraphLevel)` applies L1 to one line; `stripBidiControls(text)` removes the controls when a plain string is wanted.

## Samples

`npm run test:generate` writes the right-to-left samples under `test-output/bidi/`: `bidi-algorithm.pdf` (the rules, one per paragraph), `bidi-arabic-shaping.pdf`, `bidi-digits-mirroring.pdf`, `bidi-embeddings-showcase.pdf` (every control), `persian-showcase.pdf`, and `bidi-uax9-conformance.pdf` (v1.9.0: punctuation, brackets, isolates and a justified right-to-left paragraph, with `direction: 'auto'`). The [extreme-scripts playground](../playgrounds/extreme-scripts.html) renders the same constructions in the browser.

## See also

- [Typography](typography.html) — justification, hyphenation, spacing rules.
- [Text extraction](text-extraction.html) — geometric order, `/ActualText`, `/ToUnicode` guarantees.
- [Troubleshooting — RTL text backwards](troubleshooting.html#rtl-text-backwards).
- [Unicode Standard Annex #9](https://www.unicode.org/reports/tr9/) — the algorithm.
