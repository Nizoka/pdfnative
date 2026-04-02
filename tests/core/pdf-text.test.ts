import { describe, it, expect } from 'vitest';
import { txt, txtR, txtC, txtShaped, txtTagged, txtRTagged, txtCTagged, fmtNum } from '../../src/core/pdf-text.js';
import { createEncodingContext } from '../../src/fonts/encoding.js';
import type { FontData, ShapedGlyph } from '../../src/types/pdf-types.js';

describe('fmtNum', () => {
    it('should format integer as 2 decimal places', () => {
        expect(fmtNum(10)).toBe('10.00');
    });

    it('should format float to 2 decimals', () => {
        expect(fmtNum(3.14159)).toBe('3.14');
    });

    it('should format zero', () => {
        expect(fmtNum(0)).toBe('0.00');
    });

    it('should format negative numbers', () => {
        expect(fmtNum(-5.5)).toBe('-5.50');
    });
});

describe('txt (Latin mode)', () => {
    const enc = createEncodingContext([]);

    it('should produce BT...ET block with font and position', () => {
        const result = txt('Hello', 100, 200, '/F1', 12, enc);
        expect(result).toContain('BT');
        expect(result).toContain('/F1 12 Tf');
        expect(result).toContain('100.00 200.00 Td');
        expect(result).toContain('ET');
    });

    it('should encode string as WinAnsi PDF literal', () => {
        const result = txt('Test', 0, 0, '/F1', 10, enc);
        expect(result).toContain('(Test)');
        expect(result).toContain('Tj');
    });

    it('should escape parentheses in text', () => {
        const result = txt('(hello)', 0, 0, '/F1', 10, enc);
        expect(result).toContain('\\(hello\\)');
    });

    it('should escape backslash in text', () => {
        const result = txt('path\\to', 0, 0, '/F1', 10, enc);
        expect(result).toContain('path\\\\to');
    });
});

describe('txtR (right-aligned, Latin mode)', () => {
    const enc = createEncodingContext([]);

    it('should position text left of the right boundary', () => {
        const result = txtR('ABC', 500, 200, '/F1', 10, enc);
        expect(result).toContain('BT');
        expect(result).toContain('Td');
        // The X coordinate should be less than 500 (shifted left by text width)
        const match = result.match(/([\d.]+) 200\.00 Td/);
        expect(match).not.toBeNull();
        expect(parseFloat(match![1])).toBeLessThan(500);
    });
});

describe('txtC (center-aligned, Latin mode)', () => {
    const enc = createEncodingContext([]);

    it('should center text within column width', () => {
        const result = txtC('Hi', 100, 200, '/F1', 10, 200, enc);
        expect(result).toContain('BT');
        // X should be between 100 and 300 (centered in 200pt column)
        const match = result.match(/([\d.]+) 200\.00 Td/);
        expect(match).not.toBeNull();
        const x = parseFloat(match![1]);
        expect(x).toBeGreaterThan(100);
        expect(x).toBeLessThan(300);
    });
});

describe('txtShaped', () => {
    const mockFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: { 65: 1 },
        defaultWidth: 500,
        widths: { 1: 600, 2: 0 },
        pdfWidthArray: '1 [600]',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };

    it('should render shaped glyphs with individual BT/ET blocks', () => {
        const glyphs: ShapedGlyph[] = [
            { gid: 1, dx: 0, dy: 0, isZeroAdvance: false },
        ];
        const result = txtShaped(glyphs, 100, 200, '/F3', 10, mockFontData);
        expect(result).toContain('BT /F3 10 Tf');
        expect(result).toContain('<0001>');
        expect(result).toContain('Tj ET');
    });

    it('should handle zero-advance marks', () => {
        const glyphs: ShapedGlyph[] = [
            { gid: 1, dx: 0, dy: 0, isZeroAdvance: false },
            { gid: 2, dx: 10, dy: 20, isZeroAdvance: true },
        ];
        const result = txtShaped(glyphs, 100, 200, '/F3', 10, mockFontData);
        const blocks = result.split('\n');
        expect(blocks).toHaveLength(2);
    });

    it('should apply dx/dy offsets to mark positioning', () => {
        const glyphs: ShapedGlyph[] = [
            { gid: 1, dx: 0, dy: 0, isZeroAdvance: false },
            { gid: 2, dx: 50, dy: 100, isZeroAdvance: true },
        ];
        const result = txtShaped(glyphs, 100, 200, '/F3', 10, mockFontData);
        // Second glyph should have offset from pen position + dx*scale
        expect(result).toContain('<0002>');
    });

    it('should advance pen position for base glyphs', () => {
        const glyphs: ShapedGlyph[] = [
            { gid: 1, dx: 0, dy: 0, isZeroAdvance: false },  // advance = 600 * 10/1000 = 6
            { gid: 1, dx: 0, dy: 0, isZeroAdvance: false },  // second base
        ];
        const result = txtShaped(glyphs, 100, 200, '/F3', 10, mockFontData);
        const blocks = result.split('\n');
        expect(blocks).toHaveLength(2);
        // First at x=100, second at x=106
        expect(blocks[0]).toContain('100.00');
        expect(blocks[1]).toContain('106.00');
    });

    it('should use defaultWidth for unmapped glyphs', () => {
        const glyphs: ShapedGlyph[] = [
            { gid: 99, dx: 0, dy: 0, isZeroAdvance: false }, // not in widths → defaultWidth=500
        ];
        const result = txtShaped(glyphs, 100, 200, '/F3', 10, mockFontData);
        expect(result).toContain('<0063>'); // 99 in hex
    });

    it('should handle empty shaped array', () => {
        const result = txtShaped([], 100, 200, '/F3', 10, mockFontData);
        expect(result).toBe('');
    });
});

describe('txt (Unicode mode)', () => {
    const mockFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: { 65: 1, 66: 2, 32: 3 },
        defaultWidth: 500,
        widths: { 1: 600, 2: 700, 3: 250 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [{ fontData: mockFontData, fontRef: '/F3', lang: 'test' }];

    it('should produce hex-encoded text in Unicode mode', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txt('AB', 100, 200, '/F3', 10, enc);
        expect(result).toContain('/F3 10 Tf');
        expect(result).toContain('<00010002>');
        expect(result).toContain('Tj ET');
    });

    it('should return empty string for empty text runs', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txt('', 100, 200, '/F3', 10, enc);
        expect(result).toBe('');
    });

    it('should handle single-run Unicode text', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txt('A', 100, 200, '/F3', 10, enc);
        expect(result).toContain('<0001>');
    });
});

describe('txtR (Unicode mode)', () => {
    const mockFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: { 65: 1, 32: 3 },
        defaultWidth: 500,
        widths: { 1: 600, 3: 250 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [{ fontData: mockFontData, fontRef: '/F3', lang: 'test' }];

    it('should right-align using Unicode width calculation', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txtR('A', 500, 200, '/F3', 10, enc);
        expect(result).toContain('<0001>');
        // X should be 500 - (600 * 10/1000) = 494
        expect(result).toContain('494.00');
    });
});

describe('txtC (Unicode mode)', () => {
    const mockFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: { 65: 1, 32: 3 },
        defaultWidth: 500,
        widths: { 1: 600, 3: 250 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [{ fontData: mockFontData, fontRef: '/F3', lang: 'test' }];

    it('should center-align using Unicode width calculation', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txtC('A', 100, 200, '/F3', 10, 200, enc);
        expect(result).toContain('<0001>');
        // width = 600 * 10/1000 = 6, center = 100 + (200 - 6) / 2 = 197
        expect(result).toContain('197.00');
    });
});

describe('txt (multi-run: mixed Latin + Thai)', () => {
    const latinFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'Latin',
        cmap: { 65: 1, 66: 2, 32: 3 },
        defaultWidth: 500,
        widths: { 1: 600, 2: 700, 3: 250 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const thaiFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 20, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'Thai',
        cmap: { 0x0E01: 10, 0x0E02: 11 },
        defaultWidth: 500,
        widths: { 10: 600, 11: 600 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [
        { fontData: latinFontData, fontRef: '/F3', lang: 'en' },
        { fontData: thaiFontData, fontRef: '/F4', lang: 'th' },
    ];

    it('should produce multiple BT/ET blocks for multi-run text', () => {
        const enc = createEncodingContext(fontEntries);
        // "A" → font1, "ก" → font2 (Thai, shaped)
        const result = txt('A\u0E01', 100, 200, '/F3', 10, enc);
        // Should contain both hex and shaped output
        expect(result).toContain('/F3');
        expect(result).toContain('/F4');
        expect(result.split('\n').length).toBeGreaterThan(1);
    });

    it('should advance pen position between runs', () => {
        const enc = createEncodingContext(fontEntries);
        // "AB" (hex, width=13pt) then "กข" (shaped)
        const result = txt('AB\u0E01\u0E02', 100, 200, '/F3', 10, enc);
        expect(result).toContain('/F3');
        expect(result).toContain('/F4');
    });
});

describe('txt (single-run shaped: Thai only)', () => {
    const thaiFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 20, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'Thai',
        cmap: { 0x0E01: 10, 0x0E02: 11 },
        defaultWidth: 500,
        widths: { 10: 600, 11: 600 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [{ fontData: thaiFontData, fontRef: '/F4', lang: 'th' }];

    it('should render shaped glyphs for Thai-only text', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txt('\u0E01\u0E02', 100, 200, '/F4', 10, enc);
        // Shaped = individual BT/ET per glyph
        expect(result).toContain('/F4 10 Tf');
        expect(result.split('\n').length).toBeGreaterThanOrEqual(2);
    });
});

// ── Tagged Text Tests ────────────────────────────────────────────────

describe('txtTagged (Latin mode)', () => {
    const enc = createEncodingContext([]);

    it('should wrap text in /Span BDC...EMC with /ActualText', () => {
        const result = txtTagged('Hello', 100, 200, '/F1', 12, enc, 0);
        expect(result).toContain('/Span');
        expect(result).toContain('/MCID 0');
        expect(result).toContain('/ActualText');
        expect(result).toContain('BDC');
        expect(result).toContain('EMC');
        expect(result).toContain('BT /F1 12 Tf');
    });

    it('should encode ActualText as UTF-16BE hex', () => {
        const result = txtTagged('AB', 0, 0, '/F1', 10, enc, 5);
        expect(result).toContain('/MCID 5');
        expect(result).toContain('<FEFF00410042>'); // UTF-16BE "AB"
    });
});

describe('txtRTagged', () => {
    const enc = createEncodingContext([]);

    it('should produce right-aligned tagged text', () => {
        const result = txtRTagged('Test', 500, 200, '/F1', 10, enc, 3);
        expect(result).toContain('/Span');
        expect(result).toContain('/MCID 3');
        expect(result).toContain('BDC');
        expect(result).toContain('EMC');
    });
});

describe('txtCTagged', () => {
    const enc = createEncodingContext([]);

    it('should produce center-aligned tagged text', () => {
        const result = txtCTagged('Center', 100, 200, '/F1', 10, 200, enc, 7);
        expect(result).toContain('/Span');
        expect(result).toContain('/MCID 7');
        expect(result).toContain('BDC');
        expect(result).toContain('EMC');
    });
});

describe('txtTagged (Unicode mode)', () => {
    const mockFontData: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: { 65: 1, 66: 2 },
        defaultWidth: 500,
        widths: { 1: 600, 2: 700 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
    const fontEntries = [{ fontData: mockFontData, fontRef: '/F3', lang: 'test' }];

    it('should wrap Unicode hex text in marked content', () => {
        const enc = createEncodingContext(fontEntries);
        const result = txtTagged('AB', 100, 200, '/F3', 10, enc, 0);
        expect(result).toContain('/Span');
        expect(result).toContain('/ActualText');
        expect(result).toContain('<00010002>'); // hex glyph IDs
        expect(result).toContain('BDC');
        expect(result).toContain('EMC');
    });
});
