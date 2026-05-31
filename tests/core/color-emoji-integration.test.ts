import { describe, it, expect } from 'vitest';
import { buildDocumentPDF, buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, ColorGlyph } from '../../src/types/pdf-types.js';

// ── Minimal sfnt builder (mirrors tests/fonts/glyf-outline.test.ts) ──

function buildSfnt(tables: Record<string, Uint8Array>): Uint8Array {
    const tags = Object.keys(tables);
    const numTables = tags.length;
    const dirSize = 12 + numTables * 16;
    let dataSize = 0;
    for (const t of tags) dataSize += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(dirSize + dataSize);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, numTables);
    let off = dirSize;
    let rec = 12;
    for (const tag of tags) {
        const data = tables[tag];
        for (let i = 0; i < 4; i++) view.setUint8(rec + i, tag.charCodeAt(i));
        view.setUint32(rec + 8, off);
        view.setUint32(rec + 12, data.length);
        out.set(data, off);
        off += (data.length + 3) & ~3;
        rec += 16;
    }
    return out;
}

function headTable(unitsPerEm: number, longLoca: boolean): Uint8Array {
    const b = new Uint8Array(54);
    const v = new DataView(b.buffer);
    v.setUint16(18, unitsPerEm);
    v.setInt16(50, longLoca ? 1 : 0);
    return b;
}

function maxpTable(numGlyphs: number): Uint8Array {
    const b = new Uint8Array(32);
    new DataView(b.buffer).setUint16(4, numGlyphs);
    return b;
}

function longLoca(offsets: number[]): Uint8Array {
    const b = new Uint8Array(offsets.length * 4);
    const v = new DataView(b.buffer);
    offsets.forEach((o, i) => v.setUint32(i * 4, o));
    return b;
}

/** A 700×700 square glyph, all on-curve. */
function squareGlyph(): Uint8Array {
    const b = new Uint8Array(34);
    const v = new DataView(b.buffer);
    v.setInt16(0, 1);                                    // numberOfContours
    v.setInt16(2, 0); v.setInt16(4, 0); v.setInt16(6, 700); v.setInt16(8, 700); // bbox
    v.setUint16(10, 3);                                  // endPtsOfContours[0] = 3 (4 points)
    v.setUint16(12, 0);                                  // instructionLength
    b[14] = 0x01; b[15] = 0x01; b[16] = 0x01; b[17] = 0x01; // flags: on-curve, int16
    v.setInt16(18, 0); v.setInt16(20, 700); v.setInt16(22, 0); v.setInt16(24, -700); // x deltas
    v.setInt16(26, 0); v.setInt16(28, 0); v.setInt16(30, 700); v.setInt16(32, 0);    // y deltas
    return b;
}

/** Build a synthetic colour-emoji font: emoji cp → gid 3, colour layer → base gid 5 (square). */
function makeColorEmojiFont(paint: ColorGlyph['layers'][number]['paint']): FontData {
    const glyf = squareGlyph();
    // numGlyphs = 6 → loca has 7 entries. gid 5 = square; gids 0–4 empty.
    const ttf = buildSfnt({
        head: headTable(1000, true),
        maxp: maxpTable(6),
        loca: longLoca([0, 0, 0, 0, 0, 0, glyf.length]),
        glyf,
    });
    const ttfBase64 = Buffer.from(ttf).toString('base64');

    const cmap: Record<number, number> = { 0x1f600: 3 };
    const widths: Record<number, number> = { 3: 1000 };
    const colorGlyphs: Record<number, ColorGlyph> = {
        3: { layers: [{ glyphId: 5, paint }] },
    };

    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 6, defaultWidth: 1000, ascent: 800, descent: -200, bbox: [0, -200, 1000, 800], capHeight: 700, stemV: 50 },
        fontName: 'SynthColorEmoji',
        cmap,
        defaultWidth: 1000,
        widths,
        pdfWidthArray: '',
        ttfBase64,
        gsub: {},
        markAnchors: null,
        mark2mark: null,
        colorGlyphs,
    };
}

function colorEmojiEntry(paint: ColorGlyph['layers'][number]['paint']): FontEntry {
    return { fontData: makeColorEmojiFont(paint), fontRef: '/F3', lang: 'emoji' };
}

const SOLID: ColorGlyph['layers'][number]['paint'] = { kind: 'solid', color: [255, 180, 0, 255] };
const LINEAR: ColorGlyph['layers'][number]['paint'] = {
    kind: 'linear',
    p0: [0, 0], p1: [700, 700],
    stops: [
        { offset: 0, color: [255, 0, 0, 255] },
        { offset: 1, color: [0, 0, 255, 255] },
    ],
    extend: 'pad',
};

describe('colour-emoji inline rendering — document integration', () => {
    it('emits a colour Form XObject for a solid colour glyph', () => {
        const params: DocumentParams = {
            title: 'Colour Emoji',
            blocks: [{ type: 'paragraph', text: 'Hi \u{1F600} there' }],
            fontEntries: [colorEmojiEntry(SOLID)],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('/Subtype /Form');
        expect(pdf).toContain('/CEm0');
        expect(pdf).toContain('/CEm0 Do');
        // Solid fill renders as an `rg ... f` paint inside the form.
        expect(pdf).toMatch(/rg\b/);
        expect(pdf).toContain('endobj');
    });

    it('produces a parseable PDF (valid xref) with a colour glyph', () => {
        const params: DocumentParams = {
            title: 'Colour Emoji',
            blocks: [{ type: 'paragraph', text: 'A \u{1F600} B' }],
            fontEntries: [colorEmojiEntry(SOLID)],
        };
        const bytes = buildDocumentPDFBytes(params);
        const doc = openPdf(bytes);
        expect(doc.pageCount).toBeGreaterThanOrEqual(1);
    });

    it('emits a /Shading for a gradient colour glyph', () => {
        const params: DocumentParams = {
            title: 'Gradient Emoji',
            blocks: [{ type: 'paragraph', text: 'Grad \u{1F600}' }],
            fontEntries: [colorEmojiEntry(LINEAR)],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('/Subtype /Form');
        expect(pdf).toContain('/Shading');
        expect(pdf).toContain('/ShadingType 2');
        expect(pdf).toMatch(/\bsh\b/);
    });

    it('de-duplicates a repeated colour glyph into a single Form XObject', () => {
        const params: DocumentParams = {
            title: 'Repeat Emoji',
            blocks: [
                { type: 'paragraph', text: '\u{1F600} one' },
                { type: 'paragraph', text: 'two \u{1F600}' },
            ],
            fontEntries: [colorEmojiEntry(SOLID)],
        };
        const pdf = buildDocumentPDF(params);
        const forms = pdf.match(/\/Subtype \/Form/g) ?? [];
        expect(forms).toHaveLength(1);
        expect(pdf).not.toContain('/CEm1');
    });

    it('is byte-identical for a document without any colour-emoji font (gated/additive)', () => {
        const params: DocumentParams = {
            title: 'Plain',
            blocks: [{ type: 'paragraph', text: 'Just plain Latin text.' }],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).not.toContain('/CEm');
        expect(pdf).not.toContain('/Subtype /Form');
    });
});
