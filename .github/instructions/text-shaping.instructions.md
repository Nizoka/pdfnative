---
description: "Use when working on Thai text shaping, GSUB/GPOS OpenType features, script detection, multi-font fallback, or Unicode text segmentation."
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
- GSUB SingleSubst: `Record<number, number>` — simple GID → GID substitution map
- GSUB LigatureSubst: `Record<number, number[][]>` — first-glyph GID → arrays of `[resultGID, ...componentGIDs]`; stored in `fontData.ligatures`; `tryLigature()` pattern used by Bengali, Tamil, and Devanagari shapers
- MarkToBase anchors: `{ bases: { baseGID: { markClass: [x, y] } }, marks: { markGID: [x, y, class] } }`
- MarkToMark: same structure with `mark1Anchors` / `mark2Classes`
- Coordinates in font units (divide by unitsPerEm × fontSize for PDF points)

## Script Detection
- `script-registry.ts`: centralized Unicode range constants (`ARABIC_START/END`, `HEBREW_START/END`, `THAI_START/END`, `BENGALI_START/END`, `TAMIL_START/END`, `DEVANAGARI_START/END`) and predicates (`isArabicCodepoint`, `isHebrewCodepoint`, `isThaiCodepoint`, `isBengaliCodepoint`, `isTamilCodepoint`, `isDevanagariCodepoint`, `containsArabic`, `containsHebrew`, `containsThai`, `containsBengali`, `containsTamil`, `containsDevanagari`) — single source of truth
- All script detection modules (`arabic-shaper.ts`, `thai-shaper.ts`, `bengali-shaper.ts`, `tamil-shaper.ts`, `devanagari-shaper.ts`, `script-detect.ts`, `encoding-context.ts`) import from `script-registry.ts`
- Unicode range-based detection for: Thai, CJK, Korean, Greek, Devanagari, Arabic, Hebrew, Turkish, Vietnamese, Polish, Bengali, Tamil
- Arabic ranges: U+0600–06FF, U+0750–077F, U+08A0–08FF, U+FB50–FDFF, U+FE70–FEFE
- Hebrew ranges: U+0590–05FF, U+FB1D–FB4F
- Detection must be O(n) single-pass — no regex per character
- Return set of detected languages for efficient font preloading
- Special handling: Turkish İ/ı, Vietnamese combining marks, Polish Ł/ł

## Multi-Font Run Splitting
- Split text into runs of same-font segments
- **Script-aware preference**: `detectCharLang(cp)` maps each codepoint to its preferred `lang` — font entry with matching `lang` is preferred over broad-coverage fonts (prevents JP/ZH/KR from stealing Greek/Vietnamese/etc. characters)
- **Continuation bias**: for common/shared characters (Latin, digits, spaces, punctuation), prefer current font if it supports the character (reduce font switches)
- Run output: `{ text, fontRef, fontData, hexStr, widthPt }`
- Latin text always falls back to Helvetica (no embedding needed)
- Single-codepoint lookups via `cmap[codePoint]` — O(1) check

## Performance
- Score match by cmap presence — avoid full shaping for detection
- Batch glyph encoding: build hex string in one pass
- Pre-compute width accumulation, don't re-traverse for truncation
- Thai shaping: single pass cluster build, single pass GSUB, single pass GPOS
- Devanagari shaping: cluster build + matra reorder + GSUB ligatures + GPOS marks in sequential passes

## Tagged Mode Integration
- When `tagged: true`, shaped glyphs are wrapped in `/Span << /MCID n /ActualText <hex> >> BDC...EMC`
- `/ActualText` carries the original Unicode string (pre-shaping) so text extractors get correct output
- This solves the fundamental issue where GPOS-repositioned marks cause garbled copy-paste
- The tagged text functions (`txtTagged`, `txtRTagged`, `txtCTagged`) delegate to `wrapSpan()` in `pdf-tags.ts`
- Critical for Thai, Devanagari, Bengali, Tamil, and Vietnamese where combining marks get spatially repositioned

## BiDi Resolution (UAX #9)
- Simplified UBA: paragraph level detection (P2-P3), weak type resolution (W1-W7), neutral resolution (N1-N2)
- `BidiType` classification: L (Latin), R (Hebrew), AL (Arabic), EN, AN, ES, ET, CS, WS, ON, NSM, BN
- Character classification order matters: check NSM/BN/AN/EN specific ranges BEFORE broad Arabic block (0x0600-06FF)
- General Punctuation (U+2010–U+2027, U+2030–U+205E) classified as ON — covers dashes, quotes, ellipsis, primes
- `resolveBidiRuns(text)`: main API — returns `BidiRun[]` in visual order (L2 reordering: runs reversed for RTL paragraphs so LTR text renders first at leftmost position)
- `containsRTL(text)`: fast O(n) check for Arabic/Hebrew content
- Glyph mirroring via `MIRROR_MAP`: ~40 pairs (parentheses, brackets, guillemets, math symbols)
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

## Bengali OpenType Shaping Pipeline (bengali-shaper.ts)
1. **Cluster building**: group base consonant + halant + following consonant(s) into conjuncts
2. **GSUB Substitution**: substitute conjunct sequences (e.g., ক + ্ + ষ → ক্ষ) for contextual forms
3. **GPOS Mark Positioning**: position matras and vowel signs relative to base glyph anchors
4. Output: `ShapedGlyph[]` with `{ gid, dx, dy, isZeroAdvance }`
- Bengali ranges: U+0980–U+09FF
- `containsBengali(text)`: fast O(n) check imported from `script-registry.ts`

## Tamil OpenType Shaping Pipeline (tamil-shaper.ts)
1. **Split vowel decomposition**: multi-part vowel signs split into components positioned around base
2. **GSUB Substitution**: contextual form substitution for consonant+vowel combinations
3. Output: `ShapedGlyph[]` with glyph IDs and positioning offsets
- Tamil ranges: U+0B80–U+0BFF
- `containsTamil(text)`: fast O(n) check imported from `script-registry.ts`

## Devanagari OpenType Shaping Pipeline (devanagari-shaper.ts)
1. **Cluster building**: group base consonant + halant + following consonant(s) + matras into orthographic clusters; reph detection (Ra + Halant at cluster start)
2. **Matra reordering**: pre-base matras (ि) moved before cluster; split vowels decomposed into pre-base + post-base components
3. **GSUB LigatureSubst**: substitute conjunct sequences via `tryLigature()` using `fontData.ligatures` (152 groups for Noto Sans Devanagari)
4. **GPOS Mark Positioning**: position matras and vowel signs relative to base glyph anchors via mark-to-base and mark-to-mark
5. Output: `ShapedGlyph[]` with `{ gid, dx, dy, isZeroAdvance }`
- Devanagari ranges: U+0900–U+097F
- `containsDevanagari(text)`: fast O(n) check imported from `script-registry.ts`
