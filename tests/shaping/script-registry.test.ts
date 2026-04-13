import { describe, it, expect } from 'vitest';
import {
    isCyrillicCodepoint,
    isGeorgianCodepoint,
    isArmenianCodepoint,
    isBengaliCodepoint,
    isTamilCodepoint,
    containsBengali,
    containsTamil,
    CYRILLIC_START, CYRILLIC_END,
    CYRILLIC_SUPPLEMENT_START, CYRILLIC_SUPPLEMENT_END,
    CYRILLIC_EXT_A_START, CYRILLIC_EXT_A_END,
    CYRILLIC_EXT_B_START, CYRILLIC_EXT_B_END,
    GEORGIAN_START, GEORGIAN_END,
    GEORGIAN_SUPPLEMENT_START, GEORGIAN_SUPPLEMENT_END,
    ARMENIAN_START, ARMENIAN_END,
    ARMENIAN_LIGATURES_START, ARMENIAN_LIGATURES_END,
    BENGALI_START, BENGALI_END,
    TAMIL_START, TAMIL_END,
} from '../../src/shaping/script-registry.js';

describe('Cyrillic Unicode ranges', () => {
    it('should have correct range boundaries', () => {
        expect(CYRILLIC_START).toBe(0x0400);
        expect(CYRILLIC_END).toBe(0x04FF);
        expect(CYRILLIC_SUPPLEMENT_START).toBe(0x0500);
        expect(CYRILLIC_SUPPLEMENT_END).toBe(0x052F);
        expect(CYRILLIC_EXT_A_START).toBe(0x2DE0);
        expect(CYRILLIC_EXT_A_END).toBe(0x2DFF);
        expect(CYRILLIC_EXT_B_START).toBe(0xA640);
        expect(CYRILLIC_EXT_B_END).toBe(0xA69F);
    });

    it('isCyrillicCodepoint should match main block', () => {
        expect(isCyrillicCodepoint(0x0410)).toBe(true); // А
        expect(isCyrillicCodepoint(0x0430)).toBe(true); // а
        expect(isCyrillicCodepoint(0x0451)).toBe(true); // ё
    });

    it('isCyrillicCodepoint should match supplement', () => {
        expect(isCyrillicCodepoint(0x0500)).toBe(true);
        expect(isCyrillicCodepoint(0x052F)).toBe(true);
    });

    it('isCyrillicCodepoint should match extended blocks', () => {
        expect(isCyrillicCodepoint(0x2DE0)).toBe(true);
        expect(isCyrillicCodepoint(0xA640)).toBe(true);
    });

    it('isCyrillicCodepoint should reject non-Cyrillic', () => {
        expect(isCyrillicCodepoint(0x0041)).toBe(false); // Latin A
        expect(isCyrillicCodepoint(0x03B1)).toBe(false); // Greek alpha
    });
});

describe('Georgian Unicode ranges', () => {
    it('should have correct range boundaries', () => {
        expect(GEORGIAN_START).toBe(0x10A0);
        expect(GEORGIAN_END).toBe(0x10FF);
        expect(GEORGIAN_SUPPLEMENT_START).toBe(0x2D00);
        expect(GEORGIAN_SUPPLEMENT_END).toBe(0x2D2F);
    });

    it('isGeorgianCodepoint should match main block', () => {
        expect(isGeorgianCodepoint(0x10A0)).toBe(true); // Ⴀ
        expect(isGeorgianCodepoint(0x10D0)).toBe(true); // ა
        expect(isGeorgianCodepoint(0x10FF)).toBe(true);
    });

    it('isGeorgianCodepoint should match supplement', () => {
        expect(isGeorgianCodepoint(0x2D00)).toBe(true);
        expect(isGeorgianCodepoint(0x2D2F)).toBe(true);
    });

    it('isGeorgianCodepoint should reject non-Georgian', () => {
        expect(isGeorgianCodepoint(0x0041)).toBe(false);
        expect(isGeorgianCodepoint(0x10A0 - 1)).toBe(false);
    });
});

describe('Armenian Unicode ranges', () => {
    it('should have correct range boundaries', () => {
        expect(ARMENIAN_START).toBe(0x0530);
        expect(ARMENIAN_END).toBe(0x058F);
        expect(ARMENIAN_LIGATURES_START).toBe(0xFB13);
        expect(ARMENIAN_LIGATURES_END).toBe(0xFB17);
    });

    it('isArmenianCodepoint should match main block', () => {
        expect(isArmenianCodepoint(0x0531)).toBe(true); // Ա
        expect(isArmenianCodepoint(0x0561)).toBe(true); // ա
        expect(isArmenianCodepoint(0x058F)).toBe(true); // ֏
    });

    it('isArmenianCodepoint should match ligatures', () => {
        expect(isArmenianCodepoint(0xFB13)).toBe(true);
        expect(isArmenianCodepoint(0xFB17)).toBe(true);
    });

    it('isArmenianCodepoint should reject non-Armenian', () => {
        expect(isArmenianCodepoint(0x0041)).toBe(false);
        expect(isArmenianCodepoint(0x0530 - 1)).toBe(false);
        expect(isArmenianCodepoint(0x0590)).toBe(false); // Hebrew
    });
});

describe('Bengali Unicode ranges', () => {
    it('should have correct range boundaries', () => {
        expect(BENGALI_START).toBe(0x0980);
        expect(BENGALI_END).toBe(0x09FF);
    });

    it('isBengaliCodepoint should match main block', () => {
        expect(isBengaliCodepoint(0x0995)).toBe(true); // Ka
        expect(isBengaliCodepoint(0x09BE)).toBe(true); // aa-matra
        expect(isBengaliCodepoint(0x09E6)).toBe(true); // digit 0
    });

    it('isBengaliCodepoint should reject non-Bengali', () => {
        expect(isBengaliCodepoint(0x0041)).toBe(false); // Latin A
        expect(isBengaliCodepoint(0x0B95)).toBe(false); // Tamil Ka
        expect(isBengaliCodepoint(0x097F)).toBe(false); // below range
    });

    it('containsBengali should detect Bengali text', () => {
        expect(containsBengali('বাংলা')).toBe(true);
        expect(containsBengali('Hello')).toBe(false);
        expect(containsBengali('')).toBe(false);
    });
});

describe('Tamil Unicode ranges', () => {
    it('should have correct range boundaries', () => {
        expect(TAMIL_START).toBe(0x0B80);
        expect(TAMIL_END).toBe(0x0BFF);
    });

    it('isTamilCodepoint should match main block', () => {
        expect(isTamilCodepoint(0x0B95)).toBe(true); // Ka
        expect(isTamilCodepoint(0x0BBE)).toBe(true); // aa-matra
        expect(isTamilCodepoint(0x0BE6)).toBe(true); // digit 0
    });

    it('isTamilCodepoint should reject non-Tamil', () => {
        expect(isTamilCodepoint(0x0041)).toBe(false); // Latin A
        expect(isTamilCodepoint(0x0995)).toBe(false); // Bengali Ka
        expect(isTamilCodepoint(0x0B7F)).toBe(false); // below range
    });

    it('containsTamil should detect Tamil text', () => {
        expect(containsTamil('தமிழ்')).toBe(true);
        expect(containsTamil('Hello')).toBe(false);
        expect(containsTamil('')).toBe(false);
    });
});
