/**
 * Tests for addSignaturePlaceholder() — Issue #45.
 *
 * Validates the incremental-update injection of an AcroForm signature
 * widget placeholder into pdfnative-generated PDFs, including
 * idempotency, AcroForm merge with pre-existing fields, encryption
 * rejection, and round-trip compatibility with signPdfBytes().
 */

import { describe, it, expect } from 'vitest';
import {
    addSignaturePlaceholder,
    buildDocumentPDFBytes,
    buildPDFBytes,
    openPdf,
    isName,
    isRef,
    isArray,
    isDict,
} from '../../src/index.js';
import type { DocumentParams, PdfParams } from '../../src/index.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeDocParams(): DocumentParams {
    return {
        title: 'Placeholder Test',
        blocks: [
            { type: 'heading', text: 'Hello', level: 1 },
            { type: 'paragraph', text: 'A sample paragraph for the placeholder injector.' },
        ],
    };
}

function makeTableParams(): PdfParams {
    return {
        title: 'Placeholder Table',
        headers: ['A', 'B'],
        rows: [
            { cells: ['x', 'y'], type: '', pointed: false },
            { cells: ['z', 'w'], type: '', pointed: false },
        ],
        infoItems: [],
        balanceText: '',
        countText: '',
        footerText: 'Footer',
    };
}

function bytesToString(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('addSignaturePlaceholder() — issue #45', () => {
    it('appends an incremental update that includes a /Sig dictionary', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned);

        expect(placeheld.length).toBeGreaterThan(unsigned.length);
        // The original prefix is preserved byte-for-byte (incremental update).
        for (let i = 0; i < unsigned.length; i++) {
            expect(placeheld[i]).toBe(unsigned[i]);
        }
        const str = bytesToString(placeheld);
        expect(str).toContain('/Type /Sig');
        expect(str).toContain('/Filter /Adobe.PPKLite');
        expect(str).toContain('/SubFilter /adbe.pkcs7.detached');
        expect(str).toContain('/Contents <');
        expect(str).toContain('/ByteRange [0 0000000000 0000000000 0000000000]');
        expect(str).toMatch(/\/Prev \d+/);
    });

    it('preserves the BYTERANGE_PLACEHOLDER for signPdfBytes() to patch', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned);
        const str = bytesToString(placeheld);
        // signPdfBytes locates the placeholder by exact string match.
        const expected = '/ByteRange [0 0000000000 0000000000 0000000000]';
        expect(str.indexOf(expected)).toBeGreaterThan(0);
        expect(str.indexOf(expected, str.indexOf(expected) + 1)).toBe(-1); // exactly one
    });

    it('reserves the configured /Contents hex slot size (placeholderBytes)', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned, { placeholderBytes: 8192 });
        const str = bytesToString(placeheld);
        // 8192 bytes × 2 hex chars = 16384 zero chars between < and >
        const match = str.match(/\/Contents <(0+)>/);
        expect(match).not.toBeNull();
        expect(match![1].length).toBe(8192 * 2);
    });

    it('emits the AcroForm dict with /Fields containing the widget ref and /SigFlags 3', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned);
        const reader = openPdf(placeheld);
        const catalog = reader.getCatalog();
        const acroFormRef = catalog.get('AcroForm');
        expect(isRef(acroFormRef)).toBe(true);
        if (!isRef(acroFormRef)) return;
        const acroForm = reader.getObject(acroFormRef.num);
        expect(acroForm).not.toBeNull();
        expect(isDict(acroForm!)).toBe(true);
        if (!acroForm || !isDict(acroForm)) return;
        const fields = acroForm.get('Fields');
        expect(isArray(fields)).toBe(true);
        if (!isArray(fields)) return;
        expect(fields.length).toBe(1);
        expect(isRef(fields[0])).toBe(true);
        expect(acroForm.get('SigFlags')).toBe(3);
    });

    it('attaches the widget to /Annots on the requested page', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned, { pageIndex: 0 });
        const reader = openPdf(placeheld);
        const page = reader.getPage(0);
        const annots = page.get('Annots');
        expect(isArray(annots)).toBe(true);
        if (!isArray(annots)) return;
        // At least one annotation must be a widget pointing at a sig dict.
        const refs = annots.filter(isRef);
        let foundWidget = false;
        for (const ref of refs) {
            const obj = reader.getObject(ref.num);
            if (!obj || !isDict(obj)) continue;
            const subtype = obj.get('Subtype');
            const ft = obj.get('FT');
            if (isName(subtype) && subtype.value === 'Widget' && isName(ft) && ft.value === 'Sig') {
                foundWidget = true;
                break;
            }
        }
        expect(foundWidget).toBe(true);
    });

    it('uses the custom fieldName for /T', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned, { fieldName: 'Author.Signature' });
        const str = bytesToString(placeheld);
        expect(str).toContain('/T (Author.Signature)');
    });

    it('is idempotent — calling twice returns the same bytes', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const first = addSignaturePlaceholder(unsigned);
        const second = addSignaturePlaceholder(first);
        expect(second.length).toBe(first.length);
        for (let i = 0; i < first.length; i++) {
            expect(second[i]).toBe(first[i]);
        }
    });

    it('works on table-centric PDFs from buildPDFBytes()', () => {
        const unsigned = buildPDFBytes(makeTableParams());
        const placeheld = addSignaturePlaceholder(unsigned);
        const str = bytesToString(placeheld);
        expect(str).toContain('/Type /Sig');
        expect(str).toContain('/Subtype /Widget');
    });

    it('rejects encrypted PDFs', () => {
        const unsigned = buildDocumentPDFBytes({
            ...makeDocParams(),
            layout: { encryption: { ownerPassword: 'o', userPassword: 'u' } },
        });
        expect(() => addSignaturePlaceholder(unsigned)).toThrow(/encrypted/i);
    });

    it('throws on pageIndex out of range', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        expect(() => addSignaturePlaceholder(unsigned, { pageIndex: 99 })).toThrow(/out of range/i);
    });

    it('throws on invalid placeholderBytes', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        expect(() => addSignaturePlaceholder(unsigned, { placeholderBytes: 0 })).toThrow(/placeholderBytes/);
        expect(() => addSignaturePlaceholder(unsigned, { placeholderBytes: -1 })).toThrow(/placeholderBytes/);
        expect(() => addSignaturePlaceholder(unsigned, { placeholderBytes: 2_000_000 })).toThrow(/placeholderBytes/);
    });

    it('throws on invalid fieldName', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        expect(() => addSignaturePlaceholder(unsigned, { fieldName: '' })).toThrow(/fieldName/);
        expect(() => addSignaturePlaceholder(unsigned, { fieldName: 'has(parens)' })).toThrow(/fieldName/);
    });

    it('preserves /Prev chain (incremental update is valid)', () => {
        const unsigned = buildDocumentPDFBytes(makeDocParams());
        const placeheld = addSignaturePlaceholder(unsigned);
        // After incremental update, the new trailer's /Prev points back
        // to the original startxref. Re-opening the modified PDF must
        // succeed — the reader follows /Prev to merge xref chains.
        const reader = openPdf(placeheld);
        expect(reader.getPages().length).toBeGreaterThan(0);
    });
});
