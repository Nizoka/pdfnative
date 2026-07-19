import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergePdfs, splitPdf, extractPages } from '../../src/parser/pdf-pagetree.js';

/**
 * Byte-regression guard for the page-tree API.
 *
 * The committed fixtures were produced by the v1.5.0 implementation (before
 * the v1.6.0 streaming refactor). mergePdfs / splitPdf / extractPages must
 * keep emitting these exact bytes: the refactor into an incremental emitter
 * is required to be a pure representation change, and the streamed variants
 * are byte-identical to the buffered ones by contract.
 */
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'pagetree');

function fixture(name: string): Uint8Array {
    return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

const alpha = fixture('src-alpha-3p.pdf');
const bravo = fixture('src-bravo-2p-link.pdf');
const five = fixture('src-quinq-5p.pdf');

describe('page-tree golden fixtures (v1.5.0 bytes)', () => {
    it('mergePdfs output is byte-identical to the committed golden', () => {
        expect(mergePdfs([alpha, bravo])).toEqual(fixture('golden-merged-alpha-bravo.pdf'));
    });

    it('extractPages output is byte-identical to the committed golden', () => {
        expect(extractPages(five, [4, 0, 2])).toEqual(fixture('golden-extract-4-0-2.pdf'));
    });

    it('splitPdf outputs are byte-identical to the committed goldens', () => {
        const parts = splitPdf(five, [{ start: 0, end: 1 }, { start: 2, end: 4 }]);
        expect(parts).toHaveLength(2);
        expect(parts[0]).toEqual(fixture('golden-split-part0.pdf'));
        expect(parts[1]).toEqual(fixture('golden-split-part1.pdf'));
    });
});
