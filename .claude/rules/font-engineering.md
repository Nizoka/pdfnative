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
- Encoding: Identity-H CMap — glyph IDs map 1:1 to character codes
- String format: `<hex GID pairs>` — each glyph is 4 hex digits
- `/W` array: `[gid [width]]` format for per-glyph widths
- `/DW` default width: use font's `defaultWidth` for unlisted glyphs
- ToUnicode CMap: required for text extraction — maps GIDs back to Unicode

## TTF Subsetting Rules
- Always preserve GID 0 (`.notdef`) — required by PDF/A and most viewers
- Subset tables required: `head`, `hhea`, `maxp`, `OS/2`, `name`, `cmap`, `loca`, `glyf`, `hmtx`, `post`; kept verbatim when the source has them: `prep`, `fpgm`, `cvt `, `gasp` (hinting and dropout control — outlines never change, and no table is ever synthesised)
- Recalculate `checkSumAdjustment` in `head` table after subsetting: written as `0xB1B0AFBA − checksum(whole file)` with the field itself zeroed during the sum (ISO/IEC 14496-22 §5.2.3) — since v1.8.0; the table-directory checksum of `head` is computed with the field at zero, which is what `tests/fonts/font-subsetter.test.ts` reproduces
- Table offsets must be 4-byte aligned (pad with zeros)
- `loca` format (short/long) must match `head.indexToLocFormat`
- Compound glyphs: recursively include component GIDs with iteration limit to prevent infinite loops
- Buffer bounds checking: all DataView reads validated against buffer length to prevent out-of-range errors

## Font Data Modules
- Lazy-loaded via `registerFont()` / `loadFontData()` pattern
- Base64 TTF decoded once, cached — never decode twice
- Font data shape: `{ metrics, fontName, cmap, widths, pdfWidthArray, ttfBase64, gsub, ligatures, markAnchors, mark2mark, features, kern, otl }` — `pdfWidthArray` is required (`validateFontData()` reports it when missing); `otl` (v1.8.0, `null` when the font has no layout the shapers use) is the per-script, per-feature GSUB layout plus GDEF mark ranges the Indic engine and the Latin-marks shaper consume; `markAnchors.marks[gid]` / `mark2Classes[gid]` are flat triples `[class, x, y, …]`, one per GPOS subtable covering the mark, with classes unique across subtables — see `text-shaping.instructions.md` §GSUB/GPOS Data Format
- Build with: `npx pdfnative-build-font <input.ttf> <output.js>`; `tools/build-font-data.cjs` (reference) and `src/tools/font-compiler.ts` (`compileFontData`) must stay byte-identical — extend both, and `tests/tools/font-compiler.test.ts` runs the CLI on a synthetic font to prove it
- Source fonts are pinned in `fonts/SOURCES.json` (google/fonts commit, SHA-256 per TTF); `npm run fonts:download` verifies them and `npm run verify:fonts` refuses a source whose hash drifted

## CMap Builder
- `/CMapName /Adobe-Identity-UCS def`
- `beginbfchar` / `endbfchar` blocks — max 100 entries per block
- Unicode values as `<hex>` — handle supplementary plane (surrogate pairs)

## Common Mistakes
- Missing `.notdef` in subset → PDF viewers may crash
- Wrong `numTables` after subsetting → "invalid font" errors
- Mismatched `/W` array GIDs and actual subset GIDs
- Forgetting to update `maxp.numGlyphs` after subsetting
