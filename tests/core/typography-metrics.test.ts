import { describe, it, expect, afterEach } from 'vitest';
import {
    buildDocumentPDFBytes, wrapText,
    setHyphenationProvider, getHyphenationProvider,
} from '../../src/index.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { txtR, txtC, protrusionLeft } from '../../src/core/pdf-text.js';
import { exactBase14Width, BASE14_TABLES } from '../../src/fonts/base14-metrics.js';
import { helveticaWidth, helveticaBoldWidth, toWinAnsi } from '../../src/fonts/encoding.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// v1.8.0 — Adobe Core 14 metrics and the hyphenation provider seam.

const PINNED = new Date('2026-01-01T00:00:00Z');
const approx = createEncodingContext([], false, false);
const exact = createEncodingContext([], false, false, 'exact');

describe('Adobe Core 14 metric tables', () => {
    it('covers every WinAnsi code from 32 to 255', () => {
        expect(BASE14_TABLES.first).toBe(0x20);
        expect(BASE14_TABLES.helvetica.length).toBe(0x100 - 0x20);
        expect(BASE14_TABLES.helveticaBold.length).toBe(0x100 - 0x20);
    });

    it('holds only plausible advances', () => {
        for (const table of [BASE14_TABLES.helvetica, BASE14_TABLES.helveticaBold]) {
            for (const w of table) {
                expect(Number.isInteger(w)).toBe(true);
                expect(w).toBeGreaterThan(0);
                expect(w).toBeLessThanOrEqual(1015);
            }
        }
    });

    it('matches known AFM values', () => {
        const w = (ch: string, bold = false): number => exactBase14Width(ch, 1000, bold);
        // Helvetica
        expect(w(' ')).toBe(278);
        expect(w('M')).toBe(833);
        expect(w('i')).toBe(222);
        expect(w('W')).toBe(944);
        expect(w('@')).toBe(1015);
        // Helvetica-Bold differs where it should
        expect(w('A', true)).toBe(722);
        expect(w('A')).toBe(667);
        expect(w('m', true)).toBe(889);
        expect(w('m')).toBe(833);
    });

    it('corrects the characters the estimate got wrong', () => {
        // Each of these fell through to the estimate's 556 default; none of
        // them is actually 556 wide. Accented capitals are the worst case:
        // the estimate's A-Z branch only covers unaccented ASCII.
        const cases: readonly [string, number][] = [
            ['@', 1015], ['%', 889], ['&', 667], ['(', 333], [')', 333],
            ['É', 667], ['Ü', 722], ['ÿ', 500], ['œ', 944], ['°', 400],
        ];
        for (const [ch, expected] of cases) {
            expect(helveticaWidth(ch, 1000)).toBe(556);
            expect(exactBase14Width(toWinAnsi(ch), 1000, false)).toBe(expected);
        }
    });

    it('is proportional to font size', () => {
        expect(exactBase14Width('Hello', 22, false)).toBeCloseTo(exactBase14Width('Hello', 11, false) * 2, 9);
    });

    it('is empty for empty input', () => {
        expect(exactBase14Width('', 11, false)).toBe(0);
    });
});

describe('layout.typography.metrics', () => {
    it('defaults to the historical estimate', () => {
        expect(approx.metrics).toBe('approximate');
        expect(approx.tw('iiii', 11)).toBe(helveticaWidth('iiii', 11));
    });

    it('measures narrow letters far more accurately in exact mode', () => {
        // 'i' is 222 units, not the 556 the estimate assumes.
        const estimated = approx.tw('iiiiiiiiii', 11);
        const measured = exact.tw('iiiiiiiiii', 11);
        expect(measured).toBeLessThan(estimated * 0.6);
        expect(measured).toBeCloseTo(222 * 10 * 11 / 1000, 6);
    });

    it('measures wide letters more accurately too', () => {
        const estimated = approx.tw('WWWW', 11);
        const measured = exact.tw('WWWW', 11);
        expect(measured).toBeGreaterThan(estimated);
    });

    it('changes where lines break', () => {
        const text = 'illimitable minimalism in a little village with limited visibility';
        const width = 120;
        expect(wrapText(text, width, 11, exact)).not.toEqual(wrapText(text, width, 11, approx));
    });

    it('leaves output byte-identical unless asked for', () => {
        const params: DocumentParams = {
            title: 'Metrics',
            blocks: [{ type: 'paragraph', text: 'Mille millions de mille sabords, dit-il. '.repeat(20) }],
        };
        const plain = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const explicit = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { metrics: 'approximate' } });
        const better = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { metrics: 'exact' } });
        expect(Buffer.from(explicit).equals(Buffer.from(plain))).toBe(true);
        expect(Buffer.from(better).equals(Buffer.from(plain))).toBe(false);
    });

    it('is deterministic in exact mode', () => {
        const params: DocumentParams = { title: 'M', blocks: [{ type: 'paragraph', text: 'abc '.repeat(50) }] };
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { metrics: 'exact' } });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { metrics: 'exact' } });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});

/**
 * Right- and centre-alignment, justification and optical margins all
 * measure through one helper. The 1.8.0 audit found it handed WinAnsi
 * bytes to the estimate, which branches on Unicode codepoints, so every
 * CP1252 punctuation mark (— … “ ” ‘ ’) measured at the 556-unit default
 * and a bidi control turned into a '?' before it could be stripped.
 */
describe('aligned text measures what it renders', () => {
    const SZ = 10;
    const originX = (ops: string): number => Number(/([\d.-]+) [\d.-]+ Td/.exec(ops)![1]);

    it('lands CP1252 punctuation on the right margin in the estimate', () => {
        for (const s of ['—', '…', '“quoted”', 'a–b', 'it’s']) {
            const x = originX(txtR(s, 300, 700, '/F1', SZ, approx));
            expect(x).toBeCloseTo(300 - helveticaWidth(s, SZ), 2);
            expect(x).toBeCloseTo(300 - approx.tw(s, SZ), 2);
        }
    });

    it('lands them on the right margin with exact metrics too', () => {
        for (const s of ['—', '…', '“quoted”']) {
            const x = originX(txtR(s, 300, 700, '/F1', SZ, exact));
            expect(x).toBeCloseTo(300 - exact.tw(s, SZ), 2);
        }
    });

    it('centres on the same width the line breaker used', () => {
        const s = 'a — b … c';
        expect(originX(txtC(s, 0, 700, '/F1', SZ, 400, approx))).toBeCloseTo((400 - approx.tw(s, SZ)) / 2, 2);
        expect(originX(txtC(s, 0, 700, '/F1', SZ, 400, exact))).toBeCloseTo((400 - exact.tw(s, SZ)) / 2, 2);
    });

    it('hangs an opening quote by half its real advance', () => {
        // Helvetica quotedblleft is 333 units: 0.5 × 3.33 pt at 10 pt.
        expect(protrusionLeft('“quoted', SZ, approx)).toBeCloseTo(1.665, 2);
        expect(protrusionLeft('“quoted', SZ, exact)).toBeCloseTo(1.665, 2);
    });

    it('ignores soft hyphens and bidi controls in both metric modes', () => {
        for (const enc of [approx, exact]) {
            const plain = originX(txtR('abcdef', 300, 700, '/F1', SZ, enc));
            expect(originX(txtR('abc­def', 300, 700, '/F1', SZ, enc))).toBeCloseTo(plain, 2);
            expect(originX(txtR('abc؜def', 300, 700, '/F1', SZ, enc))).toBeCloseTo(plain, 2);
            expect(originX(txtR('abc‎def', 300, 700, '/F1', SZ, enc))).toBeCloseTo(plain, 2);
            expect(enc.tw('abc­def', SZ)).toBeCloseTo(enc.tw('abcdef', SZ), 6);
            expect(enc.tw('abc؜def', SZ)).toBeCloseTo(enc.tw('abcdef', SZ), 6);
        }
    });

    it('measures bold text with the bold advances', () => {
        const s = '“quoted” — done';
        expect(originX(txtR(s, 300, 700, '/F2', SZ, approx, true))).toBeCloseTo(300 - helveticaBoldWidth(s, SZ), 2);
    });
});

describe('hyphenation provider', () => {
    afterEach(() => setHyphenationProvider(null));

    /** Split every word after each group of three characters. */
    const everyThree = (word: string): number[] => {
        const out: number[] = [];
        for (let i = 3; i < word.length; i += 3) out.push(i);
        return out;
    };

    it('is absent by default', () => {
        expect(getHyphenationProvider()).toBeNull();
    });

    it('round-trips through the getter', () => {
        setHyphenationProvider(everyThree);
        expect(getHyphenationProvider()).toBe(everyThree);
        setHyphenationProvider(null);
        expect(getHyphenationProvider()).toBeNull();
    });

    it('does nothing to a word that already fits', () => {
        setHyphenationProvider(everyThree);
        expect(wrapText('short words only here', 400, 11, approx).join(' ')).not.toContain('-');
    });

    it('breaks a long word that would otherwise overflow', () => {
        const word = 'anticonstitutionnellement';
        const without = wrapText(word, 60, 11, approx);
        setHyphenationProvider(everyThree);
        const withProvider = wrapText(word, 60, 11, approx);
        expect(withProvider.length).toBeGreaterThan(1);
        expect(withProvider[0].endsWith('-')).toBe(true);
        expect(without[0].endsWith('-')).toBe(false);
    });

    it('loses no characters', () => {
        setHyphenationProvider(everyThree);
        const word = 'anticonstitutionnellement';
        const joined = wrapText(word, 60, 11, approx).join('').split('-').join('');
        expect(joined).toBe(word);
    });

    it('lets an author-written soft hyphen win over a computed one', () => {
        // The provider would break after three characters; the author's hint
        // sits later, and that is where the break must fall.
        setHyphenationProvider(everyThree);
        const lines = wrapText('anticonstitution­nellement', 95, 11, approx);
        expect(lines[0]).toBe('anticonstitution-');
    });

    it('ignores positions outside the word', () => {
        setHyphenationProvider(() => [-1, 0, 999]);
        const word = 'anticonstitutionnellement';
        expect(wrapText(word, 60, 11, approx).join('')).not.toContain('-');
    });

    it('survives a provider that throws', () => {
        setHyphenationProvider(() => { throw new Error('boom'); });
        expect(() => wrapText('anticonstitutionnellement', 60, 11, approx)).not.toThrow();
    });

    it('leaves short words alone', () => {
        let seen: string[] = [];
        setHyphenationProvider((w) => { seen.push(w); return []; });
        wrapText('a bc def', 4, 11, approx);
        for (const w of seen) expect(w.length).toBeGreaterThanOrEqual(4);
    });

    it('produces reproducible documents', () => {
        setHyphenationProvider(everyThree);
        const params: DocumentParams = {
            title: 'Hyphen',
            blocks: [{ type: 'paragraph', text: 'anticonstitutionnellement '.repeat(30), indent: 340 }],
        };
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});
