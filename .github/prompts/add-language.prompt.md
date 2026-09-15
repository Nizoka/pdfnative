---
description: "Add a new Unicode script/language to pdfnative: font data module, encoding support, script detection, and tests."
agent: "agent"
---
# Add New Language Support

Add support for a new Unicode script in pdfnative.

## Steps

0. **New script, or new language on a bundled script?** A Latin-script language (Hausa, Yoruba, Igbo, Swahili since v1.8.0) needs no module, `lang` key or shaper: the `latin` module (Noto Sans) carries the letters and anchors, `detectCharLang()` routes Latin Extended-B / IPA / combining marks to it and `latin-marks` composes tone marks. Add only a plate in `scripts/data/alphabet-data.ts`, a `LanguageDoc` in `scripts/data/language-docs-data.ts` (one page, edge-case table, enforced by `tests/regression/language-docs.test.ts`), an alias in `scripts/helpers/fonts.ts` and the README rows, then stop. Otherwise continue.
1. **Obtain TTF font**: Download the raw `.ttf` file directly from [github.com/notofonts](https://github.com/notofonts) — navigate to the font repo, find the TTF under `fonts/`, click **"Download raw file"** (no zip needed), save to `fonts/ttf/` (git-ignored — nothing binary is committed), add its entry to `fonts/SOURCES.json` and record hash + copyright with `npx tsx scripts/download-fonts.ts --update-manifest --commit <sha>`; add the family to `THIRD-PARTY-NOTICES.md` and `fonts/LICENSE` (a test holds them to the manifest)
2. **Font data module**: Run `npx pdfnative-build-font fonts/ttf/<Font>.ttf fonts/<name>-data.js` to generate the font data module
3. **Script registry**: Add Unicode range constants (`<SCRIPT>_START/END`) and predicates (`is<Script>Codepoint`, `contains<Script>`) to `src/shaping/script-registry.ts`
4. **Script detection**: Add Unicode range detection in `src/shaping/script-detect.ts` for the new script
5. **OpenType shaping** (if needed): an Indic script is an `IndicScriptConfig` for `src/shaping/indic-engine.ts` plus a one-line wrapper (see `telugu-shaper.ts`); a USE-covered script needs nothing; otherwise create `src/shaping/<script>-shaper.ts` and register it in `shaper-registry.ts`
6. **Font loader**: Ensure `registerFont('${lang}', loader)` works with the new font data
7. **Encoding**: Verify CIDFont encoding handles all codepoints in the script's Unicode range
8. **Multi-font**: Test that `splitTextByFont()` correctly identifies and switches to the new font
9. **Tests**: Add tests for detection, encoding, shaping (if applicable), and multi-font switching
10. **Exports**: Add new font data module to README's font registration example
11. **README**: Update the supported scripts list/count and language table

## Context
- See `src/shaping/script-registry.ts` for centralized Unicode range constants and predicates
- See `src/shaping/script-detect.ts` for existing Unicode range patterns
- See `src/shaping/indic-engine.ts` (and the `*_CONFIG` of `telugu-shaper.ts`) for Indic scripts, `src/shaping/thai-shaper.ts` for a bespoke shaper
- See `src/fonts/encoding.ts` for CIDFont encoding logic
- See `fonts/` directory for existing font data module examples — 31 font-data modules (27 scripts + Latin + math + mono and colour emoji)
- See `tools/build-font-data.cjs` for the font data generation tool
