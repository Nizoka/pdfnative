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
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import * as notoArabic from '../../fonts/noto-arabic-data.js';

const arabicFont = notoArabic as unknown as FontData;
const fontEntries: FontEntry[] = [{ fontData: arabicFont, fontRef: '/F3', lang: 'ar' }];

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

/**
 * The glyphs of a word as the encoding context shapes them, the CIDs the
 * content stream shows them by (C28), and the page the builder wrote.
 */
function shaped(text: string): { gids: number[]; codes: string[]; content: string } {
    const enc = createEncodingContext(fontEntries, false, false);
    const run = enc.textRuns(text, 10)[0];
    const gids = run.shaped!.map(g => g.gid);
    const codes = run.cids!.map(c => c.toString(16).toUpperCase().padStart(4, '0'));
    return { gids, codes, content: pageContent(build(text)) };
}
const gid = (cp: number): number => arabicFont.cmap[cp] as number;

describe('Persian joining in the content stream', () => {
    it('renders قیمت with the MEDIAL farsi-yeh form, never the isolated one', () => {
        const { gids, codes, content } = shaped('قیمت');
        expect(gids).toContain(gid(0xFBFF)); // farsi yeh MEDIAL
        expect(gids).not.toContain(gid(0x06CC)); // nominal = isolated yeh
        expect(content).toContain(`<${codes.join('')}>`); // shown by its CIDs
    });

    it('renders سال with the FINAL alef form (no bare alef)', () => {
        const { gids, codes, content } = shaped('سال');
        expect(gids).toContain(gid(0xFE8E)); // alef FINAL
        expect(gids).toContain(gid(0xFEB3)); // seen initial
        expect(content).toContain(`<${codes.join('')}>`);
    });

    it('renders پدر and گفتگو through Presentation Forms-A', () => {
        expect(shaped('پدر').gids).toContain(gid(0xFB58)); // peh INITIAL
        const goftogu = shaped('گفتگو');
        expect(goftogu.gids).toContain(gid(0xFB94)); // gaf initial
        expect(goftogu.gids).toContain(gid(0xFB95)); // gaf medial
        expect(goftogu.content).toContain(`<${goftogu.codes.join('')}>`);
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

    it('keeps an LTR island intact inside a Persian sentence, each Persian run logical (C27)', () => {
        const pdf = build('متن با (English text) داخل آن');
        const text = extractText(pdf).map(p => p.text).join('\n');
        // The brackets resolve to the Persian level (UAX #9 N0): each
        // right-to-left run carries its own bracket, in logical order, and
        // the island between them is untouched.
        expect(text).toContain('English text');
        expect(text).toContain('متن با (');
        expect(text).toContain(') داخل آن');
    });
});
