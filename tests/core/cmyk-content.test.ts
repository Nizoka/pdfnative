import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildAnnotationBody } from '../../src/core/pdf-annot-markup.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// CMYK content colours (v1.8.0) through the real document pipeline: the
// operator follows the component count, and PDF places defined as RGB-only
// never receive four components.

const PINNED = { title: 'CMYK', creationDate: new Date('2026-01-01T00:00:00Z') };

function build(params: DocumentParams): string {
    return Buffer.from(buildDocumentPDFBytes(params)).toString('latin1');
}

describe('CMYK content colours', () => {
    it('paints a CMYK paragraph with k, and an RGB one with rg', () => {
        const pdf = build({
            ...PINNED,
            blocks: [
                { type: 'paragraph', text: 'Process cyan', color: [100, 0, 0, 0] },
                { type: 'paragraph', text: 'Screen blue', color: '#2563EB' },
            ],
        } as DocumentParams);
        expect(pdf).toContain('1 0 0 0 k');
        expect(pdf).toContain('0.145 0.388 0.922 rg');
    });

    it('accepts the PDF CMYK string form', () => {
        const pdf = build({ ...PINNED, blocks: [{ type: 'paragraph', text: 'Rich black', color: '0.6 0.4 0.4 1' }] } as DocumentParams);
        expect(pdf).toContain('0.6 0.4 0.4 1 k');
    });

    it('produces a document the reader opens', () => {
        const bytes = buildDocumentPDFBytes({ ...PINNED, blocks: [{ type: 'paragraph', text: 'x', color: [0, 0, 0, 100] }] } as DocumentParams);
        expect(openPdf(bytes).pageCount).toBe(1);
    });

    it('is byte-stable for the same input', () => {
        const params = { ...PINNED, blocks: [{ type: 'paragraph', text: 'Stable', color: [0, 100, 100, 0] }] } as DocumentParams;
        expect(buildDocumentPDFBytes(params)).toEqual(buildDocumentPDFBytes(params));
    });
});

describe('CMYK in charts', () => {
    it('tints an area fill by removing ink, not by adding it', () => {
        const pdf = build({
            ...PINNED,
            blocks: [{
                type: 'chart', chartType: 'area', categories: ['a', 'b', 'c'],
                series: [{ label: 'cyan', values: [1, 3, 2], color: [100, 0, 0, 0] }],
            }],
        } as DocumentParams);
        // Full series colour for the line, 65 % ink for the area under it.
        expect(pdf).toContain('1 0 0 0 K');
        expect(pdf).toMatch(/(^|\s)0\.650* 0(\.0+)? 0(\.0+)? 0(\.0+)? k/);
        // The RGB formula applied to ink would have produced 1.35 cyan.
        expect(pdf).not.toMatch(/1\.35\d* 0/);
    });
});

describe('CMYK in annotations', () => {
    it('writes four components to /C, which annotations allow', () => {
        const body = buildAnnotationBody({ type: 'square', rect: [0, 0, 10, 10], color: [0, 0, 100, 0], interiorColor: '0 1 0 0' });
        expect(body).toContain('/C [0 0 1 0]');
        expect(body).toContain('/IC [0 1 0 0]');
    });

    it('sets free-text appearance with k', () => {
        const body = buildAnnotationBody({ type: 'freetext', rect: [0, 0, 10, 10], contents: 'note', color: [0, 0, 0, 100] });
        expect(body).toContain('/DA (/Helv 12.00 Tf 0 0 0 1 k)');
    });
});
