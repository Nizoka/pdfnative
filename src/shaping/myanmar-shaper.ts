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
 * Kinzi (v1.8.0). A kinzi is read before the syllable it decorates and drawn
 * above it, so it is held apart from the cluster it precedes and emitted as
 * a mark once that cluster's base is on the page. Treating its three code
 * points as ordinary text made the nga and the virama take horizontal space
 * of their own, which is space Burmese does not give them.
 *
 * Stacks (v1.8.0). The font keys its subjoined forms on the virama —
 * `virama + ka` is one glyph, and there is no `ka + virama + ka` — so the
 * ligature lookup has to be tried at every position in the stack, not only
 * at its head.
 *
 * Stacked marks (v1.8.0). A second mark on one base is placed against the
 * first through the font's MarkToMark anchors, rather than both being
 * anchored to the base and drawn in the same place.
 *
 * Known limitations (documented):
 *   - This is not a full USE implementation. Contextual GSUB (LookupType
 *     5/6) is not consumed, so contextual variants are approximated.
 *
 * References:
 *   - Unicode Standard §16.3 Myanmar
 *   - OpenType spec: Universal Shaping Engine; Myanmar (mymr)
 *   - ISO 15924 script code: Mymr
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { MYANMAR_START, MYANMAR_END, MYANMAR_VIRAMA, containsMyanmar } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';
import { positionMarkOnBase, positionMarkOnMark } from './gpos-positioner.js';

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

/**
 * Letters that can carry the kinzi: nga, ra, and Mon nga. Each forms the
 * kinzi with a following asat and virama, and the result is drawn above the
 * consonant that comes *after* it, not beside the letter itself.
 */
const KINZI_LETTERS = /*#__PURE__*/ new Set([0x1004, 0x101B, 0x105A]);

/** Whether `cps` starts a kinzi prefix at `i` with a base to attach to. */
function isKinziAt(cps: readonly number[], i: number): boolean {
    return KINZI_LETTERS.has(cps[i])
        && cps[i + 1] === 0x103A
        && cps[i + 2] === VIRAMA
        && i + 3 < cps.length
        && isConsonant(cps[i + 3]);
}

interface MyanmarCluster {
    codepoints: number[];
    /**
     * The three code points of a kinzi preceding this cluster, or null. They
     * belong to the syllable that follows them, which is why they are held
     * apart from `codepoints` rather than sitting at its head.
     */
    kinzi: number[] | null;
}

/**
 * Build Myanmar syllable clusters.
 * A cluster: [Kinzi] Consonant (Virama Consonant)* Medial* [vowels] [signs]
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
        // A kinzi is read before the syllable it decorates, and belongs to it.
        let kinzi: number[] | null = null;
        if (isKinziAt(cps, i)) {
            kinzi = [cps[i], cps[i + 1], cps[i + 2]];
            i += 3;
        }

        const cp = cps[i];
        const type = myanmarCharType(cp);

        if (type < 0 || cp < MYANMAR_START || cp > MYANMAR_END) {
            clusters.push({ codepoints: [cp], kinzi });
            i++;
            continue;
        }

        if (type !== 0) {
            clusters.push({ codepoints: [cp], kinzi });
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
        clusters.push({ codepoints: cluster, kinzi });
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

    /**
     * Place a mark, stacking it on the previous mark of the same cluster when
     * the font carries a mark-to-mark anchor for the pair. Without that, two
     * marks on one base are both anchored to the base and land on top of each
     * other. Returns the placed mark so the next one can stack on it.
     */
    function emitMark(
        gid: number,
        baseGid: number,
        prev: { gid: number; dx: number; dy: number } | null,
    ): { gid: number; dx: number; dy: number } {
        const stacked = prev ? positionMarkOnMark(fontData.mark2mark, prev.gid, gid) : null;
        if (stacked && prev) {
            const placed = { gid, dx: prev.dx + stacked.dx, dy: prev.dy + stacked.dy };
            shaped.push({ gid, dx: placed.dx, dy: placed.dy, isZeroAdvance: true });
            return placed;
        }
        const onBase = positionMarkOnBase(markAnchors, gid, baseGid, getAdv(baseGid));
        const dx = onBase ? onBase.dx : 0;
        const dy = onBase ? onBase.dy : 0;
        shaped.push({ gid, dx, dy, isZeroAdvance: true });
        return { gid, dx, dy };
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

        // Compose the stack, trying a ligature at EVERY position rather than
        // only at the start. The font keys its stacked forms on the virama —
        // `virama + ka` is one glyph, and there is no `ka + virama + ka` — so
        // a lookup anchored at index 0 finds nothing and the cluster falls
        // apart into a virama drawn on the line followed by a full-size
        // consonant. Kinzi and every subjoined stack were affected.
        let gi = 0;
        let first = true;
        while (gi < stackGids.length) {
            const lig = tryLig(stackGids.slice(gi));
            const gid = lig ? lig.resultGid : stackGids[gi];
            if (first) {
                emitGlyph(gid, false);
                if (lig) baseGid = gid;
                first = false;
            } else {
                // A composed form is a subjoined glyph; a leftover one keeps
                // the class-based decision this shaper has always made.
                const origCi = stackEndIdx[gi];
                const ct = myanmarCharType(codepoints[origCi]);
                emitGlyph(gid, lig !== null || ct === 7 || ct === 8, baseGid);
            }
            gi += lig ? lig.consumed : 1;
        }

        // The kinzi is drawn above this cluster's base, so it is emitted once
        // the base is on the page. The font composes its three code points
        // into a single zero-width mark; when it does not, they fall through
        // as the individual glyphs rather than vanishing.
        let prevMark: { gid: number; dx: number; dy: number } | null = null;
        if (cluster.kinzi) {
            const kGids = cluster.kinzi.map(resolveGid);
            const kLig = tryLig(kGids);
            if (kLig && kLig.consumed === kGids.length) {
                prevMark = emitMark(kLig.resultGid, baseGid, null);
            } else {
                for (const kg of kGids) prevMark = emitMark(kg, baseGid, prevMark);
            }
        }
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = myanmarCharType(cp);
            if (ct === 2 || ct === 3 || ct === 6) {
                prevMark = emitMark(resolveGid(cp), baseGid, prevMark);
            } else if (ct === 5) { emitGlyph(resolveGid(cp), false); prevMark = null; }
            else if (ct === 4) { /* already emitted pre-base */ }
            else { emitGlyph(resolveGid(cp), false); prevMark = null; }
        }
    }

    return shaped;
}
