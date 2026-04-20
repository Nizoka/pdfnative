/**
 * pdfnative — WinAnsi Encoding
 * ==============================
 * Text encoding and font reference logic for Latin (WinAnsi/Helvetica)
 * and Unicode (CIDFont/Identity-H) modes.
 */

import type { FontEntry, TextRun, EncodingContext } from '../types/pdf-types.js';
import { shapeThaiText, containsThai } from '../shaping/thai-shaper.js';
import { splitTextByFont } from '../shaping/multi-font.js';

// ── WinAnsi Encoding ─────────────────────────────────────────────────

/**
 * Encode a JavaScript string to WinAnsiEncoding (ISO-8859-1 superset).
 * Characters outside this encoding are replaced with '?'.
 */
export function toWinAnsi(str: string): string {
    if (!str) return '';
    let r = '';
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c >= 0x20 && c <= 0x7E) r += str[i];
        else if (c >= 0xA0 && c <= 0xFF) r += str[i];
        else if (c === 0x20AC) r += '\x80';
        else if (c === 0x2013) r += '\x96';
        else if (c === 0x2014) r += '\x97';
        else if (c === 0x2018) r += '\x91';
        else if (c === 0x2019) r += '\x92';
        else if (c === 0x201C) r += '\x93';
        else if (c === 0x201D) r += '\x94';
        else if (c === 0x2026) r += '\x85';
        else if (c === 0xA0 || c === 0x202F) r += ' ';
        else if (c === 0x09 || c === 0x0A || c === 0x0D) r += ' ';
        else if (c < 0x20) { /* skip control chars */ }
        else r += '?';
    }
    return r;
}

/**
 * Create a PDF string literal: encode to WinAnsi and escape (, ), \.
 */
export function pdfString(str: string): string {
    const s = toWinAnsi(str);
    return '(' + s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
}

/** Truncate string to max characters, appending '..' if needed. */
export function truncate(str: string, max: number): string {
    if (!str || str.length <= max) return str || '';
    if (max <= 2) return '..';
    return str.slice(0, max - 2) + '..';
}

/**
 * Approximate text width in points using Helvetica character metrics.
 */
export function helveticaWidth(str: string, sz: number): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const cp = str.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) i++; // skip surrogate pair
        if (cp >= 48 && cp <= 57) w += 556;
        else if (cp >= 65 && cp <= 90) w += 680;
        else if (cp >= 97 && cp <= 122) w += 500;
        else if (cp === 32) w += 278;
        else if (cp === 46 || cp === 44) w += 278;
        else if (cp === 43) w += 584;
        else if (cp === 45) w += 333;
        else if (cp === 47 || cp === 58) w += 278;
        // Unicode typographic characters
        else if (cp === 0x2014) w += 1000; // em-dash
        else if (cp === 0x2013) w += 556;  // en-dash
        else if (cp === 0x2026) w += 1000; // ellipsis
        else if (cp === 0x2018 || cp === 0x2019) w += 222; // single curly quotes
        else if (cp === 0x201C || cp === 0x201D) w += 333; // double curly quotes
        else if (cp === 0x20AC) w += 556;  // Euro sign
        else w += 556;
    }
    return w * sz / 1000;
}

// ── Encoding Context Factory ─────────────────────────────────────────

/**
 * Create an encoding context that encapsulates text encoding and font reference logic.
 * Latin mode uses WinAnsi/Helvetica, Unicode mode uses CIDFont/Identity-H.
 *
 * @param fontEntries - Array of font entries (primary first). Empty = Latin mode.
 */
export function createEncodingContext(fontEntries: FontEntry[]): EncodingContext {
    if (!fontEntries || fontEntries.length === 0) {
        return {
            isUnicode: false,
            fontEntries: [],
            ps: pdfString,
            tw: helveticaWidth,
            textRuns: () => [],
            f1: '/F1',
            f2: '/F2'
        };
    }

    const primary = fontEntries[0];

    // Track used glyph IDs per font for subsetting
    const _usedGids = new Map<string, Set<number>>();
    for (const fe of fontEntries) _usedGids.set(fe.fontRef, new Set());

    function _trackGid(fontRef: string, gid: number): void {
        const s = _usedGids.get(fontRef);
        if (s) s.add(gid);
    }

    return {
        isUnicode: true,
        fontEntries,
        fontData: primary.fontData,
        f1: primary.fontRef,
        f2: primary.fontRef,
        getUsedGids() { return _usedGids; },

        textRuns(str: string, sz: number): TextRun[] {
            if (!str) return [];
            const rawRuns = splitTextByFont(str, fontEntries);
            return rawRuns.map(run => {
                const fd = run.entry.fontData;
                const upm = fd.metrics.unitsPerEm;
                const fontRef = run.entry.fontRef;

                if (containsThai(run.text)) {
                    const shaped = shapeThaiText(run.text, fd);
                    let designW = 0;
                    for (const g of shaped) {
                        _trackGid(fontRef, g.gid);
                        if (!g.isZeroAdvance) {
                            designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                        }
                    }
                    return { text: run.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm };
                }

                let hex = '';
                let designW = 0;
                for (let i = 0; i < run.text.length; i++) {
                    const rawCp = run.text.codePointAt(i) ?? 0;
                    if (rawCp > 0xFFFF) i++;
                    const cp = (rawCp === 0x202F || rawCp === 0xA0) ? 0x20 : rawCp;
                    const gid = fd.cmap[cp] || 0;
                    _trackGid(fontRef, gid);
                    hex += gid.toString(16).padStart(4, '0');
                    const gw = fd.widths[gid];
                    designW += gw !== undefined ? gw : fd.defaultWidth;
                }
                return { text: run.text, fontRef, fontData: fd, shaped: null, hexStr: '<' + hex.toUpperCase() + '>', widthPt: designW * sz / upm };
            });
        },

        ps(str: string): string {
            if (!str) return '<>';
            const { cmap } = primary.fontData;
            if (!containsThai(str)) {
                let hex = '';
                for (let i = 0; i < str.length; i++) {
                    const rawCp = str.codePointAt(i) ?? 0;
                    if (rawCp > 0xFFFF) i++;
                    const cp = (rawCp === 0x202F || rawCp === 0xA0) ? 0x20 : rawCp;
                    const gid = cmap[cp] || 0;
                    _trackGid(primary.fontRef, gid);
                    hex += gid.toString(16).padStart(4, '0');
                }
                return '<' + hex.toUpperCase() + '>';
            }
            const shaped = shapeThaiText(str, primary.fontData);
            let hex = '';
            for (const g of shaped) { _trackGid(primary.fontRef, g.gid); hex += g.gid.toString(16).padStart(4, '0'); }
            return '<' + hex.toUpperCase() + '>';
        },

        tw(str: string, sz: number): number {
            if (!str) return 0;
            const runs = this.textRuns(str, sz);
            let total = 0;
            for (const run of runs) total += run.widthPt;
            return total;
        },
    };
}
