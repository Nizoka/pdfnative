import { describe, it, expect } from 'vitest';
import { needsUnicodeFont, detectFallbackLangs } from '../../src/shaping/script-detect.js';

describe('needsUnicodeFont', () => {
    it.each([
        ['th', true],
        ['ja', true],
        ['zh', true],
        ['ko', true],
        ['el', true],
        ['hi', true],
        ['tr', true],
        ['vi', true],
        ['pl', true],
    ])('should return true for %s', (lang, expected) => {
        expect(needsUnicodeFont(lang)).toBe(expected);
    });

    it.each([
        ['en', false],
        ['fr', false],
        ['de', false],
        ['unknown', false],
    ])('should return false for %s', (lang, expected) => {
        expect(needsUnicodeFont(lang)).toBe(expected);
    });
});

describe('detectFallbackLangs', () => {
    it('should detect Thai script', () => {
        const result = detectFallbackLangs(['สวัสดี'], 'en');
        expect(result.has('th')).toBe(true);
    });

    it('should detect Greek script', () => {
        const result = detectFallbackLangs(['Ελληνικά'], 'en');
        expect(result.has('el')).toBe(true);
    });

    it('should detect Devanagari script', () => {
        const result = detectFallbackLangs(['नमस्ते'], 'en');
        expect(result.has('hi')).toBe(true);
    });

    it('should detect CJK ideographs as zh by default', () => {
        const result = detectFallbackLangs(['中文'], 'en');
        expect(result.has('zh')).toBe(true);
    });

    it('should not add zh for CJK when primary is ja', () => {
        const result = detectFallbackLangs(['漢字'], 'ja');
        expect(result.has('zh')).toBe(false);
    });

    it('should detect Korean Hangul', () => {
        const result = detectFallbackLangs(['한국어'], 'en');
        expect(result.has('ko')).toBe(true);
    });

    it('should detect Japanese kana', () => {
        const result = detectFallbackLangs(['ひらがな'], 'en');
        expect(result.has('ja')).toBe(true);
    });

    it('should detect Vietnamese extended Latin', () => {
        const result = detectFallbackLangs(['\u1EA0'], 'en'); // Ạ
        expect(result.has('vi')).toBe(true);
    });

    it('should detect Polish-specific characters', () => {
        const result = detectFallbackLangs(['Łódź'], 'en');
        expect(result.has('pl')).toBe(true);
    });

    it('should exclude primaryLang from results', () => {
        const result = detectFallbackLangs(['สวัสดี'], 'th');
        expect(result.has('th')).toBe(false);
    });

    it('should return empty set for pure ASCII', () => {
        const result = detectFallbackLangs(['Hello World'], 'en');
        expect(result.size).toBe(0);
    });

    it('should handle empty array', () => {
        const result = detectFallbackLangs([], 'en');
        expect(result.size).toBe(0);
    });

    it('should handle null/empty strings in array', () => {
        const result = detectFallbackLangs(['', '', 'Hello'], 'en');
        expect(result.size).toBe(0);
    });

    it('should detect multiple scripts in mixed text', () => {
        const result = detectFallbackLangs(['สวัสดี Hello Ελληνικά'], 'en');
        expect(result.has('th')).toBe(true);
        expect(result.has('el')).toBe(true);
    });

    it('should detect Turkish lira sign', () => {
        const result = detectFallbackLangs(['\u20BA'], 'en'); // ₺
        expect(result.has('tr')).toBe(true);
    });

    it('should detect Indian rupee sign', () => {
        const result = detectFallbackLangs(['\u20B9'], 'en'); // ₹
        expect(result.has('hi')).toBe(true);
    });
});
