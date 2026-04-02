/**
 * Custom fuzz / edge-case tests for buildPDF input validation.
 * Proves that validation holds under pathological inputs and that
 * valid but extreme inputs produce structurally correct PDFs.
 */

import { describe, it, expect } from 'vitest';
import { buildPDF, buildPDFBytes } from '../../src/core/pdf-builder.js';
import type { PdfParams } from '../../src/types/pdf-types.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal valid params for testing */
function validParams(overrides?: Partial<PdfParams>): PdfParams {
    return {
        title: 'Test',
        infoItems: [],
        balanceText: '$0',
        countText: '0',
        headers: ['A', 'B', 'C', 'D', 'E'],
        rows: [],
        footerText: 'Footer',
        ...overrides,
    };
}

/** Verify structural integrity of PDF output */
function assertValidPdf(pdf: string): void {
    expect(pdf).toMatch(/^%PDF-1\.4/);
    expect(pdf).toMatch(/%%EOF$/);
    expect(pdf).toContain('xref');
    expect(pdf).toContain('startxref');
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
}

// ── 1. Rejection of invalid inputs ──────────────────────────────────

describe('buildPDF — invalid input rejection', () => {
    it.each([
        ['null params', null],
        ['undefined params', undefined],
        ['string params', 'not an object'],
        ['number params', 42],
        ['boolean params', true],
    ])('rejects %s', (_label, input) => {
        expect(() => buildPDF(input as unknown as PdfParams)).toThrow('params is required');
    });

    it('rejects array params (rows check)', () => {
        expect(() => buildPDF([1, 2, 3] as unknown as PdfParams)).toThrow('params.rows must be an array');
    });

    it('rejects params.rows = null', () => {
        expect(() => buildPDF(validParams({ rows: null as unknown as PdfParams['rows'] })))
            .toThrow('params.rows must be an array');
    });

    it('rejects params.rows = string', () => {
        expect(() => buildPDF(validParams({ rows: 'not-array' as unknown as PdfParams['rows'] })))
            .toThrow('params.rows must be an array');
    });

    it('rejects params.headers = null', () => {
        expect(() => buildPDF(validParams({ headers: null as unknown as string[] })))
            .toThrow('params.headers must be an array');
    });

    it('rejects params.headers = number', () => {
        expect(() => buildPDF(validParams({ headers: 999 as unknown as string[] })))
            .toThrow('params.headers must be an array');
    });

    it('rejects row count exceeding 100,000', () => {
        const hugeRows = Array.from({ length: 100_001 }, () => ({
            cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false,
        }));
        expect(() => buildPDF(validParams({ rows: hugeRows })))
            .toThrow('exceeds safe limit');
    });

    it('accepts exactly 100,000 rows without throwing', () => {
        const maxRows = Array.from({ length: 100_000 }, () => ({
            cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false,
        }));
        // Should not throw — just verify it doesn't reject the count
        expect(() => buildPDF(validParams({ rows: maxRows }))).not.toThrow();
    });
});

// ── 2. Extreme string inputs ────────────────────────────────────────

describe('buildPDF — extreme string content', () => {
    it('handles empty strings in all text fields', () => {
        const pdf = buildPDF(validParams({
            title: '',
            balanceText: '',
            countText: '',
            footerText: '',
            headers: ['', '', '', '', ''],
        }));
        assertValidPdf(pdf);
    });

    it('handles very long title (10,000 chars)', () => {
        const longTitle = 'A'.repeat(10_000);
        const pdf = buildPDF(validParams({ title: longTitle }));
        assertValidPdf(pdf);
    });

    it('handles very long cell text (10,000 chars per cell)', () => {
        const longText = 'X'.repeat(10_000);
        const pdf = buildPDF(validParams({
            rows: [{ cells: [longText, longText, longText, longText, longText], type: '', pointed: false }],
        }));
        assertValidPdf(pdf);
    });

    it('handles null byte (\\x00) in cell text', () => {
        const pdf = buildPDF(validParams({
            rows: [{ cells: ['hello\x00world', 'a', 'b', 'c', 'd'], type: '', pointed: false }],
        }));
        assertValidPdf(pdf);
    });

    it('handles newlines and tabs in text fields', () => {
        const pdf = buildPDF(validParams({
            title: 'Line1\nLine2\tTab',
            infoItems: [{ label: 'Key\n', value: 'Val\r\n' }],
            rows: [{ cells: ['\n\t\r', 'a', 'b', 'c', 'd'], type: '', pointed: false }],
        }));
        assertValidPdf(pdf);
    });

    it('handles PDF injection attempt in title (parentheses)', () => {
        const pdf = buildPDF(validParams({
            title: ') >> endobj 1 0 obj << /Type /Catalog',
            docTitle: '(\\) evil \\\\',
        }));
        assertValidPdf(pdf);
        // Ensure the injection is escaped, not executed
        expect(pdf).not.toMatch(/evil.*endobj/);
    });

    it('handles PDF injection attempt in cell text (backslashes)', () => {
        const pdf = buildPDF(validParams({
            rows: [{
                cells: ['\\\\) Tj ET BT', 'a', 'b', 'c', 'd'],
                type: '', pointed: false,
            }],
        }));
        assertValidPdf(pdf);
    });

    it('handles Unicode surrogates and BMP edge chars', () => {
        const pdf = buildPDF(validParams({
            title: '\uFFFD\uFFFE\uFFFF',
            rows: [{ cells: ['\u0000', '\u0001', '\u001F', '\u007F', '\u0080'], type: '', pointed: false }],
        }));
        assertValidPdf(pdf);
    });
});

// ── 3. Extreme numeric/structural edge cases ────────────────────────

describe('buildPDF — structural edge cases', () => {
    it('handles zero rows (empty table)', () => {
        const pdf = buildPDF(validParams({ rows: [] }));
        assertValidPdf(pdf);
        expect(pdf).toContain('/Count 1'); // At least 1 page
    });

    it('handles single row', () => {
        const pdf = buildPDF(validParams({
            rows: [{ cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false }],
        }));
        assertValidPdf(pdf);
    });

    it('handles many pages (500 rows)', () => {
        const rows = Array.from({ length: 500 }, (_, i) => ({
            cells: [`Row ${i}`, 'B', 'C', '100.00', 'OK'],
            type: i % 2 === 0 ? 'credit' : 'debit',
            pointed: i % 5 === 0,
        }));
        const pdf = buildPDF(validParams({ rows }));
        assertValidPdf(pdf);
        // Should produce multiple pages
        const pageCount = (pdf.match(/\/Type \/Page\b/g) || []).length;
        expect(pageCount).toBeGreaterThan(1);
    });

    it('handles many info items (100 items)', () => {
        const infoItems = Array.from({ length: 100 }, (_, i) => ({
            label: `Key${i}`,
            value: `Value${i}`,
        }));
        const pdf = buildPDF(validParams({ infoItems }));
        assertValidPdf(pdf);
    });

    it('handles all rows pointed (highlighted)', () => {
        const rows = Array.from({ length: 50 }, () => ({
            cells: ['a', 'b', 'c', 'd', 'e'], type: 'credit', pointed: true,
        }));
        const pdf = buildPDF(validParams({ rows }));
        assertValidPdf(pdf);
    });

    it('handles mixed credit/debit types', () => {
        const pdf = buildPDF(validParams({
            rows: [
                { cells: ['a', 'b', 'c', '+100', 'X'], type: 'credit', pointed: false },
                { cells: ['a', 'b', 'c', '-50', ''], type: 'debit', pointed: true },
                { cells: ['a', 'b', 'c', '0', ''], type: 'other', pointed: false },
            ],
        }));
        assertValidPdf(pdf);
    });
});

// ── 4. buildPDFBytes output validation ──────────────────────────────

describe('buildPDFBytes — binary output integrity', () => {
    it('produces valid Uint8Array with PDF header bytes', () => {
        const bytes = buildPDFBytes(validParams());
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
        // %PDF-1.4
        expect(bytes[0]).toBe(0x25); // %
        expect(bytes[1]).toBe(0x50); // P
        expect(bytes[2]).toBe(0x44); // D
        expect(bytes[3]).toBe(0x46); // F
    });

    it('ends with %%EOF bytes', () => {
        const bytes = buildPDFBytes(validParams());
        const tail = new TextDecoder().decode(bytes.slice(-5));
        expect(tail).toBe('%%EOF');
    });

    it('xref offsets point to actual objects', () => {
        const pdf = buildPDF(validParams({
            rows: [{ cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false }],
        }));

        // Parse xref table
        const xrefMatch = pdf.match(/xref\n0 (\d+)\n([\s\S]+?)\ntrailer/);
        expect(xrefMatch).not.toBeNull();

        const count = parseInt(xrefMatch![1], 10);
        const entries = xrefMatch![2].split('\n').filter(l => l.trim().length > 0);

        // Skip first entry (free object 0)
        for (let i = 1; i < Math.min(count, entries.length); i++) {
            const offsetStr = entries[i].slice(0, 10);
            const offsetNum = parseInt(offsetStr, 10);
            // Verify the offset points to "N 0 obj"
            const snippet = pdf.slice(offsetNum, offsetNum + 20);
            expect(snippet).toMatch(/^\d+ 0 obj/);
        }
    });

    it('trailer references /Root and /Info', () => {
        const pdf = buildPDF(validParams());
        const trailerMatch = pdf.match(/trailer\n([\s\S]+?)\nstartxref/);
        expect(trailerMatch).not.toBeNull();
        expect(trailerMatch![1]).toContain('/Root 1 0 R');
        expect(trailerMatch![1]).toContain('/Info');
    });
});

// ── 5. PDF string escaping under adversarial input ──────────────────

describe('buildPDF — string escaping robustness', () => {
    it('escapes backslashes in docTitle', () => {
        const pdf = buildPDF(validParams({ docTitle: 'C:\\Users\\test' }));
        assertValidPdf(pdf);
        expect(pdf).toContain('C:\\\\Users\\\\test');
    });

    it('escapes parentheses in docTitle', () => {
        const pdf = buildPDF(validParams({ docTitle: 'Title (draft)' }));
        assertValidPdf(pdf);
        expect(pdf).toContain('Title \\(draft\\)');
    });

    it('handles nested escapes in docTitle', () => {
        const pdf = buildPDF(validParams({ docTitle: 'A\\(B)\\C' }));
        assertValidPdf(pdf);
        // Verify /Info dict has properly escaped string
        const infoMatch = pdf.match(/\/Title \(([^)]*(?:\\.[^)]*)*)\)/);
        expect(infoMatch).not.toBeNull();
    });
});
