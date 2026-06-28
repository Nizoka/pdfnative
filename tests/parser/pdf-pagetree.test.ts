import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { mergePdfs, splitPdf, extractPages } from '../../src/parser/pdf-pagetree.js';
import { openPdf } from '../../src/parser/pdf-reader.js';

function doc(title: string, n: number, extra?: Record<string, unknown>): Uint8Array {
    const blocks: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
        blocks.push({ type: 'heading', text: `${title} page ${i + 1}`, level: 1 });
        blocks.push({ type: 'paragraph', text: `Body of ${title} page ${i + 1}.` });
        if (i < n - 1) blocks.push({ type: 'pageBreak' });
    }
    return buildDocumentPDFBytes({ title, blocks: blocks as never, ...(extra as object) });
}

function pageText(pdf: Uint8Array, index: number): string {
    const r = openPdf(pdf);
    const page = r.getPage(index);
    const c = r.resolveValue(page.get('Contents') ?? null);
    const data = r.decodeStream(c as never);
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return s;
}

// ── mergePdfs ────────────────────────────────────────────────────────

describe('mergePdfs', () => {
    it('concatenates page counts in order', () => {
        const merged = mergePdfs([doc('Alpha', 3), doc('Bravo', 2)]);
        expect(openPdf(merged).pageCount).toBe(5);
        expect(pageText(merged, 0)).toContain('Alpha');
        expect(pageText(merged, 4)).toContain('Bravo');
    });

    it('merges a single source', () => {
        expect(openPdf(mergePdfs([doc('Solo', 2)])).pageCount).toBe(2);
    });

    it('rejects an empty source list', () => {
        expect(() => mergePdfs([])).toThrow(/at least one/);
    });

    it('rejects more than 50 sources', () => {
        const many = Array.from({ length: 51 }, () => doc('X', 1));
        expect(() => mergePdfs(many)).toThrow(/at most 50/);
    });

    it('rejects encrypted sources', () => {
        const enc = doc('Secret', 1, { layout: { encryption: { userPassword: 'u', ownerPassword: 'o' } } });
        expect(() => mergePdfs([enc, doc('Plain', 1)])).toThrow(/[Ee]ncrypted/);
    });

    it('produces a valid xref that re-parses', () => {
        const merged = mergePdfs([doc('A', 2), doc('B', 1)]);
        const r = openPdf(merged);
        expect(r.pageCount).toBe(3);
        // Every page resolves with a MediaBox (inherited inline).
        for (let i = 0; i < 3; i++) {
            expect(r.getPage(i).get('MediaBox')).toBeDefined();
        }
    });

    it('output is not marked encrypted and has no AcroForm', () => {
        const merged = mergePdfs([doc('A', 1)]);
        const r = openPdf(merged);
        expect(r.trailer.get('Encrypt')).toBeUndefined();
        expect(r.getCatalog().get('AcroForm')).toBeUndefined();
    });

    it('emits a deterministic trailer /ID (ISO 32000-1 §7.5.5)', () => {
        const a = doc('A', 2);
        const b = doc('B', 1);
        const first = mergePdfs([a, b]);
        const second = mergePdfs([a, b]);
        // /ID is present and well-formed: two equal 16-byte hex strings.
        const text = (() => { let s = ''; for (let i = 0; i < first.length; i++) s += String.fromCharCode(first[i]); return s; })();
        const m = text.match(/\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/);
        expect(m).not.toBeNull();
        expect(m![1]).toBe(m![2]);
        // Same inputs → byte-identical output (deterministic).
        expect(first.length).toBe(second.length);
        for (let i = 0; i < first.length; i++) expect(first[i]).toBe(second[i]);
    });
});

// ── extractPages ─────────────────────────────────────────────────────

describe('extractPages', () => {
    const src = doc('Doc', 5);

    it('keeps the requested pages in the given order', () => {
        const out = extractPages(src, [4, 0, 2]);
        const r = openPdf(out);
        expect(r.pageCount).toBe(3);
        expect(pageText(out, 0)).toContain('Doc page 5');
        expect(pageText(out, 1)).toContain('Doc page 1');
        expect(pageText(out, 2)).toContain('Doc page 3');
    });

    it('allows repeated indices', () => {
        expect(openPdf(extractPages(src, [0, 0, 0])).pageCount).toBe(3);
    });

    it('rejects an empty index list', () => {
        expect(() => extractPages(src, [])).toThrow(/at least one/);
    });

    it('rejects out-of-range indices', () => {
        expect(() => extractPages(src, [99])).toThrow(/out of range/);
        expect(() => extractPages(src, [-1])).toThrow(/out of range/);
    });
});

// ── splitPdf ─────────────────────────────────────────────────────────

describe('splitPdf', () => {
    const src = doc('Split', 5);

    it('splits into the requested ranges', () => {
        const parts = splitPdf(src, [{ start: 0, end: 1 }, { start: 2 }, { start: 3, end: 4 }]);
        expect(parts.map(p => openPdf(p).pageCount)).toEqual([2, 1, 2]);
    });

    it('a single-page range uses start as end', () => {
        const parts = splitPdf(src, [{ start: 2 }]);
        expect(openPdf(parts[0]).pageCount).toBe(1);
        expect(pageText(parts[0], 0)).toContain('Split page 3');
    });

    it('rejects empty ranges', () => {
        expect(() => splitPdf(src, [])).toThrow(/at least one/);
    });

    it('rejects an inverted or out-of-bounds range', () => {
        expect(() => splitPdf(src, [{ start: 3, end: 1 }])).toThrow(/invalid/);
        expect(() => splitPdf(src, [{ start: 0, end: 99 }])).toThrow(/invalid/);
    });
});

// ── round-trip integrity ─────────────────────────────────────────────

describe('page-tree round-trip integrity', () => {
    it('merge → split reconstructs the original page partition', () => {
        const merged = mergePdfs([doc('Alpha', 3), doc('Bravo', 2)]);
        const [first, second] = splitPdf(merged, [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
        expect(openPdf(first).pageCount).toBe(3);
        expect(openPdf(second).pageCount).toBe(2);
        expect(pageText(first, 0)).toContain('Alpha');
        expect(pageText(second, 0)).toContain('Bravo');
    });

    it('handles Unicode (embedded-font) pages without losing resources', () => {
        // A document with a heading + paragraph should keep its /Resources graph.
        const out = extractPages(doc('Resource', 2), [1]);
        const r = openPdf(out);
        const res = r.resolveValue(r.getPage(0).get('Resources') ?? null);
        expect(res).toBeTruthy();
    });
});
