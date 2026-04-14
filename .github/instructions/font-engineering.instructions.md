---
description: "Use when working on font encoding, CIDFont embedding, TTF subsetting, CMap generation, glyph mapping, or font metrics. Covers WinAnsi, Identity-H, and font data module patterns."
applyTo: "src/fonts/**"
---
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
- Subset tables required: `head`, `hhea`, `maxp`, `OS/2`, `name`, `cmap`, `loca`, `glyf`, `hmtx`, `post`
- Recalculate `checkSumAdjustment` in `head` table after subsetting
- Table offsets must be 4-byte aligned (pad with zeros)
- `loca` format (short/long) must match `head.indexToLocFormat`
- Compound glyphs: recursively include component GIDs with iteration limit to prevent infinite loops
- Buffer bounds checking: all DataView reads validated against buffer length to prevent out-of-range errors

## Font Data Modules
- Lazy-loaded via `registerFont()` / `loadFontData()` pattern
- Base64 TTF decoded once, cached — never decode twice
- Font data shape: `{ metrics, fontName, cmap, widths, ttfBase64, gsub, ligatures, markAnchors, mark2mark }`
- Build with: `npx pdfnative-build-font <input.ttf> <output.js>`

## CMap Builder
- `/CMapName /Adobe-Identity-UCS def`
- `beginbfchar` / `endbfchar` blocks — max 100 entries per block
- Unicode values as `<hex>` — handle supplementary plane (surrogate pairs)

## Common Mistakes
- Missing `.notdef` in subset → PDF viewers may crash
- Wrong `numTables` after subsetting → "invalid font" errors
- Mismatched `/W` array GIDs and actual subset GIDs
- Forgetting to update `maxp.numGlyphs` after subsetting
