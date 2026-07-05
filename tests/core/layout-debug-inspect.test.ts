import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, inspectDocumentLayout } from '../../src/index.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// Roadmap v1.5.0 — layout debug overlay + inspectDocumentLayout().

function sampleDoc(): DocumentParams {
    return {
        title: 'Layout',
        blocks: [
            { type: 'heading', level: 1, text: 'Intro' },
            { type: 'paragraph', text: 'Lorem ipsum dolor sit amet, '.repeat(30) },
            { type: 'table', headers: ['A', 'B'], rows: Array.from({ length: 50 }, (_, i) => ({ cells: [`r${i}`, `v${i}`], type: '', pointed: false })) },
            { type: 'pageBreak' },
            { type: 'heading', level: 2, text: 'End' },
        ],
    };
}

describe('layout debug overlay', () => {
    it('debug:false is byte-identical to the default build', () => {
        const a = buildDocumentPDFBytes(sampleDoc());
        const b = buildDocumentPDFBytes(sampleDoc(), { debug: false });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });

    it('debug:true adds overlay operators (larger output)', () => {
        const plain = buildDocumentPDFBytes(sampleDoc());
        const dbg = buildDocumentPDFBytes(sampleDoc(), { debug: true });
        expect(dbg.length).toBeGreaterThan(plain.length);
    });

    it('individual layers can be toggled', () => {
        const plain = buildDocumentPDFBytes(sampleDoc());
        const marginsOnly = buildDocumentPDFBytes(sampleDoc(), { debug: { showMargins: true } });
        const all = buildDocumentPDFBytes(sampleDoc(), { debug: true });
        expect(marginsOnly.length).toBeGreaterThan(plain.length);
        expect(all.length).toBeGreaterThan(marginsOnly.length);
    });

    it('empty debug object (all layers off) is byte-identical', () => {
        const a = buildDocumentPDFBytes(sampleDoc());
        const b = buildDocumentPDFBytes(sampleDoc(), { debug: {} });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});

describe('inspectDocumentLayout', () => {
    it('reports the same page count as the real builder', () => {
        const doc = sampleDoc();
        const inspection = inspectDocumentLayout(doc);
        const reader = openPdf(buildDocumentPDFBytes(doc));
        expect(inspection.totalPages).toBe(reader.pageCount);
    });

    it('is deterministic', () => {
        const a = inspectDocumentLayout(sampleDoc());
        const b = inspectDocumentLayout(sampleDoc());
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('exposes page dimensions, margins and per-block geometry', () => {
        const insp = inspectDocumentLayout(sampleDoc());
        expect(insp.pageWidth).toBeGreaterThan(0);
        expect(insp.pageHeight).toBeGreaterThan(0);
        expect(insp.margins.t).toBeGreaterThan(0);
        expect(insp.pages[0].blocks.length).toBeGreaterThan(0);
        const first = insp.pages[0].blocks[0];
        expect(first.type).toBe('heading');
        expect(first.width).toBeGreaterThan(0);
        expect(first.height).toBeGreaterThan(0);
        expect(first.page).toBe(0);
    });

    it('honours a custom page size via layout options', () => {
        const insp = inspectDocumentLayout(sampleDoc(), { pageWidth: 612, pageHeight: 792 });
        expect(insp.pageWidth).toBe(612);
        expect(insp.pageHeight).toBe(792);
    });
});
