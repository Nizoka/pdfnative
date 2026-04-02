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
- GSUB: `Record<number, number>` — simple GID → GID substitution map
- MarkToBase anchors: `{ bases: { baseGID: { markClass: [x, y] } }, marks: { markGID: [x, y, class] } }`
- MarkToMark: same structure with `mark1Anchors` / `mark2Classes`
- Coordinates in font units (divide by unitsPerEm × fontSize for PDF points)

## Script Detection
- Unicode range-based detection for: Thai, CJK, Korean, Greek, Devanagari, Arabic, Hebrew, Turkish, Vietnamese, Polish
- Arabic ranges: U+0600–06FF, U+0750–077F, U+08A0–08FF, U+FB50–FDFF, U+FE70–FEFE
- Hebrew ranges: U+0590–05FF, U+FB1D–FB4F
- Detection must be O(n) single-pass — no regex per character
- Return set of detected languages for efficient font preloading
- Special handling: Turkish İ/ı, Vietnamese combining marks, Polish Ł/ł

## Multi-Font Run Splitting
- Split text into runs of same-font segments
- **Continuation bias**: prefer current font if it supports the character (reduce font switches)
- Run output: `{ text, fontRef, fontData, hexStr, widthPt }`
- Latin text always falls back to Helvetica (no embedding needed)
- Single-codepoint lookups via `cmap[codePoint]` — O(1) check

## Performance
- Score match by cmap presence — avoid full shaping for detection
- Batch glyph encoding: build hex string in one pass
- Pre-compute width accumulation, don't re-traverse for truncation
- Thai shaping: single pass cluster build, single pass GSUB, single pass GPOS

## Tagged Mode Integration
- When `tagged: true`, shaped glyphs are wrapped in `/Span << /MCID n /ActualText <hex> >> BDC...EMC`
- `/ActualText` carries the original Unicode string (pre-shaping) so text extractors get correct output
- This solves the fundamental issue where GPOS-repositioned marks cause garbled copy-paste
- The tagged text functions (`txtTagged`, `txtRTagged`, `txtCTagged`) delegate to `wrapSpan()` in `pdf-tags.ts`
- Critical for Thai, Devanagari, and Vietnamese where combining marks get spatially repositioned

## BiDi Resolution (UAX #9)
- Simplified UBA: paragraph level detection (P2-P3), weak type resolution (W1-W7), neutral resolution (N1-N2)
- `BidiType` classification: L (Latin), R (Hebrew), AL (Arabic), EN, AN, ES, ET, CS, WS, ON, NSM, BN
- Character classification order matters: check NSM/BN/AN/EN specific ranges BEFORE broad Arabic block (0x0600-06FF)
- `resolveBidiRuns(text)`: main API — returns `BidiRun[]` with text segments and embedding levels
- `containsRTL(text)`: fast O(n) check for Arabic/Hebrew content
- Glyph mirroring via `MIRROR_MAP`: ~40 pairs (parentheses, brackets, guillemets, math symbols)
- `reverseString()`: surrogate-pair safe reversal for RTL run reordering
- Levels: 0 = LTR, 1 = RTL, 2 = LTR embedded in RTL

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
- RTL Arabic runs: `reverseString()` back to logical order → `shapeArabicText()` → `.slice().reverse()` for visual output
- RTL Hebrew runs: text already reversed by BiDi → encode character-by-character (no positional shaping)
- LTR runs within mixed text: standard encoding path (no BiDi processing)
- CRITICAL: `shapeArabicText()` expects logical-order input and returns logical-order glyphs — must reverse for visual
- Arabic text runs: shaped via `shapeArabicText()` → `ShapedGlyph[]` → hex-encoded (same path as Thai)
- Hebrew: detected by `containsHebrew()` in script-detect, uses standard CIDFont encoding
- Both Arabic and Hebrew fonts: lazy-loaded via `registerFont('ar'/'he', loader)`
