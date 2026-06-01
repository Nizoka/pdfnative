import { describe, it, expect } from 'vitest';
import { containsEthiopic, isEthiopicCodepoint } from '../../src/shaping/script-registry.js';
import { needsUnicodeFont, detectCharLang, detectFallbackLangs } from '../../src/shaping/script-detect.js';

// Ethiopic is a precomposed syllabary (abugida) — it requires NO OpenType
// shaping, only a CIDFont with the right cmap. These tests cover the
// detection/routing plumbing (lang 'am').

describe('Ethiopic detection', () => {
    it('isEthiopicCodepoint covers the main block', () => {
        expect(isEthiopicCodepoint(0x1200)).toBe(true); // ሀ ha
        expect(isEthiopicCodepoint(0x1378)).toBe(true);
        expect(isEthiopicCodepoint(0x0041)).toBe(false); // Latin A
    });

    it('isEthiopicCodepoint covers supplement + extended blocks', () => {
        expect(isEthiopicCodepoint(0x1380)).toBe(true); // Ethiopic Supplement
        expect(isEthiopicCodepoint(0x2D80)).toBe(true); // Ethiopic Extended
        expect(isEthiopicCodepoint(0xAB01)).toBe(true); // Ethiopic Extended-A
    });

    it('containsEthiopic detects Amharic text', () => {
        expect(containsEthiopic('አማርኛ')).toBe(true); // "Amharic"
        expect(containsEthiopic('Hello')).toBe(false);
        expect(containsEthiopic('')).toBe(false);
    });

    it("routes Ethiopic codepoints to lang 'am'", () => {
        expect(detectCharLang(0x1200)).toBe('am');
        expect(detectCharLang(0x1295)).toBe('am'); // ን na
    });

    it("'am' requires Unicode font embedding", () => {
        expect(needsUnicodeFont('am')).toBe(true);
    });

    it('detectFallbackLangs flags Ethiopic text as needing am', () => {
        const needed = detectFallbackLangs(['ሰላም'], 'en');
        expect(needed.has('am')).toBe(true);
    });
});
