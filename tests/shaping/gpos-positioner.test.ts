/**
 * Unit tests for the shared GPOS positioning helpers in gpos-positioner.ts.
 * These functions are shared by multiple script shapers (Arabic, Devanagari,
 * Tibetan, Myanmar, Khmer, Sinhala, Telugu).
 */
import { describe, it, expect } from 'vitest';
import {
    getBaseAnchor,
    getMarkAnchor,
    getMark2MarkAnchor,
    positionMarkOnBase,
} from '../../src/shaping/gpos-positioner.js';

const MARK_ANCHORS = {
    bases: { 10: { 0: [500, 800] as [number, number], 1: [400, 700] as [number, number] } },
    marks: { 20: [0, 300, 600] as [number, number, number], 21: [1, 200, 500] as [number, number, number] },
};

const MARK2MARK = {
    mark1Anchors: { 20: { 0: [450, 750] as [number, number] } },
    mark2Classes: { 21: [0, 250, 550] as [number, number, number] },
};

// ── getBaseAnchor ─────────────────────────────────────────────────────

describe('getBaseAnchor', () => {
    it('returns null when markAnchors is null', () => {
        expect(getBaseAnchor(null, 10, 0)).toBeNull();
    });

    it('returns null when markAnchors is undefined', () => {
        expect(getBaseAnchor(undefined, 10, 0)).toBeNull();
    });

    it('returns null when baseGid is not in bases', () => {
        expect(getBaseAnchor(MARK_ANCHORS, 99, 0)).toBeNull();
    });

    it('returns null when classIdx is not in base anchors', () => {
        expect(getBaseAnchor(MARK_ANCHORS, 10, 9)).toBeNull();
    });

    it('returns the anchor point when present', () => {
        expect(getBaseAnchor(MARK_ANCHORS, 10, 0)).toEqual([500, 800]);
        expect(getBaseAnchor(MARK_ANCHORS, 10, 1)).toEqual([400, 700]);
    });
});

// ── getMarkAnchor ─────────────────────────────────────────────────────

describe('getMarkAnchor', () => {
    it('returns null when markAnchors is null', () => {
        expect(getMarkAnchor(null, 20)).toBeNull();
    });

    it('returns null when markAnchors is undefined', () => {
        expect(getMarkAnchor(undefined, 20)).toBeNull();
    });

    it('returns null when markGid is not in marks', () => {
        expect(getMarkAnchor(MARK_ANCHORS, 99)).toBeNull();
    });

    it('returns the MarkAnchor when present', () => {
        expect(getMarkAnchor(MARK_ANCHORS, 20)).toEqual({ classIdx: 0, x: 300, y: 600 });
        expect(getMarkAnchor(MARK_ANCHORS, 21)).toEqual({ classIdx: 1, x: 200, y: 500 });
    });
});

// ── getMark2MarkAnchor ────────────────────────────────────────────────

describe('getMark2MarkAnchor', () => {
    it('returns null when mark2mark is null', () => {
        expect(getMark2MarkAnchor(null, 20, 0)).toBeNull();
    });

    it('returns null when mark2mark is undefined', () => {
        expect(getMark2MarkAnchor(undefined, 20, 0)).toBeNull();
    });

    it('returns null when mark1Gid is not in mark1Anchors', () => {
        expect(getMark2MarkAnchor(MARK2MARK, 99, 0)).toBeNull();
    });

    it('returns null when classIdx is not present for mark1Gid', () => {
        expect(getMark2MarkAnchor(MARK2MARK, 20, 5)).toBeNull();
    });

    it('returns the anchor point when present', () => {
        expect(getMark2MarkAnchor(MARK2MARK, 20, 0)).toEqual([450, 750]);
    });
});

// ── positionMarkOnBase ────────────────────────────────────────────────

describe('positionMarkOnBase', () => {
    it('returns null when markAnchors is null', () => {
        expect(positionMarkOnBase(null, 20, 10, 600)).toBeNull();
    });

    it('returns null when markAnchors is undefined', () => {
        expect(positionMarkOnBase(undefined, 20, 10, 600)).toBeNull();
    });

    it('returns null when mark gid is not in marks', () => {
        expect(positionMarkOnBase(MARK_ANCHORS, 99, 10, 600)).toBeNull();
    });

    it('returns null when base class anchor is not found', () => {
        // Mark 21 has classIdx 1, but base 10 has { 0, 1 } so this succeeds.
        // Use a base without that class:
        const anchors = {
            bases: { 10: { 0: [500, 800] as [number, number] } },
            marks: { 21: [1, 200, 500] as [number, number, number] }, // classIdx 1 — missing on base
        };
        expect(positionMarkOnBase(anchors, 21, 10, 600)).toBeNull();
    });

    it('computes dx and dy correctly', () => {
        // mark 20: classIdx=0, anchor=(300,600)
        // base 10: class 0 anchor=(500,800)
        // baseAdv=600
        // dx = 500 - 300 - 600 = -400
        // dy = 800 - 600 = 200
        const result = positionMarkOnBase(MARK_ANCHORS, 20, 10, 600);
        expect(result).not.toBeNull();
        expect(result!.dx).toBe(500 - 300 - 600);
        expect(result!.dy).toBe(800 - 600);
    });

    it('uses mark class index to look up base anchor', () => {
        // mark 21: classIdx=1, anchor=(200,500)
        // base 10: class 1 anchor=(400,700)
        // baseAdv=500
        // dx = 400 - 200 - 500 = -300
        // dy = 700 - 500 = 200
        const result = positionMarkOnBase(MARK_ANCHORS, 21, 10, 500);
        expect(result).not.toBeNull();
        expect(result!.dx).toBe(400 - 200 - 500);
        expect(result!.dy).toBe(700 - 500);
    });
});
