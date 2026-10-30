/**
 * The five scripts that joined the Indic OpenType engine in 1.9.0 —
 * Gujarati, Gurmukhi, Kannada, Malayalam, Odia: registry constants and
 * predicates, detection and font routing, shaper dispatch, configuration
 * invariants, and the engine's fallback path on a font without layout
 * tables. The golden sequences on the bundled Noto fonts are in
 * `indic-real-font.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { FontData } from '../../src/types/pdf-types.js';
import type { IndicScriptConfig } from '../../src/shaping/indic-engine.js';
import { findShaper, SCRIPT_SHAPERS } from '../../src/shaping/shaper-registry.js';
import { detectCharLang, detectFallbackLangs, needsUnicodeFont } from '../../src/shaping/script-detect.js';
import {
    GUJARATI_START, GUJARATI_END, GURMUKHI_START, GURMUKHI_END, KANNADA_START, KANNADA_END,
    MALAYALAM_START, MALAYALAM_END, ODIA_START, ODIA_END,
    isGujaratiCodepoint, isGurmukhiCodepoint, isKannadaCodepoint, isMalayalamCodepoint, isOdiaCodepoint,
    containsGujarati, containsGurmukhi, containsKannada, containsMalayalam, containsOdia,
    isTeluguCodepoint, isDevanagariCodepoint,
} from '../../src/shaping/script-registry.js';
import { GUJARATI_CONFIG, shapeGujaratiText } from '../../src/shaping/gujarati-shaper.js';
import { GURMUKHI_CONFIG, shapeGurmukhiText } from '../../src/shaping/gurmukhi-shaper.js';
import { KANNADA_CONFIG, shapeKannadaText } from '../../src/shaping/kannada-shaper.js';
import { MALAYALAM_CONFIG, shapeMalayalamText } from '../../src/shaping/malayalam-shaper.js';
import { ODIA_CONFIG, shapeOdiaText } from '../../src/shaping/odia-shaper.js';

interface ScriptCase {
    readonly name: string;
    readonly id: string;
    readonly lang: string;
    readonly start: number;
    readonly end: number;
    readonly is: (cp: number) => boolean;
    readonly contains: (s: string) => boolean;
    readonly config: IndicScriptConfig;
    readonly shape: (s: string, fd: FontData) => readonly { gid: number; cps?: readonly number[] }[];
    /** A native word (demonstration content). */
    readonly word: string;
}

// demo-language: gu pa kn ml or (one word per script, the samples' own words)
const CASES: readonly ScriptCase[] = [
    { name: 'Gujarati', id: 'gujarati', lang: 'gu', start: GUJARATI_START, end: GUJARATI_END, is: isGujaratiCodepoint, contains: containsGujarati, config: GUJARATI_CONFIG, shape: shapeGujaratiText, word: 'ગુજરાતી' },
    { name: 'Gurmukhi', id: 'gurmukhi', lang: 'pa', start: GURMUKHI_START, end: GURMUKHI_END, is: isGurmukhiCodepoint, contains: containsGurmukhi, config: GURMUKHI_CONFIG, shape: shapeGurmukhiText, word: 'ਪੰਜਾਬੀ' },
    { name: 'Kannada', id: 'kannada', lang: 'kn', start: KANNADA_START, end: KANNADA_END, is: isKannadaCodepoint, contains: containsKannada, config: KANNADA_CONFIG, shape: shapeKannadaText, word: 'ಕನ್ನಡ' },
    { name: 'Malayalam', id: 'malayalam', lang: 'ml', start: MALAYALAM_START, end: MALAYALAM_END, is: isMalayalamCodepoint, contains: containsMalayalam, config: MALAYALAM_CONFIG, shape: shapeMalayalamText, word: 'മലയാളം' },
    { name: 'Odia', id: 'odia', lang: 'or', start: ODIA_START, end: ODIA_END, is: isOdiaCodepoint, contains: containsOdia, config: ODIA_CONFIG, shape: shapeOdiaText, word: 'ଓଡ଼ିଆ' },
];

/** A font with one glyph per code point of the block and no layout tables. */
function mockFont(c: ScriptCase): FontData {
    const cmap: Record<number, number> = { 0x20: 3 };
    const widths: Record<number, number> = { 3: 250 };
    for (let cp = c.start; cp <= c.end; cp++) { cmap[cp] = cp - c.start + 100; widths[cp - c.start + 100] = 600; }
    return {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 400, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: `Mock${c.name}`, pdfWidthArray: '', ttfBase64: '',
    };
}

describe.each(CASES)('$name (1.9.0)', (c) => {
    it('declares the UCD block and predicates that agree with it', () => {
        expect(c.is(c.start)).toBe(true);
        expect(c.is(c.end)).toBe(true);
        expect(c.is(c.start - 1)).toBe(false);
        expect(c.is(c.end + 1)).toBe(false);
        expect(c.contains(c.word)).toBe(true);
        expect(c.contains('Latin only')).toBe(false);
        expect(c.contains('')).toBe(false);
        // Disjoint from the 1.8.0 Indic blocks.
        for (let cp = c.start; cp <= c.end; cp += 0x10) {
            expect(isTeluguCodepoint(cp) || isDevanagariCodepoint(cp)).toBe(false);
        }
    });

    it('is routed to its own font and shaper', () => {
        expect(needsUnicodeFont(c.lang)).toBe(true);
        expect(detectCharLang(c.start + 0x15)).toBe(c.lang);
        expect(detectFallbackLangs([c.word], 'en').has(c.lang)).toBe(true);
        expect(findShaper(c.word)?.id).toBe(c.id);
        expect(SCRIPT_SHAPERS.find(s => s.id === c.id)?.shape).toBe(c.shape);
    });

    it('configures the engine coherently', () => {
        const inConsonants = (cp: number): boolean => c.config.consonants.some(([a, b]) => cp >= a && cp <= b);
        expect(c.config.id).toBe(c.id);
        expect(c.config.scriptTags.at(-1)).toBe('DFLT');
        expect(c.config.scriptTags.length).toBe(3);
        expect(c.is(c.config.virama)).toBe(true);
        expect(inConsonants(c.config.ra)).toBe(true);
        expect(inConsonants(c.config.virama)).toBe(false);
        for (const [a, b] of c.config.consonants) { expect(a).toBeLessThanOrEqual(b); expect(c.is(a) && c.is(b)).toBe(true); }
        for (const [sign, parts] of Object.entries(c.config.splitMatras)) {
            expect(c.is(Number(sign))).toBe(true);
            expect(parts.length).toBeGreaterThanOrEqual(2);
            for (const p of parts) expect(c.is(p)).toBe(true);
        }
    });

    it('shapes on a font without layout tables: one glyph per code point, every code point reported', () => {
        const fd = mockFont(c);
        const shaped = c.shape(c.word, fd);
        const input = Array.from(c.word).map(ch => ch.codePointAt(0) ?? 0).filter(cp => cp !== 0x200C && cp !== 0x200D);
        expect(shaped.every(g => g.gid !== 0)).toBe(true);
        expect(shaped.flatMap(g => [...(g.cps ?? [])]).sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
        // Shaping is the identity on Latin: a run with no syllable is passed through.
        expect(c.shape('abc', fd).map(g => g.gid)).toEqual([0, 0, 0]);
    });
});

describe('the five configurations against HarfBuzz hb-ot-shaper-indic.cc', () => {
    it('take the reph mode, reph position and blwf reach of the reference table', () => {
        expect([GUJARATI_CONFIG.rephMode, GUJARATI_CONFIG.rephPosition, GUJARATI_CONFIG.blwfMode]).toEqual(['implicit', 'beforePost', 'preAndPost']);
        expect([GURMUKHI_CONFIG.rephMode, GURMUKHI_CONFIG.rephPosition, GURMUKHI_CONFIG.blwfMode]).toEqual(['implicit', 'beforeSub', 'preAndPost']);
        expect([KANNADA_CONFIG.rephMode, KANNADA_CONFIG.rephPosition, KANNADA_CONFIG.blwfMode]).toEqual(['implicit', 'afterPost', 'postOnly']);
        expect([MALAYALAM_CONFIG.rephMode, MALAYALAM_CONFIG.rephPosition, MALAYALAM_CONFIG.blwfMode]).toEqual(['logical', 'afterMain', 'preAndPost']);
        expect([ODIA_CONFIG.rephMode, ODIA_CONFIG.rephPosition, ODIA_CONFIG.blwfMode]).toEqual(['implicit', 'afterMain', 'preAndPost']);
    });

    it('decompose the two-part vowel signs the UCD decomposes, and only those', () => {
        expect(Object.keys(GUJARATI_CONFIG.splitMatras)).toEqual([]);
        expect(Object.keys(GURMUKHI_CONFIG.splitMatras)).toEqual([]);
        expect(Object.keys(KANNADA_CONFIG.splitMatras).map(Number).sort()).toEqual([0x0CC0, 0x0CC7, 0x0CC8, 0x0CCA, 0x0CCB].sort());
        expect(Object.keys(MALAYALAM_CONFIG.splitMatras).map(Number).sort()).toEqual([0x0D4A, 0x0D4B, 0x0D4C].sort());
        expect(Object.keys(ODIA_CONFIG.splitMatras).map(Number).sort()).toEqual([0x0B48, 0x0B4B, 0x0B4C].sort());
    });

    it('name the Malayalam chillu letters as consonants (Consonant_Dead to the UCD)', () => {
        expect(MALAYALAM_CONFIG.consonants.some(([a, b]) => a <= 0x0D7A && 0x0D7F <= b)).toBe(true);
    });
});
