import { describe, it, expect } from 'vitest';
import {
    PG_W, PG_H,
    DEFAULT_MARGINS, DEFAULT_CW,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    ROW_H, TH_H, INFO_LN, BAL_H, TITLE_LN, FT_H, HEADER_H,
    PAGE_SIZES,
    computeColumnPositions, resolveLayout, resolveTemplate,
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
        expect(HEADER_H).toBeGreaterThan(0);
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

describe('PAGE_SIZES', () => {
    it('should have correct A4 dimensions', () => {
        expect(PAGE_SIZES.A4.width).toBeCloseTo(595.28, 1);
        expect(PAGE_SIZES.A4.height).toBeCloseTo(841.89, 1);
    });

    it('should have correct US Letter dimensions', () => {
        expect(PAGE_SIZES.Letter.width).toBe(612);
        expect(PAGE_SIZES.Letter.height).toBe(792);
    });

    it('should have correct Legal dimensions', () => {
        expect(PAGE_SIZES.Legal.width).toBe(612);
        expect(PAGE_SIZES.Legal.height).toBe(1008);
    });

    it('should have correct A3 dimensions', () => {
        expect(PAGE_SIZES.A3.width).toBeCloseTo(841.89, 1);
        expect(PAGE_SIZES.A3.height).toBeCloseTo(1190.55, 1);
    });

    it('should have correct Tabloid dimensions', () => {
        expect(PAGE_SIZES.Tabloid.width).toBe(792);
        expect(PAGE_SIZES.Tabloid.height).toBe(1224);
    });

    it('should have A4 width matching PG_W', () => {
        expect(PAGE_SIZES.A4.width).toBe(PG_W);
        expect(PAGE_SIZES.A4.height).toBe(PG_H);
    });
});

describe('resolveTemplate', () => {
    it('should replace {page} placeholder', () => {
        expect(resolveTemplate('Page {page}', 3, 10, 'Title', '2026-01-15')).toBe('Page 3');
    });

    it('should replace {pages} placeholder', () => {
        expect(resolveTemplate('{pages} pages', 1, 5, 'Title', '2026-01-15')).toBe('5 pages');
    });

    it('should replace {date} placeholder', () => {
        expect(resolveTemplate('Date: {date}', 1, 1, 'Title', '2026-04-11')).toBe('Date: 2026-04-11');
    });

    it('should replace {title} placeholder', () => {
        expect(resolveTemplate('{title}', 1, 1, 'My Report', '2026-01-01')).toBe('My Report');
    });

    it('should replace all placeholders in one template', () => {
        const result = resolveTemplate('{title} – Page {page}/{pages} – {date}', 2, 8, 'Report', '2026-04-11');
        expect(result).toBe('Report – Page 2/8 – 2026-04-11');
    });

    it('should handle multiple occurrences of same placeholder', () => {
        expect(resolveTemplate('{page} of {page}', 7, 10, '', '')).toBe('7 of 7');
    });

    it('should return string unchanged when no placeholders present', () => {
        expect(resolveTemplate('No placeholders here', 1, 1, '', '')).toBe('No placeholders here');
    });

    it('should handle empty string template', () => {
        expect(resolveTemplate('', 1, 1, '', '')).toBe('');
    });

    it('should handle empty title and date', () => {
        expect(resolveTemplate('{title}-{date}', 1, 1, '', '')).toBe('-');
    });
});
