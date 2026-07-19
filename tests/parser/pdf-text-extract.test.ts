/**
 * Tests for extractText() — content-stream text extraction.
 *
 * Fixtures are self-hosted: either built with the library itself
 * (builder round-trips, encrypted documents) or hand-assembled minimal
 * PDFs exercising specific font/encoding shapes (Type0 + ToUnicode,
 * /Differences, WinAnsi fallback, no-mapping U+FFFD).
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { PdfPasswordError } from '../../src/parser/pdf-decrypt.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── Mini-PDF assembly helpers ────────────────────────────────────────

function latin1Bytes(s: string): Uint8Array {
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i) & 0xFF;
    return buf;
}

/** Assemble a classic-xref PDF from 1-based object bodies (obj 1 = /Root). */
function assemblePdf(objects: readonly string[]): Uint8Array {
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((content, idx) => {
        offsets[idx] = body.length;
        body += `${idx + 1} 0 obj\n${content}\nendobj\n`;
    });
    const xrefOff = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`;
    return latin1Bytes(body);
}

const streamObj = (dict: string, data: string): string =>
    `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;

/** One-page skeleton: catalog, pages, page (F1 → obj 5), content (obj 4). */
function onePagePdf(content: string, fontObjs: readonly string[]): Uint8Array {
    return assemblePdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        streamObj('', content),
        ...fontObjs,
    ]);
}

const HELVETICA = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

// ── Decoding ─────────────────────────────────────────────────────────

describe('extractText decoding', () => {
    it('round-trips text produced by the document builder (WinAnsi + CP-1252)', () => {
        const params: DocumentParams = {
            title: 'Extraction test',
            blocks: [
                { type: 'heading', level: 1, text: 'Quarterly report' },
                { type: 'paragraph', text: 'Revenue grew 14% in Q3.' },
                { type: 'paragraph', text: 'café café — résumé — €42' },
            ],
        };
        const pages = extractText(buildDocumentPDFBytes(params));
        expect(pages).toHaveLength(1);
        expect(pages[0].pageIndex).toBe(0);
        expect(pages[0].text).toContain('Quarterly report');
        expect(pages[0].text).toContain('Revenue grew 14% in Q3.');
        expect(pages[0].text).toContain('café — résumé — €42');
    });

    it('decodes Type0 Identity-H codes through a /ToUnicode CMap (bfchar, bfrange, surrogate pairs)', () => {
        const cmap = [
            '/CIDInit /ProcSet findresource begin',
            '12 dict begin',
            'begincmap',
            '1 begincodespacerange <0000> <FFFF> endcodespacerange',
            '2 beginbfchar <0001> <0048> <0002> <0065> endbfchar',
            '1 beginbfrange <0010> <0012> <006C> endbfrange',
            '1 beginbfchar <0020> <D83DDE00> endbfchar',
            'endcmap end end',
        ].join('\n');
        const pdf = onePagePdf(
            'BT /F1 12 Tf 72 700 Td <000100020010001100120020> Tj ET',
            [
                '<< /Type /Font /Subtype /Type0 /BaseFont /T /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 6 0 R >>',
                streamObj('', cmap),
                '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /T /DW 600 /W [1 [500 400]] >>',
            ],
        );
        const pages = extractText(pdf);
        // <0001><0002> -> "He", bfrange 0010..0012 -> "lmn", <0020> -> U+1F600.
        expect(pages[0].text).toBe('Helmn\u{1F600}');
    });

    it('resolves /Encoding /Differences glyph names through the AGL subset', () => {
        const pdf = onePagePdf(
            'BT /F1 12 Tf 72 700 Td (AB) Tj ET',
            ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /Widths [500 500] '
                + '/Encoding << /BaseEncoding /WinAnsiEncoding /Differences [65 /Euro /uni0042] >> >>'],
        );
        // Byte 65 remapped to /Euro, byte 66 to /uni0042 -> "B".
        expect(extractText(pdf)[0].text).toBe('€B');
    });

    it('falls back to WinAnsi when the font has no /ToUnicode and no /Encoding', () => {
        // \200 = 0x80 -> euro, \223 = 0x93 -> left double quote.
        const pdf = onePagePdf('BT /F1 12 Tf 72 700 Td (\\200 \\223ok\\224) Tj ET', [HELVETICA]);
        expect(extractText(pdf)[0].text).toBe('€ “ok”');
    });

    it('emits U+FFFD for codes with no mapping anywhere', () => {
        // 0x81 is unmapped in WinAnsi.
        const pdf = onePagePdf('BT /F1 12 Tf 72 700 Td (a\\201b) Tj ET', [HELVETICA]);
        expect(extractText(pdf)[0].text).toBe('a�b');
    });
});

// ── Positions & reading order ────────────────────────────────────────

describe('extractText positions and reading order', () => {
    it('returns device-space run positions when includeRuns is set', () => {
        const pdf = onePagePdf('BT /F1 12 Tf 100 650 Td (World) Tj ET', [HELVETICA]);
        const [page] = extractText(pdf, { includeRuns: true });
        expect(page.runs).toBeDefined();
        expect(page.runs).toHaveLength(1);
        expect(page.runs![0].text).toBe('World');
        expect(page.runs![0].x).toBeCloseTo(100, 5);
        expect(page.runs![0].y).toBeCloseTo(650, 5);
        expect(page.runs![0].fontSize).toBeCloseTo(12, 5);
        expect(page.runs![0].fontName).toBe('F1');
    });

    it('applies Tm and cm to run positions', () => {
        const pdf = onePagePdf(
            'q 2 0 0 2 10 20 cm BT /F1 12 Tf 1 0 0 1 50 100 Tm (X) Tj ET Q',
            [HELVETICA],
        );
        const [page] = extractText(pdf, { includeRuns: true });
        // (50,100) through CTM [2 0 0 2 10 20] -> (110, 220); size doubled.
        expect(page.runs![0].x).toBeCloseTo(110, 5);
        expect(page.runs![0].y).toBeCloseTo(220, 5);
        expect(page.runs![0].fontSize).toBeCloseTo(24, 5);
    });

    it('sorts lines top-to-bottom even when emitted out of order', () => {
        const pdf = onePagePdf(
            'BT /F1 12 Tf 100 650 Td (World) Tj ET BT /F1 12 Tf 100 700 Td (Hello) Tj ET',
            [HELVETICA],
        );
        const [page] = extractText(pdf, { includeRuns: true });
        expect(page.text).toBe('Hello\nWorld');
        // Runs stay in content-stream order.
        expect(page.runs!.map(r => r.text)).toEqual(['World', 'Hello']);
    });

    it('treats a large negative TJ adjustment as a word space', () => {
        const pdf = onePagePdf('BT /F1 12 Tf 72 700 Td [(Hello) -250 (World)] TJ ET', [HELVETICA]);
        expect(extractText(pdf)[0].text).toBe('Hello World');
    });

    it("handles T*, ' and leading for multi-line text", () => {
        const pdf = onePagePdf(
            "BT /F1 12 Tf 14 TL 72 700 Td (Line1) Tj T* (Line2) Tj (Line3) ' ET",
            [HELVETICA],
        );
        expect(extractText(pdf)[0].text).toBe('Line1\nLine2\nLine3');
    });

    it('extracts text nested in a Form XObject', () => {
        const pdf = assemblePdf([
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
                + '/Resources << /Font << /F1 5 0 R >> /XObject << /Fm1 6 0 R >> >> /Contents 4 0 R >>',
            streamObj('', 'BT /F1 12 Tf 72 700 Td (Outer) Tj ET /Fm1 Do'),
            HELVETICA,
            streamObj(
                '/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >>',
                'BT /F1 12 Tf 72 600 Td (Inner) Tj ET',
            ),
        ]);
        const text = extractText(pdf)[0].text;
        expect(text).toContain('Outer');
        expect(text).toContain('Inner');
    });
});

// ── Encrypted documents ──────────────────────────────────────────────

// AES-256 (R6) key derivation is deliberately expensive and slows further
// under coverage instrumentation — give these tests generous timeouts.
describe('extractText on encrypted documents', { timeout: 60_000 }, () => {
    const params: DocumentParams = {
        title: 'Secret',
        blocks: [{ type: 'paragraph', text: 'Confidential payload 12345.' }],
    };
    const plainText = extractText(buildDocumentPDFBytes(params))[0].text;

    it('throws PdfPasswordError without the password', () => {
        // A non-empty USER password is required: owner-only encryption opens
        // transparently with the default empty user password.
        const enc = buildDocumentPDFBytes(params, {
            encryption: { ownerPassword: 'opw', userPassword: 'upw', algorithm: 'aes256' },
        });
        expect(() => extractText(enc)).toThrow(PdfPasswordError);
        expect(extractText(enc, { password: 'upw' })[0].text).toBe(plainText);
    });

    it('extracts identical text with the password (AES-256)', () => {
        const enc = buildDocumentPDFBytes(params, {
            encryption: { ownerPassword: 'pw', algorithm: 'aes256' },
        });
        expect(extractText(enc, { password: 'pw' })[0].text).toBe(plainText);
    });

    it('extracts identical text with the password (AES-128)', () => {
        const enc = buildDocumentPDFBytes(params, {
            encryption: { ownerPassword: 'pw', algorithm: 'aes128' },
        });
        expect(extractText(enc, { password: 'pw' })[0].text).toBe(plainText);
    });
});

// ── Validation ───────────────────────────────────────────────────────

describe('extractText validation', () => {
    const onePage = onePagePdf('BT /F1 12 Tf 72 700 Td (Solo) Tj ET', [HELVETICA]);

    it('rejects out-of-range page indices', () => {
        expect(() => extractText(onePage, { pages: [5] })).toThrow(/out of range/);
        expect(() => extractText(onePage, { pages: [-1] })).toThrow(/out of range/);
        expect(() => extractText(onePage, { pages: [0.5] })).toThrow(/out of range/);
    });

    it('rejects a non-positive maxTextLength', () => {
        expect(() => extractText(onePage, { maxTextLength: 0 })).toThrow(/maxTextLength/);
        expect(() => extractText(onePage, { maxTextLength: -5 })).toThrow(/maxTextLength/);
    });

    it('extracts only the requested pages', () => {
        const twoPages = assemblePdf([
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
            streamObj('', 'BT /F1 12 Tf 72 700 Td (PageOne) Tj ET'),
            streamObj('', 'BT /F1 12 Tf 72 700 Td (PageTwo) Tj ET'),
            HELVETICA,
        ]);
        const all = extractText(twoPages);
        expect(all.map(p => p.text)).toEqual(['PageOne', 'PageTwo']);
        const second = extractText(twoPages, { pages: [1] });
        expect(second).toHaveLength(1);
        expect(second[0].pageIndex).toBe(1);
        expect(second[0].text).toBe('PageTwo');
    });
});

// ── Safety & determinism ─────────────────────────────────────────────

describe('extractText safety and determinism', () => {
    it('enforces maxTextLength as a hard memory bound', () => {
        const pdf = onePagePdf(
            'BT /F1 12 Tf 72 700 Td (This is a fairly long line of text) Tj ET',
            [HELVETICA],
        );
        expect(() => extractText(pdf, { maxTextLength: 10 })).toThrow(/maxTextLength/);
    });

    it('survives hostile content: deep q nesting, unbalanced BT, inline images, huge TJ', () => {
        const deepQ = `${'q '.repeat(200)}BT /F1 12 Tf 72 700 Td (Deep) Tj ET${' Q'.repeat(200)}`;
        expect(extractText(onePagePdf(deepQ, [HELVETICA]))[0].text).toBe('Deep');

        const unbalanced = 'BT /F1 12 Tf 72 700 Td (NoET) Tj';
        expect(extractText(onePagePdf(unbalanced, [HELVETICA]))[0].text).toBe('NoET');

        const withImage = 'BT /F1 12 Tf 72 700 Td (A) Tj ET '
            + 'BI /W 2 /H 2 /BPC 8 /CS /G ID \x01\x28\x29\x5C\xFF\x00 EI '
            + 'BT /F1 12 Tf 72 680 Td (B) Tj ET';
        expect(extractText(onePagePdf(withImage, [HELVETICA]))[0].text).toBe('A\nB');

        const hugeTJ = `BT /F1 12 Tf 72 700 Td [${'(x) 5 '.repeat(10_000)}] TJ ET`;
        const text = extractText(onePagePdf(hugeTJ, [HELVETICA]))[0].text;
        expect(text).toBe('x'.repeat(10_000));
    });

    it('is deterministic across invocations', () => {
        const params: DocumentParams = {
            title: 'Determinism',
            blocks: [
                { type: 'heading', level: 1, text: 'Heading' },
                { type: 'paragraph', text: 'Body text with numbers 123 and symbols %&/.' },
            ],
        };
        const bytes = buildDocumentPDFBytes(params);
        const a = extractText(bytes, { includeRuns: true });
        const b = extractText(bytes, { includeRuns: true });
        expect(a).toEqual(b);
    });
});
