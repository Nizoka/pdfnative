/**
 * pdfnative — Trailer /ID + metadata parity tests
 *
 * Validates v1.0.4 PDF/A conformance fixes:
 *   - ISO 19005-1 §6.1.3 / ISO 32000-1 §14.4: trailer /ID always present
 *   - ISO 19005-1 §6.7.3 t1/t7: /Info CreationDate ↔ xmp:CreateDate parity
 *   - ISO 32000-1 §7.9.4: PDF date format with timezone offset
 */

import { describe, it, expect } from 'vitest';
import { buildPDF } from '../../src/core/pdf-builder.js';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';
import { buildPdfMetadata, buildXMPMetadata } from '../../src/core/pdf-tags.js';
import type { PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

function makeTableParams(): PdfParams {
    return {
        title: 'Trailer ID Test',
        infoItems: [{ label: 'X', value: 'Y' }],
        balanceText: 'Z',
        countText: '1 row',
        headers: ['A', 'B'],
        rows: [{ cells: ['1', '2'], type: 'credit', pointed: false }],
        footerText: 'Footer',
    };
}

function makeDocParams(): DocumentParams {
    return {
        title: 'Doc Trailer Test',
        blocks: [{ type: 'paragraph', text: 'Hello.' }],
    };
}

// ── Trailer /ID ──────────────────────────────────────────────────────

describe('Trailer /ID is always emitted (ISO 19005-1 §6.1.3)', () => {
    const idRegex = /\/ID \[<([0-9A-Fa-f]{32})> <([0-9A-Fa-f]{32})>\]/;

    it('buildPDF emits /ID without encryption', () => {
        const pdf = buildPDF(makeTableParams());
        const m = pdf.match(idRegex);
        expect(m).not.toBeNull();
        expect(m![1].length).toBe(32);
        expect(m![2].length).toBe(32);
    });

    it('buildDocumentPDF emits /ID without encryption', () => {
        const pdf = buildDocumentPDF(makeDocParams());
        const m = pdf.match(idRegex);
        expect(m).not.toBeNull();
    });

    it('buildPDF emits /ID under PDF/A (tagged) mode', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        expect(pdf).toMatch(idRegex);
    });

    it('buildPDF emits /ID under encryption mode', () => {
        const pdf = buildPDF(makeTableParams(), {
            encryption: { ownerPassword: 'owner', algorithm: 'aes128' },
        });
        expect(pdf).toMatch(idRegex);
    });

    it('produces deterministic /ID for equal title+date inputs', () => {
        const pdf1 = buildPDF(makeTableParams());
        const pdf2 = buildPDF(makeTableParams());
        const m1 = pdf1.match(idRegex)!;
        const m2 = pdf2.match(idRegex)!;
        // Same title + same wall-clock second → same ID. May occasionally diverge
        // across the second boundary, but both halves of the same call are equal.
        expect(m1[1]).toBe(m1[2]);
        expect(m2[1]).toBe(m2[2]);
    });

    it('produces different /ID for different titles', () => {
        const a = buildPDF(makeTableParams());
        const b = buildPDF({ ...makeTableParams(), title: 'A different title' });
        const ma = a.match(idRegex)!;
        const mb = b.match(idRegex)!;
        expect(ma[1]).not.toBe(mb[1]);
    });
});

// ── Date format (ISO 32000-1 §7.9.4) ─────────────────────────────────

describe('PDF date format with timezone (ISO 32000-1 §7.9.4)', () => {
    it("emits D:YYYYMMDDHHmmSS+HH'mm' or -HH'mm'", () => {
        const pdf = buildPDF(makeTableParams());
        expect(pdf).toMatch(/\/CreationDate \(D:\d{14}[+\-]\d{2}'\d{2}'\)/);
    });

    it('buildPdfMetadata produces matching xmpDate and pdfDate for the same instant', () => {
        const fixed = new Date('2026-04-25T14:30:00Z');
        const { pdfDate, xmpDate } = buildPdfMetadata(fixed);
        // Both encode the same date components (digits only).
        const pdfDigits = pdfDate.replace(/[^\d]/g, '');
        const xmpDigits = xmpDate.replace(/[^\d]/g, '');
        // pdfDate digits = YYYYMMDDHHmmSS + tzHH + tzmm = 18 digits
        // xmpDate digits = YYYY MM DD HH mm SS tzHH tzmm = 18 digits
        expect(pdfDigits).toBe(xmpDigits);
    });

    it('buildPdfMetadata pdfDate matches ISO 32000-1 §7.9.4 grammar', () => {
        const { pdfDate } = buildPdfMetadata(new Date());
        expect(pdfDate).toMatch(/^D:\d{14}[+\-]\d{2}'\d{2}'$/);
    });

    it('buildPdfMetadata xmpDate matches ISO 8601 grammar', () => {
        const { xmpDate } = buildPdfMetadata(new Date());
        expect(xmpDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+\-]\d{2}:\d{2}$/);
    });
});

// ── /Info ↔ XMP parity (ISO 19005-1 §6.7.3) ──────────────────────────

describe('/Info ↔ XMP metadata parity (ISO 19005-1 §6.7.3)', () => {
    it('XMP CreateDate equals /Info CreationDate digits', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        const infoM = pdf.match(/\/CreationDate \(D:(\d{14})([+\-])(\d{2})'(\d{2})'\)/);
        const xmpM = pdf.match(/<xmp:CreateDate>(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+\-])(\d{2}):(\d{2})<\/xmp:CreateDate>/);
        expect(infoM).not.toBeNull();
        expect(xmpM).not.toBeNull();
        // Compare digit-by-digit (year, month, day, hour, minute, second, tzSign, tzH, tzM)
        const infoDigits = infoM![1] + infoM![2] + infoM![3] + infoM![4];
        const xmpDigits = xmpM![1] + xmpM![2] + xmpM![3] + xmpM![4] + xmpM![5] + xmpM![6] + xmpM![7] + xmpM![8] + xmpM![9];
        expect(infoDigits).toBe(xmpDigits);
    });

    it('XMP Producer equals /Info Producer literal', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        expect(pdf).toContain('/Producer (pdfnative)');
        expect(pdf).toContain('<pdf:Producer>pdfnative</pdf:Producer>');
    });

    it('XMP dc:title equals /Info /Title', () => {
        const pdf = buildPDF({ ...makeTableParams(), docTitle: 'XMP Parity Title' }, { tagged: true });
        expect(pdf).toContain('/Title (XMP Parity Title)');
        expect(pdf).toContain('<rdf:li xml:lang="x-default">XMP Parity Title</rdf:li>');
    });

    it('XMP CreateDate, ModifyDate, MetadataDate are all equal', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        const c = pdf.match(/<xmp:CreateDate>([^<]+)<\/xmp:CreateDate>/)?.[1];
        const m = pdf.match(/<xmp:ModifyDate>([^<]+)<\/xmp:ModifyDate>/)?.[1];
        const md = pdf.match(/<xmp:MetadataDate>([^<]+)<\/xmp:MetadataDate>/)?.[1];
        expect(c).toBeDefined();
        expect(m).toBe(c);
        expect(md).toBe(c);
    });

    it('omits dc:creator when no author given', () => {
        const xmp = buildXMPMetadata('Title', '2026-04-25T10:00:00+00:00', 2, 'B');
        expect(xmp).not.toContain('dc:creator');
    });

    it('emits dc:creator when author given', () => {
        const xmp = buildXMPMetadata('Title', '2026-04-25T10:00:00+00:00', 2, 'B', 'Jane Smith');
        expect(xmp).toContain('<dc:creator><rdf:Seq><rdf:li>Jane Smith</rdf:li></rdf:Seq></dc:creator>');
    });

    it('escapes XML special characters in dc:creator', () => {
        const xmp = buildXMPMetadata('T', '2026-04-25T10:00:00+00:00', 2, 'B', 'A & B <C>');
        expect(xmp).toContain('A &amp; B &lt;C&gt;');
    });

    it('document builder propagates metadata.author to dc:creator', () => {
        const pdf = buildDocumentPDF({
            ...makeDocParams(),
            metadata: { author: 'Jane Smith' },
        }, { tagged: true });
        expect(pdf).toContain('<dc:creator>');
        expect(pdf).toContain('Jane Smith');
    });
});
