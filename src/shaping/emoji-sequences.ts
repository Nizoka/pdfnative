/**
 * pdfnative — Emoji Sequence Matcher (v1.7.0)
 * ============================================
 * Longest-match pre-pass for multi-codepoint emoji: flag (regional-indicator
 * pair) and ZWJ sequences. Works against the `sequences` table carried by a
 * colour-emoji font module (built by `pdfnative-build-emoji-font` /
 * `scripts/build-color-emoji-data.ts`), which maps a sequence's FIRST
 * codepoint to `[resultGid, cp2, cp3, …]` entries sorted longest-first.
 *
 * Fallback contract: a sequence absent from the table degrades to exactly
 * the historical per-codepoint behaviour — unmatched zero-width joiners,
 * variation selectors and skin-tone modifiers are dropped (as the multi-font
 * splitter always did), and unmatched regional indicators pass through to
 * the normal cmap lookup. A font without a `sequences` table never reaches
 * this module.
 *
 * Zero external dependency.
 */

import type { FontData } from '../types/pdf-types.js';
import { ZWJ, VS15, VS16, FITZPATRICK_START, FITZPATRICK_END } from './script-registry.js';

/** Regional Indicator Symbol block (U+1F1E6 A … U+1F1FF Z). */
export const REGIONAL_INDICATOR_START = 0x1F1E6;
export const REGIONAL_INDICATOR_END = 0x1F1FF;

/** True for a codepoint that can participate mid-sequence (joiners + RIs). */
export function isSequenceCodepoint(cp: number): boolean {
    return cp === ZWJ
        || cp === VS16
        || (cp >= FITZPATRICK_START && cp <= FITZPATRICK_END)
        || (cp >= REGIONAL_INDICATOR_START && cp <= REGIONAL_INDICATOR_END);
}

/**
 * Fast trigger scan: does the text contain anything that could start or
 * join a multi-codepoint emoji sequence? Cheap gate so ordinary text never
 * pays for the matcher.
 */
export function hasSequenceTriggers(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === ZWJ || c === VS16) return true;
        // Surrogate-pair blocks (RI + Fitzpatrick live in plane 1).
        if (c === 0xD83C) {
            const lo = text.charCodeAt(i + 1);
            if (lo >= 0xDDE6 && lo <= 0xDDFF) return true; // RI
            if (lo >= 0xDFFB && lo <= 0xDFFF) return true; // Fitzpatrick
        }
    }
    return false;
}

/** A matched piece: either a resolved sequence glyph or plain passthrough text. */
export interface EmojiPiece {
    /** Ligature glyph id when a bundled sequence matched, else `null`. */
    readonly gid: number | null;
    /** The source text covered by this piece (logical order). */
    readonly text: string;
}

/**
 * Greedy longest-match segmentation of `text` against the font's sequence
 * table. Returns pieces in order; `gid` pieces render as a single colour
 * glyph, `text` pieces flow through the normal per-codepoint pipeline.
 */
export function matchEmojiSequences(text: string, fd: FontData): EmojiPiece[] {
    const sequences = fd.sequences;
    if (!sequences) return [{ gid: null, text }];

    // Decode once into codepoints with their string offsets.
    const cps: number[] = [];
    const offs: number[] = [];
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        cps.push(cp);
        offs.push(i);
        i += cp > 0xFFFF ? 2 : 1;
    }
    offs.push(text.length);

    const pieces: EmojiPiece[] = [];
    let plain = '';
    const flushPlain = (): void => {
        if (plain) { pieces.push({ gid: null, text: plain }); plain = ''; }
    };

    for (let i = 0; i < cps.length;) {
        const candidates = sequences[cps[i]];
        if (candidates) {
            let matched = false;
            for (const entry of candidates) {
                // entry = [resultGid, cp2, cp3, …]
                const tailLen = entry.length - 1;
                if (i + 1 + tailLen > cps.length) continue;
                let ok = true;
                for (let c = 0; c < tailLen; c++) {
                    if (cps[i + 1 + c] !== entry[1 + c]) { ok = false; break; }
                }
                if (ok) {
                    flushPlain();
                    pieces.push({ gid: entry[0], text: text.substring(offs[i], offs[i + 1 + tailLen]) });
                    i += 1 + tailLen;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;
        }
        const cp = cps[i];
        // Unmatched joiners replicate the historical drop (no tofu); VS-15
        // asks for text presentation and is likewise invisible.
        if (cp === ZWJ || cp === VS15 || cp === VS16
            || (cp >= FITZPATRICK_START && cp <= FITZPATRICK_END)) {
            i++;
            continue;
        }
        plain += text.substring(offs[i], offs[i + 1]);
        i++;
    }
    flushPlain();
    return pieces;
}
