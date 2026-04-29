/**
 * pdfnative — Arabic Text Shaper
 * ================================
 * Unicode Presentation Forms-based positional shaping for Arabic script.
 * Handles the four positional forms (isolated, initial, medial, final)
 * and common ligatures (lam-alef).
 *
 * Arabic letters change shape based on their position in a word:
 *   - Isolated: standalone letter (no joining)
 *   - Initial: beginning of a connected sequence
 *   - Medial: middle of a connected sequence
 *   - Final: end of a connected sequence
 *
 * Uses Unicode Arabic Presentation Forms B (U+FE70-U+FEFF) to look up
 * positional glyph IDs directly from the font's cmap, instead of relying
 * on complex GSUB table parsing. This works reliably with all fonts that
 * include Arabic Presentation Forms in their cmap (standard for Noto, etc.).
 *
 * References:
 *   - Unicode Standard §9.2 Arabic
 *   - Unicode Arabic Presentation Forms B (U+FE70-U+FEFF)
 *   - ISO 32000-1 §9 (text rendering)
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import {
    ARABIC_START, ARABIC_END, HEBREW_START, HEBREW_END,
    containsArabic, containsHebrew,
} from './script-registry.js';
import { positionMarkOnBase } from './gpos-positioner.js';

// Re-export range constants for backward compatibility
export { ARABIC_START, ARABIC_END, HEBREW_START, HEBREW_END, containsArabic, containsHebrew };

/**
 * Arabic joining type classification.
 * D = Dual joining (joins on both sides)
 * R = Right joining (joins to the right only)
 * C = Join causing (e.g., TATWEEL)
 * U = Non-joining
 * T = Transparent (non-spacing marks)
 */
type JoiningType = 'D' | 'R' | 'C' | 'U' | 'T';

/**
 * Determine the joining type of an Arabic character.
 */
function getJoiningType(cp: number): JoiningType {
    // Non-spacing marks (transparent)
    if ((cp >= 0x064B && cp <= 0x065F) || // Harakat (vowel marks)
        cp === 0x0670 ||                   // Superscript alef
        (cp >= 0x06D6 && cp <= 0x06DC) ||
        (cp >= 0x06DF && cp <= 0x06E4) ||
        (cp >= 0x06E7 && cp <= 0x06E8) ||
        (cp >= 0x06EA && cp <= 0x06ED) ||
        (cp >= 0x0610 && cp <= 0x061A)) return 'T';

    // TATWEEL (kashida) - join causing
    if (cp === 0x0640) return 'C';

    // Dual-joining letters (most Arabic letters)
    // Note: This is a simplified classification. Full UCD has per-character data.
    if ((cp >= 0x0626 && cp <= 0x0628) || // YEH HAMZA, BA series
        (cp >= 0x062A && cp <= 0x062E) || // TA through KHA  
        (cp >= 0x0633 && cp <= 0x063A) || // SEEN through GHAIN
        (cp >= 0x0641 && cp <= 0x0647) || // FA through HA
        cp === 0x0649 ||                   // ALEF MAKSURA
        cp === 0x064A ||                   // YA
        cp === 0x0678 ||                   // HIGH HAMZA YEH
        (cp >= 0x069A && cp <= 0x06BF) ||  // Extended Arabic
        (cp >= 0x06C1 && cp <= 0x06C3) ||
        (cp >= 0x06CC && cp <= 0x06CE) ||
        (cp >= 0x06D0 && cp <= 0x06D3) ||
        cp === 0x06D5 ||
        cp === 0x06FA ||
        cp === 0x06FB ||
        cp === 0x06FC) return 'D';

    // Right-joining letters (ALEF, DAL, THAL, RA, ZAI, WAW, etc.)
    if (cp === 0x0622 || cp === 0x0623 || cp === 0x0624 || cp === 0x0625 ||
        cp === 0x0627 ||                   // ALEF
        cp === 0x0629 ||                   // TEH MARBUTA
        cp === 0x062F || cp === 0x0630 ||  // DAL, THAL
        cp === 0x0631 || cp === 0x0632 ||  // RA, ZAIN
        cp === 0x0648 ||                   // WAW
        (cp >= 0x0671 && cp <= 0x0673) ||
        cp === 0x0675 || cp === 0x0676 || cp === 0x0677 ||
        (cp >= 0x0688 && cp <= 0x0699) ||  // Extended DAL/RA series
        cp === 0x06C0 ||
        (cp >= 0x06C4 && cp <= 0x06CB) ||
        cp === 0x06CF ||
        cp === 0x06EE || cp === 0x06EF) return 'R';

    // Everything else in Arabic block is non-joining
    if (cp >= ARABIC_START && cp <= ARABIC_END) return 'U';

    // Non-Arabic → non-joining
    return 'U';
}

// ── Arabic Presentation Forms B (U+FE70-U+FEFF) ─────────────────────

/**
 * Unicode Arabic Presentation Forms B mapping.
 * Maps base Arabic codepoints to their positional form codepoints.
 * These are standard Unicode codepoints that fonts include in their cmap,
 * providing direct glyph access without GSUB table parsing.
 */
interface ArabicPresForm {
    readonly isol: number;
    readonly fina?: number;
    readonly init?: number;
    readonly medi?: number;
}

const ARABIC_PRES_FORMS: ReadonlyMap<number, ArabicPresForm> = new Map([
    [0x0621, { isol: 0xFE80 }],
    [0x0622, { isol: 0xFE81, fina: 0xFE82 }],
    [0x0623, { isol: 0xFE83, fina: 0xFE84 }],
    [0x0624, { isol: 0xFE85, fina: 0xFE86 }],
    [0x0625, { isol: 0xFE87, fina: 0xFE88 }],
    [0x0626, { isol: 0xFE89, fina: 0xFE8A, init: 0xFE8B, medi: 0xFE8C }],
    [0x0627, { isol: 0xFE8D, fina: 0xFE8E }],
    [0x0628, { isol: 0xFE8F, fina: 0xFE90, init: 0xFE91, medi: 0xFE92 }],
    [0x0629, { isol: 0xFE93, fina: 0xFE94 }],
    [0x062A, { isol: 0xFE95, fina: 0xFE96, init: 0xFE97, medi: 0xFE98 }],
    [0x062B, { isol: 0xFE99, fina: 0xFE9A, init: 0xFE9B, medi: 0xFE9C }],
    [0x062C, { isol: 0xFE9D, fina: 0xFE9E, init: 0xFE9F, medi: 0xFEA0 }],
    [0x062D, { isol: 0xFEA1, fina: 0xFEA2, init: 0xFEA3, medi: 0xFEA4 }],
    [0x062E, { isol: 0xFEA5, fina: 0xFEA6, init: 0xFEA7, medi: 0xFEA8 }],
    [0x062F, { isol: 0xFEA9, fina: 0xFEAA }],
    [0x0630, { isol: 0xFEAB, fina: 0xFEAC }],
    [0x0631, { isol: 0xFEAD, fina: 0xFEAE }],
    [0x0632, { isol: 0xFEAF, fina: 0xFEB0 }],
    [0x0633, { isol: 0xFEB1, fina: 0xFEB2, init: 0xFEB3, medi: 0xFEB4 }],
    [0x0634, { isol: 0xFEB5, fina: 0xFEB6, init: 0xFEB7, medi: 0xFEB8 }],
    [0x0635, { isol: 0xFEB9, fina: 0xFEBA, init: 0xFEBB, medi: 0xFEBC }],
    [0x0636, { isol: 0xFEBD, fina: 0xFEBE, init: 0xFEBF, medi: 0xFEC0 }],
    [0x0637, { isol: 0xFEC1, fina: 0xFEC2, init: 0xFEC3, medi: 0xFEC4 }],
    [0x0638, { isol: 0xFEC5, fina: 0xFEC6, init: 0xFEC7, medi: 0xFEC8 }],
    [0x0639, { isol: 0xFEC9, fina: 0xFECA, init: 0xFECB, medi: 0xFECC }],
    [0x063A, { isol: 0xFECD, fina: 0xFECE, init: 0xFECF, medi: 0xFED0 }],
    [0x0641, { isol: 0xFED1, fina: 0xFED2, init: 0xFED3, medi: 0xFED4 }],
    [0x0642, { isol: 0xFED5, fina: 0xFED6, init: 0xFED7, medi: 0xFED8 }],
    [0x0643, { isol: 0xFED9, fina: 0xFEDA, init: 0xFEDB, medi: 0xFEDC }],
    [0x0644, { isol: 0xFEDD, fina: 0xFEDE, init: 0xFEDF, medi: 0xFEE0 }],
    [0x0645, { isol: 0xFEE1, fina: 0xFEE2, init: 0xFEE3, medi: 0xFEE4 }],
    [0x0646, { isol: 0xFEE5, fina: 0xFEE6, init: 0xFEE7, medi: 0xFEE8 }],
    [0x0647, { isol: 0xFEE9, fina: 0xFEEA, init: 0xFEEB, medi: 0xFEEC }],
    [0x0648, { isol: 0xFEED, fina: 0xFEEE }],
    [0x0649, { isol: 0xFEEF, fina: 0xFEF0 }],
    [0x064A, { isol: 0xFEF1, fina: 0xFEF2, init: 0xFEF3, medi: 0xFEF4 }],
]);

/** Lam-Alef ligature presentation forms: [isolatedCP, finalCP]. */
const LAM_ALEF_PRES: ReadonlyMap<number, readonly [number, number]> = new Map([
    [0x0622, [0xFEF5, 0xFEF6]],  // LAM + ALEF WITH MADDA ABOVE
    [0x0623, [0xFEF7, 0xFEF8]],  // LAM + ALEF WITH HAMZA ABOVE
    [0x0625, [0xFEF9, 0xFEFA]],  // LAM + ALEF WITH HAMZA BELOW
    [0x0627, [0xFEFB, 0xFEFC]],  // LAM + ALEF
]);

// ── Positional Form Selection ────────────────────────────────────────

/** Positional form tags matching OpenType GSUB features. */
type PositionalForm = 'isol' | 'init' | 'medi' | 'fina';

/**
 * Determine the positional form for each character in an Arabic word.
 * Uses joining type analysis to decide isolated/initial/medial/final forms.
 *
 * @param codePoints - Array of code points (logical order)
 * @returns Array of positional form tags
 */
function resolvePositionalForms(codePoints: number[]): PositionalForm[] {
    const len = codePoints.length;
    const forms: PositionalForm[] = new Array(len).fill('isol');
    const joining = codePoints.map(getJoiningType);

    for (let i = 0; i < len; i++) {
        if (joining[i] === 'T' || joining[i] === 'U') continue;

        // Find previous non-transparent joining character
        let prevJoin: JoiningType = 'U';
        for (let j = i - 1; j >= 0; j--) {
            if (joining[j] !== 'T') { prevJoin = joining[j]; break; }
        }

        // Find next non-transparent joining character
        let nextJoin: JoiningType = 'U';
        for (let j = i + 1; j < len; j++) {
            if (joining[j] !== 'T') { nextJoin = joining[j]; break; }
        }

        const joinsToPrev = prevJoin === 'D' || prevJoin === 'C';
        const joinsToNext = (nextJoin === 'D' || nextJoin === 'R' || nextJoin === 'C') &&
                            (joining[i] === 'D' || joining[i] === 'C');

        if (joinsToPrev && joinsToNext) {
            forms[i] = 'medi';
        } else if (joinsToPrev) {
            forms[i] = 'fina';
        } else if (joinsToNext) {
            forms[i] = 'init';
        } else {
            forms[i] = 'isol';
        }
    }

    return forms;
}

// ── Lam-Alef Ligature ────────────────────────────────────────────────

/** Alef variants that form ligatures with Lam. */
const LAM = 0x0644;
const ALEF_VARIANTS = new Set([0x0622, 0x0623, 0x0625, 0x0627]);

/**
 * Check if a codepoint pair should form a Lam-Alef ligature.
 *
 * @param cp1 - First code point (expected Lam U+0644)
 * @param cp2 - Second code point (expected Alef variant)
 * @returns True if the pair forms a Lam-Alef ligature
 */
export function isLamAlef(cp1: number, cp2: number): boolean {
    return cp1 === LAM && ALEF_VARIANTS.has(cp2);
}

// ── Main Shaping API ─────────────────────────────────────────────────

// containsArabic and containsHebrew are re-exported from script-registry above

/**
 * Shape Arabic text using Unicode Presentation Forms.
 * Applies isolated/initial/medial/final forms by looking up the
 * positional presentation form codepoint in the font's cmap,
 * and handles Lam-Alef ligatures.
 *
 * @param str - Input Arabic text (logical order)
 * @param fontData - Font data with cmap and widths
 * @returns Array of positioned glyphs
 */
export function shapeArabicText(str: string, fontData: FontData): ShapedGlyph[] {
    if (!str) return [];

    // Extract code points
    const codePoints: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        codePoints.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    // Resolve positional forms
    const forms = resolvePositionalForms(codePoints);

    // Apply presentation form substitutions and build glyph array.
    // GPOS MarkBasePos (LookupType 4): when a mark follows a base glyph and
    // both are present in `markAnchors`, position the mark using its anchor
    // delta (v1.1.0 — issue #25). Falls back to (0,0) when anchors are missing
    // (e.g. presentation forms without anchor entries), preserving v1.0
    // behaviour for unsupported fonts.
    const glyphs: ShapedGlyph[] = [];
    const cmap = fontData.cmap;
    const widths = fontData.widths;
    const defaultWidth = fontData.defaultWidth;
    const markAnchors = fontData.markAnchors;
    let lastBaseGid = 0; // Track the most recent base glyph for mark anchoring

    for (let i = 0; i < codePoints.length; i++) {
        const cp = codePoints[i];

        // Check for Lam-Alef ligature
        if (i < codePoints.length - 1 && isLamAlef(cp, codePoints[i + 1])) {
            const ligForms = LAM_ALEF_PRES.get(codePoints[i + 1]);
            if (ligForms) {
                // Determine if the ligature is in final form (Lam joins to previous)
                const isFinal = forms[i] === 'medi' || forms[i] === 'fina';
                const ligCP = isFinal ? ligForms[1] : ligForms[0];
                const ligGid = cmap[ligCP];
                if (ligGid) {
                    glyphs.push({ gid: ligGid, dx: 0, dy: 0, isZeroAdvance: false });
                    lastBaseGid = ligGid;
                    i++; // Skip the Alef
                    continue;
                }
            }
        }

        // Get base glyph ID from cmap
        let gid = cmap[cp] ?? 0;

        // Apply positional form via Unicode Presentation Forms
        const presForm = ARABIC_PRES_FORMS.get(cp);
        if (presForm) {
            const form = forms[i];
            let presCP: number | undefined;
            if (form === 'init') presCP = presForm.init;
            else if (form === 'medi') presCP = presForm.medi;
            else if (form === 'fina') presCP = presForm.fina;
            else presCP = presForm.isol;

            if (presCP) {
                const presGid = cmap[presCP];
                if (presGid) gid = presGid;
            }
        }

        // Transparent marks get zero advance
        const joining = getJoiningType(cp);
        const isZeroAdvance = joining === 'T';

        if (isZeroAdvance && lastBaseGid !== 0) {
            // GPOS MarkBasePos: anchor harakat / transparent marks on the
            // preceding base glyph if the font provides anchors. Otherwise
            // emit at (0,0) — same as pre-v1.1.0 behaviour.
            const baseAdv = widths[lastBaseGid] !== undefined ? widths[lastBaseGid] : defaultWidth;
            const offset = positionMarkOnBase(markAnchors, gid, lastBaseGid, baseAdv);
            if (offset) {
                glyphs.push({ gid, dx: offset.dx, dy: offset.dy, isZeroAdvance: true });
                continue;
            }
        }

        glyphs.push({ gid, dx: 0, dy: 0, isZeroAdvance });
        if (!isZeroAdvance) lastBaseGid = gid;
    }

    return glyphs;
}
