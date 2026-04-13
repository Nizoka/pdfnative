/**
 * pdfnative — Encoding Context Factory
 * ======================================
 * Creates encoding contexts that bridge font encoding (WinAnsi/CIDFont)
 * with text shaping (Thai, Arabic, BiDi, multi-font fallback).
 *
 * Separated from encoding.ts to maintain unidirectional dependency flow:
 * core/ can import from both fonts/ and shaping/, while fonts/ stays
 * independent of shaping/.
 */

import type { FontEntry, FontData, TextRun, EncodingContext } from '../types/pdf-types.js';
import { pdfString, helveticaWidth } from '../fonts/encoding.js';
import { shapeThaiText } from '../shaping/thai-shaper.js';
import { shapeBengaliText } from '../shaping/bengali-shaper.js';
import { shapeTamilText } from '../shaping/tamil-shaper.js';
import { shapeArabicText } from '../shaping/arabic-shaper.js';
import { splitTextByFont } from '../shaping/multi-font.js';
import { resolveBidiRuns, containsRTL, reverseString } from '../shaping/bidi.js';
import { isArabicCodepoint, containsThai, containsArabic, containsBengali, containsTamil } from '../shaping/script-registry.js';

// ── Helvetica Fallback Helpers ───────────────────────────────────────

/** Check if a codepoint is WinAnsi-encodable (basic Latin + Latin-1 Supplement + extras). */
function isWinAnsi(cp: number): boolean {
    if ((cp >= 0x20 && cp <= 0x7E) || (cp >= 0xA0 && cp <= 0xFF)) return true;
    // Extended WinAnsi: full Windows-1252 range 0x80–0x9F
    if (cp === 0x20AC || cp === 0x201A || cp === 0x0192 || cp === 0x201E) return true;
    if (cp === 0x2026 || cp === 0x2020 || cp === 0x2021 || cp === 0x02C6) return true;
    if (cp === 0x2030 || cp === 0x0160 || cp === 0x2039 || cp === 0x0152) return true;
    if (cp === 0x017D || cp === 0x2018 || cp === 0x2019 || cp === 0x201C) return true;
    if (cp === 0x201D || cp === 0x2022 || cp === 0x2013 || cp === 0x2014) return true;
    if (cp === 0x02DC || cp === 0x2122 || cp === 0x0161 || cp === 0x203A) return true;
    if (cp === 0x0153 || cp === 0x017E || cp === 0x0178) return true;
    if (cp === 0x202F || cp === 0x09 || cp === 0x0A || cp === 0x0D) return true;
    return false;
}

interface ArabicSegment { text: string; arabic: boolean; }

/**
 * Split text into Arabic-shapeable and non-Arabic segments.
 * Spaces adjacent to Arabic chars stay in the Arabic segment;
 * non-Arabic chars without a CIDFont glyph form their own segments.
 */
function splitArabicNonArabic(text: string, fd: FontData): ArabicSegment[] {
    const segments: ArabicSegment[] = [];
    let cur = '';
    let curArabic = false;

    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        const charLen = cp > 0xFFFF ? 2 : 1;
        const char = text.substring(i, i + charLen);
        const isAr = isArabicCodepoint(cp);
        // Space is Arabic-adjacent if the CIDFont has a glyph for it
        const isArSpace = cp === 0x20 && (fd.cmap[0x20] ?? 0) > 0;

        if (isAr || isArSpace) {
            if (cur && !curArabic) { segments.push({ text: cur, arabic: false }); cur = ''; }
            curArabic = true;
            cur += char;
        } else {
            if (cur && curArabic) { segments.push({ text: cur, arabic: true }); cur = ''; }
            curArabic = false;
            cur += char;
        }
        i += charLen;
    }
    if (cur) segments.push({ text: cur, arabic: curArabic });
    return segments;
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
            hexStr: `<${cidHex.toUpperCase()}>`,
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
            // No CIDFont glyph, but WinAnsi-encodable → Helvetica
            if (mode === 'cid') flushCid();
            mode = 'hel';
            helChars += char;
        } else if (mode === 'hel' && isWinAnsi(cp)) {
            // Stay in Helvetica for WinAnsi chars (avoids font-switching on spaces
            // between Latin words when the CIDFont happens to cover space)
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
                            // Split into Arabic-shapeable segments and non-Arabic segments.
                            // Non-Arabic chars (e.g. em-dash) without a CIDFont glyph must
                            // fall back to Helvetica, not pass through shapeArabicText()
                            // where they would produce .notdef (gid 0).
                            const segments = splitArabicNonArabic(fRun.text, fd);
                            for (const seg of segments) {
                                if (seg.arabic) {
                                    const logical = reverseString(seg.text);
                                    const shaped = shapeArabicText(logical, fd);
                                    const visual = shaped.slice().reverse();
                                    let designW = 0;
                                    for (const g of visual) {
                                        _trackGid(fontRef, g.gid);
                                        if (!g.isZeroAdvance) {
                                            designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                        }
                                    }
                                    result.push({ text: seg.text, fontRef, fontData: fd, shaped: visual, hexStr: null, widthPt: designW * sz / upm });
                                } else {
                                    // Non-Arabic segment: use Helvetica fallback
                                    const subRuns = buildTextRunsWithFallback(seg.text, fontRef, fd, sz, _trackGid);
                                    result.push(...subRuns);
                                }
                            }
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
                            } else if (containsBengali(fRun.text)) {
                                const shaped = shapeBengaliText(fRun.text, fd);
                                let designW = 0;
                                for (const g of shaped) {
                                    _trackGid(fontRef, g.gid);
                                    if (!g.isZeroAdvance) {
                                        designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                    }
                                }
                                result.push({ text: fRun.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm });
                            } else if (containsTamil(fRun.text)) {
                                const shaped = shapeTamilText(fRun.text, fd);
                                let designW = 0;
                                for (const g of shaped) {
                                    _trackGid(fontRef, g.gid);
                                    if (!g.isZeroAdvance) {
                                        designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                    }
                                }
                                result.push({ text: fRun.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm });
                            } else {
                                // LTR non-shaped: use fallback helper
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
                const upm = fd.metrics.unitsPerEm;

                if (containsThai(run.text)) {
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

                if (containsBengali(run.text)) {
                    const shaped = shapeBengaliText(run.text, fd);
                    let designW = 0;
                    for (const g of shaped) {
                        _trackGid(fontRef, g.gid);
                        if (!g.isZeroAdvance) {
                            designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                        }
                    }
                    return [{ text: run.text, fontRef, fontData: fd, shaped, hexStr: null, widthPt: designW * sz / upm }];
                }

                if (containsTamil(run.text)) {
                    const shaped = shapeTamilText(run.text, fd);
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
                return `<${hex.toUpperCase()}>`;
            }

            if (!containsThai(str) && !containsBengali(str) && !containsTamil(str)) {
                let hex = '';
                for (let i = 0; i < str.length; i++) {
                    const rawCp = str.codePointAt(i) ?? 0;
                    if (rawCp > 0xFFFF) i++;
                    const cp = (rawCp === 0x202F || rawCp === 0xA0) ? 0x20 : rawCp;
                    const gid = cmap[cp] || 0;
                    _trackGid(primary.fontRef, gid);
                    hex += gid.toString(16).padStart(4, '0');
                }
                return `<${hex.toUpperCase()}>`;
            }
            // Shaped text path (Thai, Bengali, Tamil)
            const shapeFn = containsThai(str) ? shapeThaiText
                : containsBengali(str) ? shapeBengaliText
                : shapeTamilText;
            const shaped = shapeFn(str, primary.fontData);
            let hex = '';
            for (const g of shaped) { _trackGid(primary.fontRef, g.gid); hex += g.gid.toString(16).padStart(4, '0'); }
            return `<${hex.toUpperCase()}>`;
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
