---
description: "Use when working on Thai or Indic text shaping, the Indic OpenType engine, Latin combining marks, GSUB/GPOS OpenType features, script detection, multi-font fallback, or Unicode text segmentation."
applyTo: "src/shaping/**"
---
# Text Shaping & Multi-Script Standards

## Thai OpenType Shaping Pipeline
1. **Cluster building**: group base + above/below marks into syllable clusters
2. **GSUB SingleSubst**: substitute marks to positional variants (e.g., sara am → nikhahit + sara aa)
3. **GPOS MarkToBase**: position combining marks relative to base glyph anchors
4. **GPOS MarkToMark**: stack marks on top of other marks (e.g., tone on nikhahit)
5. Output: `ShapedGlyph[]` with `{ gid, dx, dy, isZeroAdvance }`

## GSUB/GPOS Data Format
- GSUB SingleSubst: `Record<number, number>` — simple GID → GID substitution map (`fontData.gsub`, every default-feature lookup merged; the Thai/Lao/Khmer/Myanmar/Tibetan shapers consume it)
- GSUB LigatureSubst: `Record<number, number[][]>` — first-glyph GID → arrays of `[resultGID, ...componentGIDs]`; stored in `fontData.ligatures`; `tryLigature()` pattern used by Tibetan, Khmer and Myanmar, and the fallback of the Indic engine for a font without `otl`
- **`fontData.otl` (v1.8.0)** — the per-script, per-feature layout the Indic engine and the Latin combining-mark shaper apply: `gsub.scripts[scriptTag][featureTag]` → ascending lookup indices; `gsub.lookups[index]` = `{ t, f, m }` with `t` 1 (single `{from: to}`), 2 (multiple `{from: [gid…]}`), 4 (ligature `{first: [[result, c2…]…]}`) or 6 (contextual — type 5 written in the chained shape — `[{ b, i, l, a }]` whose backtrack/input/lookahead index `gsub.sets` glyph-range lists and whose `a` is `[[inputIndex, lookupIndex]…]`); `f` = raw lookupFlag (bit 3 IgnoreMarks honoured through `gdef.marks`); Extension lookups resolved at build time; the lookups a contextual rule invokes are serialised even when no feature lists them. Types `OtlTables`, `OtlLookup`, `OtlChainRule` in `src/types/pdf-types.ts`
- MarkToBase anchors: `{ bases: { baseGID: { markClass: [x, y] } }, marks: { markGID: [class, x, y, class2, x2, y2, …] } }` — since v1.8.0 mark classes are unique across GPOS subtables and a mark carries **one triple per subtable that covers it**, in lookup order (Noto Sans Devanagari anchors े once on plain consonants, again on conjunct ligatures); `findMarkToBase()` tries the triples, the old `getMarkAnchor()` reads the first. Before 1.8.0 every subtable's class 0 collided and only the last survived — above vowel signs landed on below-base anchors
- MarkToMark: same structure with `mark1Anchors` / `mark2Classes` (triples too)
- Coordinates in font units (divide by unitsPerEm × fontSize for PDF points)
- Both generators — `tools/build-font-data.cjs` (reference) and `src/tools/font-compiler.ts` — must emit byte-identical modules; `tests/tools/font-compiler.test.ts` runs the CLI on a synthetic font and compares

## Script Detection
- `script-registry.ts`: centralized Unicode range constants (`ARABIC_START/END`, `HEBREW_START/END`, `THAI_START/END`, `BENGALI_START/END`, `TAMIL_START/END`, `DEVANAGARI_START/END`, `TELUGU_START/END`, `ETHIOPIC_START/END`, `SINHALA_START/END`, `TIBETAN_START/END`, `KHMER_START/END`, `MYANMAR_START/END`, and since 1.8.0 the Lao, Tai Tham, New Tai Lue, Tai Le and Cham ranges) and predicates (`is<Script>Codepoint` / `contains<Script>` for every one of them: `isArabicCodepoint` … `isMyanmarCodepoint`, `isLaoCodepoint`, `isTaiThamCodepoint`, `isNewTaiLueCodepoint`, `isTaiLeCodepoint`, `isChamCodepoint`, `containsArabic` … `containsMyanmar`, `containsLao`, `containsTaiTham`, `containsNewTaiLue`, `containsTaiLe`, `containsCham`) — single source of truth
- All script detection modules (`arabic-shaper.ts`, `thai-shaper.ts`, `bengali-shaper.ts`, `tamil-shaper.ts`, `devanagari-shaper.ts`, `telugu-shaper.ts`, `sinhala-shaper.ts`, `tibetan-shaper.ts`, `khmer-shaper.ts`, `myanmar-shaper.ts`, `lao-shaper.ts`, `use-shaper.ts`, `script-detect.ts`, `encoding-context.ts`) import from `script-registry.ts`
- Unicode range-based detection for: Thai, CJK, Korean, Greek, Devanagari, Arabic, Hebrew, Turkish, Vietnamese, Polish, Bengali, Tamil, Telugu, Ethiopic/Amharic, Sinhala, Tibetan, Khmer, Myanmar, Lao, Tai Tham, New Tai Lue, Tai Le, Cham (27 scripts)
- `detectCharLang` routes Bengali to `bn` and Tamil to `ta` (missing until 1.8.0: a multi-font document sent them to the first font with a glyph), and Latin Extended-B, IPA Extensions and the four generic combining-mark blocks (U+0300–036F, U+1AB0–1AFF, U+1DC0–1DFF, U+20D0–20FF) to `latin` — Hausa ɓ ɗ ƙ ƴ, Yoruba and Igbo tone marks; the four Vietnamese horn letters Ơ ơ Ư ư keep their pre-1.8.0 routing. `isCombiningMarkCodepoint` / `containsCombiningMarks` live in `script-registry.ts`
- Language keys `ha`, `yo`, `ig`, `sw` (sample data, `needsUnicodeFont`) are labels over the `latin` module: no new font, no new script

## Shaper Registry (shaper-registry.ts, v1.8.0) — the single dispatch
- `SCRIPT_SHAPERS: readonly ScriptShaper[]` lists every shaped script in dispatch order as `{ id, detect, shape }`; `findShaper(text)` returns the first whose `detect` matches, or `null`
- It replaced three hand-written dispatch ladders (and the fall-through that shaped any unmatched run as Devanagari). Adding a script = one entry here plus its shaper module; never add a per-script `if` chain in `encoding.ts`, `pdf-text.ts` or a builder
- Tai Tham and Cham (and any registered font's script with no dedicated shaper) dispatch to `use-shaper.ts` (`shapeUseText`), the Universal Shaping Engine: `use-engine.ts` (`useCategory`, `useCategories`, `splitUseSyllables`, `reorderUseCluster`) over `use-data.ts`, which is **generated** from the vendored UCD in `scripts/data/*.txt` by `npx tsx scripts/generate-use-data.ts` and drift-checked by `npm run verify:unicode` — never hand-edit it. `USE_UNICODE_VERSION` records the UCD release
- New Tai Lue and Tai Le need no reordering (detection + font routing, like Ethiopic); Lao has its own `lao-shaper.ts` (`buildLaoClusters` + GSUB/GPOS, like Thai)
- `use-lite.ts` (`classifyUseCategory`) remains the joiner-classification authority for the Indic, Khmer and Myanmar shapers; it is not the USE engine
- Arabic ranges: U+0600–06FF, U+0750–077F, U+08A0–08FF, U+FB50–FDFF, U+FE70–FEFE
- Hebrew ranges: U+0590–05FF, U+FB1D–FB4F
- Detection must be O(n) single-pass — no regex per character
- Return set of detected languages for efficient font preloading
- Special handling: Turkish İ/ı, Vietnamese combining marks, Polish Ł/ł

## Multi-Font Run Splitting
- Split text into runs of same-font segments
- **Script-aware preference**: `detectCharLang(cp)` maps each codepoint to its preferred `lang` — font entry with matching `lang` is preferred over broad-coverage fonts (prevents JP/ZH/KR from stealing Greek/Vietnamese/etc. characters)
- **Continuation bias**: for common/shared characters (Latin, digits, spaces, punctuation), prefer current font if it supports the character (reduce font switches)
- **Combining-mark lookahead (v1.8.0)**: a base followed by a generic combining mark ranks fonts 0 (no base) < 1 (base only) < 2 (base and mark) < 3 (base and an anchored mark), so Yoruba ẹ́ lands in Noto Sans in one run even when the Vietnamese subset (ẹ and U+0301, no GPOS) is registered first; text without a following mark ranks every covering font 3, exactly as before
- Run output: `{ text, fontRef, fontData, hexStr, widthPt }`
- Latin text always falls back to Helvetica (no embedding needed)
- Single-codepoint lookups via `cmap[codePoint]` — O(1) check

## Performance
- Score match by cmap presence — avoid full shaping for detection
- Batch glyph encoding: build hex string in one pass
- Pre-compute width accumulation, don't re-traverse for truncation
- Thai shaping: single pass cluster build, single pass GSUB, single pass GPOS
- Indic shaping: syllable split, one pass per basic feature stage, one presentation pass, one attachment pass; a lookup is a plain-object read and a mask check is an integer AND — no per-glyph allocation inside the lookup loop, and `npm run bench` before and after any change under `src/shaping/**`

## Tagged Mode Integration
- When `tagged: true`, shaped glyphs are wrapped in `/Span << /MCID n /ActualText <hex> >> BDC...EMC`
- `/ActualText` carries the original Unicode string (pre-shaping) so text extractors get correct output
- This solves the fundamental issue where GPOS-repositioned marks cause garbled copy-paste
- The tagged text functions (`txtTagged`, `txtRTagged`, `txtCTagged`) delegate to `wrapSpan()` in `pdf-tags.ts`
- Critical for Thai, Devanagari, Bengali, Tamil, and Vietnamese where combining marks get spatially repositioned
- Since v1.8.0 the Indic engine and the Latin combining-mark shaper also report the source code points of every glyph they emit (`ShapedGlyph.cps`), and the encoding context writes them into the ToUnicode CMap as multi-code-point `bfchar` destinations — a conjunct or a contextual form with no cmap entry extracts as its letters even in untagged output

## BiDi Resolution (UAX #9)
- Simplified UBA: paragraph level detection (P2-P3), weak type resolution (W1-W7), neutral resolution (N1-N2), and — since v1.7.0 — implicit even-level embedding (I1/I2) so digit runs (EN/AN, incl. Extended Arabic-Indic) keep logical order inside RTL text
- `BidiType` classification: L (Latin), R (Hebrew), AL (Arabic), EN, AN, ES, ET, CS, WS, ON, NSM, BN
- Character classification order matters: check NSM/BN/AN/EN specific ranges BEFORE broad Arabic block (0x0600-06FF)
- General Punctuation (U+2010–U+2027, U+2030–U+205E) classified as ON — covers dashes, quotes, ellipsis, primes
- `resolveBidiRuns(text)`: main API — returns `BidiRun[]` in visual order (L2 reordering: runs reversed for RTL paragraphs so LTR text renders first at leftmost position)
- `containsRTL(text)`: fast O(n) check for Arabic/Hebrew content
- Glyph mirroring via `BIDI_MIRRORING_PAIRS` (`bidi-mirroring-data.ts`): the complete 428-pair UCD `BidiMirroring.txt` table under rule L4 (since v1.7.0 — replaces the former ~40-pair `MIRROR_MAP`)
- `reverseString()`: surrogate-pair safe reversal for RTL run reordering
- Levels: 0 = LTR, 1 = RTL, 2 = LTR embedded in RTL

### Practical BiDi Fixups (post-N2)
- **Punctuation affinity**: in RTL paragraphs, sentence punctuation (`.` `,` `;` `:` `!` `?`) that follows an LTR word is reassigned to L so it stays in the same visual run as the preceding text — prevents "pdfnative." from splitting into "pdfnative" + floating "."
- **Bracket pairing**: opening brackets `(` `[` `{` that enclose LTR content get reassigned to L along with their matching closer, keeping `(BiDi)` as a single LTR run instead of splitting across RTL/LTR boundaries
- These fixups run only for RTL paragraphs (paraLevel=1), after `resolveNeutralTypes()` and before `assignLevels()`

## Arabic Positional Shaping
- GSUB-based: determines positional form (isolated/initial/medial/final) per character
- Joining type analysis: D (dual-joining), R (right-joining), C (join-causing), U (non-joining), T (transparent)
- Form resolution: uses joining context of adjacent characters to select form
- GSUB substitution convention: init=cp+0x10000, medi=cp+0x20000, fina=cp+0x30000
- Lam-alef ligatures: detected by `isLamAlef()`, looked up as key=lam_cp*0x10000+alef_cp
- Harakat (diacritics): transparent joining type, marked as zero-advance
- Arabic ranges: U+0600–06FF (main), U+0750–077F (Supplement), U+08A0–08FF (Extended-A), Presentation Forms
- Hebrew: right-to-left ordering without positional shaping (no GSUB needed)

## Encoding Pipeline Integration
- RTL text detected by `containsRTL()` in encoding.ts (`textRuns()` and `ps()` functions)
- When RTL detected: `resolveBidiRuns(str)` called to produce visual-order runs with embedding levels
- RTL Arabic runs: `splitArabicNonArabic()` segments into Arabic (shaped) and non-Arabic (Helvetica fallback) sub-runs
- RTL Arabic shaping: `reverseString()` back to logical order → `shapeArabicText()` → `.slice().reverse()` for visual output
- RTL Hebrew runs: text already reversed by BiDi → encode character-by-character (no positional shaping)
- LTR runs within mixed text: standard encoding path (no BiDi processing)
- Helvetica continuation bias: `buildTextRunsWithFallback()` keeps WinAnsi-encodable characters (spaces, punctuation) in Helvetica mode when already in Helvetica, preventing CIDFont space-switching between Latin words
- Helvetica width metrics: `helveticaWidth()` handles Unicode codepoints directly — em-dash (U+2014→1000), en-dash (U+2013→556), ellipsis (U+2026→1000), curly quotes, Euro sign
- CRITICAL: `shapeArabicText()` expects logical-order input and returns logical-order glyphs — must reverse for visual
- CRITICAL: `splitArabicNonArabic()` must separate non-Arabic chars (em-dash, punctuation) from Arabic shaping to avoid .notdef glyphs
- Arabic text runs: shaped via `shapeArabicText()` → `ShapedGlyph[]` → hex-encoded (same path as Thai)
- Hebrew: detected by `containsHebrew()` in script-detect, uses standard CIDFont encoding
- Both Arabic and Hebrew fonts: lazy-loaded via `registerFont('ar'/'he', loader)`

## CJK Line Breaking
- `wrapText()` in `pdf-document.ts` uses `tokenizeForWrap()` for segment-based line breaking
- `isCJKBreakable(cp)`: detects CJK codepoints that allow line breaks on either side
- CJK ranges: U+2E80–U+9FFF, U+AC00–U+D7AF, U+F900–U+FAFF, U+FE30–U+FE4F, U+FF00–U+FFEF, U+20000–U+2FA1F
- Each CJK character becomes an individual breakable segment; Latin words remain grouped
- Spaces attach to the preceding segment (trailing space rule)
- Mixed Latin/CJK text: Latin words break at spaces, CJK chars break individually
- CRITICAL: CJK text has no spaces between characters — without character-level breaking, entire strings overflow margins

## Typography Convention: En-Dash Separator
- Title/footer separators use en-dash `–` (U+2013) with spaces (`" – "`), not em-dash `—` (U+2014)
- Rationale: en-dash is 44% narrower (556 vs 1000 Helvetica units), WinAnsi-encodable, ISO/international standard
- Avoids disproportionate visual gaps in cursive scripts (Arabic) where compact shaped text amplifies the perceived space
- Em-dash still fully supported by the library (encoding, width metrics, BiDi classification) — this is a typographic recommendation, not a restriction

## Indic OpenType Engine (indic-engine.ts, v1.8.0) — Devanagari, Bengali, Tamil, Telugu, Sinhala
One engine, `shapeIndicText(str, fontData, cfg)`, behind the five exported shapers (`shapeDevanagariText` … `shapeSinhalaText` are one-line wrappers over a per-script `IndicScriptConfig`: `scriptTags`, `consonants`, `virama`, `ra`, `rephMode` implicit/explicit/none, `rephPosition` beforePost/afterSub/afterPost, `blwfMode`, `splitMatras`, `conjunctsNeedZwj`). Reference behaviour: Microsoft "Developing OpenType Fonts for Indic Scripts" and HarfBuzz `hb-ot-shaper-indic.cc`.
1. **Syllable split** (`splitIndicSyllables`) from the UCD's USE categories (`useCategory()` — B, H/HVM, CMBlw nukta, VPre/VAbv/VBlw/VPst, VM* modifiers) plus `classifyUseCategory()` for ZWJ/ZWNJ; no hand-written per-script character-class tables. A virama continues a syllable only into a consonant (Sinhala: only through ZWJ); ZWNJ after a virama closes it
2. **Decomposition** of two-part vowel signs from `cfg.splitMatras` (Bengali ো ৌ, Tamil ொ ோ ௌ, Sinhala ේ ො ෝ ෞ) — the pre-base part goes first; Devanagari ो ौ are single glyphs and are **not** split
3. **Base finding**: the last consonant without a below/post-base form, decided by asking the font (`wouldSubstitute('blwf'|'pstf'|'pref'|'vatu', [H, C] or [C, H])`, contextual rules counting only with no backtrack/lookahead); reph only when `rphf` would substitute Ra + virama (+ ZWJ in explicit mode). Positions and **per-glyph feature masks** follow: `rphf` on the reph pair, `half` on the consonants before the base, `blwf`/`pstf`/`vatu`/`pref` after it (and before it under `blwfMode: 'preAndPost'`); a nukta or virama takes the mask of the consonant it follows. Pre-base vowel signs move to the front
4. **Basic features**, one stage each in specification order: `locl ccmp nukt akhn rphf rkrf pref blwf abvf half pstf vatu cjct`; each stage applies the lookups of its feature in ascending index order, single/multiple/ligature and contextual (types 5/6, backtrack + input + lookahead, nested lookups fired at their input positions). The mask gates the glyph a feature changes; a contextual rule's input is matched regardless (Bengali `blwf` names the base before the virama and the Ra)
5. **Final reordering**: a pre-base vowel sign lands after the last virama no half form absorbed (ड्गि → ड ् ि ग), else at the syllable start; the reph glyph moves to `rephPosition`; a `pref` Ra to just before the base; leftover joiners are dropped
6. **Presentation features** in one pass, lookup order: `pres abvs blws psts haln calt`
7. **Attachment** (`attachMarks()` in `gpos-positioner.ts`): a mark is what GDEF says (fallback: an anchored glyph or a combining class); it attaches to the nearest preceding base through `findMarkToBase()` (every triple), stacks on the previous mark through MarkToMark, keeps its own advance when the font has no anchor and gave it one
- Fonts without `otl` (modules built before 1.8.0, hand-made font data) take the same path over their flat `ligatures` (as `akhn`) and `gsub` (as `pres`)
- `shapeIndicTextTraced()` prints one line per lookup that changed a syllable — the debugging aid; `scripts/glyph-names.ts` names glyph ids from a font's `post` table
- Locks: `tests/shaping/indic-real-font.test.ts` (the report's words on the bundled fonts — glyph sequences, `cps`, attachment), the per-script mock suites, `tests/visual/` pixel baselines (`doc-tamil`, `doc-devanagari`, `doc-telugu`, `doc-bengali`), `tests/regression/language-docs.test.ts`
- Not applied: GSUB type 3 (alternate) and type 8 (reverse chaining); mark filtering sets (flag 0x10) are treated as "skip no mark"; `kern`/`dist` pair positioning inside a shaped run
- Ranges and predicates (`containsDevanagari` … `containsSinhala`) come from `script-registry.ts`; the `build<Script>Clusters()` helpers stay as internal cluster analysers for the tests

## Latin combining marks (latin-marks.ts, v1.8.0)
- Registered **last** in `SCRIPT_SHAPERS` as `latin-marks` with `containsCombiningMarks` — only a run no other shaper claims and that holds a generic combining mark (Yoruba ẹ́ ọ̀, Igbo ị́, NFD accents, Greek/Cyrillic diacritics) reaches it; every existing document is byte-identical
- Pipeline: cmap → the font's `ccmp` under `latn`/`DFLT` through `applyGsubFeatures()` (Noto Sans turns `i` into its dotless form under a mark) → `attachMarks()` (mark-to-base, then mark-to-mark for a second mark on the same letter)
- No fallback to Helvetica inside a shaped run, no kerning or `fontFeatures` on it — documented limits

## Ethiopic / Amharic (script-detect.ts only — no shaper)
- Ethiopic (U+1200–U+137F) is a syllabic abugida: each codepoint is a complete consonant+vowel syllable, so **no GSUB/GPOS reordering is required** — detection + font routing only (lang `'am'`)
- `containsEthiopic(text)`: fast O(n) check imported from `script-registry.ts`

## Tibetan OpenType Shaping Pipeline (tibetan-shaper.ts)
1. **Vertical stacking**: subjoined consonants (U+0F90–U+0FBC) stack below the head consonant
2. **GSUB/GPOS**: subjoined-form ligatures via shared `gsub-driver`, anchor positioning via shared `gpos-positioner`
- Tibetan ranges: U+0F00–U+0FFF; bundled font is Noto Serif Tibetan
- `containsTibetan(text)`: fast O(n) check imported from `script-registry.ts`

## Khmer OpenType Shaping Pipeline (khmer-shaper.ts) — USE-lite
1. **Cluster building** via `classifyUseCategory()` (use-lite.ts)
2. **Coeng subscripts**: U+17D2 (coeng) + consonant → subscript form
3. **Pre-base vowel reordering**: pre-base vowel signs moved before the base
4. **Two-part vowel decomposition** via shaper table
- Khmer ranges: U+1780–U+17FF
- Pragmatic USE-lite with documented limitations (two-part-vowel MultipleSubst handled JS-side, not by the OpenType extractor)
- `containsKhmer(text)`: fast O(n) check imported from `script-registry.ts`

## Myanmar OpenType Shaping Pipeline (myanmar-shaper.ts) — USE-lite
1. **Cluster building** via `classifyUseCategory()` (use-lite.ts)
2. **Medials**: medial consonants positioned around the base
3. **Pre-base reordering**: medial-ra (U+103C) and e-vowel (U+1031) moved before the base
4. **Virama stacking**: U+1039 virama-mediated consonant stacking
- Myanmar ranges: U+1000–U+109F
- Pragmatic USE-lite with documented limitations (two-part-vowel MultipleSubst handled JS-side)
- `containsMyanmar(text)`: fast O(n) check imported from `script-registry.ts`
