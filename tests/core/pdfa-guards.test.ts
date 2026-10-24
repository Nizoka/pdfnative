/**
 * PDF/A declaration guards (v1.7.0, #69): a conformance level requested
 * with a configuration known to fail validation surfaces a diagnostic —
 * warning by default, thrown error under `strict` — instead of silently
 * stamping the pdfaid claim.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import * as notoSansData from '../../fonts/noto-sans-data.js';
import * as notoTaiThamData from '../../fonts/noto-taitham-data.js';
import * as notoOriyaData from '../../fonts/noto-oriya-data.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const latinEntry: FontEntry = {
    fontData: notoSansData as unknown as FontData,
    fontRef: '/F3',
    lang: 'latin',
};

const docParams: DocumentParams = {
    title: 'Guards',
    blocks: [{ type: 'paragraph', text: 'hello' }],
};

const tableParams: PdfParams = {
    title: 'Guards',
    infoItems: [],
    headers: ['A', 'B', 'C', 'D', 'E'],
    rows: [{ cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false }],
    balanceText: '',
    countText: '',
    footerText: '',
};

/** Minimal 4-component (CMYK) baseline JPEG — SOF0 declares 4 components. */
function makeCmykJpeg(): Uint8Array {
    return new Uint8Array([
        0xFF, 0xD8, // SOI
        // SOF0 — height=2, width=2, components=4 (CMYK)
        0xFF, 0xC0, 0x00, 0x14, 0x08,
        0x00, 0x02, 0x00, 0x02, 0x04,
        0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0x04, 0x11, 0x00,
        0xFF, 0xD9, // EOI
    ]);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PDFA_NO_FONT_ENTRIES (#69)', () => {
    it('emits exactly one diagnostic when tagged is set without fontEntries', () => {
        const seen: PdfDiagnostic[] = [];
        const bytes = buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: d => seen.push(d),
        });
        expect(seen.length).toBe(1);
        expect(seen[0].code).toBe('PDFA_NO_FONT_ENTRIES');
        expect(seen[0].message).toContain('fontEntries');
        expect(seen[0].message).toContain('pdfa2b');
        // Non-breaking: the document is still produced.
        expect(bytes.length).toBeGreaterThan(100);
    });

    it('throws under strict before any output is produced', () => {
        expect(() => buildDocumentPDFBytes(docParams, { tagged: 'pdfa2b', strict: true }))
            .toThrow(/fontEntries/);
    });

    it('stays silent when an embedded font is registered', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes({ ...docParams, fontEntries: [latinEntry] }, {
            tagged: 'pdfa2b',
            onDiagnostic: d => seen.push(d),
        });
        expect(seen).toEqual([]);
    });

    it('stays silent when tagged mode is off', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(docParams, { onDiagnostic: d => seen.push(d) });
        expect(seen).toEqual([]);
    });

    it('covers the table builder (buildPDF) too', () => {
        const seen: PdfDiagnostic[] = [];
        buildPDFBytes(tableParams, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.length).toBe(1);
        expect(seen[0].code).toBe('PDFA_NO_FONT_ENTRIES');
        expect(() => buildPDFBytes(tableParams, { tagged: 'pdfa2b', strict: true }))
            .toThrow(/fontEntries/);
    });

    it('emits the base-14 /ToUnicode CMap in tagged table-builder output', () => {
        // C10 parity with the document builder: the tagged Latin branch must
        // reference and emit the shared WinAnsi CMap.
        const bytes = buildPDFBytes(tableParams, { tagged: 'pdfa2b', onDiagnostic: () => {} });
        const pdf = Buffer.from(bytes).toString('latin1');
        expect(pdf).toContain('/ToUnicode');
        expect(pdf).toContain('beginbfchar');
    });

    it('defaults to a single deduplicated console.warn', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        buildDocumentPDFBytes(docParams, { tagged: 'pdfa2b' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('pdfnative:');
    });
});

describe('PDFA_UNEMBEDDED_FORM_FONT', () => {
    const formDoc: DocumentParams = {
        title: 'Form',
        blocks: [
            { type: 'paragraph', text: 'form' },
            { type: 'formField', fieldType: 'text', name: 'f1', label: 'Field' },
        ],
        fontEntries: [latinEntry],
    };

    // v1.8.0 (#74): the form's /DR font is embedded whenever a registered
    // font can render Latin, so this guard now fires only when none can —
    // the one case where the conformance claim is genuinely unsatisfiable.
    const noLatinDoc: DocumentParams = { ...formDoc, fontEntries: undefined };

    it('stays silent when a registered Latin font can be embedded', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(formDoc, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.some(d => d.code === 'PDFA_UNEMBEDDED_FORM_FONT')).toBe(false);
    });

    it('flags AcroForm fields under a PDF/A claim with no embeddable font', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(noLatinDoc, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.some(d => d.code === 'PDFA_UNEMBEDDED_FORM_FONT')).toBe(true);
    });

    it('throws under strict', () => {
        expect(() => buildDocumentPDFBytes(noLatinDoc, { tagged: 'pdfa2b', strict: true }))
            .toThrow(/Helv/);
    });

    it('points at the fix rather than at flattening', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(noLatinDoc, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        const msg = seen.find(d => d.code === 'PDFA_UNEMBEDDED_FORM_FONT')?.message ?? '';
        expect(msg).toContain('Register a Latin font');
        expect(msg).not.toContain('flatten');
    });

    it('stays silent without a PDF/A claim or without form fields', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(formDoc, { onDiagnostic: d => seen.push(d) });
        buildDocumentPDFBytes({ ...formDoc, blocks: [{ type: 'paragraph', text: 'x' }] }, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen).toEqual([]);
    });
});

describe('PDFA_DEVICE_CMYK_IMAGE', () => {
    const cmykDoc: DocumentParams = {
        title: 'CMYK',
        blocks: [
            { type: 'paragraph', text: 'img' },
            { type: 'image', data: makeCmykJpeg(), alt: 'cmyk' },
        ],
        fontEntries: [latinEntry],
    };

    it('emits a diagnostic for a CMYK JPEG under a PDF/A claim', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(cmykDoc, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.some(d => d.code === 'PDFA_DEVICE_CMYK_IMAGE')).toBe(true);
    });

    it('throws under strict', () => {
        expect(() => buildDocumentPDFBytes(cmykDoc, { tagged: 'pdfa2b', strict: true }))
            .toThrow(/DeviceCMYK/);
    });

    it('stays silent without a PDF/A claim', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(cmykDoc, { onDiagnostic: d => seen.push(d) });
        expect(seen).toEqual([]);
    });
});

describe('base-14 ToUnicode under tagged mode (conformance hardening)', () => {
    it('tagged Latin documents carry /ToUnicode on the base-14 dicts', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bytes = buildDocumentPDFBytes(docParams, { tagged: 'pdfa2b' });
        warn.mockRestore();
        const pdf = Buffer.from(bytes).toString('latin1');
        expect(pdf).toMatch(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding \/ToUnicode \d+ 0 R/);
        expect(pdf).toContain('beginbfchar');
    });

    it('form /Helv dicts carry /ToUnicode', () => {
        const withForm: DocumentParams = {
            ...docParams,
            blocks: [
                { type: 'paragraph', text: 'form' },
                { type: 'formField', fieldType: 'text', name: 'f1', label: 'Field' },
            ],
        };
        const bytes = buildDocumentPDFBytes(withForm);
        const pdf = Buffer.from(bytes).toString('latin1');
        const helvDicts = pdf.match(/\/BaseFont \/Helvetica [^>]*>>/g) ?? [];
        expect(helvDicts.length).toBeGreaterThan(0);
        for (const dict of helvDicts) expect(dict).toContain('/ToUnicode');
    });

    it('tagged CIDFont-only documents remain free of the base-14 CMap object', () => {
        const bytes = buildDocumentPDFBytes({ ...docParams, fontEntries: [latinEntry] }, { tagged: 'pdfa2b' });
        const pdf = Buffer.from(bytes).toString('latin1');
        // The WinAnsi bfchar CMap (Euro at 0x80) is the base-14 one; the
        // CIDFont ToUnicode is gid-keyed. No base-14 dict exists here.
        expect(pdf).not.toContain('/BaseFont /Helvetica ');
    });
});

// 1.9.0 (#87) — a level-U claim over a font whose used glyphs the ToUnicode
// CMap cannot all name. Every bundled shaper now reports its glyphs, so the
// remaining trigger is a character the font does not cover (glyph 0).

describe('PDFA_GLYPH_WITHOUT_UNICODE (level U, #87)', () => {
    const taiTham: FontEntry = { fontData: notoTaiThamData as unknown as FontData, fontRef: '/F3', lang: 'nod' };
    const covered: DocumentParams = { title: 'U', blocks: [{ type: 'paragraph', text: 'ᨣᩤᩴᨾᩮᩬᩥᨦ' }], fontEntries: [taiTham] };
    const uncovered: DocumentParams = { ...covered, blocks: [{ type: 'paragraph', text: 'ᨠ☃' }] };

    it('stays silent when every used glyph is named (the #87 Tai Tham ligature included)', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(covered, { tagged: 'pdfa2u', onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).not.toContain('PDFA_GLYPH_WITHOUT_UNICODE');
    });

    it('warns through onDiagnostic for a .notdef under pdfa2u, and names the font and glyph', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(uncovered, { tagged: 'pdfa2u', onDiagnostic: d => seen.push(d) });
        const d = seen.find(x => x.code === 'PDFA_GLYPH_WITHOUT_UNICODE');
        expect(d).toBeDefined();
        expect(d?.message).toContain('NotoSansTaiTham');
        expect(d?.message).toContain('glyph ids 0');
        expect(d?.message).toContain('6.2.11.7.2');
    });

    it('throws under strict', () => {
        expect(() => buildDocumentPDFBytes(uncovered, { tagged: 'pdfa2u', strict: true }))
            .toThrow(/ToUnicode CMap cannot name/);
    });

    // 1.9.0 — the two parts of a split vowel sign each name their own code
    // point of the canonical decomposition (ୋ → U+0B47 U+0B3E), so the
    // substituted length mark of ୈ (gid 75 in Noto Sans Oriya) is no longer a
    // glyph without a Unicode value, and the extracted text is the NFD form.
    it('stays silent for Odia split vowel signs (each part of ୈ ୋ ୌ carries its NFD code point)', () => {
        const odia: FontEntry = { fontData: notoOriyaData as unknown as FontData, fontRef: '/F3', lang: 'or' };
        // demo-language: or (split vowel signs — ବୈଠକ, କୈ, ଗୋଟିଏ)
        const text = 'ବୈଠକ କୈ ଗୋଟିଏ';
        const params: DocumentParams = { title: 'U', blocks: [{ type: 'paragraph', text }], fontEntries: [odia] };
        const seen: PdfDiagnostic[] = [];
        const bytes = buildDocumentPDFBytes(params, { tagged: 'pdfa2u', onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).not.toContain('PDFA_GLYPH_WITHOUT_UNICODE');
        expect(() => buildDocumentPDFBytes(params, { tagged: 'pdfa2u', strict: true })).not.toThrow();
        const extracted = extractText(bytes)[0].text.normalize('NFC');
        for (const word of text.split(' ')) expect(extracted).toContain(word);
    });

    it('does not fire under pdfa2b, which has no Unicode requirement', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(uncovered, { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).not.toContain('PDFA_GLYPH_WITHOUT_UNICODE');
    });

    it('is raised by the table builder too', () => {
        const seen: PdfDiagnostic[] = [];
        const params: PdfParams = {
            title: 'U', infoItems: [], balanceText: '', countText: '', footerText: '',
            headers: ['ᨠ☃'], rows: [{ cells: ['ᨠ'], type: '', pointed: false }], fontEntries: [taiTham],
        };
        buildPDFBytes(params, { tagged: 'pdfa2u', onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).toContain('PDFA_GLYPH_WITHOUT_UNICODE');
    });
});
