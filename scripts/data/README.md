# Unicode Character Database source files

Checked-in Unicode® data files used by dev-time generators to (re)build
TypeScript data modules under `src/`. They are **never** shipped in the npm
package and never loaded at runtime — only the generated `.ts` modules are.

| File | Generator | Output |
|---|---|---|
| `BidiMirroring.txt` | `scripts/generate-bidi-mirroring.ts` | `src/shaping/bidi-mirroring-data.ts` |
| `IndicSyllabicCategory.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `IndicPositionalCategory.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `ArabicShaping.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `DerivedCoreProperties.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `DerivedGeneralCategory.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `Scripts.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `IndicSyllabicCategory-Additional.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |
| `IndicPositionalCategory-Additional.txt` | `scripts/generate-use-data.ts` | `src/shaping/use-data.ts` |

All UCD files above are Unicode **17.0.0**. `generate-use-data.ts` refuses to
run if they disagree with each other, so a partial upgrade fails loudly
rather than producing a table derived from two Unicode versions.

`DerivedGeneralCategory.txt` comes from the UCD's `extracted/` directory.

## The two `-Additional` files

The Universal Shaping Engine needs `Indic_Syllabic_Category` and
`Indic_Positional_Category` values for a number of characters the UCD either
leaves unassigned or assigns differently for shaping purposes. Microsoft
publishes those overrides, and they reach us through HarfBuzz's `src/ms-use/`
directory, pinned at commit `cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec`.

They track a newer Unicode release than the UCD snapshot here. The generator
discards any override row naming a code point this UCD has not assigned, and
reports the count, so the two cannot silently drift into disagreement. As of
Unicode 17.0.0 nothing is discarded.

## License

The UCD files are © Unicode, Inc., distributed under the
[Unicode License v3](https://www.unicode.org/license.txt) — a permissive,
OSI-approved, MIT-compatible license that allows redistribution as long as the
copyright notice is retained (each file keeps its original header). This
mirrors the treatment of the Noto fonts (SIL OFL 1.1, see `fonts/LICENSE` and
`THIRD-PARTY-NOTICES.md`), whose sources are pinned in `fonts/SOURCES.json`
and downloaded rather than committed. The engine's UCD release is
`USE_UNICODE_VERSION` in `src/shaping/use-data.ts` (17.0.0).

The two `-Additional` files are distributed by HarfBuzz under the
[Old MIT license](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING),
likewise permissive and redistributable with attribution. Both keep their
original headers naming Andrew Glass as author.

## Upgrading

Replace the file with the new UCD release (keep its header), re-run the
generator, and review the regenerated module diff. Upgrade the whole set at
once: the generator cross-checks the version headers.

```
npx tsx scripts/generate-bidi-mirroring.ts
npx tsx scripts/generate-use-data.ts
npm run verify:unicode      # what CI runs
```
