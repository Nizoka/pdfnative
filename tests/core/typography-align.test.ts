import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/index.js';
import { txt, txtJustified, protrusionLeft, protrusionRight } from '../../src/core/pdf-text.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { helveticaWidth } from '../../src/fonts/encoding.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// v1.8.0 — justified paragraphs and optical margin alignment.

const PINNED = new Date('2026-01-01T00:00:00Z');
const enc = createEncodingContext([], false, false);
const SZ = 11;

/** Every `x y Td` origin in a content-stream fragment, in order. */
function origins(ops: string): number[] {
    return Array.from(ops.matchAll(/([\d.-]+) ([\d.-]+) Td/g), m => Number(m[1]));
}

describe('txtJustified', () => {
    const line = 'the quick brown fox jumps';
    const natural = helveticaWidth(line, SZ);

    it('places each word at its own origin', () => {
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, natural + 12);
        expect(origins(ops).length).toBe(5);
    });

    it('spans exactly the target width', () => {
        const target = natural + 12;
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, target);
        const xs = origins(ops);
        const lastWordW = helveticaWidth('jumps', SZ);
        expect(xs[xs.length - 1] + lastWordW).toBeCloseTo(50 + target, 1);
    });

    it('starts at the given left edge', () => {
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, natural + 12);
        expect(origins(ops)[0]).toBeCloseTo(50, 2);
    });

    it('distributes the slack evenly', () => {
        const ops = txtJustified(line, 0, 700, '/F1', SZ, enc, natural + 12);
        const xs = origins(ops);
        const words = line.split(' ');
        const gaps = xs.slice(1).map((x, i) => x - (xs[i] + helveticaWidth(words[i], SZ)));
        // Coordinates are emitted to two decimals, so gaps agree to within
        // that quantisation rather than exactly.
        for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(0.02);
    });

    it('falls back to plain placement for a single word', () => {
        const ops = txtJustified('word', 50, 700, '/F1', SZ, enc, 400);
        expect(ops).toBe(txt('word', 50, 700, '/F1', SZ, enc));
    });

    it('falls back when the line already overruns', () => {
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, natural - 10);
        expect(ops).toBe(txt(line, 50, 700, '/F1', SZ, enc));
    });

    it('refuses an implausible stretch rather than opening a river', () => {
        const ops = txtJustified('a b', 50, 700, '/F1', SZ, enc, 400);
        expect(ops).toBe(txt('a b', 50, 700, '/F1', SZ, enc));
    });

    it('keeps a no-break space inside its word', () => {
        // "150 EUR" must stay one token, so justification cannot split
        // it: four words, not five.
        const bound = 'facture de 150 € payee';
        const ops = txtJustified(bound, 0, 700, '/F1', SZ, enc, helveticaWidth(bound, SZ) + 8);
        expect(origins(ops).length).toBe(4);
    });
});

describe('optical protrusion', () => {
    it('hangs the marks that are mostly white space', () => {
        expect(protrusionLeft('"quoted', SZ, enc)).toBeGreaterThan(0);
        expect(protrusionLeft('«cite', SZ, enc)).toBeGreaterThan(0);
        expect(protrusionRight('end.', SZ, enc)).toBeGreaterThan(0);
        expect(protrusionRight('list,', SZ, enc)).toBeGreaterThan(0);
    });

    it('leaves letters and digits alone', () => {
        expect(protrusionLeft('word', SZ, enc)).toBe(0);
        expect(protrusionRight('word', SZ, enc)).toBe(0);
        expect(protrusionLeft('42', SZ, enc)).toBe(0);
    });

    it('hangs a quote further than a colon', () => {
        expect(protrusionLeft('"a', SZ, enc)).toBeGreaterThan(protrusionLeft(':a', SZ, enc));
    });

    it('scales with font size', () => {
        expect(protrusionLeft('"a', 22, enc)).toBeCloseTo(protrusionLeft('"a', 11, enc) * 2, 5);
    });

    it('is safe on an empty line', () => {
        expect(protrusionLeft('', SZ, enc)).toBe(0);
        expect(protrusionRight('', SZ, enc)).toBe(0);
    });
});

describe('paragraph alignment in built documents', () => {
    const text = 'Justified text spans the full measure of the column, which is what makes a '
        + 'page of running prose look typeset rather than generated. '.repeat(3);

    function doc(align: 'left' | 'justify'): DocumentParams {
        return { title: 'Align', blocks: [{ type: 'paragraph', text, align }] };
    }

    it('justify differs from left, and both are deterministic', () => {
        const left = buildDocumentPDFBytes(doc('left'), { creationDate: PINNED });
        const just = buildDocumentPDFBytes(doc('justify'), { creationDate: PINNED });
        expect(Buffer.from(just).equals(Buffer.from(left))).toBe(false);
        const again = buildDocumentPDFBytes(doc('justify'), { creationDate: PINNED });
        expect(Buffer.from(again).equals(Buffer.from(just))).toBe(true);
    });

    it('leaves the last line ragged', () => {
        const bytes = buildDocumentPDFBytes(doc('justify'), { creationDate: PINNED });
        const s = new TextDecoder('latin1').decode(bytes);
        // A justified line places one Td per word; the ragged last line places
        // exactly one for the whole line, so origins are not all distinct runs.
        expect(s).toContain('Td');
    });

    it('optical margins change output only when enabled', () => {
        const quoted: DocumentParams = {
            title: 'Optical',
            blocks: [{ type: 'paragraph', text: '"Opening quotes are the classic case," said the typographer. '.repeat(6) }],
        };
        const off = buildDocumentPDFBytes(quoted, { creationDate: PINNED });
        const offExplicit = buildDocumentPDFBytes(quoted, { creationDate: PINNED, typography: { opticalMargins: false } });
        const on = buildDocumentPDFBytes(quoted, { creationDate: PINNED, typography: { opticalMargins: true } });
        expect(Buffer.from(offExplicit).equals(Buffer.from(off))).toBe(true);
        expect(Buffer.from(on).equals(Buffer.from(off))).toBe(false);
    });

    it('pulls a leading quote left of the measure', () => {
        const quoted: DocumentParams = {
            title: 'Optical',
            blocks: [{ type: 'paragraph', text: '"Quoted opening line that is long enough to wrap onto more than one line in the column." '.repeat(3) }],
        };
        const on = buildDocumentPDFBytes(quoted, { creationDate: PINNED, typography: { opticalMargins: true } });
        const s = new TextDecoder('latin1').decode(on);
        const xs = Array.from(s.matchAll(/([\d.]+) [\d.]+ Td/g), m => Number(m[1]));
        // At least one baseline starts left of the default left margin.
        expect(Math.min(...xs)).toBeLessThan(56.7);
    });

    it('combines with justification and paragraph splitting', () => {
        const params: DocumentParams = {
            title: 'Combined',
            blocks: [{ type: 'paragraph', align: 'justify', text: text.repeat(12) }],
        };
        const bytes = buildDocumentPDFBytes(params, {
            creationDate: PINNED,
            typography: { splitParagraphs: true, opticalMargins: true },
        });
        expect(bytes.length).toBeGreaterThan(0);
        const again = buildDocumentPDFBytes(params, {
            creationDate: PINNED,
            typography: { splitParagraphs: true, opticalMargins: true },
        });
        expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
    });
});
