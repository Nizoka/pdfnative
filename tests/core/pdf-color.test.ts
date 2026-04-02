/**
 * Unit tests for pdf-color — color parsing, validation & normalization.
 */

import { describe, it, expect } from 'vitest';
import { parseColor, isValidPdfRgb, normalizeColors } from '../../src/core/pdf-color.js';
import type { PdfColors } from '../../src/types/pdf-types.js';

// ── parseColor — hex ─────────────────────────────────────────────────

describe('parseColor', () => {
    describe('hex colors (#RRGGBB)', () => {
        it('should parse #000000 as black', () => {
            expect(parseColor('#000000')).toBe('0 0 0');
        });

        it('should parse #FFFFFF as white', () => {
            expect(parseColor('#FFFFFF')).toBe('1 1 1');
        });

        it('should parse #2563EB (brand blue)', () => {
            expect(parseColor('#2563EB')).toBe('0.145 0.388 0.922');
        });

        it('should parse #ff0000 as red (case-insensitive)', () => {
            expect(parseColor('#ff0000')).toBe('1 0 0');
        });

        it('should parse #00FF00 as green', () => {
            expect(parseColor('#00FF00')).toBe('0 1 0');
        });

        it('should parse #0000FF as blue', () => {
            expect(parseColor('#0000FF')).toBe('0 0 1');
        });

        it('should parse mid-gray #808080', () => {
            expect(parseColor('#808080')).toBe('0.502 0.502 0.502');
        });
    });

    describe('hex colors (#RGB shorthand)', () => {
        it('should parse #000 as black', () => {
            expect(parseColor('#000')).toBe('0 0 0');
        });

        it('should parse #FFF as white', () => {
            expect(parseColor('#FFF')).toBe('1 1 1');
        });

        it('should parse #F00 as red', () => {
            expect(parseColor('#F00')).toBe('1 0 0');
        });

        it('should parse #26E (shorthand blue)', () => {
            expect(parseColor('#26E')).toBe('0.133 0.4 0.933');
        });

        it('should parse lowercase #abc', () => {
            expect(parseColor('#abc')).toBe('0.667 0.733 0.8');
        });
    });

    describe('RGB tuples [r, g, b]', () => {
        it('should parse [0, 0, 0] as black', () => {
            expect(parseColor([0, 0, 0])).toBe('0 0 0');
        });

        it('should parse [255, 255, 255] as white', () => {
            expect(parseColor([255, 255, 255])).toBe('1 1 1');
        });

        it('should parse [37, 99, 235] as brand blue', () => {
            expect(parseColor([37, 99, 235])).toBe('0.145 0.388 0.922');
        });

        it('should parse [128, 128, 128] as mid-gray', () => {
            expect(parseColor([128, 128, 128])).toBe('0.502 0.502 0.502');
        });

        it('should parse boundary [0, 255, 0]', () => {
            expect(parseColor([0, 255, 0])).toBe('0 1 0');
        });
    });

    describe('PDF operator strings', () => {
        it('should pass through "0 0 0"', () => {
            expect(parseColor('0 0 0')).toBe('0 0 0');
        });

        it('should pass through "1 1 1"', () => {
            expect(parseColor('1 1 1')).toBe('1 1 1');
        });

        it('should pass through "0.145 0.388 0.922"', () => {
            expect(parseColor('0.145 0.388 0.922')).toBe('0.145 0.388 0.922');
        });

        it('should pass through integer values "0 1 0"', () => {
            expect(parseColor('0 1 0')).toBe('0 1 0');
        });
    });

    describe('error cases', () => {
        it('should reject empty string', () => {
            expect(() => parseColor('' as never)).toThrow('Invalid color format');
        });

        it('should reject invalid hex (5 chars)', () => {
            expect(() => parseColor('#12345' as never)).toThrow('Invalid');
        });

        it('should reject hex without #', () => {
            expect(() => parseColor('2563EB' as never)).toThrow('Invalid');
        });

        it('should reject tuple with 2 values', () => {
            expect(() => parseColor([1, 2] as never)).toThrow('expected [r, g, b]');
        });

        it('should reject tuple with 4 values', () => {
            expect(() => parseColor([1, 2, 3, 4] as never)).toThrow('expected [r, g, b]');
        });

        it('should reject tuple with value > 255', () => {
            expect(() => parseColor([0, 0, 256] as never)).toThrow('Expected a number 0–255');
        });

        it('should reject tuple with negative value', () => {
            expect(() => parseColor([0, -1, 0] as never)).toThrow('Expected a number 0–255');
        });

        it('should reject tuple with NaN', () => {
            expect(() => parseColor([0, NaN, 0] as never)).toThrow('Expected a number 0–255');
        });

        it('should reject tuple with Infinity', () => {
            expect(() => parseColor([0, Infinity, 0] as never)).toThrow('Expected a number 0–255');
        });

        it('should reject PDF string with value > 1', () => {
            expect(() => parseColor('0 1.5 0' as never)).toThrow('must be 0.0–1.0');
        });

        it('should reject PDF string with negative value', () => {
            expect(() => parseColor('-0.1 0 0' as never)).toThrow('Invalid color format');
        });

        it('should reject number input', () => {
            expect(() => parseColor(42 as never)).toThrow('Invalid color format');
        });

        it('should reject null input', () => {
            expect(() => parseColor(null as never)).toThrow();
        });

        it('should reject undefined input', () => {
            expect(() => parseColor(undefined as never)).toThrow();
        });

        it('should reject boolean input', () => {
            expect(() => parseColor(true as never)).toThrow('Invalid color format');
        });
    });
});

// ── isValidPdfRgb ────────────────────────────────────────────────────

describe('isValidPdfRgb', () => {
    it('should accept "0 0 0"', () => {
        expect(isValidPdfRgb('0 0 0')).toBe(true);
    });

    it('should accept "1 1 1"', () => {
        expect(isValidPdfRgb('1 1 1')).toBe(true);
    });

    it('should accept "0.145 0.388 0.922"', () => {
        expect(isValidPdfRgb('0.145 0.388 0.922')).toBe(true);
    });

    it('should reject values > 1', () => {
        expect(isValidPdfRgb('0 1.5 0')).toBe(false);
    });

    it('should reject 2-component string', () => {
        expect(isValidPdfRgb('0 0')).toBe(false);
    });

    it('should reject 4-component string', () => {
        expect(isValidPdfRgb('0 0 0 0')).toBe(false);
    });

    it('should reject hex string', () => {
        expect(isValidPdfRgb('#FF0000')).toBe(false);
    });

    it('should reject empty string', () => {
        expect(isValidPdfRgb('')).toBe(false);
    });

    it('should reject text with operators', () => {
        expect(isValidPdfRgb('0 0 0 rg')).toBe(false);
    });
});

// ── normalizeColors ──────────────────────────────────────────────────

describe('normalizeColors', () => {
    const DEFAULT_COLORS: PdfColors = {
        title:  '0.145 0.388 0.922',
        credit: '0.059 0.569 0.482',
        debit:  '0.784 0.176 0.243',
        text:   '0.216 0.255 0.318',
        thBg:   '0.941 0.949 0.956',
        thBrd:  '0.812 0.839 0.859',
        rowBrd: '0.902 0.918 0.929',
        ptdBg:  '0.965 0.976 0.984',
        balBg:  '0.973 0.973 0.996',
        balBrd: '0.812 0.812 0.964',
        label:  '0.400 0.443 0.502',
        footer: '0.400 0.443 0.502',
    };

    it('should pass through valid PDF RGB strings unchanged', () => {
        const result = normalizeColors(DEFAULT_COLORS);
        expect(result).toEqual(DEFAULT_COLORS);
    });

    it('should normalize hex colors to PDF RGB', () => {
        const colors: PdfColors = {
            ...DEFAULT_COLORS,
            title: '#2563EB',
            credit: '#0F9179',
        };
        const result = normalizeColors(colors);
        expect(result.title).toBe('0.145 0.388 0.922');
        expect(result.credit).toBe('0.059 0.569 0.475');
    });

    it('should normalize tuple colors to PDF RGB', () => {
        const colors: PdfColors = {
            ...DEFAULT_COLORS,
            title: [37, 99, 235],
        };
        const result = normalizeColors(colors);
        expect(result.title).toBe('0.145 0.388 0.922');
    });

    it('should reject invalid color in any field', () => {
        const colors: PdfColors = {
            ...DEFAULT_COLORS,
            title: 'not-a-color' as never,
        };
        expect(() => normalizeColors(colors)).toThrow('Invalid color format');
    });

    it('should handle mixed formats across fields', () => {
        const colors: PdfColors = {
            title:  '#FF0000',
            credit: [0, 255, 0],
            debit:  '0 0 1',
            text:   '#333',
            thBg:   [240, 240, 240],
            thBrd:  '0.8 0.8 0.8',
            rowBrd: '#EEEEEE',
            ptdBg:  [245, 249, 252],
            balBg:  '#F8F8FE',
            balBrd: [207, 207, 246],
            label:  '0.4 0.443 0.502',
            footer: '#667788',
        };
        const result = normalizeColors(colors);
        expect(result.title).toBe('1 0 0');
        expect(result.credit).toBe('0 1 0');
        expect(result.debit).toBe('0 0 1');
        expect(typeof result.text).toBe('string');
    });
});
