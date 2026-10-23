/**
 * Which code point names a shared glyph in a ToUnicode CMap (1.9.0, #84):
 * the ordinary character over a compatibility or presentation form, the
 * lowest code point among equals — and the code point the text actually
 * encoded over any inference, which is what the embedder consults first.
 */

import { describe, it, expect } from 'vitest';
import { codepointRank, preferredCodepoint } from '../../src/fonts/unicode-preference.js';
import { buildToUnicodeCMap } from '../../src/fonts/font-embedder.js';

describe('codepointRank', () => {
    it('ranks compatibility and presentation blocks after ordinary characters', () => {
        expect(codepointRank(0x6708)).toBe(0); // 月 CJK unified ideograph
        expect(codepointRank(0x2F49)).toBe(1); // ⽉ Kangxi radical
        expect(codepointRank(0x2E82)).toBe(1); // CJK Radicals Supplement
        expect(codepointRank(0xF900)).toBe(1); // CJK compatibility ideograph
        expect(codepointRank(0xFB01)).toBe(1); // ﬁ ligature (Alphabetic Presentation Forms)
        expect(codepointRank(0xFE80)).toBe(1); // Arabic Presentation Forms-B
        expect(codepointRank(0x1D6A8)).toBe(1); // mathematical bold capital alpha
        expect(codepointRank(0x0041)).toBe(0);
        expect(codepointRank(0x0661)).toBe(0); // Arabic-Indic digit one
        expect(codepointRank(0x06F1)).toBe(0); // Extended Arabic-Indic digit one
    });
});

describe('preferredCodepoint', () => {
    it('prefers the ordinary character whatever the numeric order', () => {
        expect(preferredCodepoint(0x2F49, 0x6708)).toBe(0x6708);
        expect(preferredCodepoint(0x6708, 0x2F49)).toBe(0x6708);
        expect(preferredCodepoint(0x2E82, 0x4E5B)).toBe(0x4E5B);
        expect(preferredCodepoint(0x1D6A8, 0x1D756)).toBe(0x1D6A8); // both compatibility: lowest
    });

    it('keeps the lowest code point among equals (the historical rule)', () => {
        expect(preferredCodepoint(0x0661, 0x06F1)).toBe(0x0661);
        expect(preferredCodepoint(0x06F1, 0x0661)).toBe(0x0661);
        expect(preferredCodepoint(0x0041, 0x0041)).toBe(0x0041);
    });
});

describe('buildToUnicodeCMap naming', () => {
    // A glyph shared by the ideograph and its radical, another by two digit sets.
    const cmap = { 0x2F49: 7, 0x6708: 7, 0x0661: 9, 0x06F1: 9, 0x0041: 3 };

    it('names a shared glyph by the ordinary character, not the lowest code point', () => {
        const cm = buildToUnicodeCMap(cmap, new Set([7, 3]));
        expect(cm).toContain('<0007> <6708>');
        expect(cm).not.toContain('<0007> <2F49>');
        expect(cm).toContain('<0003> <0041>');
    });

    it('names a glyph by the code point the document actually encoded when it is known', () => {
        const encoded = new Map<number, number>([[9, 0x06F1]]);
        const cm = buildToUnicodeCMap(cmap, new Set([9]), undefined, encoded);
        expect(cm).toContain('<0009> <06F1>');
        // Without that evidence the lowest of two ordinary code points wins.
        expect(buildToUnicodeCMap(cmap, new Set([9]))).toContain('<0009> <0661>');
    });

    it('ranks evidence: encoded, then a shaper override, then the inverted cmap', () => {
        const overrides = new Map<number, number | readonly number[]>([[7, [0x6708, 0x5EA6]], [11, 0x0E33]]);
        const encoded = new Map<number, number>([[7, 0x2F49]]);
        const cm = buildToUnicodeCMap(cmap, new Set([7, 11]), overrides, encoded);
        expect(cm).toContain('<0007> <2F49>');      // the radical really was encoded
        expect(cm).toContain('<000B> <0E33>');      // a glyph the cmap cannot name: the shaper's word
        const cm2 = buildToUnicodeCMap(cmap, new Set([7]), overrides);
        expect(cm2).toContain('<0007> <67085EA6>'); // override beats the inverted cmap
    });

    it('is byte-identical to the 1.8.0 output when no compatibility block and no evidence is involved', () => {
        const plain = { 0x0041: 1, 0x0042: 2, 0x00E9: 3, 0x0E01: 4 };
        const a = buildToUnicodeCMap(plain, new Set([1, 2, 3, 4]));
        expect(a).toContain('<0001> <0041>');
        expect(a).toContain('<0003> <00E9>');
        expect(a).toContain('<0004> <0E01>');
        expect(a).toBe(buildToUnicodeCMap(plain, new Set([1, 2, 3, 4]), new Map(), new Map()));
    });
});
