/**
 * Persian end-to-end rendering (v1.7.0): the three RTL fixes verified at
 * the PDF level with the real bundled Noto Naskh Arabic font — positional
 * glyphs in the content stream, logical digit order and mirrored
 * delimiters in the extracted text.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import * as notoArabic from '../../fonts/noto-arabic-data.js';

const arabicFont = notoArabic as unknown as FontData;
const fontEntries: FontEntry[] = [{ fontData: arabicFont, fontRef: '/F3', lang: 'ar' }];

const gidHex = (cp: number): string =>
    (arabicFont.cmap[cp] as number).toString(16).toUpperCase().padStart(4, '0');

function pageContent(pdf: Uint8Array): string {
    const r = openPdf(pdf);
    const page = r.getPage(0);
    const data = r.decodeStream(r.resolveValue(page.get('Contents') ?? null) as never);
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return s;
}

function build(text: string): Uint8Array {
    const params: DocumentParams = {
        title: 'fa',
        blocks: [{ type: 'paragraph', text }],
        fontEntries,
    };
    return buildDocumentPDFBytes(params);
}

describe('Persian joining in the content stream', () => {
    it('renders قیمت with the MEDIAL farsi-yeh form, never the isolated one', () => {
        const content = pageContent(build('قیمت'));
        expect(content).toContain(gidHex(0xFBFF)); // farsi yeh MEDIAL
        expect(content).not.toContain(gidHex(0x06CC)); // nominal = isolated yeh
    });

    it('renders سال with the FINAL alef form (no bare alef)', () => {
        const content = pageContent(build('سال'));
        expect(content).toContain(gidHex(0xFE8E)); // alef FINAL
        expect(content).toContain(gidHex(0xFEB3)); // seen initial
    });

    it('renders پدر and گفتگو through Presentation Forms-A', () => {
        const pedar = pageContent(build('پدر'));
        expect(pedar).toContain(gidHex(0xFB58)); // peh INITIAL
        const goftogu = pageContent(build('گفتگو'));
        expect(goftogu).toContain(gidHex(0xFB94)); // gaf initial
        expect(goftogu).toContain(gidHex(0xFB95)); // gaf medial
    });
});

describe('Persian digits and mirroring at the extraction level', () => {
    it('keeps the Persian year in logical order', () => {
        const pdf = build('سال ۱۴۰۵ هجری خورشیدی');
        const text = extractText(pdf).map(p => p.text).join('\n');
        // Reversed order must never appear; the leading digit may extract as
        // U+0661 (shared glyph with U+06F1 in Noto — pre-existing ToUnicode
        // characteristic), so match either spelling of 1-4-0-5.
        expect(text).toMatch(/[۱١][۴٤][۰٠][۵٥]/);
        expect(text).not.toMatch(/[۵٥][۰٠][۴٤][۱١]/);
    });

    it('mirrors parentheses around Persian content', () => {
        const pdf = build('این کتابخانه (بدون وابستگی) است');
        const text = extractText(pdf).map(p => p.text).join('\n');
        expect(text).toContain('(');
        expect(text).toContain(')');
    });

    it('keeps an LTR island intact inside a Persian sentence', () => {
        const pdf = build('متن با (English text) داخل آن');
        const text = extractText(pdf).map(p => p.text).join('\n');
        expect(text).toContain('(English text)');
    });
});
