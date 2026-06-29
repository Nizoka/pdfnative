/**
 * Tests for validateFontData() — the opt-in structural sanity check for
 * custom font-data modules (v1.4.0).
 *
 * Verifies a real bundled font passes, and that each common corruption mode
 * (non-object, missing metrics, empty cmap, out-of-range glyph ids, bad
 * pdfWidthArray, malformed base64, non-SFNT magic) is reported.
 */

import { describe, it, expect } from 'vitest';
import { validateFontData } from '../../src/fonts/font-validator.js';
import * as notoSans from '../../fonts/noto-sans-data.js';

// A valid plain FontData built from the trusted bundled module.
const VALID = {
    metrics: notoSans.metrics,
    fontName: notoSans.fontName,
    cmap: notoSans.cmap,
    defaultWidth: notoSans.defaultWidth,
    widths: notoSans.widths,
    pdfWidthArray: notoSans.pdfWidthArray,
    ttfBase64: notoSans.ttfBase64,
    gsub: notoSans.gsub,
};

describe('validateFontData', () => {
    it('accepts a real bundled font', () => {
        const r = validateFontData(VALID);
        expect(r.valid).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateFontData(null).valid).toBe(false);
        expect(validateFontData(42).valid).toBe(false);
        expect(validateFontData('font').errors[0]).toMatch(/non-null object/);
    });

    it('reports missing metrics', () => {
        const r = validateFontData({ ...VALID, metrics: undefined });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /metrics/.test(e))).toBe(true);
    });

    it('reports non-finite metric fields', () => {
        const r = validateFontData({ ...VALID, metrics: { ...notoSans.metrics, ascent: NaN } });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /metrics\.ascent/.test(e))).toBe(true);
    });

    it('reports an empty fontName', () => {
        const r = validateFontData({ ...VALID, fontName: '' });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /fontName/.test(e))).toBe(true);
    });

    it('reports an empty cmap', () => {
        const r = validateFontData({ ...VALID, cmap: {} });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /cmap.*empty/.test(e))).toBe(true);
    });

    it('reports out-of-range glyph ids', () => {
        const r = validateFontData({ ...VALID, cmap: { 0x41: 999999999 } });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /out-of-range glyph id/.test(e))).toBe(true);
    });

    it('reports a bad pdfWidthArray', () => {
        const r = validateFontData({ ...VALID, pdfWidthArray: '' });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /pdfWidthArray/.test(e))).toBe(true);
    });

    it('reports a malformed base64 ttf payload', () => {
        const r = validateFontData({ ...VALID, ttfBase64: 'not valid base64 @@@' });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /not valid base64/.test(e))).toBe(true);
    });

    it('reports a non-SFNT binary', () => {
        // 'AAAAAA==' decodes to 0x00 0x00 0x00 0x00 — not a known SFNT magic.
        const r = validateFontData({ ...VALID, ttfBase64: 'AAAAAA==' });
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => /not an SFNT/.test(e))).toBe(true);
    });

    it('does not throw on arbitrary malformed input (reports instead)', () => {
        expect(() => validateFontData({ metrics: 5, cmap: [], widths: null })).not.toThrow();
    });
});
