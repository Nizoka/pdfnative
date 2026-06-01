/**
 * pdfnative — Khmer Mini-Shaper
 * ==============================
 * Pure JS OpenType GSUB + GPOS shaping for the Khmer script (Cambodia).
 * Zero external dependency.
 *
 * Khmer is a USE-class (Universal Shaping Engine) script. This is a pragmatic
 * USE-lite implementation that covers the common cases:
 *   - Coeng (U+17D2) + consonant → subscript consonant (stacked below / behind)
 *   - Pre-base (left-side) vowel reordering — U+17C1 (e), U+17C2 (ae),
 *     U+17C3 (ai) render to the LEFT of their base, so they are emitted first.
 *   - Two-part vowels (U+17BE, U+17BF, U+17C0, U+17C4, U+17C5) are decomposed
 *     into their pre-base + post-base halves.
 *   - GSUB LigatureSubst: coeng-form subscript ligatures when the font provides
 *     them; GPOS MarkToBase for above / below vowel signs and diacritics.
 *
 * Known limitations (documented):
 *   - This is not a full USE implementation. Robat (U+17CC), complex
 *     multi-coeng stacks beyond the font's ligature coverage, and contextual
 *     GSUB (LookupType 5/6) are approximated, not fully reordered.
 *
 * References:
 *   - Unicode Standard §16.4 Khmer
 *   - OpenType spec: Universal Shaping Engine; Khmer (khmr)
 *   - ISO 15924 script code: Khmr
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { KHMER_START, KHMER_END, KHMER_COENG, containsKhmer } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';

// Re-export range constants
export { KHMER_START, KHMER_END, containsKhmer };

/** Coeng — subscript register shifter (U+17D2). */
const COENG = KHMER_COENG; // 0x17D2

/**
 * Decomposition of Khmer two-part dependent vowels into
 * [pre-base (left) part, ...post-base parts].
 */
const TWO_PART_VOWELS: Record<number, number[]> = {
    0x17BE: [0x17C1, 0x17B6], // ើ
    0x17BF: [0x17C1, 0x17B8], // ឿ  (approx: e + y-like)
    0x17C0: [0x17C1, 0x17B9], // ៀ  (approx)
    0x17C4: [0x17C1, 0x17B6], // ោ  (e + aa)
    0x17C5: [0x17C1, 0x17B6], // ៅ  (e + aa-like)
};

/**
 * Khmer character type classification.
 *   0 = consonant (U+1780–U+17A2)
 *   1 = independent vowel / letter (U+17A3–U+17B5)
 *   2 = dependent vowel sign — above (GPOS)
 *   3 = dependent vowel sign — below (GPOS)
 *   4 = dependent vowel sign — pre-base / left
 *   5 = dependent vowel sign — post-base spacing (right)
 *   6 = sign / diacritic (above)
 *   7 = coeng (U+17D2)
 *   9 = digit / symbol / punctuation
 */
function khmerCharType(cp: number): number {
    if (cp === COENG) return 7;
    if (cp >= 0x1780 && cp <= 0x17A2) return 0;
    if (cp >= 0x17A3 && cp <= 0x17B5) return 1;
    // Pre-base vowels (left)
    if (cp === 0x17C1 || cp === 0x17C2 || cp === 0x17C3) return 4;
    // Above vowels
    if (cp === 0x17B7 || cp === 0x17B8 || cp === 0x17B9 || cp === 0x17BA ||
        cp === 0x17BB || cp === 0x17BD) return 2;
    // Below vowels
    if (cp === 0x17BC) return 3;
    // Post-base spacing vowels
    if (cp === 0x17B6 || cp === 0x17C4 || cp === 0x17C5) return 5;
    // Signs / diacritics (above): nikahit, reahmuk, etc.
    if (cp >= 0x17C6 && cp <= 0x17D1) return 6;
    if (cp === 0x17CB || cp === 0x17CD || cp === 0x17CE || cp === 0x17CF ||
        cp === 0x17D0) return 6;
    if (cp === 0x17DD) return 6;
    // Khmer digits + symbols
    if (cp >= 0x17E0 && cp <= 0x17E9) return 9;
    if (cp >= 0x17D4 && cp <= 0x17DC) return 9;
    if (cp >= 0x17F0 && cp <= 0x17F9) return 9;
    return -1;
}

function isConsonant(cp: number): boolean {
    return khmerCharType(cp) === 0;
}

interface KhmerCluster {
    codepoints: number[];
}

/**
 * Build Khmer orthographic clusters, decomposing two-part vowels.
 * A cluster: BaseConsonant (Coeng Consonant)* [vowels] [signs]
 */
export function buildKhmerClusters(str: string): KhmerCluster[] {
    const clusters: KhmerCluster[] = [];
    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const decomp = TWO_PART_VOWELS[cp];
        if (decomp) { for (const d of decomp) cps.push(d); }
        else cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = khmerCharType(cp);

        if (type < 0 || cp < KHMER_START || cp > KHMER_END) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        if (type !== 0 && type !== 1) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        const cluster: number[] = [cp];
        i++;
        // Consume coeng + consonant pairs.
        while (i < cps.length && cps[i] === COENG) {
            if (i + 1 < cps.length && isConsonant(cps[i + 1])) {
                cluster.push(cps[i]);     // coeng
                cluster.push(cps[i + 1]); // subscript consonant
                i += 2;
            } else {
                cluster.push(cps[i]);
                i++;
                break;
            }
        }
        // Consume vowels and signs.
        while (i < cps.length) {
            const ct = khmerCharType(cps[i]);
            if (ct >= 2 && ct <= 6) { cluster.push(cps[i]); i++; }
            else break;
        }
        clusters.push({ codepoints: cluster });
    }
    return clusters;
}

/**
 * Shape a string of Khmer text into an array of positioned glyphs.
 *
 * @param str - Raw Khmer string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeKhmerText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, ligatures, markAnchors, widths, defaultWidth } = fontData;
    const shaped: ShapedGlyph[] = [];

    function resolveGid(cp: number): number {
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        return cmap[normCp] || 0;
    }

    function tryLig(gids: number[]) {
        return tryLigature(gids, ligatures);
    }

    function getAdv(gid: number): number {
        return widths[gid] !== undefined ? widths[gid] : defaultWidth;
    }

    function getBaseAnchor(baseGid: number, markClass: number): [number, number] | null {
        const base = markAnchors && markAnchors.bases && markAnchors.bases[baseGid];
        if (!base) return null;
        return base[markClass] ?? null;
    }

    function getMarkAnchor(markGid: number): { classIdx: number; x: number; y: number } | null {
        const mark = markAnchors && markAnchors.marks && markAnchors.marks[markGid];
        if (!mark) return null;
        return { classIdx: mark[0], x: mark[1], y: mark[2] };
    }

    function emitGlyph(gid: number, isZero: boolean, baseGid?: number): void {
        if (isZero && baseGid !== undefined) {
            const markAnchor = getMarkAnchor(gid);
            if (markAnchor) {
                const baseAnchorPt = getBaseAnchor(baseGid, markAnchor.classIdx);
                if (baseAnchorPt) {
                    const baseAdv = getAdv(baseGid);
                    shaped.push({
                        gid, dx: baseAnchorPt[0] - markAnchor.x - baseAdv,
                        dy: baseAnchorPt[1] - markAnchor.y, isZeroAdvance: true,
                    });
                    return;
                }
            }
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: true });
        } else {
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: false });
        }
    }

    const clusters = buildKhmerClusters(str);

    for (const cluster of clusters) {
        const { codepoints } = cluster;

        // Resolve base GID (first consonant / independent letter).
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = khmerCharType(codepoints[ci]);
            if (ct === 0 || ct === 1) { baseGid = resolveGid(codepoints[ci]); break; }
        }

        // Emit pre-base (left) vowels first.
        for (let ci = 0; ci < codepoints.length; ci++) {
            if (khmerCharType(codepoints[ci]) === 4) emitGlyph(resolveGid(codepoints[ci]), false);
        }

        // Build base + coeng-consonant GID run for ligature lookup.
        const stackGids: number[] = [];
        const stackEndIdx: number[] = [];
        let markStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = khmerCharType(cp);
            if (ct === 0 || ct === 1 || ct === 7) {
                stackGids.push(resolveGid(cp));
                stackEndIdx.push(ci);
            } else if (ct >= 2 && ct <= 6) {
                markStart = ci;
                break;
            } else {
                emitGlyph(resolveGid(cp), false);
            }
        }

        const ligResult = tryLig(stackGids);
        if (ligResult) {
            emitGlyph(ligResult.resultGid, false);
            baseGid = ligResult.resultGid;
            let gi = ligResult.consumed;
            while (gi < stackGids.length) {
                const subLig = tryLig(stackGids.slice(gi));
                if (subLig) { emitGlyph(subLig.resultGid, false); gi += subLig.consumed; }
                else {
                    const origCi = stackEndIdx[gi];
                    const ct = khmerCharType(codepoints[origCi]);
                    if (ct === 7) emitGlyph(stackGids[gi], true, baseGid); // orphan coeng → below
                    else emitGlyph(stackGids[gi], false);
                    gi++;
                }
            }
        } else {
            for (let gi = 0; gi < stackGids.length; gi++) {
                const origCi = stackEndIdx[gi];
                const ct = khmerCharType(codepoints[origCi]);
                if (gi === 0) emitGlyph(stackGids[gi], false);
                else if (ct === 7) emitGlyph(stackGids[gi], true, baseGid);
                else emitGlyph(stackGids[gi], true, baseGid); // subscript consonant below
            }
        }

        // Emit remaining vowels and signs (pre-base already done).
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = khmerCharType(cp);
            if (ct === 2 || ct === 3 || ct === 6) emitGlyph(resolveGid(cp), true, baseGid);
            else if (ct === 5) emitGlyph(resolveGid(cp), false);
            else if (ct === 4) { /* already emitted pre-base */ }
            else emitGlyph(resolveGid(cp), false);
        }
    }

    return shaped;
}
