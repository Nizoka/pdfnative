/**
 * pdfnative — Issue #48 regression: WinAnsi /ToUnicode CMap
 * =========================================================
 * Text containing the Euro sign `€` (U+20AC) and the other CP1252 0x80–0x9F
 * glyphs (curly quotes, em-dash, …) must:
 *   1. Emit the correct WinAnsi byte (0x80 for €) — never `?` (0x3F).
 *   2. Carry a /ToUnicode CMap on the base-14 Latin fonts so the text is
 *      selectable/searchable and minimal viewers resolve the glyph.
 *
 * See https://github.com/Nizoka/pdfnative/issues/48
 */
import { describe, it, expect } from 'vitest';
import { buildWinAnsiToUnicodeCMap, toWinAnsi } from '../../src/fonts/encoding.js';
import { buildPDF } from '../../src/core/pdf-builder.js';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';

const EURO = '\u20AC';
const SAMPLE = `Total 12.00 ${EURO} ${'\u2019'}q${'\u2019'} ${'\u2014'} ${'\u2026'}`;

describe('buildWinAnsiToUnicodeCMap', () => {
    const cmap = buildWinAnsiToUnicodeCMap();

    it('is a well-formed CMap stream body', () => {
        expect(cmap).toContain('begincmap');
        expect(cmap).toContain('endcmap');
        expect(cmap).toContain('/CMapType 2 def');
        expect(cmap).toContain('1 begincodespacerange\n<20> <FF>\nendcodespacerange');
    });

    it('maps the Euro byte 0x80 to U+20AC', () => {
        expect(cmap).toContain('<80> <20AC>');
    });

    it('maps CP1252 punctuation to the correct Unicode codepoints', () => {
        expect(cmap).toContain('<92> <2019>'); // right single quote
        expect(cmap).toContain('<97> <2014>'); // em-dash
        expect(cmap).toContain('<85> <2026>'); // ellipsis
        expect(cmap).toContain('<99> <2122>'); // trademark
    });

    it('maps Latin-1 bytes 1:1 (byte === codepoint)', () => {
        expect(cmap).toContain('<41> <0041>'); // 'A'
        expect(cmap).toContain('<E9> <00E9>'); // 'é'
    });

    it('keeps bfchar blocks within the 100-entry limit', () => {
        const blocks = cmap.match(/(\d+) beginbfchar/g) ?? [];
        for (const b of blocks) {
            const n = parseInt(b, 10);
            expect(n).toBeGreaterThan(0);
            expect(n).toBeLessThanOrEqual(100);
        }
    });
});

describe('issue #48 — Euro in table builder (Latin mode)', () => {
    const pdf = buildPDF({
        title: 'Invoice',
        infoItems: [],
        balanceText: '',
        countText: '',
        headers: ['Item', 'Price'],
        rows: [{ cells: ['Widget A', `12.00 ${EURO}`], type: '', pointed: false }],
        footerText: '',
    });

    it('emits the Euro byte 0x80, not a question mark', () => {
        // toWinAnsi maps € → 0x80 (single byte)
        expect(toWinAnsi(EURO)).toBe('\x80');
        expect(pdf).toContain('\x80');
    });

    it('attaches a /ToUnicode reference to the WinAnsi base fonts', () => {
        expect(pdf).toMatch(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding \/ToUnicode \d+ 0 R/);
        expect(pdf).toMatch(/\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding \/ToUnicode \d+ 0 R/);
    });

    it('embeds the WinAnsi→Unicode CMap with the Euro mapping', () => {
        expect(pdf).toContain('<80> <20AC>');
    });

    it('keeps /Size consistent with the emitted object count', () => {
        const size = Number((pdf.match(/\/Size (\d+)/) ?? [])[1]);
        const maxObj = Math.max(...[...pdf.matchAll(/(\d+) 0 obj/g)].map(m => Number(m[1])));
        expect(size).toBe(maxObj + 1);
    });
});

describe('issue #48 — Euro in document builder (Latin mode)', () => {
    const pdf = buildDocumentPDF({ blocks: [{ type: 'paragraph', text: SAMPLE }] });

    it('emits the Euro byte 0x80, not a question mark', () => {
        expect(pdf).toContain('\x80');
    });

    it('attaches a /ToUnicode reference to the WinAnsi base fonts', () => {
        expect(pdf).toMatch(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding \/ToUnicode \d+ 0 R/);
    });

    it('embeds the WinAnsi→Unicode CMap', () => {
        expect(pdf).toContain('<80> <20AC>');
        expect(pdf).toContain('<97> <2014>');
    });

    it('keeps /Size consistent with the emitted object count', () => {
        const size = Number((pdf.match(/\/Size (\d+)/) ?? [])[1]);
        const maxObj = Math.max(...[...pdf.matchAll(/(\d+) 0 obj/g)].map(m => Number(m[1])));
        expect(size).toBe(maxObj + 1);
    });
});
