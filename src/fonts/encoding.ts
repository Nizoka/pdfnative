/**
 * pdfnative — WinAnsi Encoding
 * ==============================
 * Text encoding and font reference logic for Latin (WinAnsi/Helvetica)
 * and Unicode (CIDFont/Identity-H) modes.
 */

import type { FontEntry, FontData, TextRun, EncodingContext } from '../types/pdf-types.js';
import { shapeThaiText, containsThai } from '../shaping/thai-shaper.js';
import { shapeArabicText, containsArabic } from '../shaping/arabic-shaper.js';
import { splitTextByFont } from '../shaping/multi-font.js';
import { resolveBidiRuns, containsRTL, reverseString } from '../shaping/bidi.js';

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
    return str.slice(0, max - 2) + '..';
}

/**
 * Approximate text width in points using Helvetica character metrics.
 */
export function helveticaWidth(str: string, sz: number): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c >= 48 && c <= 57) w += 556;
        else if (c >= 65 && c <= 90) w += 680;
        else if (c >= 97 && c <= 122) w += 500;
        else if (c === 32) w += 278;
        else if (c === 46 || c === 44) w += 278;
        else if (c === 43) w += 584;
        else if (c === 45) w += 333;
        else if (c === 47 || c === 58) w += 278;
        else w += 556;
    }
    return w * sz / 1000;
}

// ── Helvetica Fallback Helpers ───────────────────────────────────────

/** Check if a codepoint is WinAnsi-encodable (basic Latin + Latin-1 Supplement + extras). */
function isWinAnsi(cp: number): boolean {
    if ((cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF)) return true;
    // Extended WinAnsi: €, –, —, '', "", …, NBSP, NNBSP, whitespace
    if (cp === 0x20AC || cp === 0x2013 || cp === 0x2014) return true;
    if (cp === 0x2018 || cp === 0x2019 || cp === 0x201C || cp === 0x201D) return true;
    if (cp === 0x2026 || cp === 0x202F || cp === 0x09 || cp === 0x0A || cp === 0x0D) return true;
    return false;
}

/**
 * Build TextRuns for a non-shaped text segment, splitting into CIDFont and
 * Helvetica sub-runs based on cmap coverage. Characters with no CIDFont glyph
 * that are WinAnsi-encodable fall back to Helvetica (/F1).
 */
function buildTextRunsWithFallback(
    text: string,
    fontRef: string,
    fd: FontData,
    sz: number,
    trackGid: (ref: string, gid: number) => void,
): TextRun[] {
    const upm = fd.metrics.unitsPerEm;
    const result: TextRun[] = [];
    let mode: 'cid' | 'hel' | null = null;
    let cidChars = '';
    let cidHex = '';
    let cidDesignW = 0;
    let helChars = '';

    function flushCid(): void {
        if (!cidChars) return;
        result.push({
            text: cidChars, fontRef, fontData: fd, shaped: null,
            hexStr: '<' + cidHex.toUpperCase() + '>',
            widthPt: cidDesignW * sz / upm,
        });
        cidChars = '';
        cidHex = '';
        cidDesignW = 0;
    }

    function flushHel(): void {
        if (!helChars) return;
        result.push({
            text: helChars, fontRef: '/F1', fontData: fd, shaped: null,
            hexStr: pdfString(helChars),
            widthPt: helveticaWidth(helChars, sz),
        });
        helChars = '';
    }

    for (let i = 0; i < text.length;) {
        const rawCp = text.codePointAt(i) ?? 0;
        const charLen = rawCp > 0xFFFF ? 2 : 1;
        const cp = (rawCp === 0x202F || rawCp === 0xA0) ? 0x20 : rawCp;
        const char = text.substring(i, i + charLen);
        const gid = fd.cmap[cp] ?? 0;

        if (gid === 0 && isWinAnsi(cp)) {
            if (mode === 'cid') flushCid();
            mode = 'hel';
            helChars += char;
        } else {
            if (mode === 'hel') flushHel();
            mode = 'cid';
            cidChars += char;
            trackGid(fontRef, gid);
            cidHex += gid.toString(16).padStart(4, '0');
            const gw = fd.widths[gid];
            cidDesignW += gw !== undefined ? gw : fd.defaultWidth;
        }
        i += charLen;
    }
    if (mode === 'cid') flushCid();
    if (mode === 'hel') flushHel();

    return result;
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

            // ── RTL path: BiDi reordering ────────────────────────────
            if (containsRTL(str)) {
                const bidiRuns = resolveBidiRuns(str);
                const result: TextRun[] = [];

                for (const bRun of bidiRuns) {
                    const isRTL = bRun.level % 2 === 1;
                    const fontRuns = splitTextByFont(bRun.text, fontEntries);

                    for (const fRun of fontRuns) {
                        const fd = fRun.entry.fontData;
                        const upm = fd.metrics.unitsPerEm;
                        const fontRef = fRun.entry.fontRef;

                        if (isRTL && containsArabic(fRun.text)) {
                            // Reverse back to logical order for shaping, then reverse glyphs
                            const logical = reverseString(fRun.text);
                            const shaped = shapeArabicText(logical, fd);
                            // Reverse shaped glyphs for visual order
                            const visual = shaped.slice().reverse();
                            let designW = 0;
                            for (const g of visual) {
                                _trackGid(fontRef, g.gid);
                                if (!g.isZeroAdvance) {
                                    designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                }
                            }
                            result.push({ text: fRun.text, fontRef, fontData: fd, shaped: visual, hexStr: null, widthPt: designW * sz / upm });
                        } else if (isRTL) {
                            // RTL non-Arabic (Hebrew etc.): text already reversed by BiDi
                            // Use fallback helper to handle Latin chars not covered by CIDFont
                            const subRuns = buildTextRunsWithFallback(fRun.text, fontRef, fd, sz, _trackGid);
                            result.push(...subRuns);
                        } else {
                            // LTR run: standard path
                            if (containsThai(fRun.text)) {
                                const shaped = shapeThaiText(fRun.text, fd);
                                let designW = 0;
                                for (const g of shaped) {
                                    _trackGid(fontRef, g.gid);
                                    if (!g.isZeroAdvance) {
                                        designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                    }
                                }
                                result.push({ text: fRun.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm });
                            } else {
                                // LTR non-Thai: use fallback helper
                                const subRuns = buildTextRunsWithFallback(fRun.text, fontRef, fd, sz, _trackGid);
                                result.push(...subRuns);
                            }
                        }
                    }
                }
                return result;
            }

            // ── LTR path: existing logic ─────────────────────────────
            const rawRuns = splitTextByFont(str, fontEntries);
            return rawRuns.flatMap(run => {
                const fd = run.entry.fontData;
                const fontRef = run.entry.fontRef;

                if (containsThai(run.text)) {
                    const upm = fd.metrics.unitsPerEm;
                    const shaped = shapeThaiText(run.text, fd);
                    let designW = 0;
                    for (const g of shaped) {
                        _trackGid(fontRef, g.gid);
                        if (!g.isZeroAdvance) {
                            designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                        }
                    }
                    return [{ text: run.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm }];
                }

                return buildTextRunsWithFallback(run.text, fontRef, fd, sz, _trackGid);
            });
        },

        ps(str: string): string {
            if (!str) return '<>';
            const { cmap } = primary.fontData;

            // BiDi path for RTL text
            if (containsRTL(str)) {
                const bidiRuns = resolveBidiRuns(str);
                let hex = '';
                for (const bRun of bidiRuns) {
                    const isRTL = bRun.level % 2 === 1;
                    if (isRTL && containsArabic(bRun.text)) {
                        const logical = reverseString(bRun.text);
                        const shaped = shapeArabicText(logical, primary.fontData);
                        for (let i = shaped.length - 1; i >= 0; i--) {
                            _trackGid(primary.fontRef, shaped[i].gid);
                            hex += shaped[i].gid.toString(16).padStart(4, '0');
                        }
                    } else {
                        for (let i = 0; i < bRun.text.length; i++) {
                            const rawCp = bRun.text.codePointAt(i) ?? 0;
                            if (rawCp > 0xFFFF) i++;
                            const cp = (rawCp === 0x202F || rawCp === 0xA0) ? 0x20 : rawCp;
                            const gid = cmap[cp] || 0;
                            _trackGid(primary.fontRef, gid);
                            hex += gid.toString(16).padStart(4, '0');
                        }
                    }
                }
                return '<' + hex.toUpperCase() + '>';
            }

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
