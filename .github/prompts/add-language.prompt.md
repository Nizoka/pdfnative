---
description: "Add a new Unicode script/language to pdfnative: font data module, encoding support, script detection, and tests."
agent: "agent"
---
# Add New Language Support

Add support for a new Unicode script in pdfnative.

## Steps

1. **Obtain TTF font**: Download the raw `.ttf` file directly from [github.com/notofonts](https://github.com/notofonts) — navigate to the font repo, find the TTF under `fonts/`, click **"Download raw file"** (no zip needed), save to `fonts/ttf/`
2. **Font data module**: Run `npx pdfnative-build-font fonts/ttf/<Font>.ttf fonts/<name>-data.js` to generate the font data module
3. **Script registry**: Add Unicode range constants (`<SCRIPT>_START/END`) and predicates (`is<Script>Codepoint`, `contains<Script>`) to `src/shaping/script-registry.ts`
4. **Script detection**: Add Unicode range detection in `src/shaping/script-detect.ts` for the new script
5. **OpenType shaping** (if needed): Create `src/shaping/<script>-shaper.ts` for GSUB/GPOS (see `bengali-shaper.ts` or `tamil-shaper.ts`)
6. **Font loader**: Ensure `registerFont('${lang}', loader)` works with the new font data
7. **Encoding**: Verify CIDFont encoding handles all codepoints in the script's Unicode range
8. **Multi-font**: Test that `splitTextByFont()` correctly identifies and switches to the new font
9. **Tests**: Add tests for detection, encoding, shaping (if applicable), and multi-font switching
10. **Exports**: Add new font data module to README's font registration example
11. **README**: Update the supported scripts list/count and language table

## Context
- See `src/shaping/script-registry.ts` for centralized Unicode range constants and predicates
- See `src/shaping/script-detect.ts` for existing Unicode range patterns
- See `src/shaping/bengali-shaper.ts` and `src/shaping/tamil-shaper.ts` for OpenType shaping examples
- See `src/fonts/encoding.ts` for CIDFont encoding logic
- See `fonts/` directory for existing font data module examples (16 scripts)
- See `tools/build-font-data.cjs` for the font data generation tool
