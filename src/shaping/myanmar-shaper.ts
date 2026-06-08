/**
 * pdfnative — Myanmar Mini-Shaper
 * ================================
 * Pure JS OpenType GSUB + GPOS shaping for the Myanmar (Burmese) script.
 * Zero external dependency.
 *
 * Myanmar is a USE-class (Universal Shaping Engine) script. This is a pragmatic
 * USE-lite implementation covering the common cases:
 *   - Medial consonants: medial ya (U+103B), ra (U+103C), wa (U+103D),
 *     ha (U+103E). Medial **ra** renders to the LEFT of its base (pre-base)
 *     and is therefore emitted first.
 *   - Virama / stacker (U+1039): C + U+1039 + C → stacked subscript consonant.
 *   - Asat (U+103A, visible killer) is preserved.
 *   - GSUB LigatureSubst for medial / stacked forms when the font provides
 *     them; GPOS MarkToBase for above / below vowel signs and tone marks.
 *
 * Known limitations (documented):
 *   - This is not a full USE implementation. Kinzi (U+1004 U+103A U+1039),
 *     deep stacks beyond the font's ligature coverage, and contextual GSUB
 *     (LookupType 5/6) are approximated, not fully reordered. Kinzi is rendered
 *     via its stacking sequence rather than a dedicated reordering pass.
 *
 * References:
 *   - Unicode Standard §16.3 Myanmar
 *   - OpenType spec: Universal Shaping Engine; Myanmar (mymr)
 *   - ISO 15924 script code: Mymr
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { MYANMAR_START, MYANMAR_END, MYANMAR_VIRAMA, containsMyanmar } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';

// Re-export range constants
export { MYANMAR_START, MYANMAR_END, containsMyanmar };

/** Virama / stacker (U+1039) — invisible, stacks the following consonant. */
const VIRAMA = MYANMAR_VIRAMA; // 0x1039
/** Medial ra (U+103C) — renders to the LEFT of the base (pre-base). */
const MEDIAL_RA = 0x103C;

/**
 * Myanmar character type classification.
 *   0 = consonant (U+1000–U+102A, U+103F, extended)
 *   2 = vowel sign / tone — above (GPOS)
 *   3 = vowel sign — below (GPOS)
 *   4 = medial ra (pre-base / left)
 *   5 = vowel sign — post-base spacing (right)
 *   6 = sign / asat / anusvara (above)
 *   7 = virama / stacker (U+1039)
 *   8 = medial (ya / wa / ha) — below / around base
 *   9 = digit / symbol / punctuation
 */
function myanmarCharType(cp: number): number {
    if (cp === VIRAMA) return 7;
    if (cp === MEDIAL_RA) return 4;
    // Medials ya / wa / ha
    if (cp === 0x103B || cp === 0x103D || cp === 0x103E) return 8;
    // Consonants
    if (cp >= 0x1000 && cp <= 0x102A) return 0;
    if (cp === 0x103F) return 0; // great sa
    if (cp >= 0x1050 && cp <= 0x1055) return 0; // extended consonants
    // Above vowels: i, ii, e + tone marks
    if (cp === 0x102D || cp === 0x102E || cp === 0x1032 || cp === 0x1036 ||
        cp === 0x1033 || cp === 0x1034 || cp === 0x1035) return 2;
    // Below vowels: u, uu
    if (cp === 0x102F || cp === 0x1030 || cp === 0x1037) return 3;
    // Post-base spacing vowels: aa, tall aa, e (1031 is pre-base actually)
    if (cp === 0x102B || cp === 0x102C) return 5;
    if (cp === 0x1031) return 4; // e vowel — pre-base (left)
    // Asat (visible virama) + anusvara + visarga + dot below
    if (cp === 0x103A) return 6;
    if (cp === 0x1038) return 5; // visarga (right spacing)
    // Myanmar digits + Shan digits
    if (cp >= 0x1040 && cp <= 0x1049) return 9;
    if (cp >= 0x1090 && cp <= 0x1099) return 9;
    // Punctuation
    if (cp === 0x104A || cp === 0x104B) return 9;
    if (cp >= 0x104C && cp <= 0x104F) return 9;
    return -1;
}

function isConsonant(cp: number): boolean {
    return myanmarCharType(cp) === 0;
}

interface MyanmarCluster {
    codepoints: number[];
}

/**
 * Build Myanmar syllable clusters.
 * A cluster: Consonant (Virama Consonant)* Medial* [vowels] [signs]
 */
export function buildMyanmarClusters(str: string): MyanmarCluster[] {
    const clusters: MyanmarCluster[] = [];
    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = myanmarCharType(cp);

        if (type < 0 || cp < MYANMAR_START || cp > MYANMAR_END) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        if (type !== 0) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        const cluster: number[] = [cp];
        i++;
        // Consume virama + consonant (stacked) pairs.
        while (i < cps.length && cps[i] === VIRAMA) {
            if (i + 1 < cps.length && isConsonant(cps[i + 1])) {
                cluster.push(cps[i]);     // virama
                cluster.push(cps[i + 1]); // stacked consonant
                i += 2;
            } else {
                cluster.push(cps[i]);
                i++;
                break;
            }
        }
        // Consume asat directly after base/stack.
        // Consume medials.
        while (i < cps.length && myanmarCharType(cps[i]) === 8) {
            cluster.push(cps[i]);
            i++;
        }
        // Consume pre-base medial ra / e-vowel, vowels and signs.
        while (i < cps.length) {
            const ct = myanmarCharType(cps[i]);
            if ((ct >= 2 && ct <= 6)) { cluster.push(cps[i]); i++; }
            else break;
        }
        clusters.push({ codepoints: cluster });
    }
    return clusters;
}

/**
 * Shape a string of Myanmar text into an array of positioned glyphs.
 *
 * @param str - Raw Myanmar string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeMyanmarText(str: string, fontData: FontData): ShapedGlyph[] {
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

    const clusters = buildMyanmarClusters(str);

    for (const cluster of clusters) {
        const { codepoints } = cluster;

        // Resolve base GID (first consonant).
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            if (myanmarCharType(codepoints[ci]) === 0) { baseGid = resolveGid(codepoints[ci]); break; }
        }

        // Emit pre-base (left) glyphs first: medial ra and the e-vowel (U+1031).
        for (let ci = 0; ci < codepoints.length; ci++) {
            if (myanmarCharType(codepoints[ci]) === 4) emitGlyph(resolveGid(codepoints[ci]), false);
        }

        // Build base + virama-consonant + medials run for ligature lookup.
        const stackGids: number[] = [];
        const stackEndIdx: number[] = [];
        let markStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = myanmarCharType(cp);
            if (ct === 0 || ct === 7 || ct === 8) {
                stackGids.push(resolveGid(cp));
                stackEndIdx.push(ci);
            } else if (ct === 2 || ct === 3 || ct === 5 || ct === 6) {
                markStart = ci;
                break;
            } else if (ct === 4) {
                // pre-base, already emitted
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
                    const ct = myanmarCharType(codepoints[origCi]);
                    if (ct === 7 || ct === 8) emitGlyph(stackGids[gi], true, baseGid);
                    else emitGlyph(stackGids[gi], false);
                    gi++;
                }
            }
        } else {
            for (let gi = 0; gi < stackGids.length; gi++) {
                const origCi = stackEndIdx[gi];
                const ct = myanmarCharType(codepoints[origCi]);
                if (gi === 0) emitGlyph(stackGids[gi], false);
                else if (ct === 7 || ct === 8) emitGlyph(stackGids[gi], true, baseGid);
                else emitGlyph(stackGids[gi], false);
            }
        }

        // Emit remaining vowels and signs (pre-base already done).
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = myanmarCharType(cp);
            if (ct === 2 || ct === 3 || ct === 6) emitGlyph(resolveGid(cp), true, baseGid);
            else if (ct === 5) emitGlyph(resolveGid(cp), false);
            else if (ct === 4) { /* already emitted pre-base */ }
            else emitGlyph(resolveGid(cp), false);
        }
    }

    return shaped;
}
