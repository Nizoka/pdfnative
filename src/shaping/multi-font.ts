/**
 * pdfnative — Multi-Font Text Run Splitter
 * ==========================================
 * Split text into runs, each assigned to the font whose cmap covers it.
 * Uses "continuation bias": if the current font covers the next codepoint,
 * it stays in the same run (minimizes font switches on shared Latin/space chars).
 */

import type { FontEntry } from '../types/pdf-types.js';
import { detectCharLang } from './script-detect.js';
import { isZeroWidthFormat } from './script-registry.js';
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
        if (currentEntry && (currentEntry.fontData.cmap[normCp]
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

        // Find best font entry whose cmap covers this codepoint.
        // Prefer font whose lang matches the codepoint's script. A sequence
        // table keyed by this codepoint counts as coverage (flag pairs start
        // on a regional indicator that deliberately has no cmap entry).
        let newEntry: FontEntry | null = null;
        const charLang = detectCharLang(normCp);
        const covers = (fe: FontEntry): boolean =>
            Boolean(fe.fontData.cmap[normCp] || fe.fontData.sequences?.[normCp]);
        if (charLang) {
            for (const fe of fontEntries) {
                if (fe.lang === charLang && covers(fe)) { newEntry = fe; break; }
            }
        }
        if (!newEntry) {
            for (const fe of fontEntries) {
                if (covers(fe)) { newEntry = fe; break; }
            }
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
