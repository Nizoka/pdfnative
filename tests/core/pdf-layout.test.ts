import { describe, it, expect } from 'vitest';
import {
    PG_W, PG_H,
    DEFAULT_MARGINS, DEFAULT_CW,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    ROW_H, TH_H, INFO_LN, BAL_H, TITLE_LN, FT_H,
    computeColumnPositions, resolveLayout,
} from '../../src/core/pdf-layout.js';

describe('Layout Constants', () => {
    it('should have correct A4 dimensions', () => {
        expect(PG_W).toBeCloseTo(595.28, 1);
        expect(PG_H).toBeCloseTo(841.89, 1);
    });

    it('should have consistent content width', () => {
        expect(DEFAULT_CW).toBeCloseTo(PG_W - DEFAULT_MARGINS.l - DEFAULT_MARGINS.r, 2);
    });

    it('should have positive row heights', () => {
        expect(ROW_H).toBeGreaterThan(0);
        expect(TH_H).toBeGreaterThan(0);
        expect(BAL_H).toBeGreaterThan(0);
        expect(TITLE_LN).toBeGreaterThan(0);
        expect(FT_H).toBeGreaterThan(0);
        expect(INFO_LN).toBeGreaterThan(0);
    });

    it('should have valid default colors (PDF RGB format)', () => {
        const rgbPattern = /^\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/;
        for (const [, value] of Object.entries(DEFAULT_COLORS)) {
            expect(value).toMatch(rgbPattern);
        }
    });

    it('should have default columns summing to ~1.0', () => {
        const sum = DEFAULT_COLUMNS.reduce((acc, col) => acc + col.f, 0);
        expect(sum).toBeCloseTo(1.0, 2);
    });

    it('should have valid column alignments', () => {
        for (const col of DEFAULT_COLUMNS) {
            expect(['l', 'r', 'c']).toContain(col.a);
        }
    });

    it('should have valid font sizes', () => {
        expect(DEFAULT_FONT_SIZES.title).toBeGreaterThan(DEFAULT_FONT_SIZES.td);
        expect(DEFAULT_FONT_SIZES.th).toBeGreaterThan(0);
        expect(DEFAULT_FONT_SIZES.ft).toBeGreaterThan(0);
    });
});

describe('computeColumnPositions', () => {
    it('should compute X positions from left margin', () => {
        const columns = [
            { f: 0.5, a: 'l' as const, mx: 20, mxH: 20 },
            { f: 0.5, a: 'r' as const, mx: 20, mxH: 20 },
        ];
        const { cx, cwi } = computeColumnPositions(columns, 36, 500);
        expect(cx[0]).toBe(36);
        expect(cx[1]).toBe(286);
        expect(cwi[0]).toBe(250);
        expect(cwi[1]).toBe(250);
    });

    it('should handle single column', () => {
        const columns = [{ f: 1.0, a: 'l' as const, mx: 50, mxH: 50 }];
        const { cx, cwi } = computeColumnPositions(columns, 0, 600);
        expect(cx[0]).toBe(0);
        expect(cwi[0]).toBe(600);
    });

    it('should work with default columns', () => {
        const { cx, cwi } = computeColumnPositions(DEFAULT_COLUMNS, DEFAULT_MARGINS.l, DEFAULT_CW);
        expect(cx.length).toBe(DEFAULT_COLUMNS.length);
        expect(cwi.length).toBe(DEFAULT_COLUMNS.length);
        // All X positions should be >= margin
        for (const x of cx) expect(x).toBeGreaterThanOrEqual(DEFAULT_MARGINS.l);
    });
});

describe('resolveLayout', () => {
    it('should return defaults when no options provided', () => {
        const layout = resolveLayout();
        expect(layout.pgW).toBe(PG_W);
        expect(layout.pgH).toBe(PG_H);
        expect(layout.columns).toBe(DEFAULT_COLUMNS);
        expect(layout.cx.length).toBe(DEFAULT_COLUMNS.length);
    });

    it('should override page width', () => {
        const layout = resolveLayout({ pageWidth: 612 });
        expect(layout.pgW).toBe(612);
        expect(layout.cw).toBe(612 - DEFAULT_MARGINS.l - DEFAULT_MARGINS.r);
    });

    it('should override margins', () => {
        const layout = resolveLayout({ margins: { t: 50, r: 50, b: 50, l: 50 } });
        expect(layout.mg.t).toBe(50);
        expect(layout.cw).toBe(PG_W - 100);
    });

    it('should recompute column positions with new margins', () => {
        const layout = resolveLayout({ margins: { t: 10, r: 10, b: 10, l: 100 } });
        expect(layout.cx[0]).toBe(100);
    });
});
