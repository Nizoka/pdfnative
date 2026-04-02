import { describe, it, expect } from 'vitest';
import { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from '../../src/fonts/font-embedder.js';

describe('base64ToByteString', () => {
    it('should decode base64 to binary string', () => {
        // "Hello" in base64
        const result = base64ToByteString('SGVsbG8=');
        expect(result).toBe('Hello');
    });

    it('should handle empty string', () => {
        const result = base64ToByteString('');
        expect(result).toBe('');
    });

    it('should preserve binary bytes', () => {
        // \x00\xFF in base64
        const result = base64ToByteString('AP8=');
        expect(result.charCodeAt(0)).toBe(0);
        expect(result.charCodeAt(1)).toBe(255);
    });

    it('should use Buffer fallback when atob is unavailable', () => {
        const originalAtob = globalThis.atob;
        // @ts-expect-error -- deliberately removing atob for testing
        globalThis.atob = undefined;
        try {
            const result = base64ToByteString('SGVsbG8=');
            expect(result).toBe('Hello');
        } finally {
            globalThis.atob = originalAtob;
        }
    });
});

describe('buildToUnicodeCMap', () => {
    it('should produce valid CMap structure', () => {
        const cmap: Record<number, number> = { 65: 1, 66: 2 };
        const usedGids = new Set([1, 2]);
        const result = buildToUnicodeCMap(cmap, usedGids);

        expect(result).toContain('/CIDInit /ProcSet findresource begin');
        expect(result).toContain('begincmap');
        expect(result).toContain('endcmap');
        expect(result).toContain('/CMapName /Adobe-Identity-UCS def');
        expect(result).toContain('begincodespacerange');
        expect(result).toContain('<0000> <FFFF>');
        expect(result).toContain('endcodespacerange');
    });

    it('should map GIDs to Unicode codepoints', () => {
        const cmap: Record<number, number> = { 65: 1 }; // U+0041 → GID 1
        const usedGids = new Set([1]);
        const result = buildToUnicodeCMap(cmap, usedGids);
        expect(result).toContain('<0001> <0041>');
    });

    it('should only include used GIDs', () => {
        const cmap: Record<number, number> = { 65: 1, 66: 2, 67: 3 };
        const usedGids = new Set([1]);
        const result = buildToUnicodeCMap(cmap, usedGids);
        expect(result).toContain('<0001>');
        expect(result).not.toContain('<0002>');
        expect(result).not.toContain('<0003>');
    });

    it('should handle supplementary plane characters with surrogates', () => {
        // U+1F600 (😀) → GID 100
        const cmap: Record<number, number> = { 0x1F600: 100 };
        const usedGids = new Set([100]);
        const result = buildToUnicodeCMap(cmap, usedGids);
        expect(result).toContain('<0064>'); // GID 100 = 0x0064
        // Surrogate pair for U+1F600: D83D DE00
        expect(result).toContain('D83DDE00');
    });

    it('should batch entries into groups of max 100', () => {
        const cmap: Record<number, number> = {};
        const usedGids = new Set<number>();
        for (let i = 1; i <= 150; i++) {
            cmap[i + 64] = i;
            usedGids.add(i);
        }
        const result = buildToUnicodeCMap(cmap, usedGids);
        expect((result.match(/beginbfchar/g) || []).length).toBe(2); // 2 blocks
    });
});

describe('buildSubsetWidthArray', () => {
    it('should return null for empty usedGids', () => {
        expect(buildSubsetWidthArray({}, new Set())).toBeNull();
    });

    it('should build compact width array for single GID', () => {
        const widths = { 1: 600 };
        const result = buildSubsetWidthArray(widths, new Set([1]));
        expect(result).toBe('1 [600]');
    });

    it('should group consecutive GIDs', () => {
        const widths: Record<number, number> = { 1: 600, 2: 700, 3: 500 };
        const result = buildSubsetWidthArray(widths, new Set([1, 2, 3]));
        expect(result).toBe('1 [600 700 500]');
    });

    it('should create separate groups for non-consecutive GIDs', () => {
        const widths: Record<number, number> = { 1: 600, 5: 700 };
        const result = buildSubsetWidthArray(widths, new Set([1, 5]));
        expect(result).toBe('1 [600] 5 [700]');
    });

    it('should skip GIDs without width data', () => {
        const widths: Record<number, number> = { 1: 600 };
        const result = buildSubsetWidthArray(widths, new Set([1, 99]));
        expect(result).toBe('1 [600]');
    });
});
