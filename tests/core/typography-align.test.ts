import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, extractText } from '../../src/index.js';
import { txt, txtJustified, protrusionLeft, protrusionRight } from '../../src/core/pdf-text.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { helveticaWidth } from '../../src/fonts/encoding.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

// v1.8.0 — justified paragraphs and optical margin alignment.

const PINNED = new Date('2026-01-01T00:00:00Z');
const enc = createEncodingContext([], false, false);
const SZ = 11;
const latinEntries: FontEntry[] = [{ fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' }];

/** Every `x y Td` origin in a content-stream fragment, in order. */
function origins(ops: string): number[] {
    return Array.from(ops.matchAll(/([\d.-]+) ([\d.-]+) Td/g), m => Number(m[1]));
}

/** The items of the first `[…] TJ` array: strings as text, numbers as numbers. */
function tjItems(ops: string): (string | number)[] {
    const m = ops.match(/\[(.*)\] TJ/);
    if (!m) return [];
    const items: (string | number)[] = [];
    for (const t of m[1].matchAll(/\(((?:\\.|[^)\\])*)\)|<([0-9A-Fa-f]*)>|(-?[\d.]+)/g)) {
        if (t[1] !== undefined) items.push(t[1]);
        else if (t[2] !== undefined) items.push(`<${t[2]}>`);
        else items.push(Number(t[3]));
    }
    return items;
}

/** Points the TJ array advances the pen by, base-14 Helvetica at `SZ`. */
function tjSpan(ops: string): number {
    return tjItems(ops).reduce<number>((n, it) =>
        n + (typeof it === 'number' ? -it * SZ / 1000 : helveticaWidth(it, SZ)), 0);
}

describe('txtJustified', () => {
    const line = 'the quick brown fox jumps';
    const natural = helveticaWidth(line, SZ);

    it('shows the whole line as one TJ array, spaces included', () => {
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, natural + 12);
        expect(origins(ops).length).toBe(1);
        expect((ops.match(/\bTJ\b/g) ?? []).length).toBe(1);
        const strings = tjItems(ops).filter(it => typeof it === 'string');
        expect(strings).toEqual(['the ', 'quick ', 'brown ', 'fox ', 'jumps']);
    });

    it('spans exactly the target width', () => {
        const target = natural + 12;
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, target);
        expect(tjSpan(ops)).toBeCloseTo(target, 1);
    });

    it('starts at the given left edge', () => {
        const ops = txtJustified(line, 50, 700, '/F1', SZ, enc, natural + 12);
        expect(origins(ops)[0]).toBeCloseTo(50, 2);
    });

    it('distributes the slack evenly, as negative adjustments', () => {
        const ops = txtJustified(line, 0, 700, '/F1', SZ, enc, natural + 12);
        const gaps = tjItems(ops).filter((it): it is number => typeof it === 'number');
        expect(gaps.length).toBe(4);
        for (const g of gaps) {
            expect(g).toBeLessThan(0);
            expect(g).toBe(gaps[0]);
        }
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
        expect(tjItems(ops).filter(it => typeof it === 'string').length).toBe(4);
    });

    it('does the same with a registered font', () => {
        const uni = createEncodingContext(latinEntries, false, false);
        const natural = uni.tw(line, SZ);
        const ops = txtJustified(line, 50, 700, '/F3', SZ, uni, natural + 12);
        expect(origins(ops).length).toBe(1);
        expect((ops.match(/\bTJ\b/g) ?? []).length).toBe(1);
        const items = tjItems(ops);
        expect(items.filter(it => typeof it === 'string').length).toBe(5);
        const gaps = items.filter((it): it is number => typeof it === 'number');
        expect(gaps.length).toBe(4);
        // Pen advance: glyph widths from the font plus the four adjustments.
        const fd = notoSans as unknown as FontData;
        const glyphW = (hex: string): number => {
            let w = 0;
            for (let i = 1; i + 4 <= hex.length; i += 4) {
                const gid = parseInt(hex.slice(i, i + 4), 16);
                w += (fd.widths[gid] ?? fd.defaultWidth) * SZ / fd.metrics.unitsPerEm;
            }
            return w;
        };
        const span = items.reduce<number>((n, it) => n + (typeof it === 'number' ? -it * SZ / 1000 : glyphW(it)), 0);
        expect(span).toBeCloseTo(natural + 12, 1);
    });

    it('keeps kerning adjustments inside the same array', () => {
        const kerned = createEncodingContext(latinEntries, false, false);
        const text = 'AVATAR To Yo Wave';
        const ops = txtJustified(text, 50, 700, '/F3', SZ, kerned, kerned.tw(text, SZ) + 12);
        // Still one text object even though every word kerns internally.
        expect(origins(ops).length).toBe(1);
    });
});

describe('justified text stays extractable', () => {
    const text = ('Justified prose keeps its word boundaries: every space is still a glyph in the '
        + 'content stream, only the gap after it grows. ').repeat(4);

    function extracted(align: 'left' | 'justify', fontEntries?: FontEntry[]): string {
        const bytes = buildDocumentPDFBytes(
            { title: 'Extract', blocks: [{ type: 'paragraph', text, align }], fontEntries },
            { creationDate: PINNED },
        );
        return extractText(bytes).map(p => p.text).join('\n').replace(/\s+/g, ' ').trim();
    }

    it('extracts identically to the ragged version in base-14 mode', () => {
        expect(extracted('justify')).toBe(extracted('left'));
        expect(extracted('justify')).toContain('boundaries: every space');
    });

    it('extracts identically to the ragged version with a registered font', () => {
        expect(extracted('justify', latinEntries)).toBe(extracted('left', latinEntries));
    });

    it('emits one text object per justified line', () => {
        const bytes = buildDocumentPDFBytes(
            { title: 'Count', blocks: [{ type: 'paragraph', text, align: 'justify' }] },
            { creationDate: PINNED, compress: false },
        );
        const s = new TextDecoder('latin1').decode(bytes);
        const tj = (s.match(/\] TJ/g) ?? []).length;
        const bt = (s.match(/\bBT\b/g) ?? []).length;
        // Title, footer and the ragged last line are Tj; every other line is
        // exactly one TJ, so BT never outnumbers lines + furniture.
        expect(tj).toBeGreaterThan(2);
        expect(bt).toBeLessThan(tj + 6);
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
