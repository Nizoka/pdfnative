/**
 * pdfnative — Tibetan Mini-Shaper
 * ================================
 * Pure JS OpenType GSUB + GPOS shaping for the Tibetan script.
 * Zero external dependency.
 *
 * Tibetan builds vertical stacks: a head consonant with zero or more
 * *subjoined* consonants (U+0F90–U+0FBC) stacked beneath it, plus vowel
 * signs above / below and spacing marks to the right.
 *
 * Handles:
 *   - Stack building (head consonant + subjoined consonants + vowels + marks)
 *   - GSUB LigatureSubst: pre-baked stacked-consonant ligatures when the font
 *     provides them (head + subjoined → single stack glyph)
 *   - GPOS MarkToBase: subjoined consonants and above/below vowel signs are
 *     anchored on the base when no ligature exists
 *
 * Known limitations (documented):
 *   - Deep stacks beyond the font's ligature coverage fall back to GPOS
 *     below-base anchoring of each subjoined consonant, which approximates but
 *     may not perfectly match a native stacking engine.
 *   - GSUB contextual substitution (LookupType 5/6) is not consumed.
 *
 * References:
 *   - Unicode Standard §13.4 Tibetan
 *   - OpenType spec: Script-specific shaping for Tibetan (tibt)
 *   - ISO 15924 script code: Tibt
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { TIBETAN_START, TIBETAN_END, containsTibetan } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';

// Re-export range constants
export { TIBETAN_START, TIBETAN_END, containsTibetan };

/**
 * Tibetan character type classification.
 *   0 = head consonant (U+0F40–U+0F6C)
 *   1 = independent vowel / letter (U+0F00 OM, U+0F88–U+0F8C)
 *   2 = vowel sign / mark — above (GPOS)
 *   3 = vowel sign — below (GPOS)
 *   5 = sign — post-base spacing (right)
 *   6 = halanta (U+0F84)
 *   8 = subjoined consonant (U+0F90–U+0FBC) — stacks below base
 *   9 = digit / punctuation / symbol
 */
function tibetanCharType(cp: number): number {
    // Subjoined consonants
    if (cp >= 0x0F90 && cp <= 0x0FBC) return 8;
    // Halanta
    if (cp === 0x0F84) return 6;
    // Head consonants
    if (cp >= 0x0F40 && cp <= 0x0F6C) return 0;
    // Vowel signs: above
    if (cp === 0x0F72 || cp === 0x0F7A || cp === 0x0F7B || cp === 0x0F7C ||
        cp === 0x0F7D || cp === 0x0F80 || cp === 0x0F81 || cp === 0x0F83 ||
        cp === 0x0F82 || cp === 0x0F7E) return 2;
    // Vowel signs: below
    if (cp === 0x0F71 || cp === 0x0F74 || cp === 0x0F73 || cp === 0x0F75 ||
        cp === 0x0F18 || cp === 0x0F19 || cp === 0x0F35 || cp === 0x0F37 ||
        cp === 0x0F39) return 3;
    // Visarga / spacing
    if (cp === 0x0F7F) return 5;
    // OM and other independent letters
    if (cp === 0x0F00 || (cp >= 0x0F88 && cp <= 0x0F8C)) return 1;
    // Digits
    if (cp >= 0x0F20 && cp <= 0x0F33) return 9;
    // Punctuation / head marks / other symbols
    if (cp >= 0x0F01 && cp <= 0x0F17) return 9;
    if (cp >= 0x0F3A && cp <= 0x0F3F) return 9;
    if (cp >= 0x0FBE && cp <= 0x0FCF) return 9;
    if (cp === 0x0F34 || cp === 0x0F36 || cp === 0x0F38) return 9;
    if (cp === 0x0F85) return 9;
    return -1;
}

interface TibetanStack {
    codepoints: number[];
}

/**
 * Build Tibetan stacks. A stack: HeadConsonant Subjoined* Vowel* Mark*
 * (or an independent letter / digit / punctuation emitted on its own).
 */
export function buildTibetanStacks(str: string): TibetanStack[] {
    const stacks: TibetanStack[] = [];
    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = tibetanCharType(cp);

        if (type < 0 || cp < TIBETAN_START || cp > TIBETAN_END) {
            stacks.push({ codepoints: [cp] });
            i++;
            continue;
        }

        // Start a stack only on a head consonant or independent letter.
        if (type !== 0 && type !== 1) {
            stacks.push({ codepoints: [cp] });
            i++;
            continue;
        }

        const stack: number[] = [cp];
        i++;
        // Consume subjoined consonants.
        while (i < cps.length && tibetanCharType(cps[i]) === 8) {
            stack.push(cps[i]);
            i++;
        }
        // Consume halanta, vowels and marks.
        while (i < cps.length) {
            const ct = tibetanCharType(cps[i]);
            if (ct === 2 || ct === 3 || ct === 5 || ct === 6) {
                stack.push(cps[i]);
                i++;
            } else {
                break;
            }
        }
        stacks.push({ codepoints: stack });
    }
    return stacks;
}

/**
 * Shape a string of Tibetan text into an array of positioned glyphs.
 *
 * @param str - Raw Tibetan string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeTibetanText(str: string, fontData: FontData): ShapedGlyph[] {
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

    const stacks = buildTibetanStacks(str);

    for (const stack of stacks) {
        const { codepoints } = stack;

        // Gather the consonant stack GIDs (head + subjoined) for ligature lookup.
        const stackGids: number[] = [];
        const stackEndIdx: number[] = [];
        let markStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = tibetanCharType(codepoints[ci]);
            if (ct === 0 || ct === 8 || ct === 1 || ct === 6) {
                stackGids.push(resolveGid(codepoints[ci]));
                stackEndIdx.push(ci);
            } else if (ct === 2 || ct === 3 || ct === 5) {
                markStart = ci;
                break;
            } else if (ct < 0 || ct === 9) {
                emitGlyph(resolveGid(codepoints[ci]), false);
            }
        }

        let baseGid = stackGids.length > 0 ? stackGids[0] : 0;

        const ligResult = tryLig(stackGids);
        if (ligResult) {
            emitGlyph(ligResult.resultGid, false);
            baseGid = ligResult.resultGid;
            let gi = ligResult.consumed;
            while (gi < stackGids.length) {
                const subSeq = stackGids.slice(gi);
                const subLig = tryLig(subSeq);
                if (subLig) {
                    emitGlyph(subLig.resultGid, false);
                    gi += subLig.consumed;
                } else {
                    const origCi = stackEndIdx[gi];
                    const ct = tibetanCharType(codepoints[origCi]);
                    // Subjoined consonants and halanta stack below — GPOS anchor.
                    if (ct === 8 || ct === 6) emitGlyph(stackGids[gi], true, baseGid);
                    else emitGlyph(stackGids[gi], false);
                    gi++;
                }
            }
        } else {
            for (let gi = 0; gi < stackGids.length; gi++) {
                const origCi = stackEndIdx[gi];
                const ct = tibetanCharType(codepoints[origCi]);
                if (gi === 0) emitGlyph(stackGids[gi], false);
                else if (ct === 8 || ct === 6) emitGlyph(stackGids[gi], true, baseGid);
                else emitGlyph(stackGids[gi], false);
            }
        }

        // Emit vowels and marks.
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = tibetanCharType(cp);
            if (ct === 2 || ct === 3) emitGlyph(resolveGid(cp), true, baseGid);
            else if (ct === 5) emitGlyph(resolveGid(cp), false);
            else emitGlyph(resolveGid(cp), false);
        }
    }

    return shaped;
}
