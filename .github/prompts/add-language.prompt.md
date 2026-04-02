---
description: "Add a new Unicode script/language to pdfnative: font data module, encoding support, script detection, and tests."
agent: "agent"
---
# Add New Language Support

Add support for a new Unicode script in pdfnative.

## Steps

1. **Font data module**: Run `npx pdfnative-build-font fonts/ttf/<Font>.ttf fonts/<name>-data.js` to generate the font data module
2. **Script detection**: Add Unicode range detection in `src/shaping/script-detect.ts` for the new script
3. **Font loader**: Ensure `registerFont('${lang}', loader)` works with the new font data
4. **Encoding**: Verify CIDFont encoding handles all codepoints in the script's Unicode range
5. **Multi-font**: Test that `splitTextByFont()` correctly identifies and switches to the new font
6. **Tests**: Add tests for detection, encoding, and multi-font switching with the new script
7. **Exports**: Add new font data module to README's font registration example
8. **README**: Update the supported scripts list

## Context
- See `src/shaping/script-detect.ts` for existing Unicode range patterns
- See `src/fonts/encoding.ts` for CIDFont encoding logic
- See `fonts/` directory for existing font data module examples
- See `tools/build-font-data.cjs` for the font data generation tool
