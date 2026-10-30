/**
 * decodePdfTextString (v1.9.0, #85) — the one decoder for ISO 32000-1
 * §7.9.2.2 text strings: UTF-16BE behind FE FF, UTF-8 behind EF BB BF,
 * otherwise PDFDocEncoding (Annex D). Round-trips through the readers that
 * used to carry their own copies: /Info, annotations, page labels, form
 * fields and signature field names.
 */

import { describe, it, expect } from 'vitest';
import { decodePdfTextString } from '../../src/parser/pdf-text-string.js';
import { encodePdfTextString } from '../../src/core/pdf-text.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { createModifier } from '../../src/parser/pdf-modifier.js';
import { buildAnnotationBody } from '../../src/core/pdf-annot-markup.js';
import { readFormFields } from '../../src/core/pdf-form-fill.js';
import { addSignaturePlaceholder } from '../../src/core/pdf-sig-placeholder.js';
import { listSignatures } from '../../src/core/pdf-sig-utils.js';
import { isDict } from '../../src/parser/pdf-object-parser.js';
import * as pdfnative from '../../src/index.js';

/** Bytes → the byte-per-char string the tokenizer produces. */
const raw = (...bytes: number[]): string => String.fromCharCode(...bytes);

describe('decodePdfTextString', () => {
    it('decodes UTF-16BE behind the FE FF byte order mark', () => {
        expect(decodePdfTextString(raw(0xFE, 0xFF, 0x00, 0x52, 0x20, 0x14, 0x00, 0x7A))).toBe('R—z');
    });

    it('keeps an odd trailing UTF-16BE byte visible as U+FFFD instead of dropping it', () => {
        expect(decodePdfTextString(raw(0xFE, 0xFF, 0x00, 0x41, 0x00))).toBe('A�');
    });

    it('decodes UTF-8 behind the EF BB BF byte order mark (ISO 32000-2)', () => {
        expect(decodePdfTextString(raw(0xEF, 0xBB, 0xBF, 0x68, 0xC3, 0xA9, 0xE6, 0x9C, 0x88))).toBe('hé月');
    });

    it('maps the PDFDocEncoding high range, not Latin-1', () => {
        // 0x80 bullet, 0x84 em dash, 0x85 en dash, 0x8D/0x8E double quotes, 0x95 Lslash, 0x9C oe, 0xA0 Euro
        expect(decodePdfTextString(raw(0x80, 0x84, 0x85, 0x8D, 0x8E, 0x95, 0x9C, 0xA0))).toBe('•—–“”Łœ€');
        // 0x18–0x1F are the spacing accents
        expect(decodePdfTextString(raw(0x18, 0x19, 0x1F))).toBe('˘ˇ˜');
        // undefined positions never masquerade as text
        expect(decodePdfTextString(raw(0x7F, 0x9F, 0xAD))).toBe('���');
    });

    it('passes ASCII and Latin-1 letters through unchanged', () => {
        expect(decodePdfTextString('caf\xe9 Rapport 2026')).toBe('café Rapport 2026');
        expect(decodePdfTextString('')).toBe('');
    });

    it('is the inverse of encodePdfTextString for literal and UTF-16BE output', () => {
        const samples = ['plain', 'café', 'Rapport Annuel — 2026', 'ชื่อ', '月度', 'a\nb (x) \\ y'];
        for (const s of samples) {
            const encoded = encodePdfTextString(s);
            // `(…)` literal → unescape; `<…>` hex → bytes.
            let bytes: string;
            if (encoded.startsWith('<')) {
                const hex = encoded.slice(1, -1);
                bytes = '';
                for (let i = 0; i < hex.length; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
            } else {
                bytes = encoded.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[c] ?? c);
            }
            expect(decodePdfTextString(bytes), s).toBe(s);
        }
    });

    it('is exported from the package root', () => {
        expect(typeof pdfnative.decodePdfTextString).toBe('function');
    });
});

describe('the readers decode their text strings through it', () => {
    const title = 'Rapport Annuel — 2026 • ชื่อ';
    const bytes = buildDocumentPDFBytes({ title, blocks: [{ type: 'paragraph', text: 'x' }], pageLabels: [{ startPage: 0, style: 'roman', prefix: 'Préface — ' }] });

    it('/Info /Title round-trips through openPdf + decodePdfTextString', () => {
        const reader = openPdf(bytes);
        const info = reader.resolveValue(reader.trailer.get('Info') ?? null);
        expect(info !== null && isDict(info)).toBe(true);
        if (info === null || !isDict(info)) return;
        const rawTitle = info.get('Title');
        expect(typeof rawTitle).toBe('string');
        expect(decodePdfTextString(rawTitle as string)).toBe(title);
    });

    it('getPageLabels() decodes a non-ASCII /P prefix', () => {
        const labels = openPdf(bytes).getPageLabels();
        expect(labels?.[0]?.prefix).toBe('Préface — ');
    });

    it('getAnnotations() decodes /Contents and /T', () => {
        const mod = createModifier(openPdf(bytes));
        mod.addAnnotation(0, buildAnnotationBody({ type: 'text', rect: [10, 10, 30, 30], contents: 'Vu — à relire', title: 'Zoë' }));
        const [a] = openPdf(mod.save()).getAnnotations(0);
        expect(a.contents).toBe('Vu — à relire');
        expect(a.title).toBe('Zoë');
    });

    it('readFormFields() decodes field names and values', () => {
        const form = buildDocumentPDFBytes({
            title: 'Form',
            blocks: [{ type: 'formField', fieldType: 'text', name: 'prénom', value: 'Émile — 月' }],
        });
        const fields = readFormFields(form);
        expect(fields.map(f => f.name)).toContain('prénom');
        expect(fields.find(f => f.name === 'prénom')?.value).toBe('Émile — 月');
    });

    it('listSignatures() reads the field name through the decoder (ASCII names round-trip unchanged)', () => {
        // addSignaturePlaceholder restricts field names to ASCII; a foreign
        // producer's UTF-16BE /T goes through the same decoder as the others.
        const withSig = addSignaturePlaceholder(bytes, { fieldName: 'Signature-Direction' });
        expect(listSignatures(withSig)[0]?.fieldName).toBe('Signature-Direction');
    });
});
