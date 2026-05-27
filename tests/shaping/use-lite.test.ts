/**
 * Tests for USE-lite cluster classifier (src/shaping/use-lite.ts).
 */

import { describe, it, expect } from 'vitest';
import { classifyUseCategory, classifyClusters } from '../../src/index.js';

function cps(str: string): number[] {
    return Array.from(str).map(c => c.codePointAt(0)!);
}

describe('classifyUseCategory', () => {
    it('classifies Devanagari consonants as B', () => {
        expect(classifyUseCategory(0x0915)).toBe('B'); // KA
        expect(classifyUseCategory(0x0939)).toBe('B'); // HA
    });

    it('classifies Devanagari vowels as V', () => {
        expect(classifyUseCategory(0x0905)).toBe('V'); // A
        expect(classifyUseCategory(0x0914)).toBe('V'); // AU
    });

    it('classifies Devanagari virama as H', () => {
        expect(classifyUseCategory(0x094D)).toBe('H');
    });

    it('classifies Devanagari pre-base matra i as Mpre', () => {
        expect(classifyUseCategory(0x093F)).toBe('Mpre');
    });

    it('classifies Bengali consonants as B', () => {
        expect(classifyUseCategory(0x0995)).toBe('B'); // KA
        expect(classifyUseCategory(0x09B9)).toBe('B'); // HA
    });

    it('classifies Bengali virama as H', () => {
        expect(classifyUseCategory(0x09CD)).toBe('H');
    });

    it('classifies Tamil consonants as B', () => {
        expect(classifyUseCategory(0x0B95)).toBe('B'); // KA
        expect(classifyUseCategory(0x0BB9)).toBe('B'); // HA
    });

    it('classifies Tamil pulli as H', () => {
        expect(classifyUseCategory(0x0BCD)).toBe('H');
    });

    it('classifies ZWJ / ZWNJ', () => {
        expect(classifyUseCategory(0x200C)).toBe('ZWNJ');
        expect(classifyUseCategory(0x200D)).toBe('ZWJ');
    });

    it('classifies digits as N', () => {
        expect(classifyUseCategory(0x0966)).toBe('N'); // Devanagari 0
        expect(classifyUseCategory(0x09E6)).toBe('N'); // Bengali 0
        expect(classifyUseCategory(0x0BE6)).toBe('N'); // Tamil 0
    });

    it('returns O for non-Indic code points', () => {
        expect(classifyUseCategory(0x0041)).toBe('O'); // 'A'
        expect(classifyUseCategory(0x05D0)).toBe('O'); // Hebrew alef
    });
});

describe('classifyClusters', () => {
    it('produces an empty result for empty input', () => {
        expect(classifyClusters([])).toEqual([]);
    });

    it('one base produces one cluster', () => {
        const clusters = classifyClusters([0x0915]); // KA
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0915);
        expect(clusters[0].base?.category).toBe('B');
    });

    it('base + matra produces one cluster with post mark', () => {
        // KA + AA matra
        const clusters = classifyClusters([0x0915, 0x093E]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0915);
        expect(clusters[0].post).toHaveLength(1);
        expect(clusters[0].post[0].cp).toBe(0x093E);
    });

    it('base + i-matra produces one cluster with prebase', () => {
        // KA + I matra (visually appears before base)
        const clusters = classifyClusters([0x0915, 0x093F]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0915);
        expect(clusters[0].prebase).toHaveLength(1);
        expect(clusters[0].prebase[0].cp).toBe(0x093F);
        expect(clusters[0].prebase[0].category).toBe('Mpre');
    });

    it('detects reph: leading Ra + virama + consonant', () => {
        // र (Ra) + ् (virama) + क (Ka) = "rka" cluster with reph
        const clusters = classifyClusters([0x0930, 0x094D, 0x0915]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0915);
        expect(clusters[0].prebase).toHaveLength(1);
        expect(clusters[0].prebase[0].category).toBe('R');
        expect(clusters[0].prebase[0].cp).toBe(0x0930);
    });

    it('detects conjunct tail: consonant + virama + consonant', () => {
        // प (Pa) + ् (virama) + र (Ra) = "pra" conjunct
        const clusters = classifyClusters([0x092A, 0x094D, 0x0930]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x092A);
        expect(clusters[0].tail).toHaveLength(2);
        expect(clusters[0].tail[0].category).toBe('H');
        expect(clusters[0].tail[1].category).toBe('B');
        expect(clusters[0].tail[1].cp).toBe(0x0930);
    });

    it('handles multi-cluster strings', () => {
        // प्रकार: प + ् + र + क + ा + र
        const clusters = classifyClusters(cps('प्रकार'));
        // Cluster 1: प + ् + र (conjunct "pra")
        // Cluster 2: क + ा (kā)
        // Cluster 3: र (ra)
        expect(clusters.length).toBeGreaterThanOrEqual(2);
    });

    it('handles Bengali base + post-matra', () => {
        // ক (KA) + া (matra aa)
        const clusters = classifyClusters([0x0995, 0x09BE]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0995);
        expect(clusters[0].post).toHaveLength(1);
        expect(clusters[0].post[0].cp).toBe(0x09BE);
    });

    it('handles Bengali pre-base i-matra', () => {
        // ক (KA) + ি (matra i)
        const clusters = classifyClusters([0x0995, 0x09BF]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0995);
        expect(clusters[0].prebase).toHaveLength(1);
        expect(clusters[0].prebase[0].category).toBe('Mpre');
    });

    it('handles Tamil consonant + pulli (pure consonant)', () => {
        // க (KA) + ் (pulli)
        const clusters = classifyClusters([0x0B95, 0x0BCD]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base?.cp).toBe(0x0B95);
        expect(clusters[0].tail).toHaveLength(1);
        expect(clusters[0].tail[0].category).toBe('H');
    });

    it('preserves all input code points across clusters', () => {
        const input = cps('कमल');
        const clusters = classifyClusters(input);
        const flat: number[] = [];
        for (const c of clusters) {
            for (const m of c.prebase) flat.push(m.cp);
            if (c.base) flat.push(c.base.cp);
            for (const m of c.above) flat.push(m.cp);
            for (const m of c.below) flat.push(m.cp);
            for (const m of c.post) flat.push(m.cp);
            for (const m of c.tail) flat.push(m.cp);
        }
        expect(flat.sort()).toEqual([...input].sort());
    });

    it('handles non-Indic code points as O-category bases', () => {
        const clusters = classifyClusters([0x0041, 0x0042]); // 'A', 'B'
        expect(clusters.length).toBe(2);
        expect(clusters[0].base?.category).toBe('O');
        expect(clusters[1].base?.category).toBe('O');
    });
});
