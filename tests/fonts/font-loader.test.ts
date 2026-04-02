import { describe, it, expect, beforeEach } from 'vitest';
import {
    registerFont, registerFonts, loadFontData,
    hasFontLoader, getRegisteredLangs, clearFontCache, resetFontRegistry,
} from '../../src/fonts/font-loader.js';
import type { FontData } from '../../src/types/pdf-types.js';

const mockFontData: FontData = {
    metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
    fontName: 'MockFont',
    cmap: {},
    defaultWidth: 500,
    widths: {},
    pdfWidthArray: '',
    ttfBase64: '',
    gsub: {},
    markAnchors: null,
    mark2mark: null,
};

describe('Font Loader', () => {
    beforeEach(() => {
        resetFontRegistry();
    });

    describe('registerFont', () => {
        it('should register a font loader', () => {
            registerFont('th', async () => mockFontData);
            expect(hasFontLoader('th')).toBe(true);
        });

        it('should not have unregistered fonts', () => {
            expect(hasFontLoader('th')).toBe(false);
        });
    });

    describe('registerFonts', () => {
        it('should register multiple font loaders at once', () => {
            registerFonts({
                th: async () => mockFontData,
                ja: async () => mockFontData,
                ko: async () => mockFontData,
            });
            expect(hasFontLoader('th')).toBe(true);
            expect(hasFontLoader('ja')).toBe(true);
            expect(hasFontLoader('ko')).toBe(true);
        });
    });

    describe('loadFontData', () => {
        it('should load font data from registered loader', async () => {
            registerFont('th', async () => mockFontData);
            const result = await loadFontData('th');
            expect(result).toBe(mockFontData);
        });

        it('should return null for unregistered font', async () => {
            const result = await loadFontData('unknown');
            expect(result).toBeNull();
        });

        it('should cache loaded font data', async () => {
            let loadCount = 0;
            registerFont('th', async () => { loadCount++; return mockFontData; });
            await loadFontData('th');
            await loadFontData('th');
            expect(loadCount).toBe(1);
        });

        it('should support ES module default export format', async () => {
            registerFont('ja', async () => ({ default: mockFontData }));
            const result = await loadFontData('ja');
            expect(result).toBe(mockFontData);
        });

        it('should return null after loader failure', async () => {
            registerFont('bad', async () => { throw new Error('load failed'); });
            const result = await loadFontData('bad');
            expect(result).toBeNull();
        });
    });

    describe('getRegisteredLangs', () => {
        it('should return empty array when no fonts registered', () => {
            expect(getRegisteredLangs()).toEqual([]);
        });

        it('should return all registered language codes', () => {
            registerFont('th', async () => mockFontData);
            registerFont('ja', async () => mockFontData);
            const langs = getRegisteredLangs();
            expect(langs).toContain('th');
            expect(langs).toContain('ja');
        });
    });

    describe('clearFontCache', () => {
        it('should clear cached data but keep registrations', async () => {
            let loadCount = 0;
            registerFont('th', async () => { loadCount++; return mockFontData; });
            await loadFontData('th');
            expect(loadCount).toBe(1);
            clearFontCache();
            await loadFontData('th');
            expect(loadCount).toBe(2);
            expect(hasFontLoader('th')).toBe(true);
        });
    });

    describe('resetFontRegistry', () => {
        it('should clear both registry and cache', async () => {
            registerFont('th', async () => mockFontData);
            await loadFontData('th');
            resetFontRegistry();
            expect(hasFontLoader('th')).toBe(false);
            expect(getRegisteredLangs()).toEqual([]);
        });
    });
});
