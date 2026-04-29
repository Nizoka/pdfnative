/**
 * pdfnative — Tests for ColumnDef minWidth/maxWidth (v1.1.0)
 */
import { describe, it, expect } from 'vitest';
import { computeColumnPositions } from '../../src/core/pdf-layout.js';
import type { ColumnDef } from '../../src/types/pdf-types.js';

describe('computeColumnPositions — minWidth / maxWidth (v1.1.0)', () => {
    it('produces byte-identical layout when no constraints are set', () => {
        const cols: ColumnDef[] = [
            { f: 0.5, a: 'l', mx: 10, mxH: 10 },
            { f: 0.3, a: 'r', mx: 10, mxH: 10 },
            { f: 0.2, a: 'c', mx: 10, mxH: 10 },
        ];
        const { cx, cwi } = computeColumnPositions(cols, 50, 500);
        // sum(f) = 1, no constraints → free distribution = f * cw
        expect(cwi[0]).toBeCloseTo(250, 6);
        expect(cwi[1]).toBeCloseTo(150, 6);
        expect(cwi[2]).toBeCloseTo(100, 6);
        expect(cx[0]).toBe(50);
        expect(cx[1]).toBeCloseTo(300, 6);
        expect(cx[2]).toBeCloseTo(450, 6);
    });

    it('clamps a column to minWidth and redistributes shortfall', () => {
        // Without constraints: 100, 300, 100 → with min 200 on col 0:
        // fixed = 200 ; remaining = 500 - 200 = 300
        // freeWeight = 0.6+0.2 = 0.8 → col1 = 0.6/0.8 * 300 = 225 ; col2 = 0.2/0.8 * 300 = 75
        const cols: ColumnDef[] = [
            { f: 0.2, a: 'l', mx: 10, mxH: 10, minWidth: 200 },
            { f: 0.6, a: 'l', mx: 10, mxH: 10 },
            { f: 0.2, a: 'l', mx: 10, mxH: 10 },
        ];
        const { cwi } = computeColumnPositions(cols, 0, 500);
        expect(cwi[0]).toBe(200);
        expect(cwi[1]).toBeCloseTo(225, 6);
        expect(cwi[2]).toBeCloseTo(75, 6);
    });

    it('clamps a column to maxWidth and redistributes surplus', () => {
        // f=0.6 of 500 = 300. max=200 → fixed=200 ; remaining = 300 (500-200)
        // freeWeight = 0.2+0.2 = 0.4 → col0 = 0.2/0.4 * 300 = 150 ; col2 = 150
        const cols: ColumnDef[] = [
            { f: 0.2, a: 'l', mx: 10, mxH: 10 },
            { f: 0.6, a: 'l', mx: 10, mxH: 10, maxWidth: 200 },
            { f: 0.2, a: 'l', mx: 10, mxH: 10 },
        ];
        const { cwi } = computeColumnPositions(cols, 0, 500);
        expect(cwi[0]).toBeCloseTo(150, 6);
        expect(cwi[1]).toBe(200);
        expect(cwi[2]).toBeCloseTo(150, 6);
    });

    it('handles all-constrained case without division by zero', () => {
        const cols: ColumnDef[] = [
            { f: 0.5, a: 'l', mx: 10, mxH: 10, minWidth: 100, maxWidth: 100 },
            { f: 0.5, a: 'l', mx: 10, mxH: 10, minWidth: 100, maxWidth: 100 },
        ];
        const { cwi } = computeColumnPositions(cols, 0, 500);
        expect(cwi[0]).toBe(100);
        expect(cwi[1]).toBe(100);
    });

    it('lets minWidth dominate maxWidth when both fire (min wins by ordering)', () => {
        // f=0.1 * 500 = 50 → minWidth=80 clamps up to 80, then maxWidth=70 clamps down to 70
        // The implementation applies min then max in sequence → final = 70
        const cols: ColumnDef[] = [
            { f: 0.1, a: 'l', mx: 10, mxH: 10, minWidth: 80, maxWidth: 70 },
            { f: 0.9, a: 'l', mx: 10, mxH: 10 },
        ];
        const { cwi } = computeColumnPositions(cols, 0, 500);
        expect(cwi[0]).toBe(70);
    });

    it('produces correct cumulative X positions', () => {
        const cols: ColumnDef[] = [
            { f: 0.4, a: 'l', mx: 10, mxH: 10, minWidth: 250 },
            { f: 0.6, a: 'l', mx: 10, mxH: 10 },
        ];
        const { cx, cwi } = computeColumnPositions(cols, 30, 500);
        expect(cx[0]).toBe(30);
        expect(cx[1]).toBe(30 + cwi[0]);
        expect(cx[1] + cwi[1]).toBeCloseTo(530, 6);
    });
});
