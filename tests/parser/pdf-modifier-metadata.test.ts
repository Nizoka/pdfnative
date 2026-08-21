/**
 * pdfnative — PdfModifier.updateMetadata tests (v1.7.0)
 * ========================================================
 * Incremental /Info re-issue + XMP resynchronisation:
 *   - /Info gains /ModDate + provided fields (ISO 32000-1 §14.3.3)
 *   - XMP xmp:ModifyDate / xmp:MetadataDate mirror the same instant
 *     (Info ↔ XMP parity, ISO 19005 §6.7.3-style equivalence)
 *   - xmp:CreateDate and the pdfaid claim are preserved
 *   - deterministic output for a fixed modDate
 *   - existing buildXMPMetadata call sites stay byte-identical
 *     (ModifyDate == CreateDate at creation time)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { createModifier } from '../../src/parser/pdf-modifier.js';
import { isDict, isStream, isRef } from '../../src/parser/pdf-object-parser.js';
import type { PdfDict } from '../../src/parser/pdf-object-parser.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPdfMetadata } from '../../src/core/pdf-tags.js';
import { initNodeCompression } from '../../src/core/pdf-compress.js';
import { initNodeDecompression } from '../../src/parser/pdf-inflate.js';
import type { PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── Helpers ──────────────────────────────────────────────────────────

const FIXED_DATE = new Date(2026, 2, 14, 9, 45, 30); // 2026-03-14 09:45:30 local

function tableParams(): PdfParams {
    return {
        title: 'Metadata Test Report',
        infoItems: [{ label: 'Period', value: 'Mar 2026' }],
        balanceText: 'Balance: $1.00',
        countText: '1 item',
        headers: ['Date', 'Item', 'Amount'],
        rows: [{ cells: ['03/14', 'Item', '$1.00'], type: 'credit', pointed: false }],
        footerText: 'footer',
    };
}

function docParams(): DocumentParams {
    return {
        title: 'Tagged Metadata Doc',
        blocks: [
            { type: 'heading', text: 'Heading', level: 1 },
            { type: 'paragraph', text: 'A paragraph of body text.' },
        ],
    };
}

function latin1(bytes: Uint8Array): string {
    return new TextDecoder('latin1').decode(bytes);
}

/** Decode a PDF text-string value (UTF-16BE BOM or Latin-1/ASCII). */
function decodeText(raw: unknown): string {
    if (typeof raw !== 'string') throw new Error('expected a string value');
    if (raw.length >= 2 && raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < raw.length; i += 2) {
            out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
        }
        return out;
    }
    return raw;
}

function xmpOf(bytes: Uint8Array): string | null {
    const reader = openPdf(bytes);
    const mdRef = reader.getCatalog().get('Metadata');
    if (mdRef === undefined || !isRef(mdRef)) return null;
    const md = reader.resolveValue(mdRef);
    if (!isStream(md)) return null;
    return latin1(reader.decodeStream(md));
}

beforeAll(async () => {
    await initNodeCompression();
    await initNodeDecompression();
});

// ── /Info updates on a plain PDF ─────────────────────────────────────

describe('updateMetadata — plain PDF (/Info only)', () => {
    it('sets /ModDate and the provided fields, keeps the rest', () => {
        const original = buildPDFBytes(tableParams(), { compress: false });
        const mod = createModifier(openPdf(original));
        mod.updateMetadata({
            title: 'Updated Title',
            author: 'Jane Doe',
            subject: 'Updated subject',
            keywords: 'alpha, beta',
            modDate: FIXED_DATE,
        });
        const saved = mod.save();

        const info = openPdf(saved).getInfo();
        expect(info).not.toBeNull();
        expect(decodeText(info!.get('Title'))).toBe('Updated Title');
        expect(decodeText(info!.get('Author'))).toBe('Jane Doe');
        expect(decodeText(info!.get('Subject'))).toBe('Updated subject');
        expect(decodeText(info!.get('Keywords'))).toBe('alpha, beta');

        const { pdfDate } = buildPdfMetadata(FIXED_DATE);
        expect(info!.get('ModDate')).toBe(pdfDate);
        // /CreationDate and /Producer survive from the original revision
        expect(typeof info!.get('CreationDate')).toBe('string');
        expect(info!.get('Producer')).toBe('pdfnative');
    });

    it('leaves omitted fields untouched', () => {
        const original = buildPDFBytes(tableParams(), { compress: false });
        const mod = createModifier(openPdf(original));
        mod.updateMetadata({ author: 'Only Author', modDate: FIXED_DATE });
        const saved = mod.save();

        const info = openPdf(saved).getInfo();
        expect(decodeText(info!.get('Title'))).toBe('Metadata Test Report'); // original title kept
        expect(decodeText(info!.get('Author'))).toBe('Only Author');
    });

    it('round-trips non-ASCII values through UTF-16BE', () => {
        const original = buildPDFBytes(tableParams(), { compress: false });
        const mod = createModifier(openPdf(original));
        mod.updateMetadata({ title: 'Résumé — été', modDate: FIXED_DATE });
        const saved = mod.save();

        const info = openPdf(saved).getInfo();
        expect(decodeText(info!.get('Title'))).toBe('Résumé — été');
    });

    it('does not touch XMP on a document without a /Metadata stream', () => {
        const original = buildPDFBytes(tableParams(), { compress: false });
        expect(xmpOf(original)).toBeNull();

        const mod = createModifier(openPdf(original));
        mod.updateMetadata({ title: 'No XMP here', modDate: FIXED_DATE });
        const saved = mod.save();

        expect(xmpOf(saved)).toBeNull();
        const tail = latin1(saved.subarray(original.length));
        expect(tail).not.toContain('/Type /Metadata');
    });

    it('creates an /Info dictionary when the source has none', () => {
        // Hand-assembled PDF without /Info
        const objs = [
            '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
            '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
            '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n',
        ];
        let body = '%PDF-1.4\n';
        const offsets: number[] = [];
        for (const o of objs) { offsets.push(body.length); body += o; }
        const xrefPos = body.length;
        body += 'xref\n0 4\n0000000000 65535 f \n';
        for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
        body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
        const original = new Uint8Array(body.length);
        for (let i = 0; i < body.length; i++) original[i] = body.charCodeAt(i) & 0xFF;

        const reader = openPdf(original);
        expect(reader.getInfo()).toBeNull();

        const mod = createModifier(reader);
        mod.updateMetadata({ title: 'Fresh Info', author: 'A', modDate: FIXED_DATE });
        const saved = mod.save();

        const info = openPdf(saved).getInfo();
        expect(info).not.toBeNull();
        expect(decodeText(info!.get('Title'))).toBe('Fresh Info');
        const { pdfDate } = buildPdfMetadata(FIXED_DATE);
        expect(info!.get('ModDate')).toBe(pdfDate);
    });
});

// ── XMP resynchronisation on a PDF/A document ────────────────────────

describe('updateMetadata — PDF/A document (XMP resync)', () => {
    it('mirrors ModifyDate/MetadataDate into XMP and preserves CreateDate + pdfaid', () => {
        const original = buildDocumentPDFBytes(docParams(), { compress: false, tagged: 'pdfa2b' });
        const origXmp = xmpOf(original);
        expect(origXmp).not.toBeNull();
        const origCreate = /<xmp:CreateDate>([^<]*)<\/xmp:CreateDate>/.exec(origXmp!)![1];

        const mod = createModifier(openPdf(original));
        mod.updateMetadata({ title: 'Retitled', author: 'Jane Doe', modDate: FIXED_DATE });
        const saved = mod.save();

        const xmp = xmpOf(saved);
        expect(xmp).not.toBeNull();
        const { pdfDate, xmpDate } = buildPdfMetadata(FIXED_DATE);

        // ModifyDate / MetadataDate mirror the /Info /ModDate instant
        expect(xmp).toContain(`<xmp:ModifyDate>${xmpDate}</xmp:ModifyDate>`);
        expect(xmp).toContain(`<xmp:MetadataDate>${xmpDate}</xmp:MetadataDate>`);
        const info = openPdf(saved).getInfo();
        expect(info!.get('ModDate')).toBe(pdfDate);

        // CreateDate and the PDF/A claim are preserved from the old packet
        expect(xmp).toContain(`<xmp:CreateDate>${origCreate}</xmp:CreateDate>`);
        expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');

        // dc parity with the FINAL /Info values
        expect(xmp).toContain('Retitled');
        expect(xmp).toContain('<dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>');
        expect(decodeText(info!.get('Title'))).toBe('Retitled');
    });

    it('is deterministic for a fixed modDate', () => {
        const original = buildDocumentPDFBytes(docParams(), { compress: false, tagged: 'pdfa2b' });
        const run = (): Uint8Array => {
            const mod = createModifier(openPdf(original));
            mod.updateMetadata({ title: 'Same Title', modDate: FIXED_DATE });
            return mod.save();
        };
        const a = run();
        const b = run();
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('reopened document still parses as a tagged PDF', () => {
        const original = buildDocumentPDFBytes(docParams(), { compress: false, tagged: 'pdfa2b' });
        const mod = createModifier(openPdf(original));
        mod.updateMetadata({ subject: 'New subject', modDate: FIXED_DATE });
        const saved = mod.save();

        const reader = openPdf(saved);
        expect(reader.pageCount).toBe(1);
        const markInfo = reader.resolveValue(reader.getCatalog().get('MarkInfo') ?? null);
        expect(isDict(markInfo)).toBe(true);
        expect((markInfo as PdfDict).get('Marked')).toBe(true);
    });
});

// ── Creation-time call sites stay byte-identical ─────────────────────

describe('buildXMPMetadata backwards compatibility', () => {
    it('freshly built docs still emit ModifyDate == CreateDate == MetadataDate', () => {
        const bytes = buildDocumentPDFBytes(docParams(), { compress: false, tagged: 'pdfa2b' });
        const xmp = xmpOf(bytes);
        expect(xmp).not.toBeNull();
        const create = /<xmp:CreateDate>([^<]*)<\/xmp:CreateDate>/.exec(xmp!)![1];
        expect(xmp).toContain(`<xmp:ModifyDate>${create}</xmp:ModifyDate>`);
        expect(xmp).toContain(`<xmp:MetadataDate>${create}</xmp:MetadataDate>`);
    });
});
