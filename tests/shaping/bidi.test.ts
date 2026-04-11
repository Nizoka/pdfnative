import { describe, it, expect } from 'vitest';
import {
    classifyBidiType,
    detectParagraphLevel,
    resolveBidiRuns,
    containsRTL,
    mirrorCodePoint,
    reverseString,
} from '../../src/shaping/bidi.js';
import type { BidiType } from '../../src/shaping/bidi.js';

// ── classifyBidiType ─────────────────────────────────────────────────

describe('classifyBidiType', () => {
    it('should classify Latin letters as L', () => {
        expect(classifyBidiType(0x0041)).toBe('L'); // A
        expect(classifyBidiType(0x007A)).toBe('L'); // z
    });

    it('should classify Arabic letters as AL', () => {
        expect(classifyBidiType(0x0627)).toBe('AL'); // ALEF
        expect(classifyBidiType(0x0628)).toBe('AL'); // BA
        expect(classifyBidiType(0x0639)).toBe('AL'); // AIN
    });

    it('should classify Hebrew letters as R', () => {
        expect(classifyBidiType(0x05D0)).toBe('R'); // ALEF
        expect(classifyBidiType(0x05EA)).toBe('R'); // TAV
    });

    it('should classify European digits as EN', () => {
        expect(classifyBidiType(0x0030)).toBe('EN'); // 0
        expect(classifyBidiType(0x0039)).toBe('EN'); // 9
    });

    it('should classify Arabic-Indic digits as AN', () => {
        expect(classifyBidiType(0x0660)).toBe('AN'); // Arabic-Indic 0
        expect(classifyBidiType(0x0669)).toBe('AN'); // Arabic-Indic 9
    });

    it('should classify whitespace as WS', () => {
        expect(classifyBidiType(0x0020)).toBe('WS'); // Space
        expect(classifyBidiType(0x0009)).toBe('WS'); // Tab
    });

    it('should classify plus/minus as ES', () => {
        expect(classifyBidiType(0x002B)).toBe('ES'); // +
        expect(classifyBidiType(0x002D)).toBe('ES'); // -
    });

    it('should classify currency symbols as ET', () => {
        expect(classifyBidiType(0x0024)).toBe('ET'); // $
        expect(classifyBidiType(0x20AC)).toBe('ET'); // €
    });

    it('should classify Arabic diacritics as NSM', () => {
        expect(classifyBidiType(0x064B)).toBe('NSM'); // FATHATAN
        expect(classifyBidiType(0x0650)).toBe('NSM'); // KASRA
    });

    it('should classify zero-width characters as BN', () => {
        expect(classifyBidiType(0x200B)).toBe('BN'); // ZWSP
        expect(classifyBidiType(0xFEFF)).toBe('BN'); // BOM
    });

    it('should classify General Punctuation as ON', () => {
        expect(classifyBidiType(0x2014)).toBe('ON'); // Em-dash
        expect(classifyBidiType(0x2013)).toBe('ON'); // En-dash
        expect(classifyBidiType(0x2010)).toBe('ON'); // Hyphen
        expect(classifyBidiType(0x2018)).toBe('ON'); // Left single quote
        expect(classifyBidiType(0x201C)).toBe('ON'); // Left double quote
        expect(classifyBidiType(0x2026)).toBe('ON'); // Ellipsis
        expect(classifyBidiType(0x2030)).toBe('ON'); // Per mille
        expect(classifyBidiType(0x2032)).toBe('ON'); // Prime
    });
});

// ── detectParagraphLevel ─────────────────────────────────────────────

describe('detectParagraphLevel', () => {
    it('should detect LTR paragraph level for Latin text', () => {
        const types: BidiType[] = ['L', 'L', 'L'];
        expect(detectParagraphLevel(types)).toBe(0);
    });

    it('should detect RTL paragraph level for Arabic text', () => {
        const types: BidiType[] = ['AL', 'AL', 'AL'];
        expect(detectParagraphLevel(types)).toBe(1);
    });

    it('should detect RTL for Hebrew text', () => {
        const types: BidiType[] = ['R', 'R', 'R'];
        expect(detectParagraphLevel(types)).toBe(1);
    });

    it('should detect LTR when first strong char is L', () => {
        const types: BidiType[] = ['WS', 'L', 'AL'];
        expect(detectParagraphLevel(types)).toBe(0);
    });

    it('should detect RTL when first strong char is R/AL', () => {
        const types: BidiType[] = ['WS', 'EN', 'AL', 'L'];
        expect(detectParagraphLevel(types)).toBe(1);
    });

    it('should default to LTR for neutral-only text', () => {
        const types: BidiType[] = ['WS', 'ON', 'EN'];
        expect(detectParagraphLevel(types)).toBe(0);
    });
});

// ── resolveBidiRuns ──────────────────────────────────────────────────

describe('resolveBidiRuns', () => {
    it('should return empty array for empty string', () => {
        expect(resolveBidiRuns('')).toEqual([]);
    });

    it('should return single LTR run for pure Latin text', () => {
        const runs = resolveBidiRuns('Hello World');
        expect(runs.length).toBe(1);
        expect(runs[0].text).toBe('Hello World');
        expect(runs[0].level).toBe(0);
    });

    it('should return single RTL run for pure Arabic text', () => {
        const runs = resolveBidiRuns('\u0645\u0631\u062D\u0628\u0627');
        expect(runs.length).toBe(1);
        expect(runs[0].level).toBe(1);
        // Text should be reversed for visual order
        expect(runs[0].text).toBe('\u0627\u0628\u062D\u0631\u0645');
    });

    it('should split mixed LTR/RTL into multiple runs', () => {
        // "Hello مرحبا World"
        const text = 'Hello \u0645\u0631\u062D\u0628\u0627 World';
        const runs = resolveBidiRuns(text);
        expect(runs.length).toBeGreaterThanOrEqual(2);
        // First run should be LTR
        const ltrRun = runs.find(r => r.level === 0);
        expect(ltrRun).toBeDefined();
    });

    it('should handle Hebrew text', () => {
        // שלום (Shalom)
        const runs = resolveBidiRuns('\u05E9\u05DC\u05D5\u05DD');
        expect(runs.length).toBe(1);
        expect(runs[0].level).toBe(1);
    });

    it('should keep em-dash and spaces together between Hebrew and English', () => {
        // "שלום — Hello" — em-dash (U+2014) between RTL and LTR
        const text = '\u05E9\u05DC\u05D5\u05DD \u2014 Hello';
        const runs = resolveBidiRuns(text);
        // Em-dash classified as ON → resolved to paragraph direction (RTL)
        // The space+em-dash+space should stay with the Hebrew RTL run
        const rtlRun = runs.find(r => r.level % 2 === 1);
        expect(rtlRun).toBeDefined();
        // The RTL run should contain the em-dash
        expect(rtlRun!.text).toContain('\u2014');
    });

    it('should handle numbers in RTL context', () => {
        // Arabic text with number: "عدد 123"
        const text = '\u0639\u062F\u062F 123';
        const runs = resolveBidiRuns(text);
        expect(runs.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle pure whitespace', () => {
        const runs = resolveBidiRuns('   ');
        expect(runs.length).toBe(1);
        expect(runs[0].level).toBe(0);
    });

    it('should reorder runs for RTL paragraph: English first, Hebrew last', () => {
        const title = '\u05D4\u05D0\u05DC\u05E4\u05D1\u05D9\u05EA \u05D4\u05E2\u05D1\u05E8\u05D9 \u2013 Hebrew Alphabet Coverage';
        const runs = resolveBidiRuns(title);
        expect(runs.length).toBe(2);
        // LTR run first (leftmost for visual rendering)
        expect(runs[0].level).toBe(2);
        expect(runs[0].text).toBe('Hebrew Alphabet Coverage');
        // RTL run second (rightmost, contains en-dash)
        expect(runs[1].level).toBe(1);
        expect(runs[1].text).toContain('\u2013');
    });

    it('should reorder runs for Arabic RTL paragraph', () => {
        const title = '\u0627\u0644\u0623\u0628\u062C\u062F\u064A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u2013 Arabic Script Coverage';
        const runs = resolveBidiRuns(title);
        expect(runs[0].level).toBe(2); // LTR first
        expect(runs[0].text).toBe('Arabic Script Coverage');
        expect(runs[1].level).toBe(1); // RTL second
    });

    it('should not reorder runs for LTR paragraphs (Devanagari)', () => {
        const title = 'Devanagari \u0926\u0947\u0935\u0928\u093E\u0917\u0930\u0940 Test';
        const runs = resolveBidiRuns(title);
        expect(runs[0].level).toBe(0);
        expect(runs[0].text).toContain('Devanagari');
    });

    it('should not reverse single-run pure RTL text', () => {
        const text = '\u05E9\u05DC\u05D5\u05DD';
        const runs = resolveBidiRuns(text);
        expect(runs.length).toBe(1);
        expect(runs[0].level).toBe(1);
    });
});

// ── containsRTL ─────────────────────────────────────────────────────

describe('containsRTL', () => {
    it('should detect Arabic text', () => {
        expect(containsRTL('\u0645\u0631\u062D\u0628\u0627')).toBe(true);
    });

    it('should detect Hebrew text', () => {
        expect(containsRTL('\u05E9\u05DC\u05D5\u05DD')).toBe(true);
    });

    it('should return false for Latin text', () => {
        expect(containsRTL('Hello World')).toBe(false);
    });

    it('should return false for empty text', () => {
        expect(containsRTL('')).toBe(false);
    });

    it('should detect RTL in mixed text', () => {
        expect(containsRTL('Hello \u0645\u0631\u062D\u0628\u0627')).toBe(true);
    });
});

// ── mirrorCodePoint ──────────────────────────────────────────────────

describe('mirrorCodePoint', () => {
    it('should mirror parentheses', () => {
        expect(mirrorCodePoint(0x0028)).toBe(0x0029); // ( → )
        expect(mirrorCodePoint(0x0029)).toBe(0x0028); // ) → (
    });

    it('should mirror brackets', () => {
        expect(mirrorCodePoint(0x005B)).toBe(0x005D); // [ → ]
        expect(mirrorCodePoint(0x005D)).toBe(0x005B); // ] → [
    });

    it('should mirror angle brackets', () => {
        expect(mirrorCodePoint(0x003C)).toBe(0x003E); // < → >
        expect(mirrorCodePoint(0x003E)).toBe(0x003C); // > → <
    });

    it('should mirror curly braces', () => {
        expect(mirrorCodePoint(0x007B)).toBe(0x007D); // { → }
        expect(mirrorCodePoint(0x007D)).toBe(0x007B); // } → {
    });

    it('should mirror guillemets', () => {
        expect(mirrorCodePoint(0x00AB)).toBe(0x00BB); // « → »
        expect(mirrorCodePoint(0x00BB)).toBe(0x00AB); // » → «
    });

    it('should return same codepoint for non-mirrored characters', () => {
        expect(mirrorCodePoint(0x0041)).toBe(0x0041); // A → A
        expect(mirrorCodePoint(0x0627)).toBe(0x0627); // Arabic ALEF → same
    });
});

// ── reverseString ────────────────────────────────────────────────────

describe('reverseString', () => {
    it('should reverse ASCII text', () => {
        expect(reverseString('abc')).toBe('cba');
    });

    it('should reverse Hebrew text', () => {
        expect(reverseString('\u05E9\u05DC\u05D5\u05DD')).toBe('\u05DD\u05D5\u05DC\u05E9');
    });

    it('should handle empty string', () => {
        expect(reverseString('')).toBe('');
    });

    it('should handle single character', () => {
        expect(reverseString('x')).toBe('x');
    });
});
