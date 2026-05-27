/**
 * Tests for UAX #9 explicit embedding/override normalization.
 *
 * Validates that LRE/RLE/LRO/RLO/PDF code points are mapped to their
 * sealed-isolate equivalents (LRI/RLI/PDI) before the existing isolate
 * pipeline runs, and that the resolved BiDi runs are equivalent.
 */

import { describe, it, expect } from 'vitest';
import { normalizeBidiEmbeddings, resolveBidiRuns } from '../../src/index.js';

const LRE = '\u202A', RLE = '\u202B', PDF = '\u202C', LRO = '\u202D', RLO = '\u202E';
const LRI = '\u2066', RLI = '\u2067', PDI = '\u2069';

describe('normalizeBidiEmbeddings', () => {
    it('passes through text without embedding markers unchanged', () => {
        expect(normalizeBidiEmbeddings('hello world')).toBe('hello world');
        expect(normalizeBidiEmbeddings('שלום')).toBe('שלום');
        expect(normalizeBidiEmbeddings('')).toBe('');
    });

    it('maps LRE → LRI and matched PDF → PDI', () => {
        expect(normalizeBidiEmbeddings(`a${LRE}b${PDF}c`)).toBe(`a${LRI}b${PDI}c`);
    });

    it('maps RLE → RLI and matched PDF → PDI', () => {
        expect(normalizeBidiEmbeddings(`a${RLE}b${PDF}c`)).toBe(`a${RLI}b${PDI}c`);
    });

    it('maps LRO → LRI (base direction L)', () => {
        expect(normalizeBidiEmbeddings(`a${LRO}b${PDF}c`)).toBe(`a${LRI}b${PDI}c`);
    });

    it('maps RLO → RLI (base direction R)', () => {
        expect(normalizeBidiEmbeddings(`a${RLO}b${PDF}c`)).toBe(`a${RLI}b${PDI}c`);
    });

    it('drops orphan PDF markers', () => {
        expect(normalizeBidiEmbeddings(`a${PDF}b`)).toBe('ab');
    });

    it('handles nested embeddings', () => {
        const input = `a${LRE}b${RLE}c${PDF}d${PDF}e`;
        const expected = `a${LRI}b${RLI}c${PDI}d${PDI}e`;
        expect(normalizeBidiEmbeddings(input)).toBe(expected);
    });

    it('emits no PDI for unclosed embedding (truncated input)', () => {
        // Unclosed LRE — the isolate pipeline will treat the rest of the
        // text as scoped by the LRI we emit; no PDI inserted.
        expect(normalizeBidiEmbeddings(`a${LRE}b`)).toBe(`a${LRI}b`);
    });

    it('respects max stack depth (125) by dropping deep markers', () => {
        let input = '';
        for (let i = 0; i < 130; i++) input += LRE;
        input += 'x';
        for (let i = 0; i < 130; i++) input += PDF;
        const out = normalizeBidiEmbeddings(input);
        // Should produce at most 125 LRI markers and 125 PDI markers.
        const lriCount = (out.match(/\u2066/g) ?? []).length;
        const pdiCount = (out.match(/\u2069/g) ?? []).length;
        expect(lriCount).toBeLessThanOrEqual(125);
        expect(pdiCount).toBeLessThanOrEqual(125);
        expect(out).toContain('x');
    });
});

describe('resolveBidiRuns with embeddings', () => {
    it('LRE around RTL content forces L base direction', () => {
        // "abc<LRE>שלום<PDF>def" — outer paragraph is LTR; the embedded
        // Hebrew "שלום" should appear in its own RTL run between the
        // English words.
        const runs = resolveBidiRuns(`abc${LRE}שלום${PDF}def`);
        // We expect multiple runs covering English and Hebrew content.
        expect(runs.length).toBeGreaterThanOrEqual(2);
        const allText = runs.map(r => r.text).join('');
        expect(allText).toContain('abc');
        expect(allText).toContain('def');
        // Hebrew comes back in visual (reversed) order.
        expect(allText).toContain('םולש');
    });

    it('RLE around LTR content forces R base direction', () => {
        const runs = resolveBidiRuns(`שלום${RLE}abc${PDF}עולם`);
        const allText = runs.map(r => r.text).join('');
        expect(allText).toContain('abc');
        // Hebrew comes back in visual (reversed) order.
        expect(allText).toContain('םולש');
        expect(allText).toContain('םלוע');
    });

    it('embeddings produce results equivalent to isolates', () => {
        const embedVersion = `abc${LRE}שלום${PDF}def`;
        const isolateVersion = `abc${LRI}שלום${PDI}def`;
        const embedRuns = resolveBidiRuns(embedVersion);
        const isolateRuns = resolveBidiRuns(isolateVersion);
        expect(embedRuns.length).toBe(isolateRuns.length);
        for (let i = 0; i < embedRuns.length; i++) {
            expect(embedRuns[i].text).toBe(isolateRuns[i].text);
            expect(embedRuns[i].level).toBe(isolateRuns[i].level);
        }
    });

    it('preserves existing isolate behaviour when no embeddings present', () => {
        const runs = resolveBidiRuns(`abc${LRI}שלום${PDI}def`);
        expect(runs.length).toBeGreaterThanOrEqual(2);
    });
});
