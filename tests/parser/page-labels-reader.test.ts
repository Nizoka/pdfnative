import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// Roadmap v1.5.0 — PdfReader.getPageLabels() reads the /PageLabels number tree
// back into PageLabelRange[] (round-trip complement of buildPageLabelsDict).

function multiPageDoc(pageLabels: DocumentParams['pageLabels']): DocumentParams {
    return {
        title: 'PL',
        blocks: [
            { type: 'heading', level: 1, text: 'A' },
            { type: 'pageBreak' },
            { type: 'heading', level: 1, text: 'B' },
            { type: 'pageBreak' },
            { type: 'heading', level: 1, text: 'C' },
            { type: 'pageBreak' },
            { type: 'heading', level: 1, text: 'D' },
        ],
        pageLabels,
    };
}

describe('page-labels reader (getPageLabels)', () => {
    it('returns null when the document has no page labels', () => {
        const bytes = buildDocumentPDFBytes({ title: 'x', blocks: [{ type: 'paragraph', text: 'hi' }] });
        expect(openPdf(bytes).getPageLabels()).toBeNull();
    });

    it('round-trips roman / decimal / prefixed ranges', () => {
        const bytes = buildDocumentPDFBytes(multiPageDoc([
            { startPage: 0, style: 'roman' },
            { startPage: 2, style: 'decimal' },
            { startPage: 3, style: 'Alpha', prefix: 'App-' },
        ]));
        const labels = openPdf(bytes).getPageLabels();
        expect(labels).not.toBeNull();
        expect(labels).toEqual([
            { startPage: 0, style: 'roman' },
            { startPage: 2, style: 'decimal' },
            { startPage: 3, style: 'Alpha', prefix: 'App-' },
        ]);
    });

    it('captures a non-default start value', () => {
        const bytes = buildDocumentPDFBytes(multiPageDoc([
            { startPage: 0, style: 'decimal', start: 5 },
        ]));
        const labels = openPdf(bytes).getPageLabels();
        expect(labels).toEqual([{ startPage: 0, style: 'decimal', start: 5 }]);
    });

    it('omits the default start (1) on read-back', () => {
        const bytes = buildDocumentPDFBytes(multiPageDoc([
            { startPage: 0, style: 'decimal', start: 1 },
        ]));
        const labels = openPdf(bytes).getPageLabels();
        expect(labels).toEqual([{ startPage: 0, style: 'decimal' }]);
    });
});
