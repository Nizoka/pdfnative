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
| `NotoSansGujarati-Regular.ttf` | `noto-gujarati-data.js` | google/fonts `ofl/notosansgujarati` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/gujarati) |
| `NotoSansGurmukhi-Regular.ttf` | `noto-gurmukhi-data.js` | google/fonts `ofl/notosansgurmukhi` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/gurmukhi) |
| `NotoSansKannada-Regular.ttf` | `noto-kannada-data.js` | google/fonts `ofl/notosanskannada` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/kannada) |
| `NotoSansMalayalam-Regular.ttf` | `noto-malayalam-data.js` | google/fonts `ofl/notosansmalayalam` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/malayalam) |
| `NotoSansOriya-Regular.ttf` | `noto-oriya-data.js` | google/fonts `ofl/notosansoriya` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/oriya) |
| `NotoSansThai-Regular.ttf` | `noto-thai-data.js` | google/fonts `ofl/notosansthai` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/thai) |
| `NotoSansTibetan-Regular.ttf` | `noto-tibetan-data.js` | google/fonts `ofl/notoseriftibetan` | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/tibetan) |
| `NotoEmoji-Regular.ttf` | `noto-emoji-data.js` | google/fonts `ofl/notoemoji` | Copyright 2013 Google LLC |
| `NotoColorEmoji-Regular.ttf` | `noto-color-emoji-data.js` | google/fonts `ofl/notocoloremoji` at `f265cc2d8e08` | Copyright 2022 Google Inc. |

## Unicode Character Database — Unicode License v3

Dev-time generators consume checked-in Unicode® Character Database source
files (`scripts/data/`, Unicode 17.0.0 — `IndicSyllabicCategory.txt`,
`IndicPositionalCategory.txt`, `ArabicShaping.txt`, `DerivedCoreProperties.txt`,
`DerivedGeneralCategory.txt`, `Scripts.txt`, `BidiMirroring.txt`,
`BidiBrackets.txt` and `DerivedBidiClass.txt`) to build four TypeScript data
modules: `src/shaping/use-data.ts`, `src/shaping/bidi-mirroring-data.ts`,
`src/shaping/bidi-brackets-data.ts` and `src/shaping/bidi-class-data.ts`. A
sample of `BidiCharacterTest.txt` (`BidiCharacterTest-subset.txt`) drives the
UAX #9 conformance test and builds nothing. The source files are **not**
shipped in the npm package; the generated modules are, compiled into `dist/`,
where each keeps its `@license` header naming Unicode, Inc. and this notice
(a bundler drops ordinary comments; the `@license` form survives). The full
license text below is the documentation copy the license's condition (b)
asks for.

- License: [Unicode License v3](https://www.unicode.org/license.txt)
  (SPDX `Unicode-3.0`) — permissive, OSI-approved; each source file retains
  its original copyright header.
- Copyright: © 1991-2026 Unicode, Inc.
- Provenance and regeneration: [scripts/data/README.md](scripts/data/README.md);
  `USE_UNICODE_VERSION` in `src/shaping/use-data.ts` and
  `BIDI_CLASS_UNICODE_VERSION` in `src/shaping/bidi-class-data.ts` name the release.

<details>
<summary>Unicode License v3 — full text</summary>

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

</details>

## Microsoft Universal Shaping Engine override tables — MIT License

The Universal Shaping Engine needs `Indic_Syllabic_Category` and
`Indic_Positional_Category` values the Unicode Character Database does not
carry. Microsoft publishes those overrides (author Andrew Glass), and two of
their files (`IndicSyllabicCategory-Additional.txt`,
`IndicPositionalCategory-Additional.txt`) are checked in under
`scripts/data/`, taken from HarfBuzz's `src/ms-use/` directory at commit
`cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec`. The files themselves are consumed
only by the dev-time generator and are **not** shipped; the category values
they assign are compiled into `src/shaping/use-data.ts` and do ship, which is
why that module's `@license` header names Microsoft and this notice carries
the license text.

- License: [MIT](https://github.com/harfbuzz/harfbuzz/blob/main/src/ms-use/COPYING)
  (SPDX `MIT`), as distributed in HarfBuzz's `src/ms-use/COPYING`.
- Copyright: © Microsoft Corporation.

<details>
<summary>MIT License (Microsoft USE override tables) — full text</summary>

```text
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```

</details>

## HarfBuzz — Old MIT License (the USE cluster grammar)

`src/shaping/use-engine.ts` builds its cluster grammar — the productions
`standard_cluster`, `virama_terminated_cluster`, `sakot_terminated_cluster`,
`numeral_cluster`, `symbol_cluster`, `hieroglyph_cluster`, `broken_cluster`
and their tails — as a transcription of the Ragel state machine in HarfBuzz's
`src/hb-ot-shaper-use-machine.rl` (commit
`cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec`), which is HarfBuzz's reading of
the Universal Shaping Engine specification. No HarfBuzz code is copied; the
grammar is re-expressed as pure TypeScript matchers, and the module ships in
`dist/` with a `@license` header carrying the notice below, as the license
asks of every copy.

- License: [Old MIT](https://github.com/harfbuzz/harfbuzz/blob/main/COPYING),
  HarfBuzz's license.
- Copyright: © 2015 Google, Inc. (the machine file); HarfBuzz © its
  contributors as listed in its `COPYING`.

<details>
<summary>Old MIT License (HarfBuzz) — full text</summary>

```text
Copyright © 2015  Google, Inc.

Permission is hereby granted, without written agreement and without
license or royalty fees, to use, copy, modify, and distribute this
software and its documentation for any purpose, provided that the
above copyright notice and the following two paragraphs appear in
all copies of this software.

IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES
ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN
IF THE COPYRIGHT HOLDER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
DAMAGE.

THE COPYRIGHT HOLDER SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING,
BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE.  THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE COPYRIGHT HOLDER HAS NO OBLIGATION TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

</details>

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
with integrity hashes; the playgrounds load pdfnative, React, `@babel/standalone`
(the React playground compiles JSX in the browser) and `pdfnative-react` from
esm.sh and jsDelivr. None of these is part of the repository or the npm package.
`docs/assets/synthetic-cmyk.icc` is generated by
`scripts/lib/synthetic-cmyk-profile.ts`. No hyphenation patterns, emoji data
files, ICC profiles or third-party images are bundled.
