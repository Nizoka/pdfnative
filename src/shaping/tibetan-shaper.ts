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
 * Since 1.9.0 (#81) the font's own OpenType layout drives the shaping, through
 * the engine shared with the Indic scripts: the `tibt` (else `DFLT`) GSUB
 * features `ccmp`, `abvs`, `blws` and `calt` select head and subjoined forms
 * and compose the stacks (contextual lookups included), then `attachMarks()`
 * positions every mark through the font's mark-to-base and mark-to-mark
 * anchors, trying every anchor class a mark carries. Each glyph names the
 * code points it stands for (`ShapedGlyph.cps`), so the ToUnicode CMap
 * covers stacks and contextual forms in untagged output too.
 *
 * Font data without `otl` (hand-made font data, modules built before 1.9.0)
 * takes the pre-1.9.0 path: pre-baked `ligatures`, then GPOS mark-to-base
 * anchoring of whatever the font left unstacked.
 *
 * References:
 *   - Unicode Standard §13.4 Tibetan
 *   - Microsoft Typography, "Developing OpenType Fonts for Tibetan Script"
 *     (GSUB ccmp, abvs, blws, calt; GPOS mark, mkmk, abvm, blwm)
 *   - ISO 15924 script code: Tibt
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { TIBETAN_START, TIBETAN_END, containsTibetan } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';
import { attachMarks, findMarkToBase, type AttachItem } from './gpos-positioner.js';
import { applyGsubFeatures } from './indic-engine.js';

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

/** The script tags the engine tries, in order, for a Tibetan font. */
const TIBETAN_SCRIPT_TAGS: readonly string[] = ['tibt', 'DFLT'];

/** The GSUB features of the Tibetan shaping specification, in application order. */
const TIBETAN_FEATURES: readonly string[] = ['ccmp', 'abvs', 'blws', 'calt'];

/**
 * Shape a string of Tibetan text into an array of positioned glyphs.
 *
 * With a font module carrying `otl` tables for `tibt` (the bundled Noto
 * Serif Tibetan since 1.9.0) the font's own layout drives the shaping: its
 * `ccmp`, `abvs`, `blws` and `calt` lookups select head and subjoined forms
 * and compose the stacks, then every mark attaches through the font's
 * mark-to-base and mark-to-mark anchors (#81). Font data without `otl`
 * takes the pre-1.9.0 path (pre-baked ligatures, then mark-to-base).
 * Every glyph names its source code points.
 *
 * @param str - Raw Tibetan string
 * @param fontData - Font data with cmap, `otl` or `ligatures`, markAnchors, widths
 * @returns Array of positioned glyphs
 */
export function shapeTibetanText(str: string, fontData: FontData): ShapedGlyph[] {
    if (str.length === 0) return [];
    const { cmap } = fontData;
    const gidOf = (cp: number): number => cmap[(cp === 0x202F || cp === 0xA0) ? 0x20 : cp] || 0;

    const otl = fontData.otl;
    if (otl && TIBETAN_SCRIPT_TAGS.some(t => otl.gsub.scripts[t] !== undefined)) {
        return shapeWithLayout(str, fontData, gidOf);
    }
    return shapeWithLigatures(str, fontData, gidOf);
}

/** GDEF says which glyphs are marks; without a GDEF, an anchored or combining glyph is one. */
function markPredicate(fontData: FontData): (gid: number, cp: number) => boolean {
    const gdef = fontData.otl?.gdef;
    if (gdef) {
        return (gid) => {
            for (const [a, b] of gdef.marks) if (gid >= a && gid <= b) return true;
            return false;
        };
    }
    const anchored = fontData.markAnchors?.marks;
    return (gid, cp) => {
        const ct = tibetanCharType(cp);
        return (anchored !== undefined && anchored[gid] !== undefined) || ct === 2 || ct === 3 || ct === 8 || ct === 6;
    };
}

/** The 1.9.0 path: the font's own layout tables, then GPOS attachment. */
function shapeWithLayout(str: string, fontData: FontData, gidOf: (cp: number) => number): ShapedGlyph[] {
    const glyphs: { gid: number; cps: number[] }[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        i += cp > 0xFFFF ? 2 : 1;
        glyphs.push({ gid: gidOf(cp), cps: [cp] });
    }
    const composed = applyGsubFeatures(glyphs, fontData, TIBETAN_SCRIPT_TAGS, TIBETAN_FEATURES);
    const isMark = markPredicate(fontData);
    const items: AttachItem[] = composed.map(g => ({
        gid: g.gid,
        isMark: isMark(g.gid, g.cps[0] ?? 0),
        cps: g.cps,
        keepAdvance: true,
    }));
    return attachMarks(items, fontData);
}

/** The pre-1.9.0 path for font data without `otl`: pre-baked ligatures and mark-to-base anchors. */
function shapeWithLigatures(str: string, fontData: FontData, gidOf: (cp: number) => number): ShapedGlyph[] {
    const { ligatures, markAnchors, widths, defaultWidth } = fontData;
    const shaped: ShapedGlyph[] = [];
    const getAdv = (gid: number): number => (widths[gid] !== undefined ? widths[gid] : defaultWidth);

    function emitGlyph(gid: number, cps: readonly number[], isZero: boolean, baseGid?: number): void {
        if (isZero && baseGid !== undefined) {
            // Every anchor triple the mark carries is tried (1.9.0); the
            // first-triple read of earlier releases missed most pairs (#81).
            const found = findMarkToBase(markAnchors, gid, baseGid);
            if (found) {
                shaped.push({
                    gid, dx: found.base[0] - found.mark[0] - getAdv(baseGid),
                    dy: found.base[1] - found.mark[1], isZeroAdvance: true, cps,
                });
                return;
            }
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: true, cps });
        } else {
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: false, cps });
        }
    }

    for (const stack of buildTibetanStacks(str)) {
        const { codepoints } = stack;

        // Gather the consonant stack GIDs (head + subjoined) for ligature lookup.
        const stackGids: number[] = [];
        const stackEndIdx: number[] = [];
        let markStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = tibetanCharType(codepoints[ci]);
            if (ct === 0 || ct === 8 || ct === 1 || ct === 6) {
                stackGids.push(gidOf(codepoints[ci]));
                stackEndIdx.push(ci);
            } else if (ct === 2 || ct === 3 || ct === 5) {
                markStart = ci;
                break;
            } else if (ct < 0 || ct === 9) {
                emitGlyph(gidOf(codepoints[ci]), [codepoints[ci]], false);
            }
        }

        let baseGid = stackGids.length > 0 ? stackGids[0] : 0;
        const cpsOf = (from: number, count: number): number[] =>
            stackEndIdx.slice(from, from + count).map(ci => codepoints[ci]);

        const ligResult = tryLigature(stackGids, ligatures);
        if (ligResult) {
            emitGlyph(ligResult.resultGid, cpsOf(0, ligResult.consumed), false);
            baseGid = ligResult.resultGid;
            let gi = ligResult.consumed;
            while (gi < stackGids.length) {
                const subLig = tryLigature(stackGids.slice(gi), ligatures);
                if (subLig) {
                    emitGlyph(subLig.resultGid, cpsOf(gi, subLig.consumed), false);
                    gi += subLig.consumed;
                } else {
                    const ct = tibetanCharType(codepoints[stackEndIdx[gi]]);
                    // Subjoined consonants and halanta stack below — GPOS anchor.
                    emitGlyph(stackGids[gi], cpsOf(gi, 1), ct === 8 || ct === 6, baseGid);
                    gi++;
                }
            }
        } else {
            for (let gi = 0; gi < stackGids.length; gi++) {
                const ct = tibetanCharType(codepoints[stackEndIdx[gi]]);
                emitGlyph(stackGids[gi], cpsOf(gi, 1), gi > 0 && (ct === 8 || ct === 6), baseGid);
            }
        }

        // Emit vowels and marks.
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = tibetanCharType(cp);
            emitGlyph(gidOf(cp), [cp], ct === 2 || ct === 3, baseGid);
        }
    }

    return shaped;
}
