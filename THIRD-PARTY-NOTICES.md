# Third-party notices

pdfnative itself is MIT-licensed (see [LICENSE](LICENSE)) and has **zero
runtime dependencies**. The repository and the published npm package embed
the following third-party data, each under its own permissive license:

## Noto fonts (Google) — SIL Open Font License 1.1

The bundled font data modules (`fonts/*.js`, generated from the Noto family
TTFs in `fonts/ttf/`) are derived from Google's Noto fonts.

- License: [SIL Open Font License 1.1](https://scripts.sil.org/OFL) — full
  text in [fonts/LICENSE](fonts/LICENSE), shipped in the npm package.
- Copyright: © Google LLC.

## Unicode Character Database — Unicode License v3

Dev-time generators consume checked-in Unicode® Character Database source
files (`scripts/data/`, e.g. `BidiMirroring.txt`) to build TypeScript data
modules under `src/`. The source files are **not** shipped in the npm
package; only the generated modules are.

- License: [Unicode License v3](https://www.unicode.org/license.txt) —
  permissive, OSI-approved; each file retains its original copyright header.
- Copyright: © Unicode, Inc.
- Provenance and regeneration: [scripts/data/README.md](scripts/data/README.md).

## Universal Shaping Engine override tables — Old MIT License

The Universal Shaping Engine needs `Indic_Syllabic_Category` and
`Indic_Positional_Category` values the Unicode Character Database does not
carry. Microsoft publishes those overrides, and two of their files
(`IndicSyllabicCategory-Additional.txt`, `IndicPositionalCategory-Additional.txt`)
are checked in under `scripts/data/`. They are consumed only by the dev-time
generator and are **not** shipped in the npm package.

- License: [Old MIT](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING),
  as distributed by HarfBuzz; each file retains its original header.
- Author: Andrew Glass (Microsoft), via the HarfBuzz project.

No other third-party code or data is included.
