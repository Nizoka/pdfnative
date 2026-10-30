---
paths:
  - "src/fonts/**"
---
<!-- GENERATED from .github/instructions/font-engineering.instructions.md by scripts/build-claude-rules.ts — do not edit -->

# Font Engineering Standards

## WinAnsi Encoding (Helvetica)
- Code page 1252 — covers Latin-1 + full Windows-1252 range (0x80–0x9F: bullet, dagger, trademark, Œ/œ, Š/š, Ž/ž, curly quotes, ellipsis, per mille, guillemets — 27 characters)
- PDF string format: `(escaped text)` with `\(`, `\)`, `\\` escaping
- Width calculation: built-in Helvetica width table, no font embedding needed
- Bullet (U+2022 → 0x95): 350 units width in `helveticaWidth()`
- Truncation: calculate cumulative width, break at column max

## CIDFont Type2 / Identity-H
- Encoding: Identity-H CMap — a character code is a CID, and since v1.9.0 (C28) a font's CIDs are the **document's**, allotted in order of first use by `EncodingContext._trackGid()` (CID 0 = `.notdef`; `getCidMaps()` returns `cidToGid` per font ref); the embedded subset is renumbered so glyph i is CID i and `/CIDToGIDMap /Identity` stays. `TextRun.hexStr` / `tjStr` hold CIDs, `TextRun.cids` the codes of a shaped run's glyphs (`ShapedGlyph.gid` keeps the font's id for widths and anchors); the feature and kerning wrappers (`fonts/font-features.ts`, `fonts/font-kerning.ts`) and the colour-emoji emitter map codes back to glyph ids through the context's resolver — never look a code up in the font module directly
- String format: `<hex CID pairs>` — each glyph is 4 hex digits
- `/W` array: `buildCidWidthArray(widths, cids, usedGids)` — one contiguous `c [w w …]` group from CID 1, broken only by a glyph without a width entry (`/DW` covers it, as the layout measured it); CID 0 listed only when `.notdef` was drawn
- `/DW` default width: use font's `defaultWidth` for unlisted glyphs
- ToUnicode CMap: required for text extraction — `buildToUnicodeCMap(cmap, usedGids, overrides, encoded, cids)` keys every entry by CID

## TTF Subsetting Rules
- Always preserve GID 0 (`.notdef`) — required by PDF/A and most viewers
- Subset tables required: `head`, `hhea`, `maxp`, `OS/2`, `name`, `cmap`, `loca`, `glyf`, `hmtx`, `post`; kept verbatim when the source has them: `prep`, `fpgm`, `cvt `, `gasp` (hinting and dropout control — outlines never change, and no table is ever synthesised)
- Recalculate `checkSumAdjustment` in `head` table after subsetting: written as `0xB1B0AFBA − checksum(whole file)` with the field itself zeroed during the sum (ISO/IEC 14496-22 §5.2.3) — since v1.8.0; the table-directory checksum of `head` is computed with the field at zero, which is what `tests/fonts/font-subsetter.test.ts` reproduces
- Table offsets must be 4-byte aligned (pad with zeros)
- `loca` format (short/long) must match `head.indexToLocFormat`
- Compound glyphs: recursively include component GIDs with iteration limit to prevent infinite loops
- Buffer bounds checking: all DataView reads validated against buffer length to prevent out-of-range errors
- The lean PDF embed (v1.9.0): the two CIDFontType2 sites (`pdf-document.ts`, `pdf-builder.ts`) call `subsetTTF(ttf, gids, { lean: { cmap, cids } })` — the viewer selects glyphs through `/CIDToGIDMap /Identity` and never reads the font's `cmap`, so the embed carries a `cmap` rebuilt over the kept glyphs (format 4, plus format 12 beyond the BMP), a format-3 `post` and no `gasp`; with `cids` (C28) the glyphs are renumbered in CID order — `cids` first, then the components the composite closure adds in ascending source order, every composite's references rewritten (`renumberComponents`) — and `glyf`, `loca`, `hmtx` (the source's trailing-advance rule unfolded), `hhea.numberOfHMetrics` and `maxp.numGlyphs` cover the kept glyphs only, each outline byte-identical under its new id; without `cids` the ids are retained and outlines, metrics, `name` and hinting are byte-identical to the plain subset. Never for a simple TrueType font (`pdf-form-font.ts`, WinAnsi: the viewer reads its `cmap`), never for the emoji font, never for the derived Latin source fonts. `tests/fonts/lean-subset.test.ts` is the contract. A registered font no character reaches (an empty used-glyph set) embeds the `.notdef`-only lean subset with `/W []` — never the whole program — while keeping its five objects, since the page resources name it (C18, same test file). Every subset's `/BaseFont` and `/FontName` carry the six-letter tag of ISO 32000-1 §9.6.4 from `subsetTag(fontName, usedGids)` in `font-embedder.ts` — deterministic (FNV-1a over the name and the sorted gids), the same tag on the Type0, the CIDFont and the descriptor, and on the `/F1`/`/F2` aliases under PDF/A-2 and PDF/X; never under PDF/A-1, where ISO 19005-1 §6.3.5 would then demand a `/CIDSet` stream (C21)

## Font Data Modules
- Lazy-loaded via `registerFont()` / `loadFontData()` pattern
- Base64 TTF decoded once, cached — never decode twice
- Font data shape: `{ metrics, fontName, cmap, widths, pdfWidthArray, ttfBase64, gsub, ligatures, markAnchors, mark2mark, features, kern, otl }` — `pdfWidthArray` is required (`validateFontData()` reports it when missing); `otl` (v1.8.0, `null` when the font has no layout the shapers use) is the per-script, per-feature GSUB layout plus GDEF mark ranges the Indic engine and the Latin-marks shaper consume; `markAnchors.marks[gid]` / `mark2Classes[gid]` are flat triples `[class, x, y, …]`, one per GPOS subtable covering the mark, with classes unique across subtables — see `text-shaping.instructions.md` §GSUB/GPOS Data Format
- Build with: `npx pdfnative-build-font <input.ttf> <output.js>`; `tools/build-font-data.cjs` (reference) and `src/tools/font-compiler.ts` (`compileFontData`) must stay byte-identical — extend both, and `tests/tools/font-compiler.test.ts` runs the CLI on a synthetic font to prove it
- Source fonts are pinned in `fonts/SOURCES.json` (google/fonts commit or notofonts release tag, SHA-256 and copyright statement per TTF); `npm run fonts:download` verifies them and `npm run verify:fonts` refuses a source whose hash drifted. The five Latin subsets are `derived[]` entries the script cuts from `NotoSans-VF.ttf` with `subsetTTF(vf, gids, { keepLayoutTables })` from `fonts/subsets/*.codepoints.txt` (`scripts/lib/latin-subsets.ts`, GSUB closure when layout is kept); nothing under `fonts/ttf/` is committed, and `verify:fonts` re-derives them before comparing their modules. `subsetTTF`'s two-argument call stays byte-identical: `keepLayoutTables` (source fonts, never PDF embeds) and `lean` (CIDFontType2 embeds only) are the two opt-ins. Every module header carries the font's copyright statement (`name` id 0, ` * Copyright:` after ` * Source:`, v1.9.0): both generators read it the same way, and a module without the line is stale

## CMap Builder
- `/CMapName /Adobe-Identity-UCS def`
- `beginbfchar` / `endbfchar` blocks — max 100 entries per block
- Unicode values as `<hex>` — handle supplementary plane (surrogate pairs)

## Common Mistakes
- Missing `.notdef` in subset → PDF viewers may crash
- Wrong `numTables` after subsetting → "invalid font" errors
- Mismatched `/W` array CIDs and the subset's glyph order (a code written from a glyph id instead of `_trackGid()`'s CID draws the wrong glyph)
- Forgetting to update `maxp.numGlyphs` after subsetting
