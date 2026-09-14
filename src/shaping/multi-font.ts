/**
 * pdfnative — Multi-Font Text Run Splitter
 * ==========================================
 * Split text into runs, each assigned to the font whose cmap covers it.
 * Uses "continuation bias": if the current font covers the next codepoint,
 * it stays in the same run (minimizes font switches on shared Latin/space chars).
 */

import type { FontEntry } from '../types/pdf-types.js';
import { detectCharLang } from './script-detect.js';
import { isZeroWidthFormat, isCombiningMarkCodepoint } from './script-registry.js';
import { isSequenceCodepoint } from './emoji-sequences.js';

/** A text run with its assigned font entry */
export interface FontRun {
    text: string;
    entry: FontEntry;
}

/**
 * Split a string into text runs, each assigned to the font whose cmap covers it.
 *
 * @param str - Input text
 * @param fontEntries - Font list (primary first)
 * @returns Runs with assigned font entry
 */
export function splitTextByFont(str: string, fontEntries: FontEntry[]): FontRun[] {
    if (!str || fontEntries.length === 0) return [];
    if (fontEntries.length === 1) return [{ text: str, entry: fontEntries[0] }];

    const runs: FontRun[] = [];
    let currentEntry: FontEntry | null = null;
    let currentText = '';
    // True when the previous codepoint kept in a sequence-capable run was a
    // ZWJ: the joined codepoint that follows belongs to the same sequence
    // even when the subset cmap has no standalone glyph for it (v1.7.0).
    let afterZwj = false;

    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const charLen = cp > 0xFFFF ? 2 : 1;
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        const char = str.substring(i, i + charLen);

        // Continuation bias: if current font covers this cp, keep going.
        // A sequence-capable colour-emoji font (v1.7.0) also keeps joiners,
        // variation selectors, skin tones and regional indicators in its
        // run — plus the codepoint right after a ZWJ — so the emoji-sequence
        // matcher sees the intact sequence.
        // A base followed by a combining mark wants a font that has the mark
        // AND can attach it (GPOS anchors): the Vietnamese subset carries
        // ẹ and U+0301 but no anchors, Noto Sans has both, so Yoruba ẹ́ goes
        // to Noto Sans in one run. Ranks: 0 no base glyph, 1 base only,
        // 2 base and mark, 3 base and an anchored mark. Text without a
        // following mark ranks every covering font 3, exactly as before. (v1.8.0)
        const nextCp = i + charLen < str.length ? (str.codePointAt(i + charLen) ?? 0) : 0;
        const nextIsMark = isCombiningMarkCodepoint(nextCp);
        const rank = (fe: FontEntry): number => {
            const fd = fe.fontData;
            if (!(fd.cmap[normCp] || fd.sequences?.[normCp])) return 0;
            if (!nextIsMark) return 3;
            const markGid = fd.cmap[nextCp];
            if (!markGid) return 1;
            return fd.markAnchors?.marks[markGid] ? 3 : 2;
        };

        const keepsMark = !nextIsMark || (currentEntry !== null && rank(currentEntry) === 3);
        if (currentEntry && keepsMark && (currentEntry.fontData.cmap[normCp]
            || (currentEntry.fontData.sequences && (isSequenceCodepoint(normCp) || afterZwj)))) {
            afterZwj = Boolean(currentEntry.fontData.sequences) && normCp === 0x200D;
            currentText += char;
            i += charLen;
            continue;
        }
        afterZwj = false;

        // Zero-width joiners / variation selectors / skin-tone modifiers that
        // no registered font covers carry no glyph — drop them rather than
        // emit .notdef tofu. (When a font, e.g. an Indic shaper font, *does*
        // map the joiner the continuation-bias check above keeps it.)
        if (isZeroWidthFormat(normCp) && !fontEntries.some((fe) => fe.fontData.cmap[normCp])) {
            i += charLen;
            continue;
        }

        // Find the best font entry for this codepoint: the highest rank, a
        // language match breaking ties, then registration order. A sequence
        // table keyed by this codepoint counts as coverage (flag pairs start
        // on a regional indicator that deliberately has no cmap entry).
        let newEntry: FontEntry | null = null;
        const charLang = detectCharLang(normCp);
        let bestScore = 0;
        for (const fe of fontEntries) {
            const r = rank(fe);
            if (r === 0) continue;
            const score = r * 2 + (charLang !== null && fe.lang === charLang ? 1 : 0);
            if (score > bestScore) { bestScore = score; newEntry = fe; }
        }
        // If no font covers it, fall back to primary (will render .notdef)
        if (!newEntry) newEntry = fontEntries[0];

        // Font switch → flush current run
        if (newEntry !== currentEntry) {
            if (currentText && currentEntry) runs.push({ text: currentText, entry: currentEntry });
            currentEntry = newEntry;
            currentText = char;
        } else {
            currentText += char;
        }
        i += charLen;
    }
    if (currentText && currentEntry) runs.push({ text: currentText, entry: currentEntry });
    return runs;
}
