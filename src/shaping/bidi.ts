/**
 * pdfnative — Simplified Unicode Bidirectional Algorithm
 * =======================================================
 * Pure JS implementation of a subset of UAX #9 (Unicode Bidirectional Algorithm).
 * Sufficient for real-world Arabic/Hebrew + Latin mixed text in PDF documents.
 *
 * Supported:
 *   - Embedding levels 0 (LTR) and 1 (RTL)
 *   - Character types: L, R, AL, EN, AN, ES, ET, CS, WS, ON, NSM, BN
 *   - Weak type resolution (W1-W7)
 *   - Neutral type resolution (N1-N2)
 *   - Reordering (L2 — reverse RTL runs)
 *   - Paragraph level detection (P2-P3)
 *   - Isolates (LRI U+2066, RLI U+2067, FSI U+2068, PDI U+2069) — v1.1.0
 *
 * Not supported (defer to v1.2):
 *   - Explicit embeddings (LRE/RLE), overrides (LRO/RLO)
 *   - Levels > 2
 *
 * References:
 *   - Unicode Standard Annex #9: https://unicode.org/reports/tr9/
 *   - ISO 32000-1 §14.8.2.3 (logical structure and reading order)
 */

// ── Bidi Character Types ─────────────────────────────────────────────

/** Bidirectional character type classification. */
export type BidiType = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'WS' | 'ON' | 'NSM' | 'BN';

/** A run of text with a resolved embedding level. */
export interface BidiRun {
    readonly text: string;
    readonly level: number;   // 0 = LTR, 1 = RTL
    readonly start: number;   // Offset in the source text
}

// ── Character Type Classification ────────────────────────────────────

/**
 * Classify a Unicode code point into its bidi character type.
 * Based on Unicode Character Database BidiClass property.
 *
 * @param cp - Unicode code point
 * @returns Bidi character type classification
 */
export function classifyBidiType(cp: number): BidiType {
    // ── Specific types BEFORE broad block ranges ─────────────────────

    // Non-spacing marks (must be before Arabic block check)
    if ((cp >= 0x0300 && cp <= 0x036F) || // Combining Diacritical Marks
        (cp >= 0x0591 && cp <= 0x05BD) || // Hebrew marks
        (cp >= 0x05BF && cp <= 0x05BF) ||
        (cp >= 0x05C1 && cp <= 0x05C2) ||
        (cp >= 0x05C4 && cp <= 0x05C5) ||
        (cp >= 0x05C7 && cp <= 0x05C7) ||
        (cp >= 0x0610 && cp <= 0x061A) || // Arabic marks
        (cp >= 0x064B && cp <= 0x065F) || // Arabic harakat
        (cp >= 0x0670 && cp <= 0x0670) || // Arabic superscript alef
        (cp >= 0x06D6 && cp <= 0x06DC) ||
        (cp >= 0x06DF && cp <= 0x06E4) ||
        (cp >= 0x06E7 && cp <= 0x06E8) ||
        (cp >= 0x06EA && cp <= 0x06ED) ||
        (cp >= 0xFE20 && cp <= 0xFE2F)) return 'NSM';

    // Boundary neutrals (must be before Arabic Presentation Forms-B).
    // Isolate format characters (LRI/RLI/FSI/PDI) are also classified as BN
    // here — their directional effect is handled separately by the isolate
    // pre-pass in resolveBidiRuns. UAX #9 actually defines them as their own
    // types, but treating them as BN inside the core algorithm gives correct
    // results once the recursion has carved out the inner sub-paragraphs.
    if (cp === 0x200B || cp === 0x200C || cp === 0x200D ||
        cp === 0x200E || cp === 0x200F || cp === 0xFEFF ||
        cp === 0x2066 || cp === 0x2067 || cp === 0x2068 || cp === 0x2069) return 'BN';

    // Arabic-Indic digits (must be before Arabic block)
    if (cp >= 0x0660 && cp <= 0x0669) return 'AN';
    // Extended Arabic-Indic digits
    if (cp >= 0x06F0 && cp <= 0x06F9) return 'AN';

    // European digits 0-9
    if (cp >= 0x0030 && cp <= 0x0039) return 'EN';

    // European separators
    if (cp === 0x002B || cp === 0x002D) return 'ES'; // + -
    // European terminators
    if (cp === 0x0023 || cp === 0x0024 || cp === 0x0025 ||
        cp === 0x00A2 || cp === 0x00A3 || cp === 0x00A4 || cp === 0x00A5 ||
        cp === 0x20AC || cp === 0x20B9 || cp === 0x20BA) return 'ET';

    // Common separators
    if (cp === 0x002C || cp === 0x002E || cp === 0x002F || cp === 0x003A || cp === 0x00A0) return 'CS';

    // Whitespace
    if (cp === 0x0020 || cp === 0x0009 || cp === 0x000A || cp === 0x000D ||
        cp === 0x000C || cp === 0x2000 || cp === 0x200A ||
        cp === 0x2028 || cp === 0x2029 || cp === 0x202F || cp === 0x205F || cp === 0x3000) return 'WS';

    // ── Broad block ranges ───────────────────────────────────────────

    // Arabic block U+0600-06FF → AL
    if (cp >= 0x0600 && cp <= 0x06FF) return 'AL';
    // Arabic Supplement U+0750-077F → AL
    if (cp >= 0x0750 && cp <= 0x077F) return 'AL';
    // Arabic Extended-A U+08A0-08FF → AL
    if (cp >= 0x08A0 && cp <= 0x08FF) return 'AL';
    // Arabic Presentation Forms-A U+FB50-FDFF → AL
    if (cp >= 0xFB50 && cp <= 0xFDFF) return 'AL';
    // Arabic Presentation Forms-B U+FE70-FEFE → AL (FEFF is BN, handled above)
    if (cp >= 0xFE70 && cp <= 0xFEFE) return 'AL';

    // Hebrew U+0590-05FF → R (marks already handled above as NSM)
    if (cp >= 0x05D0 && cp <= 0x05EA) return 'R'; // Hebrew letters
    if (cp >= 0x05F0 && cp <= 0x05F4) return 'R'; // Hebrew yod/punctuation
    // Misc Hebrew/RTL: Syriac, Thaana
    if (cp >= 0x0700 && cp <= 0x074F) return 'R'; // Syriac
    if (cp >= 0x0780 && cp <= 0x07BF) return 'R'; // Thaana
    if (cp >= 0xFB1D && cp <= 0xFB4F) return 'R'; // Hebrew Presentation Forms

    // Latin, CJK, etc. → L (default)
    if (cp >= 0x0041 && cp <= 0x005A) return 'L'; // A-Z
    if (cp >= 0x0061 && cp <= 0x007A) return 'L'; // a-z
    if (cp >= 0x00C0 && cp <= 0x024F) return 'L'; // Latin Extended
    if (cp >= 0x0370 && cp <= 0x03FF) return 'L'; // Greek
    if (cp >= 0x0400 && cp <= 0x04FF) return 'L'; // Cyrillic
    if (cp >= 0x0E00 && cp <= 0x0E7F) return 'L'; // Thai
    if (cp >= 0x0900 && cp <= 0x097F) return 'L'; // Devanagari
    if (cp >= 0x3040 && cp <= 0x30FF) return 'L'; // Japanese Kana
    if (cp >= 0x4E00 && cp <= 0x9FFF) return 'L'; // CJK
    if (cp >= 0xAC00 && cp <= 0xD7AF) return 'L'; // Hangul

    // Punctuation → ON (Other Neutral)
    if (cp >= 0x0021 && cp <= 0x002F) return 'ON';
    if (cp >= 0x003A && cp <= 0x0040) return 'ON';
    if (cp >= 0x005B && cp <= 0x0060) return 'ON';
    if (cp >= 0x007B && cp <= 0x007E) return 'ON';
    if (cp >= 0x00A1 && cp <= 0x00BF) return 'ON';
    // General Punctuation: dashes, quotes, leaders, etc. (U+2010–U+205E)
    if (cp >= 0x2010 && cp <= 0x2027) return 'ON';
    if (cp >= 0x2030 && cp <= 0x205E) return 'ON';

    // Default: Left-to-right for unclassified
    return 'L';
}

// ── Paragraph Level Detection (P2-P3) ────────────────────────────────

/**
 * Determine the paragraph embedding level.
 * P2: Find first strong character (L, R, AL).
 * P3: If R or AL → level 1, else level 0.
 *
 * @param types - Array of bidi character types for the paragraph
 * @returns 0 for LTR, 1 for RTL
 */
export function detectParagraphLevel(types: BidiType[]): number {
    for (const t of types) {
        if (t === 'L') return 0;
        if (t === 'R' || t === 'AL') return 1;
    }
    return 0; // default LTR
}

// ── Weak Type Resolution (W1-W7) ────────────────────────────────────

/**
 * Apply weak type resolution rules W1-W7 from UAX #9.
 * Modifies types array in place.
 */
function resolveWeakTypes(types: BidiType[], paraLevel: number): void {
    const len = types.length;

    // W1: NSM → type of previous character (or paragraph embedding direction)
    let prevType: BidiType = paraLevel === 0 ? 'L' : 'R';
    for (let i = 0; i < len; i++) {
        if (types[i] === 'BN') continue;
        if (types[i] === 'NSM') {
            types[i] = prevType;
        }
        prevType = types[i];
    }

    // W2: EN after AL → AN
    let lastStrong: BidiType = paraLevel === 0 ? 'L' : 'R';
    for (let i = 0; i < len; i++) {
        if (types[i] === 'BN') continue;
        if (types[i] === 'R' || types[i] === 'L' || types[i] === 'AL') {
            lastStrong = types[i];
        } else if (types[i] === 'EN' && lastStrong === 'AL') {
            types[i] = 'AN';
        }
    }

    // W3: AL → R
    for (let i = 0; i < len; i++) {
        if (types[i] === 'AL') types[i] = 'R';
    }

    // W4: ES between EN → EN; CS between EN → EN; CS between AN → AN
    for (let i = 1; i < len - 1; i++) {
        if (types[i] === 'BN') continue;
        if (types[i] === 'ES' && types[i - 1] === 'EN' && types[i + 1] === 'EN') {
            types[i] = 'EN';
        } else if (types[i] === 'CS') {
            if (types[i - 1] === 'EN' && types[i + 1] === 'EN') types[i] = 'EN';
            else if (types[i - 1] === 'AN' && types[i + 1] === 'AN') types[i] = 'AN';
        }
    }

    // W5: ET adjacent to EN → EN
    for (let i = 0; i < len; i++) {
        if (types[i] === 'ET') {
            // Check backward
            let found = false;
            for (let j = i - 1; j >= 0; j--) {
                if (types[j] === 'EN') { found = true; break; }
                if (types[j] !== 'ET' && types[j] !== 'BN') break;
            }
            if (!found) {
                // Check forward
                for (let j = i + 1; j < len; j++) {
                    if (types[j] === 'EN') { found = true; break; }
                    if (types[j] !== 'ET' && types[j] !== 'BN') break;
                }
            }
            if (found) types[i] = 'EN';
        }
    }

    // W6: remaining ES, ET, CS → ON
    for (let i = 0; i < len; i++) {
        if (types[i] === 'ES' || types[i] === 'ET' || types[i] === 'CS') {
            types[i] = 'ON';
        }
    }

    // W7: EN preceded by L (in run direction) → L
    lastStrong = paraLevel === 0 ? 'L' : 'R';
    for (let i = 0; i < len; i++) {
        if (types[i] === 'BN') continue;
        if (types[i] === 'L' || types[i] === 'R') {
            lastStrong = types[i];
        } else if (types[i] === 'EN' && lastStrong === 'L') {
            types[i] = 'L';
        }
    }
}

// ── Neutral Type Resolution (N1-N2) ─────────────────────────────────

/**
 * Apply neutral type resolution rules N1-N2 from UAX #9.
 * Modifies types array in place.
 */
function resolveNeutralTypes(types: BidiType[], paraLevel: number): void {
    const len = types.length;
    const paraDir: BidiType = paraLevel === 0 ? 'L' : 'R';

    for (let i = 0; i < len; i++) {
        if (types[i] !== 'ON' && types[i] !== 'WS' && types[i] !== 'BN') continue;

        // Find start of neutral run
        const start = i;
        while (i < len && (types[i] === 'ON' || types[i] === 'WS' || types[i] === 'BN')) i++;
        const end = i; // exclusive

        // Find surrounding strong types
        let prevStrong: BidiType = paraDir;
        for (let j = start - 1; j >= 0; j--) {
            if (types[j] === 'L' || types[j] === 'R' || types[j] === 'EN' || types[j] === 'AN') {
                prevStrong = (types[j] === 'EN' || types[j] === 'AN') ? 'R' : types[j];
                break;
            }
        }

        let nextStrong: BidiType = paraDir;
        for (let j = end; j < len; j++) {
            if (types[j] === 'L' || types[j] === 'R' || types[j] === 'EN' || types[j] === 'AN') {
                nextStrong = (types[j] === 'EN' || types[j] === 'AN') ? 'R' : types[j];
                break;
            }
        }

        // N1: If same direction, neutrals inherit that direction
        // N2: Otherwise, inherit paragraph embedding level direction
        const resolved: BidiType = (prevStrong === nextStrong) ? prevStrong : paraDir;
        for (let j = start; j < end; j++) {
            types[j] = resolved;
        }
    }
}

// ── Level Assignment ─────────────────────────────────────────────────

/**
 * Assign embedding levels based on resolved types and paragraph level.
 */
function assignLevels(types: BidiType[], paraLevel: number): number[] {
    const levels: number[] = [];
    for (const t of types) {
        if (paraLevel === 0) {
            // LTR paragraph: R/AL/AN → level 1, EN → level 2 (but we simplify to 1)
            levels.push((t === 'R' || t === 'AN') ? 1 : 0);
        } else {
            // RTL paragraph: L/EN → level 2 (but we simplify to 0 for L)
            levels.push((t === 'L') ? 2 : 1);
        }
    }
    return levels;
}

// ── Glyph Mirroring ──────────────────────────────────────────────────

/** Mirroring pairs for bidirectional text. ~40 common pairs. */
const MIRROR_MAP: Record<number, number> = {
    0x0028: 0x0029, // ( → )
    0x0029: 0x0028, // ) → (
    0x003C: 0x003E, // < → >
    0x003E: 0x003C, // > → <
    0x005B: 0x005D, // [ → ]
    0x005D: 0x005B, // ] → [
    0x007B: 0x007D, // { → }
    0x007D: 0x007B, // } → {
    0x00AB: 0x00BB, // « → »
    0x00BB: 0x00AB, // » → «
    0x2039: 0x203A, // ‹ → ›
    0x203A: 0x2039, // › → ‹
    0x2045: 0x2046, // ⁅ → ⁆
    0x2046: 0x2045, // ⁆ → ⁅
    0x207D: 0x207E, // ⁽ → ⁾
    0x207E: 0x207D, // ⁾ → ⁽
    0x208D: 0x208E, // ₍ → ₎
    0x208E: 0x208D, // ₎ → ₍
    0x2329: 0x232A, // 〈 → 〉
    0x232A: 0x2329, // 〉 → 〈
    0x27E6: 0x27E7, // ⟦ → ⟧
    0x27E7: 0x27E6, // ⟧ → ⟦
    0x27E8: 0x27E9, // ⟨ → ⟩
    0x27E9: 0x27E8, // ⟩ → ⟨
    0x27EA: 0x27EB, // ⟪ → ⟫
    0x27EB: 0x27EA, // ⟫ → ⟪
    0x2983: 0x2984, // ⦃ → ⦄
    0x2984: 0x2983, // ⦄ → ⦃
    0x2985: 0x2986, // ⦅ → ⦆
    0x2986: 0x2985, // ⦆ → ⦅
    0x2987: 0x2988, // ⦇ → ⦈
    0x2988: 0x2987, // ⦈ → ⦇
    0x2989: 0x298A, // ⦉ → ⦊
    0x298A: 0x2989, // ⦊ → ⦉
    0x298B: 0x298C, // ⦋ → ⦌
    0x298C: 0x298B, // ⦌ → ⦋
    0x3008: 0x3009, // 〈 → 〉
    0x3009: 0x3008, // 〉 → 〈
    0x300A: 0x300B, // 《 → 》
    0x300B: 0x300A, // 》 → 《
};

/**
 * Apply glyph mirroring for a code point in RTL context.
 * Returns the mirrored code point, or the original if no mirror exists.
 *
 * @param cp - Unicode code point to mirror
 * @returns Mirrored code point (e.g. '(' → ')') or the original
 */
export function mirrorCodePoint(cp: number): number {
    return MIRROR_MAP[cp] ?? cp;
}

// ── Practical Fixups ─────────────────────────────────────────────────

/** Sentence-terminating punctuation codepoints. */
const SENTENCE_PUNCT = new Set([
    0x002E, // .
    0x002C, // ,
    0x003B, // ;
    0x003A, // :
    0x0021, // !
    0x003F, // ?
]);

/**
 * In RTL paragraphs, keep sentence punctuation (. , ; : ! ?) attached to
 * the preceding LTR word. Standard N2 assigns paragraph direction (R) when
 * neighbors disagree, causing "pdfnative." to split into "pdfnative" + ".".
 * We reassign the punctuation to L so it stays in the same LTR run.
 */
function fixPunctuationAffinity(types: BidiType[], codePoints: readonly number[], len: number): void {
    for (let i = 1; i < len; i++) {
        if (types[i] === 'R' && SENTENCE_PUNCT.has(codePoints[i])) {
            // Check if preceding non-WS character is L
            let prevIdx = i - 1;
            while (prevIdx >= 0 && (types[prevIdx] === 'WS' || types[prevIdx] === 'BN')) prevIdx--;
            if (prevIdx >= 0 && types[prevIdx] === 'L') {
                types[i] = 'L';
            }
        }
    }
}

/**
 * Simplified bracket pairing for parentheses, square brackets, and curly braces.
 * When brackets enclose LTR content in an RTL paragraph, the opener and closer
 * should share the LTR level so they visually surround the content.
 * Handles: ( ), [ ], { }
 */
function fixBracketPairing(types: BidiType[], codePoints: readonly number[], len: number): void {
    const OPEN_BRACKETS: Record<number, number> = {
        0x0028: 0x0029, // ( → )
        0x005B: 0x005D, // [ → ]
        0x007B: 0x007D, // { → }
    };

    for (let i = 0; i < len; i++) {
        const closer = OPEN_BRACKETS[codePoints[i]];
        if (closer === undefined) continue;
        // Found an opening bracket — find the matching closer
        let depth = 1;
        let closeIdx = -1;
        for (let j = i + 1; j < len; j++) {
            if (codePoints[j] === codePoints[i]) depth++;
            else if (codePoints[j] === closer) {
                depth--;
                if (depth === 0) { closeIdx = j; break; }
            }
        }
        if (closeIdx === -1) continue;
        // Check if the content between brackets contains any L
        let hasL = false;
        for (let j = i + 1; j < closeIdx; j++) {
            if (types[j] === 'L') { hasL = true; break; }
        }
        if (hasL) {
            // Assign opener and closer to L so they stay with the LTR content
            types[i] = 'L';
            types[closeIdx] = 'L';
        }
    }
}

// ── Isolate Pair Detection (UAX #9 §3.3.2) ───────────────────────────

type IsolateKind = 'LRI' | 'RLI' | 'FSI';

interface IsolatePair {
    /** Codepoint index of the LRI/RLI/FSI marker. */
    readonly open: number;
    /** Codepoint index of the matching PDI. */
    readonly close: number;
    readonly kind: IsolateKind;
}

/**
 * Find all outermost matched isolate pairs (LRI/RLI/FSI ... PDI) in a
 * codepoint sequence. Nested pairs are intentionally returned only at the
 * outermost level; the recursive call in `resolveBidiRuns` handles deeper
 * nesting by re-running this scan inside the inner substring.
 *
 * Unmatched openers are ignored (treated as plain BN), matching browser
 * behaviour — UAX #9 BD9 says the formatting character is left in place
 * with no directional effect.
 */
function findOutermostIsolatePairs(codePoints: readonly number[]): IsolatePair[] {
    const pairs: IsolatePair[] = [];
    let i = 0;
    while (i < codePoints.length) {
        const cp = codePoints[i];
        if (cp === 0x2066 || cp === 0x2067 || cp === 0x2068) {
            let depth = 1;
            let close = -1;
            for (let j = i + 1; j < codePoints.length; j++) {
                const cj = codePoints[j];
                if (cj === 0x2066 || cj === 0x2067 || cj === 0x2068) depth++;
                else if (cj === 0x2069) {
                    depth--;
                    if (depth === 0) { close = j; break; }
                }
            }
            if (close === -1) { i++; continue; } // unmatched opener — skip
            const kind: IsolateKind = cp === 0x2066 ? 'LRI' : cp === 0x2067 ? 'RLI' : 'FSI';
            pairs.push({ open: i, close, kind });
            i = close + 1;
        } else {
            i++;
        }
    }
    return pairs;
}

// ── Main API ─────────────────────────────────────────────────────────

/**
 * Resolve bidirectional text into ordered runs with embedding levels.
 *
 * Implements UAX #9 with isolate support (LRI/RLI/FSI ... PDI). When the
 * input contains matched isolate pairs, the inner content is resolved as
 * a sealed sub-paragraph with its own forced or auto-detected direction,
 * preventing the outer context from leaking into it (and vice versa).
 *
 * @param text - Input text in logical order
 * @returns Array of BidiRun objects in visual order
 */
export function resolveBidiRuns(text: string): BidiRun[] {
    if (!text) return [];

    // Extract code points + a parallel cp→str byte-offset map so we can
    // slice substrings cheaply when recursing into isolate ranges.
    const codePoints: number[] = [];
    const cpToStr: number[] = [];
    for (let i = 0; i < text.length;) {
        cpToStr.push(i);
        const cp = text.codePointAt(i) ?? 0;
        codePoints.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }
    cpToStr.push(text.length); // sentinel

    const isolates = findOutermostIsolatePairs(codePoints);
    if (isolates.length === 0) {
        return resolveBidiCore(text, codePoints, cpToStr);
    }

    // Compute parent paragraph level from strong types OUTSIDE isolated
    // ranges (UAX #9 P2/P3 in the presence of isolates).
    const insideIsolate = new Array<boolean>(codePoints.length).fill(false);
    for (const p of isolates) {
        for (let k = p.open; k <= p.close; k++) insideIsolate[k] = true;
    }
    const outerTypes: BidiType[] = codePoints.map((cp, idx) =>
        insideIsolate[idx] ? 'BN' : classifyBidiType(cp));
    const parentLevel = detectParagraphLevel(outerTypes);

    const out: BidiRun[] = [];
    const emitSegment = (cpStart: number, cpEnd: number, forced?: number): void => {
        if (cpStart >= cpEnd) return;
        const segText = text.substring(cpToStr[cpStart], cpToStr[cpEnd]);
        const segCps = codePoints.slice(cpStart, cpEnd);
        const baseStrIdx = cpToStr[cpStart];
        const segCpToStr = cpToStr.slice(cpStart, cpEnd + 1).map(x => x - baseStrIdx);
        // Recurse to handle any nested isolates inside this segment.
        const segRuns = forced === undefined
            ? resolveBidiRuns(segText)
            : resolveBidiCore(segText, segCps, segCpToStr, forced);
        for (const r of segRuns) {
            out.push({ text: r.text, level: r.level, start: r.start + baseStrIdx });
        }
    };

    let cursor = 0;
    for (const pair of isolates) {
        emitSegment(cursor, pair.open, parentLevel);
        // Inner content excludes the LRI/RLI/FSI marker and the PDI marker.
        const innerStart = pair.open + 1;
        const innerEnd = pair.close;
        let innerLevel: number;
        if (pair.kind === 'LRI') innerLevel = 0;
        else if (pair.kind === 'RLI') innerLevel = 1;
        else {
            // FSI: auto-detect from first strong character inside the isolate.
            const innerTypes = codePoints.slice(innerStart, innerEnd).map(classifyBidiType);
            innerLevel = detectParagraphLevel(innerTypes);
        }
        // Recurse so nested isolates are also resolved.
        if (innerStart < innerEnd) {
            const innerText = text.substring(cpToStr[innerStart], cpToStr[innerEnd]);
            const innerRuns = resolveBidiRunsForced(innerText, innerLevel);
            const baseStrIdx = cpToStr[innerStart];
            for (const r of innerRuns) {
                out.push({ text: r.text, level: r.level, start: r.start + baseStrIdx });
            }
        }
        cursor = pair.close + 1;
    }
    emitSegment(cursor, codePoints.length, parentLevel);
    return out;
}

/**
 * Internal helper: resolve text with a forced paragraph level, handling
 * any nested isolates first.
 */
function resolveBidiRunsForced(text: string, forcedLevel: number): BidiRun[] {
    if (!text) return [];
    const codePoints: number[] = [];
    const cpToStr: number[] = [];
    for (let i = 0; i < text.length;) {
        cpToStr.push(i);
        const cp = text.codePointAt(i) ?? 0;
        codePoints.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }
    cpToStr.push(text.length);

    const isolates = findOutermostIsolatePairs(codePoints);
    if (isolates.length === 0) {
        return resolveBidiCore(text, codePoints, cpToStr, forcedLevel);
    }

    const out: BidiRun[] = [];
    const emit = (cpStart: number, cpEnd: number, forced: number): void => {
        if (cpStart >= cpEnd) return;
        const segText = text.substring(cpToStr[cpStart], cpToStr[cpEnd]);
        const segCps = codePoints.slice(cpStart, cpEnd);
        const baseStrIdx = cpToStr[cpStart];
        const segCpToStr = cpToStr.slice(cpStart, cpEnd + 1).map(x => x - baseStrIdx);
        const segRuns = resolveBidiCore(segText, segCps, segCpToStr, forced);
        for (const r of segRuns) {
            out.push({ text: r.text, level: r.level, start: r.start + baseStrIdx });
        }
    };

    let cursor = 0;
    for (const pair of isolates) {
        emit(cursor, pair.open, forcedLevel);
        const innerStart = pair.open + 1;
        const innerEnd = pair.close;
        let innerLevel: number;
        if (pair.kind === 'LRI') innerLevel = 0;
        else if (pair.kind === 'RLI') innerLevel = 1;
        else {
            const innerTypes = codePoints.slice(innerStart, innerEnd).map(classifyBidiType);
            innerLevel = detectParagraphLevel(innerTypes);
        }
        if (innerStart < innerEnd) {
            const innerText = text.substring(cpToStr[innerStart], cpToStr[innerEnd]);
            const innerRuns = resolveBidiRunsForced(innerText, innerLevel);
            const baseStrIdx = cpToStr[innerStart];
            for (const r of innerRuns) {
                out.push({ text: r.text, level: r.level, start: r.start + baseStrIdx });
            }
        }
        cursor = pair.close + 1;
    }
    emit(cursor, codePoints.length, forcedLevel);
    return out;
}

/**
 * Core BiDi resolver: full UAX #9 W1-W7 / N1-N2 / L2 pipeline on a single
 * paragraph. Isolate handling is performed in the public dispatchers above.
 *
 * @param text - Source text (already known to contain no outer isolate pairs)
 * @param codePoints - Parallel codepoint array
 * @param cpToStr - Codepoint-index → string-byte-offset map (length = cp+1)
 * @param forcedLevel - Optional override for the paragraph embedding level
 */
function resolveBidiCore(
    text: string,
    codePoints: readonly number[],
    cpToStr: readonly number[],
    forcedLevel?: number,
): BidiRun[] {
    const len = codePoints.length;
    if (len === 0) return [];

    // Step 1: Classify
    const types: BidiType[] = codePoints.map(classifyBidiType);

    // Step 2: Detect paragraph level (P2-P3) unless overridden by an isolate.
    const paraLevel = forcedLevel !== undefined ? forcedLevel : detectParagraphLevel(types);

    // Step 3: Resolve weak types (W1-W7)
    resolveWeakTypes(types, paraLevel);

    // Step 4: Resolve neutral types (N1-N2)
    resolveNeutralTypes(types, paraLevel);

    // Step 4b: Practical fixups for common mixed RTL/LTR patterns.
    // Standard N2 assigns paragraph direction to neutrals between opposing strong
    // types. This causes periods after LTR words to drift into RTL runs and
    // bracket pairs around LTR content to split across runs. We fix these by
    // keeping sentence punctuation with the preceding LTR text and by pairing
    // brackets with their enclosed content.
    if (paraLevel === 1) {
        fixPunctuationAffinity(types, codePoints, len);
        fixBracketPairing(types, codePoints, len);
    }

    // Step 5: Assign levels
    const levels = assignLevels(types, paraLevel);

    // Step 6: Build runs of same level (uses the cpToStr map passed in by the dispatcher).
    const runs: BidiRun[] = [];
    let runStart = 0;
    let runLevel = levels[0];

    for (let i = 1; i <= len; i++) {
        if (i === len || levels[i] !== runLevel) {
            const start = cpToStr[runStart];
            const end = cpToStr[i];
            let runText = text.substring(start, end);
            // Reverse RTL runs for visual order.
            // Note: do NOT apply glyph mirroring (UAX #9 L4) here — our rendering
            // model pre-reverses text for a left-to-right PDF engine. The reversal
            // itself swaps bracket/paren positions correctly: logical "(X)" becomes
            // visual ")X(" → PDF renders L→R as ")X(" → reader reads R→L as "(X)".
            // Applying mirrorCodePoint would double-swap and produce wrong output.
            if (runLevel % 2 === 1) {
                runText = reverseString(runText);
            }
            runs.push({ text: runText, level: runLevel, start });
            if (i < len) {
                runStart = i;
                runLevel = levels[i];
            }
        }
    }

    // L2 reordering: for RTL paragraphs, reverse run order so that
    // the first logical run (rightmost visually) appears last in the
    // array — txt() renders runs left-to-right, so English text must
    // come first and Hebrew/Arabic text last.
    if (paraLevel === 1 && runs.length > 1) {
        runs.reverse();
    }

    return runs;
}

/**
 * Check if text contains any RTL characters (Arabic or Hebrew).
 *
 * @param text - Input text string
 * @returns True if text contains R or AL bidi types
 */
export function containsRTL(text: string): boolean {
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        const t = classifyBidiType(cp);
        if (t === 'R' || t === 'AL') return true;
        i += cp > 0xFFFF ? 2 : 1;
    }
    return false;
}

// ── Internal Helpers ─────────────────────────────────────────────────

/**
 * Reverse a string while keeping surrogate pairs intact.
 *
 * @param str - Input string to reverse
 * @returns Reversed string with valid surrogate pair ordering
 */
export function reverseString(str: string): string {
    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }
    cps.reverse();
    return String.fromCodePoint(...cps);
}
