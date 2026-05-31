import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { validatePdfUA } from '../../src/parser/pdf-ua-validator.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const sample: DocumentParams = {
    title: 'PDF/UA Sample',
    blocks: [
        { type: 'heading', level: 1, text: 'Accessible Document' },
        { type: 'paragraph', text: 'This document is produced in tagged mode and should satisfy the PDF/UA structural prerequisites.' },
        { type: 'list', items: ['First item', 'Second item', 'Third item'], style: 'bullet' },
    ],
};

describe('validatePdfUA', () => {
    it('passes a tagged document', () => {
        const bytes = buildDocumentPDFBytes(sample, { tagged: true });
        const res = validatePdfUA(bytes);
        expect(res.errors).toEqual([]);
        expect(res.valid).toBe(true);
    });

    it('reports structural errors for a non-tagged document', () => {
        const bytes = buildDocumentPDFBytes(sample, { tagged: false });
        const res = validatePdfUA(bytes);
        expect(res.valid).toBe(false);
        // Non-tagged docs lack /MarkInfo, /StructTreeRoot and /Metadata.
        expect(res.errors.some((e) => e.includes('/MarkInfo'))).toBe(true);
        expect(res.errors.some((e) => e.includes('/StructTreeRoot'))).toBe(true);
    });

    it('returns a single error for unparseable input', () => {
        const res = validatePdfUA(new Uint8Array([1, 2, 3, 4]));
        expect(res.valid).toBe(false);
        expect(res.errors.length).toBeGreaterThanOrEqual(1);
    });

    it('finds no duplicate MCIDs in a tagged document', () => {
        const bytes = buildDocumentPDFBytes(sample, { tagged: true });
        const res = validatePdfUA(bytes);
        expect(res.errors.some((e) => e.includes('duplicate /MCID'))).toBe(false);
    });
});
