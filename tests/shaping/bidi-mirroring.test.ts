import { describe, it, expect } from 'vitest';
import { mirrorCodePoint } from '../../src/shaping/bidi.js';
import { BIDI_MIRRORING_PAIRS, BIDI_MIRRORING_COUNT } from '../../src/shaping/bidi-mirroring-data.js';

// ── Generated Bidi_Mirroring_Glyph table (UAX #9 L4) ─────────────────

describe('bidi-mirroring-data', () => {
    it('should store one [from, to] pair per UCD mapping', () => {
        expect(BIDI_MIRRORING_PAIRS.length).toBe(BIDI_MIRRORING_COUNT * 2);
        // Unicode 9+ ships well over 400 mappings; guard against a truncated
        // regeneration ever being committed.
        expect(BIDI_MIRRORING_COUNT).toBeGreaterThanOrEqual(400);
    });

    it('should contain only valid, distinct code points', () => {
        for (let i = 0; i < BIDI_MIRRORING_PAIRS.length; i += 2) {
            const from = BIDI_MIRRORING_PAIRS[i];
            const to = BIDI_MIRRORING_PAIRS[i + 1];
            expect(Number.isInteger(from)).toBe(true);
            expect(Number.isInteger(to)).toBe(true);
            expect(from).toBeGreaterThan(0);
            expect(to).toBeGreaterThan(0);
            expect(from).toBeLessThanOrEqual(0x10FFFF);
            expect(to).toBeLessThanOrEqual(0x10FFFF);
            expect(from).not.toBe(to);
        }
    });

    it('should have no duplicate source code points', () => {
        const seen = new Set<number>();
        for (let i = 0; i < BIDI_MIRRORING_PAIRS.length; i += 2) {
            expect(seen.has(BIDI_MIRRORING_PAIRS[i])).toBe(false);
            seen.add(BIDI_MIRRORING_PAIRS[i]);
        }
    });

    it('should map every table entry through mirrorCodePoint', () => {
        for (let i = 0; i < BIDI_MIRRORING_PAIRS.length; i += 2) {
            expect(mirrorCodePoint(BIDI_MIRRORING_PAIRS[i])).toBe(BIDI_MIRRORING_PAIRS[i + 1]);
        }
    });

    it('should round-trip every symmetric mapping', () => {
        // Most mappings are true pairs; the UCD also lists asymmetric
        // "BEST FIT" entries whose target has no entry of its own. For every
        // source whose target IS also a source, the pair must round-trip.
        const map = new Map<number, number>();
        for (let i = 0; i < BIDI_MIRRORING_PAIRS.length; i += 2) {
            map.set(BIDI_MIRRORING_PAIRS[i], BIDI_MIRRORING_PAIRS[i + 1]);
        }
        let symmetric = 0;
        for (const [from, to] of map) {
            const back = map.get(to);
            if (back !== undefined && back === from) symmetric++;
        }
        // The overwhelming majority of the table round-trips.
        expect(symmetric).toBeGreaterThan(BIDI_MIRRORING_COUNT * 0.9);
    });

    it('should cover the classic delimiter pairs', () => {
        const expectPair = (a: number, b: number): void => {
            expect(mirrorCodePoint(a)).toBe(b);
            expect(mirrorCodePoint(b)).toBe(a);
        };
        expectPair(0x0028, 0x0029); // ( )
        expectPair(0x005B, 0x005D); // [ ]
        expectPair(0x007B, 0x007D); // { }
        expectPair(0x003C, 0x003E); // < >
        expectPair(0x00AB, 0x00BB); // « »
        expectPair(0x2039, 0x203A); // ‹ ›
        expectPair(0x27E8, 0x27E9); // ⟨ ⟩
        expectPair(0x2264, 0x2265); // ≤ ≥ — math operators, new with the full table
        expectPair(0x2282, 0x2283); // ⊂ ⊃
    });

    it('should return unmapped code points unchanged', () => {
        expect(mirrorCodePoint(0x0041)).toBe(0x0041); // A
        expect(mirrorCodePoint(0x05D0)).toBe(0x05D0); // א
        expect(mirrorCodePoint(0x0021)).toBe(0x0021); // ! (Bidi_Mirrored=No)
    });
});
