import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, inspectDocumentLayout } from '../../src/index.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { paginateDocument, paginatePass } from '../../src/core/pdf-pagination.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { PG_H, DEFAULT_MARGINS } from '../../src/core/pdf-layout.js';
import type { DocumentParams, DocumentBlock } from '../../src/types/pdf-document-types.js';

// v1.8.0 — issue #75 and the shared planner behind it.
//
// The inspector used to re-implement pagination: it measured heights without
// the heading list (so a `toc` block came out as 0 pt) and ran one pass where
// the builder runs up to three. Both now call the same planner, so the page
// count it reports and the page count the PDF actually has cannot diverge.

/** Page count of a built PDF, read back through the parser. */
function builtPages(params: DocumentParams, layout?: Parameters<typeof buildDocumentPDFBytes>[1]): number {
    return openPdf(buildDocumentPDFBytes(params, layout)).pageCount;
}

function headings(count: number, level: 1 | 2 | 3 = 1): DocumentBlock[] {
    const out: DocumentBlock[] = [];
    for (let i = 1; i <= count; i++) {
        out.push({ type: 'heading', level, text: `Section ${i}` });
        out.push({ type: 'paragraph', text: `Body copy for section ${i}. `.repeat(8) });
    }
    return out;
}

function tocDoc(sections: number): DocumentParams {
    return {
        title: 'Report with contents',
        blocks: [
            { type: 'toc', title: 'Table of Contents', maxLevel: 3 },
            ...headings(sections),
        ],
    };
}

describe('inspector / builder page-count parity (issue #75)', () => {
    it('agrees on a document whose table of contents fills most of a page', () => {
        const params = tocDoc(30);
        expect(inspectDocumentLayout(params).totalPages).toBe(builtPages(params));
    });

    it('agrees on a table of contents that spans several pages', () => {
        const params = tocDoc(90);
        const inspected = inspectDocumentLayout(params);
        expect(inspected.totalPages).toBe(builtPages(params));
        expect(inspected.totalPages).toBeGreaterThan(3);
    });

    it('measures the toc block itself, not zero', () => {
        const inspected = inspectDocumentLayout(tocDoc(20));
        const toc = inspected.pages[0].blocks.find(b => b.type === 'toc');
        expect(toc).toBeDefined();
        expect(toc!.height).toBeGreaterThan(0);
    });

    it('keeps blocks after the toc from overlapping it', () => {
        const inspected = inspectDocumentLayout(tocDoc(20));
        const first = inspected.pages[0].blocks;
        for (let i = 1; i < first.length; i++) {
            // Each block starts at or below the previous block's bottom edge.
            expect(first[i].top).toBeLessThanOrEqual(first[i - 1].top - first[i - 1].height + 0.001);
        }
    });

    it('still agrees on documents without a table of contents', () => {
        const params: DocumentParams = { title: 'Plain', blocks: headings(40) };
        expect(inspectDocumentLayout(params).totalPages).toBe(builtPages(params));
    });

    it('agrees on a document mixing a toc, a long table and page breaks', () => {
        const rows = Array.from({ length: 120 }, (_, i) => ({
            cells: [`r${i}`, `value ${i}`], type: '', pointed: false,
        }));
        const params: DocumentParams = {
            title: 'Mixed',
            blocks: [
                { type: 'toc', title: 'Contents' },
                ...headings(6),
                { type: 'pageBreak' },
                { type: 'heading', level: 1, text: 'Data' },
                { type: 'table', headers: ['Ref', 'Value'], rows },
                { type: 'pageBreak' },
                { type: 'heading', level: 2, text: 'Appendix' },
                { type: 'paragraph', text: 'Tail. '.repeat(50) },
            ],
        };
        expect(inspectDocumentLayout(params).totalPages).toBe(builtPages(params));
    });

    it('agrees under a custom page size and margins', () => {
        const params = tocDoc(25);
        const layout = { pageWidth: 595, pageHeight: 420, margins: { t: 30, r: 30, b: 30, l: 30 } };
        expect(inspectDocumentLayout(params, layout).totalPages).toBe(builtPages(params, layout));
    });

    it('agrees when a header template reserves vertical space', () => {
        const params = tocDoc(25);
        const layout = { headerTemplate: { left: 'pdfnative', right: '{page}/{pages}' } };
        expect(inspectDocumentLayout(params, layout).totalPages).toBe(builtPages(params, layout));
    });
});

describe('paginateDocument', () => {
    const enc = createEncodingContext([], false, false);
    const input = (blocks: DocumentBlock[], title?: string) => ({
        blocks, title, enc, pgH: PG_H, mg: { ...DEFAULT_MARGINS }, cw: 495, headerH: 0,
    });

    it('returns the renderer view and the geometry view in lockstep', () => {
        const res = paginateDocument(input(headings(12), 'T'));
        expect(res.planned.length).toBe(res.pages.length);
        for (let p = 0; p < res.pages.length; p++) {
            expect(res.planned[p].length).toBe(res.pages[p].length);
            for (let i = 0; i < res.pages[p].length; i++) {
                expect(res.planned[p][i].item).toBe(res.pages[p][i]);
            }
        }
    });

    it('collects one heading destination per heading, in document order', () => {
        const res = paginateDocument(input(headings(5)));
        expect(res.headings.map(h => h.text)).toEqual([
            'Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5',
        ]);
        expect(res.headings.map(h => h.destName)).toEqual([
            'toc_h_0', 'toc_h_1', 'toc_h_2', 'toc_h_3', 'toc_h_4',
        ]);
    });

    it('is deterministic', () => {
        const a = paginateDocument(input(headings(30), 'T'));
        const b = paginateDocument(input(headings(30), 'T'));
        expect(b.pages.length).toBe(a.pages.length);
        expect(b.planned.map(p => p.map(i => i.top))).toEqual(a.planned.map(p => p.map(i => i.top)));
    });

    it('reserves the title band only on the first page', () => {
        const withTitle = paginateDocument(input(headings(2), 'A title'));
        const without = paginateDocument(input(headings(2)));
        expect(withTitle.planned[0][0].top).toBeLessThan(without.planned[0][0].top);
    });

    it('starts a fresh page on a pageBreak block', () => {
        const res = paginateDocument(input([
            { type: 'paragraph', text: 'one' },
            { type: 'pageBreak' },
            { type: 'paragraph', text: 'two' },
        ]));
        expect(res.pages.length).toBe(2);
        expect(res.pages[1].length).toBe(1);
    });

    it('slices a long table across pages with a shared struct accumulator', () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({
            cells: [`r${i}`], type: '', pointed: false,
        }));
        const res = paginateDocument(input([{ type: 'table', headers: ['Ref'], rows }]));
        const slices = res.pages.flat().filter(i => i.type === '__tableSlice');
        expect(slices.length).toBeGreaterThan(1);
        const accums = new Set(slices.map(s => (s as { slice: { tableStructAccum: unknown } }).slice.tableStructAccum));
        expect(accums.size).toBe(1);
        expect(slices.filter(s => (s as { slice: { isFinalSlice: boolean } }).slice.isFinalSlice).length).toBe(1);
    });

    it('measures a toc block as zero without headings and non-zero with them', () => {
        const blocks: DocumentBlock[] = [{ type: 'toc' }, ...headings(6)];
        const single = paginatePass(input(blocks));
        const tocSingle = single.planned[0].find(p => p.type === 'toc');
        expect(tocSingle!.height).toBe(0);

        const converged = paginateDocument(input(blocks));
        const tocConverged = converged.planned[0].find(p => p.type === 'toc');
        expect(tocConverged!.height).toBeGreaterThan(0);
    });
});
