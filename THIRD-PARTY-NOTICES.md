# Third-party notices

pdfnative itself is MIT-licensed (see [LICENSE](LICENSE)) and has **zero
runtime dependencies**. The repository and the published npm package embed
or derive from the following third-party material, each under its own
permissive license. `fonts/SOURCES.json` is the machine-readable record of
every font source (upstream, commit or release tag, SHA-256, copyright
statement); a test holds this file to it.

## Noto fonts (Google and the Noto Project) — SIL Open Font License 1.1

No font file is committed to the repository or shipped in the package. The
bundled font data modules (`fonts/*-data.js`) are **Modified Versions** in
the sense of OFL §1: glyph subsets of the Noto fonts, converted to base64
with their metric and layout tables extracted, by `tools/build-font-data.cjs`
and `scripts/build-color-emoji-data.ts`. Their sources are downloaded and
SHA-256-checked by `npm run fonts:download` from the google/fonts repository
at commit `5fb648bb932bf1cdcd5fd71a73b79097e8666c36` (Noto Color Emoji at
`f265cc2d8e08067dac782ba633458b97661ab85d`) or from the notofonts release
archives named below; the five Latin subsets are cut from the pinned
`NotoSans-VF.ttf` by the library's own `subsetTTF()` (code-point lists under
`fonts/subsets/`, command `npx tsx scripts/build-latin-subsets.ts`), and
`npm run verify:fonts` re-derives them and rebuilds every module before
comparing it byte for byte with what ships. Documents produced with pdfnative
embed further subsets of these modules; OFL §5 exempts such documents from
the license's terms.

- License: [SIL Open Font License 1.1](https://openfontlicense.org) — full
  text in [fonts/LICENSE](fonts/LICENSE), shipped in the npm package together
  with every copyright statement below, as OFL §2 requires.
- Reserved Font Names: the Noto Sans CJK fonts (Japanese, Korean, Simplified
  Chinese) are derived from Adobe's Source Han Sans and declare the Reserved
  Font Name **"Source"**; no other family declares one. pdfnative's modules
  and the fonts it embeds are named after the Noto family (`NotoSansJP-Regular`
  and so on) and never use "Source".

| Source font | Module | Upstream | Copyright |
|---|---|---|---|
| `NotoSans-VF.ttf` | `noto-sans-data.js` | google/fonts `ofl/notosans` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic) |
| `NotoSans-Cyrillic.ttf` | `noto-cyrillic-data.js` | derived from `NotoSans-VF.ttf` by `subsetTTF()` (layout tables kept) | as `NotoSans-VF.ttf` |
| `NotoSans-Greek.ttf` | `noto-greek-data.js` | derived from `NotoSans-VF.ttf` by `subsetTTF()` | as `NotoSans-VF.ttf` |
| `NotoSans-Polish.ttf` | `noto-polish-data.js` | derived from `NotoSans-VF.ttf` by `subsetTTF()` | as `NotoSans-VF.ttf` |
| `NotoSans-Turkish.ttf` | `noto-turkish-data.js` | derived from `NotoSans-VF.ttf` by `subsetTTF()` | as `NotoSans-VF.ttf` |
| `NotoSans-Vietnamese.ttf` | `noto-vietnamese-data.js` | derived from `NotoSans-VF.ttf` by `subsetTTF()` | as `NotoSans-VF.ttf` |
| `NotoSansArabic-Regular.ttf` | `noto-arabic-data.js` | notofonts/arabic release `NotoSansArabic-v2.013` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/arabic) |
| `NotoSansArmenian-Regular.ttf` | `noto-armenian-data.js` | notofonts/armenian release `NotoSansArmenian-v2.008` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/armenian) |
| `NotoSansBengali-Regular.ttf` | `noto-bengali-data.js` | google/fonts `ofl/notosansbengali` | Copyright 2025 The Noto Project Authors (https://github.com/notofonts/bengali) |
| `NotoSansCham-Regular.ttf` | `noto-cham-data.js` | google/fonts `ofl/notosanscham` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/cham) |
| `NotoSansDevanagari-Regular.ttf` | `noto-devanagari-data.js` | google/fonts `ofl/notosansdevanagari` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari) |
| `NotoSansEthiopic-Regular.ttf` | `noto-ethiopic-data.js` | google/fonts `ofl/notosansethiopic` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/ethiopic) |
| `NotoSansGeorgian-Regular.ttf` | `noto-georgian-data.js` | notofonts/georgian release `NotoSansGeorgian-v2.005` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/georgian) |
| `NotoSansHebrew-Regular.ttf` | `noto-hebrew-data.js` | notofonts/hebrew release `NotoSansHebrew-v3.001` | Copyright 2024 The Noto Project Authors (https://github.com/notofonts/hebrew) |
| `NotoSansJP-Regular.ttf` | `noto-jp-data.js` | google/fonts `ofl/notosansjp` | (c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. |
| `NotoSansKR-Regular.ttf` | `noto-kr-data.js` | google/fonts `ofl/notosanskr` | (c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. |
| `NotoSansKhmer-Regular.ttf` | `noto-khmer-data.js` | google/fonts `ofl/notosanskhmer` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/khmer) |
| `NotoSansLao-Regular.ttf` | `noto-lao-data.js` | google/fonts `ofl/notosanslao` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/lao) |
| `NotoSansMath-Regular.ttf` | `noto-sans-math-data.js` | google/fonts `ofl/notosansmath` | Copyright 2022 Google LLC. All Rights Reserved. |
| `NotoSansMyanmar-Regular.ttf` | `noto-myanmar-data.js` | google/fonts `ofl/notosansmyanmar` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/myanmar) |
| `NotoSansNewTaiLue-Regular.ttf` | `noto-newtailue-data.js` | google/fonts `ofl/notosansnewtailue` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/new-tai-lue) |
| `NotoSansSC-Regular.ttf` | `noto-sc-data.js` | google/fonts `ofl/notosanssc` | (c) 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. |
| `NotoSansSinhala-Regular.ttf` | `noto-sinhala-data.js` | google/fonts `ofl/notosanssinhala` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/sinhala) |
| `NotoSansTaiLe-Regular.ttf` | `noto-taile-data.js` | google/fonts `ofl/notosanstaile` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/tai-le) |
| `NotoSansTaiTham-Regular.ttf` | `noto-taitham-data.js` | google/fonts `ofl/notosanstaitham` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/tai-tham) |
| `NotoSansTamil-Regular.ttf` | `noto-tamil-data.js` | google/fonts `ofl/notosanstamil` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/tamil) |
| `NotoSansTelugu-Regular.ttf` | `noto-telugu-data.js` | google/fonts `ofl/notosanstelugu` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/telugu) |
| `NotoSansThai-Regular.ttf` | `noto-thai-data.js` | google/fonts `ofl/notosansthai` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai) |
| `NotoSansTibetan-Regular.ttf` | `noto-tibetan-data.js` | google/fonts `ofl/notoseriftibetan` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/tibetan) |
| `NotoEmoji-Regular.ttf` | `noto-emoji-data.js` | google/fonts `ofl/notoemoji` | Copyright 2013 Google LLC |
| `NotoColorEmoji-Regular.ttf` | `noto-color-emoji-data.js` | google/fonts `ofl/notocoloremoji` at `f265cc2d8e08` | Copyright 2022 Google Inc. |

## Unicode Character Database — Unicode License v3

Dev-time generators consume checked-in Unicode® Character Database source
files (`scripts/data/`, Unicode 17.0.0 — `BidiMirroring.txt`,
`IndicSyllabicCategory.txt`, `IndicPositionalCategory.txt` and their
companions) to build the TypeScript data modules `src/shaping/use-data.ts`
and `src/shaping/bidi-mirroring-data.ts`. The source files are **not**
shipped in the npm package; the generated modules are, compiled into `dist/`,
and keep the copyright line.

- License: [Unicode License v3](https://www.unicode.org/license.txt) —
  permissive, OSI-approved; each file retains its original copyright header.
- Copyright: © Unicode, Inc.
- Provenance and regeneration: [scripts/data/README.md](scripts/data/README.md);
  `USE_UNICODE_VERSION` in `src/shaping/use-data.ts` names the release.

## Universal Shaping Engine override tables — Old MIT License

The Universal Shaping Engine needs `Indic_Syllabic_Category` and
`Indic_Positional_Category` values the Unicode Character Database does not
carry. Microsoft publishes those overrides, and two of their files
(`IndicSyllabicCategory-Additional.txt`, `IndicPositionalCategory-Additional.txt`)
are checked in under `scripts/data/`, taken from HarfBuzz's `src/ms-use/`
directory at commit `cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec`. They are
consumed only by the dev-time generator and are **not** shipped in the npm
package.

- License: [Old MIT](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING),
  as distributed by HarfBuzz; each file retains its original header.
- Author: Andrew Glass (Microsoft), via the HarfBuzz project.

## Adobe Core 14 font metrics

The base-14 advance widths pdfnative uses to measure Helvetica text without
embedding a font — `src/fonts/encoding.ts` and, for the exact `metrics:
'exact'` typography option, `src/fonts/base14-metrics.ts` — are transcribed
from Adobe's `Helvetica.afm` and `Helvetica-Bold.afm`, the Adobe Font Metrics
files of the PostScript Core 14 fonts. The AFM files themselves are not
redistributed; only the numbers are, compiled into `dist/`.

- Copyright: © Adobe Systems Incorporated. Adobe permits the Core 14 AFM
  files to be used, copied and distributed provided that this copyright
  notice is retained.

## Not included

The pdfnative.dev site pages load Prism.js, marked and DOMPurify from jsDelivr
with integrity hashes; the playgrounds load pdfnative and React from esm.sh
and jsDelivr. None of these is part of the repository or the npm package.
`docs/assets/synthetic-cmyk.icc` is generated by
`scripts/lib/synthetic-cmyk-profile.ts`. No hyphenation patterns, emoji data
files, ICC profiles or third-party images are bundled.
