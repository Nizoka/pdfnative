/**
 * pdfnative — Multi-Font Text Run Splitter
 * ==========================================
 * Split text into runs, each assigned to the font whose cmap covers it.
 * Uses script-aware preference: characters in a specific Unicode script
 * prefer the font entry whose lang matches that script.
 * Falls back to continuation bias for shared Latin/space characters.
 */

import type { FontEntry } from '../types/pdf-types.js';
import { detectCharLang } from './script-detect.js';

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

    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const charLen = cp > 0xFFFF ? 2 : 1;
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        const char = str.substring(i, i + charLen);

        // Script-aware preference: if char belongs to a specific script,
        // prefer the font entry with matching lang (avoids broad-coverage
        // fonts like JP/ZH/KR stealing characters from specific scripts)
        const charLang = detectCharLang(normCp);
        if (charLang) {
            let preferred: FontEntry | null = null;
            for (const fe of fontEntries) {
                if (fe.lang === charLang && fe.fontData.cmap[normCp]) { preferred = fe; break; }
            }
            if (preferred) {
                if (preferred !== currentEntry) {
                    if (currentText && currentEntry) runs.push({ text: currentText, entry: currentEntry });
                    currentEntry = preferred;
                    currentText = char;
                } else {
                    currentText += char;
                }
                i += charLen;
                continue;
            }
        }

        // Continuation bias: if current font covers this cp, keep going
        if (currentEntry && currentEntry.fontData.cmap[normCp]) {
            currentText += char;
            i += charLen;
            continue;
        }

        // Find first font entry whose cmap covers this codepoint
        let newEntry: FontEntry | null = null;
        for (const fe of fontEntries) {
            if (fe.fontData.cmap[normCp]) { newEntry = fe; break; }
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
