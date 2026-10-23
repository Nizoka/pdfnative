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

import type { FontEntry, FontData, TextRun, EncodingContext, Base14Metrics, TextDirection } from '../types/pdf-types.js';
import { pdfString, helveticaWidth, stripSoftHyphens, toWinAnsi, narrowNoBreakSpaceCorrection } from '../fonts/encoding.js';
import { exactBase14Width } from '../fonts/base14-metrics.js';
import { preferredCodepoint } from '../fonts/unicode-preference.js';
import { applyFeaturesToRuns, composeFeatureMap } from '../fonts/font-features.js';
import { applyKerningToRuns } from '../fonts/font-kerning.js';
import { shapeArabicText } from '../shaping/arabic-shaper.js';
import { findShaper, type ScriptShaper } from '../shaping/shaper-registry.js';
import { splitTextByFont } from '../shaping/multi-font.js';
import { resolveBidiRuns, resolveBidiLevels, bidiRunsForLine, containsRTL, reverseString, stripBidiControls } from '../shaping/bidi.js';
import type { BidiRun } from '../shaping/bidi.js';
import { hasSequenceTriggers, matchEmojiSequences } from '../shaping/emoji-sequences.js';
import { isArabicCodepoint, containsArabic } from '../shaping/script-registry.js';
import { createColorEmojiCollector } from './color-emoji.js';

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

/**
 * The codepoint a no-break space is shown as in a given font.
 *
 * A font that carries U+00A0 or U+202F gets the real glyph: a narrow no-break
 * space is then actually narrow (166 units in Noto Sans against 260 for the
 * space), and both extract as what the author wrote, which is what makes
 * `punctuationSpacing: 'fr'` distinguishable from `'fr-CA'` in the output.
 * A font without the glyph falls back to the ordinary space so the character
 * never reaches the cmap as .notdef. Any other codepoint passes through.
 *
 * @since 1.8.0
 */
function spaceCodepoint(fd: FontData, rawCp: number): number {
    if (rawCp !== 0x202F && rawCp !== 0xA0) return rawCp;
    return (fd.cmap[rawCp] ?? 0) > 0 ? rawCp : 0x20;
}

/**
 * Shape one run with a registered shaper and measure it.
 *
 * Zero-advance glyphs — the combining marks a shaper stacks on their base —
 * contribute no width, which is the difference between a Thai tone mark
 * sitting above its vowel and pushing the line along.
 *
 * @since 1.8.0
 */
function shapedRun(
    text: string,
    shaper: ScriptShaper,
    fontRef: string,
    fd: FontData,
    sz: number,
    trackGid: (ref: string, gid: number) => void,
    onGlyph?: (ref: string, gid: number, cps: readonly number[]) => void,
): TextRun {
    const shaped = shaper.shape(text, fd);
    let designW = 0;
    for (const g of shaped) {
        trackGid(fontRef, g.gid);
        if (onGlyph && g.cps && g.cps.length > 0) onGlyph(fontRef, g.gid, g.cps);
        if (!g.isZeroAdvance) {
            designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
        }
    }
    return {
        text, fontRef, fontData: fd, shaped, hexStr: null,
        widthPt: designW * sz / fd.metrics.unitsPerEm,
    };
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
 *
 * @param pdfA - When true, disables Helvetica fallback (PDF/A forbids unembedded
 *   standard-14 fonts). Missing glyphs route through the primary CIDFont as
 *   .notdef (gid 0). Callers must register a Latin-coverage font (e.g. Noto Sans)
 *   to ensure full WinAnsi range is covered.
 */
function buildTextRunsWithFallback(
    text: string,
    fontRef: string,
    fd: FontData,
    sz: number,
    trackGid: (ref: string, gid: number, cp?: number) => void,
    pdfA: boolean = false,
): TextRun[] {
    // Emoji-sequence pre-pass (v1.7.0): fonts carrying a `sequences` table
    // resolve flag / ZWJ sequences to a single colour ligature glyph before
    // the per-codepoint loop. Text without triggers — and every font
    // without the table — takes the historical path byte-identically.
    if (fd.sequences && hasSequenceTriggers(text)) {
        const upm = fd.metrics.unitsPerEm;
        const result: TextRun[] = [];
        for (const piece of matchEmojiSequences(text, fd)) {
            if (piece.gid !== null) {
                trackGid(fontRef, piece.gid);
                const gw = fd.widths[piece.gid] !== undefined ? fd.widths[piece.gid] : fd.defaultWidth;
                result.push({
                    text: piece.text, fontRef, fontData: fd, shaped: null,
                    hexStr: `<${piece.gid.toString(16).toUpperCase().padStart(4, '0')}>`,
                    widthPt: gw * sz / upm,
                });
            } else {
                result.push(...buildTextRunsCore(piece.text, fontRef, fd, sz, trackGid, pdfA));
            }
        }
        return result;
    }
    return buildTextRunsCore(text, fontRef, fd, sz, trackGid, pdfA);
}

function buildTextRunsCore(
    text: string,
    fontRef: string,
    fd: FontData,
    sz: number,
    trackGid: (ref: string, gid: number, cp?: number) => void,
    pdfA: boolean = false,
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
        // Skip C0 control characters (incl. \n \r \t) and DEL. They are layout
        // separators consumed by the wrapping layer and must never reach the
        // subset cmap lookup, where they resolve to .notdef (gid 0) and render
        // as tofu (□) in CID-keyed fonts under PDF/A (Helvetica fallback is
        // disabled). (#58)
        if (rawCp < 0x20 || rawCp === 0x7F) { i += charLen; continue; }
        const cp = spaceCodepoint(fd, rawCp);
        const char = text.substring(i, i + charLen);
        const gid = fd.cmap[cp] ?? 0;

        if (gid === 0 && isWinAnsi(cp) && !pdfA) {
            // No CIDFont glyph, but WinAnsi-encodable → Helvetica fallback
            // Disabled under PDF/A (unembedded standard-14 fonts forbidden).
            if (mode === 'cid') flushCid();
            mode = 'hel';
            helChars += char;
        } else if (mode === 'hel' && isWinAnsi(cp) && !pdfA) {
            // Stay in Helvetica for WinAnsi chars (avoids font-switching on spaces
            // between Latin words when the CIDFont happens to cover space)
            helChars += char;
        } else {
            if (mode === 'hel') flushHel();
            mode = 'cid';
            cidChars += char;
            trackGid(fontRef, gid, cp);
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
 * @param pdfA - When true and at least one font entry is registered, disables
 *   WinAnsi/Helvetica fallback in mixed-content runs (Helvetica is unembedded
 *   standard-14, forbidden by ISO 19005). When pdfA is true with no fontEntries,
 *   Latin mode is used as before — strict PDF/A conformance requires the caller
 *   to register a Latin font (e.g. Noto Sans VF).
 */
export function createEncodingContext(
    fontEntries: FontEntry[],
    pdfA: boolean = false,
    normalize: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | false = false,
    metrics: Base14Metrics = 'approximate',
    lang?: string,
): EncodingContext {
    // Optional Unicode normalization applied at every text entry point. Off by
    // default so output stays byte-identical; opt in via `layout.normalize`.
    // Uses the native `String.prototype.normalize` (zero dependency).
    const _norm = normalize ? (s: string): string => s.normalize(normalize) : (s: string): string => s;

    // Base-14 measurement. 'exact' reads the Adobe Core 14 AFM advances;
    // 'approximate' keeps the historical bucketed estimate so output is
    // byte-identical by default (see fonts/base14-metrics.ts).
    // The AFM table is indexed by WinAnsi byte; soft hyphens and bidi controls
    // are invisible and must be stripped first, as helveticaWidth does itself.
    const latinWidth = metrics === 'exact'
        ? (s: string, sz: number): number => exactBase14Width(toWinAnsi(stripSoftHyphens(stripBidiControls(s))), sz, false) - narrowNoBreakSpaceCorrection(s, sz)
        : helveticaWidth;

    if (!fontEntries || fontEntries.length === 0) {
        return {
            isUnicode: false,
            fontEntries: [],
            metrics,
            lang,
            ps: normalize ? (s: string): string => pdfString(_norm(s)) : pdfString,
            tw: normalize ? (s: string, sz: number): number => latinWidth(_norm(s), sz) : latinWidth,
            textRuns: () => [],
            f1: '/F1',
            f2: '/F2'
        };
    }

    const primary = fontEntries[0];

    // Track used glyph IDs per font for subsetting
    const _usedGids = new Map<string, Set<number>>();
    for (const fe of fontEntries) _usedGids.set(fe.fontRef, new Set());

    // The code point the text encoded for each glyph reached through the
    // cmap, per font — what names the glyph in ToUnicode before any
    // inference (1.9.0, #84). First evidence wins.
    const _encoded = new Map<string, Map<number, number>>();
    function _trackGid(fontRef: string, gid: number, cp?: number): void {
        const s = _usedGids.get(fontRef);
        if (s) s.add(gid);
        if (cp !== undefined) {
            let m = _encoded.get(fontRef);
            if (!m) { m = new Map(); _encoded.set(fontRef, m); }
            if (!m.has(gid)) m.set(gid, cp);
        }
    }

    // Glyphs produced by an OpenType substitution have no cmap entry, so
    // ToUnicode must be told which character they stand for. Filled by the
    // feature-derived context (see withFeatureSupport) and by the shapers
    // that report source code points (a conjunct names every letter it
    // fused, v1.8.0); empty otherwise.
    const _toUnicodeOverrides = new Map<string, Map<number, number | readonly number[]>>();
    function _onShapedGlyph(fontRef: string, gid: number, cps: readonly number[]): void {
        let m = _toUnicodeOverrides.get(fontRef);
        if (!m) { m = new Map(); _toUnicodeOverrides.set(fontRef, m); }
        if (!m.has(gid)) m.set(gid, cps.length === 1 ? cps[0] : [...cps]);
    }
    const _inverseCmaps = new WeakMap<FontData, Map<number, number>>();
    function _codepointOf(fd: FontData, gid: number): number | undefined {
        let inv = _inverseCmaps.get(fd);
        if (!inv) {
            inv = new Map();
            for (const [cp, g] of Object.entries(fd.cmap)) {
                const cpNum = Number(cp);
                const prev = inv.get(g);
                inv.set(g, prev === undefined ? cpNum : preferredCodepoint(prev, cpNum));
            }
            _inverseCmaps.set(fd, inv);
        }
        return inv.get(gid);
    }
    function _onSubstitute(fontRef: string, fromGid: number, toGid: number, fd: FontData): void {
        _trackGid(fontRef, toGid);
        const cp = _codepointOf(fd, fromGid);
        if (cp === undefined) return;
        let m = _toUnicodeOverrides.get(fontRef);
        if (!m) { m = new Map(); _toUnicodeOverrides.set(fontRef, m); }
        if (!m.has(toGid)) m.set(toGid, cp);
    }

    // Colour-emoji collector: activated only when a registered font carries a
    // COLR/CPAL `colorGlyphs` table (the opt-in `'emoji-color'` font). When no
    // such font is present this stays undefined and the builders are unchanged.
    const _colorEmoji = fontEntries.some((fe) => fe.fontData.colorGlyphs)
        ? createColorEmojiCollector()
        : undefined;

    const ctx: EncodingContext = {
        isUnicode: true,
        fontEntries,
        metrics,
        lang,
        fontData: primary.fontData,
        f1: primary.fontRef,
        f2: primary.fontRef,
        getUsedGids() { return _usedGids; },
        getToUnicodeOverrides() { return _toUnicodeOverrides; },
        getToUnicodeEncoded() { return _encoded; },
        colorEmoji: _colorEmoji,

        textRuns(str: string, sz: number): TextRun[] {
            return runsOf(str, sz, resolvePerLine);
        },

        ps(str: string): string {
            return psOf(str, resolvePerLine);
        },

        tw(str: string, sz: number): number {
            if (!str) return 0;
            const runs = this.textRuns(str, sz);
            let total = 0;
            for (const run of runs) total += run.widthPt;
            return total;
        },

        withParagraph(text: string, direction?: TextDirection): EncodingContext {
            const para = _norm(text);
            // Nothing right-to-left anywhere and no forced RTL base: every line
            // resolves to its logical order — the undirected context serves.
            if (direction !== 'rtl' && !containsRTL(para)) return ctx;
            const { paraLevel, levels } = resolveBidiLevels(para, direction ?? 'auto');
            let cursor = 0;
            let lastAt = -1;
            const resolve = (line: string): BidiRun[] | null => {
                // In an LTR paragraph a line without right-to-left characters
                // keeps its logical order; in an RTL paragraph even a Latin-only
                // line carries the paragraph level (its neutrals, its alignment).
                if (paraLevel === 0 && !containsRTL(line)) return null;
                let at = lastAt >= 0 && para.startsWith(line, lastAt) ? lastAt : para.indexOf(line, cursor);
                if (at === -1) at = para.indexOf(line);
                // A line the wrapper rewrote (a materialised hyphen, a dropped
                // soft hyphen) is no substring of the paragraph: resolve it alone.
                if (at === -1) return resolveBidiRuns(line);
                lastAt = at;
                cursor = at + line.length;
                return bidiRunsForLine(line, levels.slice(at, cursor), paraLevel);
            };
            const derived: EncodingContext = {
                ...ctx,
                paragraphLevel: paraLevel,
                textRuns: (str: string, sz: number) => runsOf(str, sz, resolve),
                ps: (str: string) => psOf(str, resolve),
                tw(str: string, sz: number): number {
                    if (!str) return 0;
                    let total = 0;
                    for (const run of derived.textRuns(str, sz)) total += run.widthPt;
                    return total;
                },
            };
            return derived;
        },
    };

    /** Per-line resolution: the text is its own paragraph (UAX #9 P1 on one line). */
    function resolvePerLine(str: string): BidiRun[] | null {
        return containsRTL(str) ? resolveBidiRuns(str) : null;
    }

    /**
     * The runs of one line. The resolver sees the text with its directional
     * formatting characters (they steer the algorithm) and leaves them out of
     * the runs; soft hyphens are conditional and vanish here — the line
     * breaker materialised a real hyphen wherever it broke (Unicode §23.2).
     */
    function runsOf(str: string, sz: number, resolve: (line: string) => BidiRun[] | null): TextRun[] {
        if (!str) return [];
        str = _norm(str);
        const bidiRuns = resolve(str);
        if (bidiRuns !== null) {
            const result: TextRun[] = [];
            for (const bRun of bidiRuns) {
                const runText = stripSoftHyphens(bRun.text);
                if (!runText) continue;
                const isRTL = bRun.level % 2 === 1;
                const fontRuns = splitTextByFont(runText, fontEntries);
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
                                    if (g.cps && g.cps.length > 0) _onShapedGlyph(fontRef, g.gid, g.cps);
                                    if (!g.isZeroAdvance) {
                                        designW += fd.widths[g.gid] !== undefined ? fd.widths[g.gid] : fd.defaultWidth;
                                    }
                                }
                                result.push({ text: seg.text, fontRef, fontData: fd, shaped: visual, hexStr: null, widthPt: designW * sz / upm });
                            } else {
                                // Non-Arabic segment: use Helvetica fallback
                                result.push(...buildTextRunsWithFallback(seg.text, fontRef, fd, sz, _trackGid, pdfA));
                            }
                        }
                    } else if (isRTL) {
                        // RTL non-Arabic (Hebrew etc.): text already reversed by BiDi.
                        // Use fallback helper to handle Latin chars not covered by CIDFont.
                        result.push(...buildTextRunsWithFallback(fRun.text, fontRef, fd, sz, _trackGid, pdfA));
                    } else {
                        // LTR run: standard path
                        const shaper = findShaper(fRun.text);
                        if (shaper) {
                            result.push(shapedRun(fRun.text, shaper, fontRef, fd, sz, _trackGid, _onShapedGlyph));
                        } else {
                            result.push(...buildTextRunsWithFallback(fRun.text, fontRef, fd, sz, _trackGid, pdfA));
                        }
                    }
                }
            }
            return result;
        }

        // ── LTR path ─────────────────────────────────────────────────
        // A directional formatting character left here has no glyph in any
        // font and would reach the cmap as .notdef.
        str = stripSoftHyphens(stripBidiControls(str));
        if (!str) return [];
        const rawRuns = splitTextByFont(str, fontEntries);
        return rawRuns.flatMap(run => {
            const fd = run.entry.fontData;
            const fontRef = run.entry.fontRef;

            const shaper = findShaper(run.text);
            if (shaper) return [shapedRun(run.text, shaper, fontRef, fd, sz, _trackGid, _onShapedGlyph)];

            return buildTextRunsWithFallback(run.text, fontRef, fd, sz, _trackGid, pdfA);
        });
    }

    /** Single-font hex string of one line (the table builder's path). */
    function psOf(str: string, resolve: (line: string) => BidiRun[] | null): string {
        if (!str) return '<>';
        str = _norm(str);
        const { cmap } = primary.fontData;

        const bidiRuns = resolve(str);
        if (bidiRuns !== null) {
            let hex = '';
            for (const bRun of bidiRuns) {
                const runText = stripSoftHyphens(bRun.text);
                if (!runText) continue;
                const isRTL = bRun.level % 2 === 1;
                if (isRTL && containsArabic(runText)) {
                    const logical = reverseString(runText);
                    const shaped = shapeArabicText(logical, primary.fontData);
                    for (let i = shaped.length - 1; i >= 0; i--) {
                        const g = shaped[i];
                        _trackGid(primary.fontRef, g.gid);
                        if (g.cps && g.cps.length > 0) _onShapedGlyph(primary.fontRef, g.gid, g.cps);
                        hex += g.gid.toString(16).padStart(4, '0');
                    }
                } else {
                    for (let i = 0; i < runText.length; i++) {
                        const rawCp = runText.codePointAt(i) ?? 0;
                        if (rawCp > 0xFFFF) i++;
                        const cp = spaceCodepoint(primary.fontData, rawCp);
                        const gid = cmap[cp] || 0;
                        _trackGid(primary.fontRef, gid, cp);
                        hex += gid.toString(16).padStart(4, '0');
                    }
                }
            }
            return `<${hex.toUpperCase()}>`;
        }

        str = stripSoftHyphens(stripBidiControls(str));
        if (!str) return '<>';
        const shaper = findShaper(str);
        if (!shaper) {
            let hex = '';
            for (let i = 0; i < str.length; i++) {
                const rawCp = str.codePointAt(i) ?? 0;
                if (rawCp > 0xFFFF) i++;
                const cp = spaceCodepoint(primary.fontData, rawCp);
                const gid = cmap[cp] || 0;
                _trackGid(primary.fontRef, gid, cp);
                hex += gid.toString(16).padStart(4, '0');
            }
            return `<${hex.toUpperCase()}>`;
        }
        // Shaped text path: the registry's first match. Every glyph reports
        // its code points so the ToUnicode CMap covers it.
        const shaped = shaper.shape(str, primary.fontData);
        let hex = '';
        for (const g of shaped) {
            _trackGid(primary.fontRef, g.gid);
            if (g.cps && g.cps.length > 0) _onShapedGlyph(primary.fontRef, g.gid, g.cps);
            hex += g.gid.toString(16).padStart(4, '0');
        }
        return `<${hex.toUpperCase()}>`;
    }

    return withFeatureSupport(ctx, _onSubstitute);
}

/**
 * Apply a document's configured OpenType features to its encoding context.
 *
 * A no-op when no tags are configured, when the context has no registered
 * font (the base-14 faces carry no OpenType tables), or when no font in play
 * declares any of the tags.
 *
 * @since 1.8.0
 */
export function applyDocumentFeatures(
    enc: EncodingContext,
    tags: readonly string[] | undefined,
): EncodingContext {
    if (!tags || tags.length === 0 || !enc.withFeatures) return enc;
    return enc.withFeatures(tags);
}

/**
 * Derive a context that applies the fonts' pair kerning.
 *
 * A no-op without a registered font, or when no font in play carries a pair
 * table — the base-14 faces have no OpenType data at all.
 *
 * @since 1.8.0
 */
export function applyDocumentKerning(enc: EncodingContext, on: boolean | undefined): EncodingContext {
    if (on !== true || !enc.isUnicode) return enc;
    if (!enc.fontEntries.some(fe => fe.fontData.kern)) return enc;

    const baseParagraph = enc.withParagraph;
    const kerned: EncodingContext = {
        ...enc,
        textRuns: (str: string, sz: number) => applyKerningToRuns(enc.textRuns(str, sz), sz),
        tw(str: string, sz: number): number {
            if (!str) return 0;
            let total = 0;
            for (const run of kerned.textRuns(str, sz)) total += run.widthPt;
            return total;
        },
        // A paragraph context derived from the kerned context kerns too.
        withParagraph: baseParagraph === undefined
            ? undefined
            : (text: string, direction?: TextDirection): EncodingContext => {
                const para = baseParagraph(text, direction);
                return para === enc ? kerned : applyDocumentKerning(para, true);
            },
    };
    return kerned;
}

/**
 * Attach `withFeatures()` to a Unicode context.
 *
 * The derived context substitutes glyphs on the way out of `textRuns()`, so
 * every caller — measurement, wrapping and emission alike — sees the same
 * substituted glyphs without a single signature change. `ps()` is left
 * alone: it serves the shaped and single-font hex paths, where a shaper has
 * already chosen contextual forms that must not be overwritten.
 *
 * `onSubstitute` receives every glyph the features introduce, so the
 * substituted glyphs join the subset, the `/W` array and the ToUnicode map
 * exactly as cmap-reached glyphs do. Without it the emitted CIDs would name
 * glyphs the subsetter dropped — blank on the page, `/DW` for the advance,
 * U+FFFD on extraction.
 */
function withFeatureSupport(
    base: EncodingContext,
    onSubstitute: (fontRef: string, fromGid: number, toGid: number, fd: FontData) => void,
): EncodingContext {
    const baseParagraph = base.withParagraph;
    function derive(tags: readonly string[]): EncodingContext {
        // Nothing to do when no font in play declares any of the tags. Return
        // the wrapper, not `base`, so callers can compare by identity to see
        // that nothing changed.
        const applies = base.fontEntries.some(fe => composeFeatureMap(fe.fontData, tags) !== null);
        if (!applies) return wrapper;

        // Substitutions per tag, so a tag that asks for what the font already
        // does by default can be reported instead of silently doing nothing.
        const usage = new Map<string, number>(tags.map(t => [t, 0]));
        const track = (fontRef: string, fromGid: number, toGid: number, fd: FontData): void => {
            onSubstitute(fontRef, fromGid, toGid, fd);
            for (const tag of tags) {
                if (fd.features?.[tag]?.[fromGid] === toGid) usage.set(tag, (usage.get(tag) ?? 0) + 1);
            }
        };

        const derived: EncodingContext = {
            ...base,
            textRuns: (str: string, sz: number) => applyFeaturesToRuns(base.textRuns(str, sz), tags, sz, track),
            tw(str: string, sz: number): number {
                if (!str) return 0;
                let total = 0;
                for (const run of derived.textRuns(str, sz)) total += run.widthPt;
                return total;
            },
            getFeatureUsage: () => usage,
            // Deriving again replaces the feature set rather than stacking it.
            withFeatures: derive,
            // A paragraph context derived here applies the same features and
            // reports into the same usage counters.
            withParagraph: baseParagraph === undefined
                ? undefined
                : (text: string, direction?: TextDirection): EncodingContext => {
                    const para = baseParagraph(text, direction);
                    if (para === base) return derived;
                    const featured: EncodingContext = {
                        ...para,
                        textRuns: (str: string, sz: number) => applyFeaturesToRuns(para.textRuns(str, sz), tags, sz, track),
                        tw(str: string, sz: number): number {
                            if (!str) return 0;
                            let total = 0;
                            for (const run of featured.textRuns(str, sz)) total += run.widthPt;
                            return total;
                        },
                        getFeatureUsage: () => usage,
                        withFeatures: derive,
                    };
                    return featured;
                },
        };
        return derived;
    }

    const wrapper: EncodingContext = {
        ...base,
        withFeatures: derive,
        // The wrapper is the context callers hold: a paragraph that needs no
        // resolution must come back as the wrapper itself, by identity.
        withParagraph: baseParagraph === undefined
            ? undefined
            : (text: string, direction?: TextDirection): EncodingContext => {
                const para = baseParagraph(text, direction);
                return para === base ? wrapper : para;
            },
    };
    return wrapper;
}
