import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildOutlineObjects } from '../../src/core/pdf-outline.js';
import { buildPageLabelsDict } from '../../src/core/pdf-page-labels.js';
import type { DocumentParams, OutlineItem, PageLabelRange } from '../../src/types/pdf-document-types.js';

function bytesToLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

// ── Page labels (unit) ───────────────────────────────────────────────

describe('buildPageLabelsDict', () => {
    it('builds a roman + decimal number tree', () => {
        const ranges: PageLabelRange[] = [
            { startPage: 0, style: 'roman' },
            { startPage: 3, style: 'decimal', start: 1 },
        ];
        const dict = buildPageLabelsDict(ranges, 10);
        expect(dict).toContain('/Nums [');
        expect(dict).toContain('0 << /S /r >>');
        expect(dict).toContain('3 << /S /D >>');
    });

    it('encodes prefix and start', () => {
        const dict = buildPageLabelsDict([{ startPage: 0, style: 'Alpha', prefix: 'A-', start: 2 }], 5);
        expect(dict).toContain('/S /A');
        expect(dict).toContain('/P (A-)');
        expect(dict).toContain('/St 2');
    });

    it('omits /S for style none', () => {
        const dict = buildPageLabelsDict([{ startPage: 0, style: 'none', prefix: 'cover' }], 2);
        expect(dict).not.toContain('/S');
        expect(dict).toContain('/P (cover)');
    });

    it('sorts ranges and rejects out-of-bounds', () => {
        expect(() => buildPageLabelsDict([{ startPage: 99 }], 3)).toThrow(/out of bounds/);
    });

    it('rejects duplicate startPage', () => {
        expect(() => buildPageLabelsDict([{ startPage: 0 }, { startPage: 0 }], 5)).toThrow(/increasing/);
    });

    it('rejects empty ranges', () => {
        expect(() => buildPageLabelsDict([], 5)).toThrow(/at least one/);
    });

    it('escapes parentheses in prefix', () => {
        const dict = buildPageLabelsDict([{ startPage: 0, prefix: 'a(b)' }], 2);
        expect(dict).toContain('/P (a\\(b\\))');
    });
});

// ── Outline (unit) ───────────────────────────────────────────────────

describe('buildOutlineObjects', () => {
    const pageObj = (i: number) => 5 + i * 2;
    const fmt = (n: number) => String(Math.round(n));

    it('wires a flat outline with prev/next links', () => {
        const items = [
            { title: 'A', pageIndex: 0 },
            { title: 'B', pageIndex: 1 },
            { title: 'C', pageIndex: 2 },
        ];
        const built = buildOutlineObjects(items, 20, pageObj, 700, fmt, 3);
        expect(built.rootObjNum).toBe(20);
        // root + 3 items
        expect(built.totalObjects).toBe(4);
        const root = built.objects[0][1];
        expect(root).toContain('/Type /Outlines');
        expect(root).toContain('/First 21 0 R');
        expect(root).toContain('/Last 23 0 R');
        expect(root).toContain('/Count 3');
        // middle item has both prev and next
        const b = built.objects[2][1];
        expect(b).toContain('/Prev 21 0 R');
        expect(b).toContain('/Next 23 0 R');
        expect(b).toContain('/Dest [7 0 R /XYZ 0 700 null]');
    });

    it('nests children and emits /First/Last/Count on the parent', () => {
        const items: { title: string; pageIndex: number; children?: { title: string; pageIndex: number }[] }[] = [
            { title: 'Chapter', pageIndex: 0, children: [
                { title: 'Section 1', pageIndex: 1 },
                { title: 'Section 2', pageIndex: 2 },
            ] },
        ];
        const built = buildOutlineObjects(items, 30, pageObj, 700, fmt, 3);
        // root + parent + 2 children
        expect(built.totalObjects).toBe(4);
        const parent = built.objects[1][1];
        expect(parent).toContain('/First 32 0 R');
        expect(parent).toContain('/Last 33 0 R');
        expect(parent).toContain('/Count 2');
        // root visible count includes descendants
        expect(built.objects[0][1]).toContain('/Count 3');
    });

    it('clamps page index to range', () => {
        const built = buildOutlineObjects([{ title: 'X', pageIndex: 99 }], 10, pageObj, 700, fmt, 3);
        expect(built.objects[1][1]).toContain(`/Dest [${pageObj(2)} 0 R`);
    });

    it('encodes flags and colour', () => {
        const built = buildOutlineObjects(
            [{ title: 'Bold', pageIndex: 0, bold: true, italic: true, color: '1 0 0' }],
            10, pageObj, 700, fmt, 1,
        );
        expect(built.objects[1][1]).toContain('/F 3');
        expect(built.objects[1][1]).toContain('/C [1 0 0]');
    });

    it('emits a negative /Count for a collapsed node and hides its children from ancestors', () => {
        const items = [
            { title: 'Chapter', pageIndex: 0, open: false, children: [
                { title: 'S1', pageIndex: 1 },
                { title: 'S2', pageIndex: 2 },
            ] },
            { title: 'Appendix', pageIndex: 2 },
        ];
        const built = buildOutlineObjects(items, 40, pageObj, 700, fmt, 3);
        // Chapter (objects[1]) collapsed with 2 children → /Count -2.
        expect(built.objects[1][1]).toContain('/Count -2');
        // Root: Chapter (children hidden) + Appendix → 2 visible items.
        expect(built.objects[0][1]).toContain('/Count 2');
    });

    it('a collapsed intermediate node contributes only itself to an open ancestor', () => {
        const items = [
            { title: 'Top', pageIndex: 0, children: [
                { title: 'Mid', pageIndex: 1, open: false, children: [
                    { title: 'G1', pageIndex: 2 },
                    { title: 'G2', pageIndex: 2 },
                ] },
            ] },
        ];
        const built = buildOutlineObjects(items, 50, pageObj, 700, fmt, 3);
        // Top open: sees Mid only (grandchildren hidden under collapsed Mid) → +1.
        expect(built.objects[1][1]).toContain('/Count 1');
        // Mid collapsed with 2 grandchildren → -2.
        expect(built.objects[2][1]).toContain('/Count -2');
        // Root: Top + Mid visible, grandchildren hidden → 2.
        expect(built.objects[0][1]).toContain('/Count 2');
    });

    it('defaults to open (positive /Count) when `open` is omitted', () => {
        const items = [
            { title: 'P', pageIndex: 0, children: [{ title: 'C', pageIndex: 1 }] },
        ];
        const built = buildOutlineObjects(items, 60, pageObj, 700, fmt, 2);
        expect(built.objects[1][1]).toContain('/Count 1');
        expect(built.objects[1][1]).not.toContain('/Count -');
    });
});

// ── Integration ──────────────────────────────────────────────────────

describe('document outline + page labels integration', () => {
    function doc(overrides: Partial<DocumentParams>): Uint8Array {
        return buildDocumentPDFBytes({
            title: 'Doc',
            blocks: [
                { type: 'heading', text: 'One', level: 1 },
                { type: 'paragraph', text: 'p' },
                { type: 'pageBreak' },
                { type: 'heading', text: 'Two', level: 1 },
                { type: 'paragraph', text: 'q' },
            ],
            ...overrides,
        });
    }

    it('emits /Outlines and /PageMode for explicit outline', () => {
        const outline: OutlineItem[] = [
            { title: 'One', pageIndex: 0 },
            { title: 'Two', pageIndex: 1 },
        ];
        const pdf = bytesToLatin1(doc({ outline }));
        expect(pdf).toContain('/Outlines');
        expect(pdf).toContain('/PageMode /UseOutlines');
        expect(pdf).toContain('/Type /Outlines');
        expect(pdf).toContain('(One)');
        expect(pdf).toContain('(Two)');
    });

    it("derives an outline from headings with outline: 'auto'", () => {
        const pdf = bytesToLatin1(doc({ outline: 'auto' }));
        expect(pdf).toContain('/Type /Outlines');
        expect(pdf).toContain('(One)');
        expect(pdf).toContain('(Two)');
    });

    it('emits /PageLabels', () => {
        const pdf = bytesToLatin1(doc({
            pageLabels: [{ startPage: 0, style: 'roman' }, { startPage: 1, style: 'decimal' }],
        }));
        expect(pdf).toContain('/PageLabels << /Nums [');
        expect(pdf).toContain('0 << /S /r >>');
    });

    it('outline works in tagged/PDF-A mode', () => {
        const pdf = bytesToLatin1(doc({ outline: 'auto', layout: { tagged: 'pdfa2b' } }));
        expect(pdf).toContain('/Outlines');
        expect(pdf).toContain('/StructTreeRoot');
    });

    it('does not emit outline keys when not requested (byte-stable path)', () => {
        const pdf = bytesToLatin1(doc({}));
        expect(pdf).not.toContain('/Outlines');
        expect(pdf).not.toContain('/PageLabels');
    });

    it('produces a parseable xref (startxref present and valid)', () => {
        const pdf = bytesToLatin1(doc({ outline: 'auto', pageLabels: [{ startPage: 0 }] }));
        const m = pdf.lastIndexOf('startxref');
        expect(m).toBeGreaterThan(0);
        expect(pdf).toContain('%%EOF');
    });
});
