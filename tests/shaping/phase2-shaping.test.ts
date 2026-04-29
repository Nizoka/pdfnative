/**
 * Tests for Phase 2 v1.1.0 shaping refactor (issue #25):
 *   - GSUB driver shared by Bengali/Tamil/Devanagari (`tryLigature`)
 *   - GPOS positioner shared by Arabic/Devanagari (`positionMarkOnBase`)
 *   - UAX #9 isolate support (LRI/RLI/FSI/PDI) in `resolveBidiRuns`
 */

import { describe, it, expect } from 'vitest';
import { tryLigature } from '../../src/shaping/gsub-driver.js';
import {
    getBaseAnchor,
    getMarkAnchor,
    positionMarkOnBase,
} from '../../src/shaping/gpos-positioner.js';
import { resolveBidiRuns, classifyBidiType } from '../../src/shaping/bidi.js';

describe('GSUB driver (Phase 2)', () => {
    it('returns null when ligatures table is missing', () => {
        expect(tryLigature([1, 2], null)).toBeNull();
        expect(tryLigature([1, 2], undefined)).toBeNull();
    });

    it('returns null when input is shorter than any ligature', () => {
        // Entry [99, 2, 3] under key=1 means input must be [1, 2, 3]
        const ligs = { 1: [[99, 2, 3]] };
        expect(tryLigature([1], ligs)).toBeNull();
    });

    it('returns null when first GID has no ligature entries', () => {
        const ligs = { 1: [[99, 2]] };
        expect(tryLigature([42, 2], ligs)).toBeNull();
    });

    it('matches a 2-component ligature greedily', () => {
        // Key=1, entry=[result, comp_after_key]
        const ligs = { 1: [[99, 2]] };
        const result = tryLigature([1, 2, 3], ligs);
        expect(result).toEqual({ resultGid: 99, consumed: 2 });
    });

    it('prefers the longest match when entries are sorted longest-first', () => {
        // Caller is responsible for longest-first ordering (font baker does this)
        const ligs = { 1: [[99, 2, 3], [88, 2]] };
        const result = tryLigature([1, 2, 3, 4], ligs);
        expect(result).toEqual({ resultGid: 99, consumed: 3 });
    });

    it('skips non-matching components and tries next entry', () => {
        const ligs = { 1: [[99, 2, 3], [88, 5]] };
        const result = tryLigature([1, 5, 9], ligs);
        expect(result).toEqual({ resultGid: 88, consumed: 2 });
    });

    it('returns null when no entry matches', () => {
        const ligs = { 1: [[99, 2, 3]] };
        expect(tryLigature([1, 7, 8], ligs)).toBeNull();
    });
});

describe('GPOS positioner (Phase 2)', () => {
    const markAnchors = {
        marks: { 100: [0, 50, 200] as [number, number, number] },
        bases: { 50: { 0: [300, 400] as [number, number] } },
    };

    it('returns null when markAnchors table is missing', () => {
        expect(getBaseAnchor(null, 50, 0)).toBeNull();
        expect(getMarkAnchor(undefined, 100)).toBeNull();
    });

    it('looks up an existing base anchor', () => {
        expect(getBaseAnchor(markAnchors, 50, 0)).toEqual([300, 400]);
    });

    it('returns null for a base GID with no entry', () => {
        expect(getBaseAnchor(markAnchors, 999, 0)).toBeNull();
    });

    it('looks up an existing mark anchor', () => {
        expect(getMarkAnchor(markAnchors, 100)).toEqual({ classIdx: 0, x: 50, y: 200 });
    });

    it('returns null for a mark GID with no entry', () => {
        expect(getMarkAnchor(markAnchors, 999)).toBeNull();
    });

    it('computes the mark→base offset correctly', () => {
        // base advance = 600
        // dx = baseAnchorX - markX - baseAdv = 300 - 50 - 600 = -350
        // dy = baseAnchorY - markY = 400 - 200 = 200
        const offset = positionMarkOnBase(markAnchors, 100, 50, 600);
        expect(offset).toEqual({ dx: -350, dy: 200 });
    });

    it('returns null when either anchor is missing', () => {
        expect(positionMarkOnBase(markAnchors, 100, 999, 600)).toBeNull();
        expect(positionMarkOnBase(markAnchors, 999, 50, 600)).toBeNull();
    });
});

describe('BiDi isolate support (UAX #9 §3.3.2)', () => {
    it('classifies LRI/RLI/FSI/PDI as boundary neutrals', () => {
        expect(classifyBidiType(0x2066)).toBe('BN'); // LRI
        expect(classifyBidiType(0x2067)).toBe('BN'); // RLI
        expect(classifyBidiType(0x2068)).toBe('BN'); // FSI
        expect(classifyBidiType(0x2069)).toBe('BN'); // PDI
    });

    it('produces a single LTR run when no isolates are present', () => {
        const runs = resolveBidiRuns('Hello world');
        expect(runs.length).toBe(1);
        expect(runs[0].level).toBe(0);
    });

    it('seals an LRI...PDI inner content as LTR even inside an RTL paragraph', () => {
        // Hebrew + LRI "ABC" PDI + Hebrew
        // Without isolates, "ABC" inside RTL would be reversed/repositioned.
        // With LRI, it remains LTR.
        const text = '\u05D0\u05D1\u2066ABC\u2069\u05D2\u05D3';
        const runs = resolveBidiRuns(text);
        // Verify we get at least one LTR run carrying 'ABC' literally
        const ltrAbc = runs.find(r => r.level === 0 && r.text === 'ABC');
        expect(ltrAbc).toBeDefined();
    });

    it('seals an RLI...PDI inner content as RTL inside an LTR paragraph', () => {
        // English + RLI "אב" PDI + English
        const text = 'Start \u2067\u05D0\u05D1\u2069 end';
        const runs = resolveBidiRuns(text);
        // The Hebrew sub-paragraph should be reversed visually
        const rtlRun = runs.find(r => r.level === 1);
        expect(rtlRun).toBeDefined();
        expect(rtlRun!.text).toBe('\u05D1\u05D0'); // visual order
    });

    it('FSI auto-detects inner direction from first strong char', () => {
        const ltrInside = resolveBidiRuns('Outer \u2068Inner\u2069 tail');
        // Inner first strong is L → inner is LTR
        const inner = ltrInside.find(r => r.text === 'Inner');
        expect(inner?.level).toBe(0);

        const rtlInside = resolveBidiRuns('Outer \u2068\u05D0\u05D1\u2069 tail');
        const innerR = rtlInside.find(r => r.text === '\u05D1\u05D0' || r.text === '\u05D0\u05D1');
        expect(innerR?.level).toBe(1);
    });

    it('ignores unmatched isolate openers', () => {
        // LRI without PDI → treated as plain BN (no effect)
        const runs = resolveBidiRuns('A\u2066B');
        expect(runs.map(r => r.text).join('')).toBe('A\u2066B');
    });

    it('ignores unmatched PDIs', () => {
        const runs = resolveBidiRuns('A\u2069B');
        expect(runs.map(r => r.text).join('')).toBe('A\u2069B');
    });

    it('handles nested isolates by re-resolving inner segments', () => {
        // RLI <Hebrew> LRI <Latin> PDI <Hebrew> PDI
        const text = '\u2067\u05D0\u2066ABC\u2069\u05D1\u2069';
        const runs = resolveBidiRuns(text);
        // Should produce both an LTR run with 'ABC' and an RTL run with hebrew
        const ltr = runs.find(r => r.text === 'ABC');
        expect(ltr?.level).toBe(0);
        const rtl = runs.find(r => r.level === 1);
        expect(rtl).toBeDefined();
    });
});

describe('Arabic GPOS MarkBasePos integration (Phase 2)', () => {
    it('positions transparent marks (harakat) on the preceding base when font has anchors', async () => {
        const { shapeArabicText } = await import('../../src/shaping/arabic-shaper.js');
        // Synthetic font data: base GID 10 with anchor (200, 500) for class 0,
        // mark GID 20 with own anchor (50, 100) at class 0, base advance 600.
        // Expected mark offset: dx = 200 - 50 - 600 = -450, dy = 500 - 100 = 400.
        const fontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 100, defaultWidth: 600, ascent: 1000, descent: -200, bbox: [0, 0, 1000, 1000], capHeight: 700, stemV: 80 },
            fontName: 'Test',
            // U+0628 (Arabic beh) → 10, U+064E (fatha mark) → 20
            cmap: { 0x0628: 10, 0x064E: 20, 0x20: 30 },
            defaultWidth: 600,
            widths: { 10: 600, 20: 0, 30: 250 },
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
            ligatures: null,
            markAnchors: {
                marks: { 20: [0, 50, 100] as [number, number, number] },
                bases: { 10: { 0: [200, 500] as [number, number] } },
            },
            mark2mark: null,
        };
        const glyphs = shapeArabicText('\u0628\u064E', fontData);
        // Expect 2 glyphs: base at (0,0), mark at (-450, 400) with zero advance
        expect(glyphs.length).toBe(2);
        expect(glyphs[1].isZeroAdvance).toBe(true);
        expect(glyphs[1].dx).toBe(-450);
        expect(glyphs[1].dy).toBe(400);
    });

    it('falls back to (0,0) for marks when font has no anchor entries', async () => {
        const { shapeArabicText } = await import('../../src/shaping/arabic-shaper.js');
        const fontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 100, defaultWidth: 600, ascent: 1000, descent: -200, bbox: [0, 0, 1000, 1000], capHeight: 700, stemV: 80 },
            fontName: 'Test',
            cmap: { 0x0628: 10, 0x064E: 20 },
            defaultWidth: 600,
            widths: { 10: 600, 20: 0 },
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
            ligatures: null,
            markAnchors: null,
            mark2mark: null,
        };
        const glyphs = shapeArabicText('\u0628\u064E', fontData);
        expect(glyphs.length).toBe(2);
        expect(glyphs[1].isZeroAdvance).toBe(true);
        expect(glyphs[1].dx).toBe(0);
        expect(glyphs[1].dy).toBe(0);
    });
});
