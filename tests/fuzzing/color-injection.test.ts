/**
 * Fuzz / adversarial tests for color input validation.
 * Ensures parseColor rejects injection attempts and malformed inputs.
 */

import { describe, it, expect } from 'vitest';
import { parseColor } from '../../src/core/pdf-color.js';

// ── PDF operator injection ───────────────────────────────────────────

describe('parseColor — injection resistance', () => {
    it.each([
        ['PDF operator injection', '0 0 0 rg 1 0 0 rg'],
        ['newline injection', '0 0 0\n1 0 0 rg'],
        ['carriage return injection', '0 0 0\r1 0 0 rg'],
        ['tab injection', '0\t0\t0'],
        ['stream injection', '0 0 0 rg\nstream\nmalicious'],
        ['endobj injection', '0 0 0 rg\nendobj'],
        ['BT/ET injection', '0 0 0 rg BT /F1 12 Tf ET'],
        ['comment injection', '0 0 0 % comment'],
        ['parenthesis injection', '0 0 0 rg (text) Tj'],
        ['angle bracket injection', '0 0 0 rg <hex> Tj'],
        ['slash injection', '0 0 0 /Name'],
        ['null byte injection', '0 0 0\x000 rg'],
    ])('rejects %s: %s', (_label, input) => {
        expect(() => parseColor(input as never)).toThrow();
    });

    it('rejects string with leading spaces', () => {
        expect(() => parseColor(' 0 0 0' as never)).toThrow();
    });

    it('rejects string with trailing spaces', () => {
        expect(() => parseColor('0 0 0 ' as never)).toThrow();
    });

    it('rejects double-space between values', () => {
        expect(() => parseColor('0  0  0' as never)).toThrow();
    });
});

// ── SQL/XSS-style injection ──────────────────────────────────────────

describe('parseColor — cross-domain injection', () => {
    it.each([
        ['SQL-style', "0'; DROP TABLE--"],
        ['XSS-style', '<script>alert(1)</script>'],
        ['HTML entity', '&#x30; &#x30; &#x30;'],
        ['Unicode escape', '\\u0030 \\u0030 \\u0030'],
        ['Template literal', '${0} ${0} ${0}'],
        ['JSON injection', '{"r":0,"g":0,"b":0}'],
    ])('rejects %s: %s', (_label, input) => {
        expect(() => parseColor(input as never)).toThrow();
    });
});

// ── Hex edge cases ───────────────────────────────────────────────────

describe('parseColor — hex edge cases', () => {
    it.each([
        ['too short (#RR)', '#FF'],
        ['too long (#RRGGBBAA)', '#FF0000FF'],
        ['five chars', '#12345'],
        ['no hash', 'FF0000'],
        ['double hash', '##FF0000'],
        ['non-hex chars', '#GGHHII'],
        ['spaces in hex', '#FF 00 00'],
        ['with newline', '#FF\n0000'],
    ])('rejects %s: %s', (_label, input) => {
        expect(() => parseColor(input as never)).toThrow();
    });
});

// ── Tuple edge cases ─────────────────────────────────────────────────

describe('parseColor — tuple edge cases', () => {
    it('rejects empty array', () => {
        expect(() => parseColor([] as never)).toThrow();
    });

    it('rejects single-value array', () => {
        expect(() => parseColor([128] as never)).toThrow();
    });

    it('rejects string values in tuple', () => {
        expect(() => parseColor(['red', 'green', 'blue'] as never)).toThrow();
    });

    it('rejects float values > 1 in tuple (treated as 0-255 range)', () => {
        // 128.5 is valid — it's in [0, 255] range
        const result = parseColor([128.5, 0, 0]);
        expect(result).toMatch(/^\d/);
    });

    it('rejects object in tuple position', () => {
        expect(() => parseColor([{}, 0, 0] as never)).toThrow();
    });
});

// ── Boundary values ──────────────────────────────────────────────────

describe('parseColor — boundary values', () => {
    it('accepts exact 0 components', () => {
        expect(parseColor('0 0 0')).toBe('0 0 0');
    });

    it('accepts exact 1 components', () => {
        expect(parseColor('1 1 1')).toBe('1 1 1');
    });

    it('rejects 1.001 component', () => {
        expect(() => parseColor('0 0 1.001' as never)).toThrow('must be 0.0–1.0');
    });

    it('accepts 0.999 component', () => {
        expect(parseColor('0 0 0.999')).toBe('0 0 0.999');
    });

    it('accepts tuple [0, 0, 0]', () => {
        expect(parseColor([0, 0, 0])).toBe('0 0 0');
    });

    it('accepts tuple [255, 255, 255]', () => {
        expect(parseColor([255, 255, 255])).toBe('1 1 1');
    });

    it('rejects tuple [256, 0, 0]', () => {
        expect(() => parseColor([256, 0, 0] as never)).toThrow('Expected a number 0–255');
    });
});
