/**
 * `TEXT_GLYPH_NOT_COVERED` (v1.9.0): a character no registered font covers
 * — drawn as the `.notdef` box of the CID font it was routed to, or written
 * as `?` by the base-14 WinAnsi path — is reported through the diagnostics
 * sink, once per font, naming the code points. The bytes never change.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import * as notoSansData from '../../fonts/noto-sans-data.js';
import * as notoTamilData from '../../fonts/noto-tamil-data.js';
import * as notoDevanagariData from '../../fonts/noto-devanagari-data.js';
import * as notoArabicData from '../../fonts/noto-arabic-data.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { isStream, dictGet } from '../../src/parser/pdf-object-parser.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const latin: FontEntry = { fontData: notoSansData as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const tamil: FontEntry = { fontData: notoTamilData as unknown as FontData, fontRef: '/F3', lang: 'ta' };
const devanagari: FontEntry = { fontData: notoDevanagariData as unknown as FontData, fontRef: '/F3', lang: 'hi' };
const arabic: FontEntry = { fontData: notoArabicData as unknown as FontData, fontRef: '/F3', lang: 'ar' };
const PINNED = new Date('2026-01-01T00:00:00Z');

function doc(text: string, fontEntries?: FontEntry[]): DocumentParams {
    return { title: 'Coverage', blocks: [{ type: 'paragraph', text }], ...(fontEntries ? { fontEntries } : {}) };
}

function diagnosticsOf(params: DocumentParams): PdfDiagnostic[] {
    const seen: PdfDiagnostic[] = [];
    buildDocumentPDFBytes(params, { creationDate: PINNED, onDiagnostic: d => seen.push(d) });
    return seen.filter(d => d.code === 'TEXT_GLYPH_NOT_COVERED');
}

function content(pdf: Uint8Array): string {
    const reader = openPdf(pdf);
    const c = reader.resolveValue(dictGet(reader.getPage(0), 'Contents')!);
    if (!isStream(c)) throw new Error('no content stream');
    return new TextDecoder('latin1').decode(reader.decodeStream(c));
}

describe('TEXT_GLYPH_NOT_COVERED', () => {
    it('names a code point a CID font has no glyph for, with the font, once', () => {
        // demo-language: ta (the arrow is what the Tamil font lacks)
        const seen = diagnosticsOf(doc('கொ → கெ + கா, கோ → கே + கா', [tamil]));
        expect(seen).toHaveLength(1);
        expect(seen[0].severity).toBe('warning');
        expect(seen[0].message).toContain('U+2192 "→"');
        expect(seen[0].message).toContain('/F3 NotoSansTamil');
        expect(seen[0].message).toContain('.notdef');
        expect(seen[0].message).toContain("registerFont('math'");
    });

    it('names a character a shaped run drew as glyph 0 (the Indic engine reports it)', () => {
        // demo-language: hi (the snowman has no Devanagari glyph)
        const seen = diagnosticsOf(doc('हिन्दी ☃', [devanagari]));
        expect(seen).toHaveLength(1);
        expect(seen[0].message).toContain('U+2603 "☃"');
        expect(seen[0].message).not.toContain('U+0939');
    });

    it('names a character the Arabic shaper drew as glyph 0', () => {
        // demo-language: ar (the snowman inside an Arabic run)
        const seen = diagnosticsOf(doc('مرحبا ☃ بالعالم', [arabic]));
        expect(seen).toHaveLength(1);
        expect(seen[0].message).toContain('U+2603');
    });

    it('names a character outside WinAnsi on the base-14 path, written as "?"', () => {
        const seen = diagnosticsOf(doc('Original: 10 bytes → Rev 2: 12 bytes'));
        expect(seen).toHaveLength(1);
        expect(seen[0].message).toContain('U+2192 "→"');
        expect(seen[0].message).toContain('WinAnsiEncoding');
        expect(seen[0].message).toContain('Helvetica');
    });

    it('stays silent for covered text: Latin on the base-14 path, Latin and Tamil on their fonts, joiners and a soft hyphen', () => {
        expect(diagnosticsOf(doc('Hello – “world” € ‰'))).toEqual([]);
        expect(diagnosticsOf(doc('Hello lean world', [latin]))).toEqual([]);
        // demo-language: ta (a covered sentence; the joiner and soft hyphen are default-ignorable)
        expect(diagnosticsOf(doc('தமிழ் மொழி‍­யில்', [tamil]))).toEqual([]);
    });

    it('lists every missing code point in order, at most eight, and counts the rest', () => {
        const seen = diagnosticsOf(doc('→ ← ↑ ↓ ∀ ∃ ∑ ∏ ∫ ≈'));
        expect(seen).toHaveLength(1);
        expect(seen[0].message).toContain('U+2190 "←", U+2191 "↑", U+2192 "→"');
        expect(seen[0].message).toContain('(10 in all)');
        expect(seen[0].message).not.toContain('U+2248');
    });

    it('throws under strict', () => {
        expect(() => buildDocumentPDFBytes(doc('a → b', [tamil]), { strict: true }))
            .toThrow(/no glyph in \/F3 NotoSansTamil/);
        expect(() => buildDocumentPDFBytes(doc('a → b'), { strict: true }))
            .toThrow(/outside WinAnsiEncoding/);
    });

    it('leaves the bytes unchanged: the .notdef glyph and the "?" are still written', () => {
        const params = doc('a → b', [tamil]);
        // The default sink (console.warn, silenced here) against a custom one.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const silent = buildDocumentPDFBytes(params, { creationDate: PINNED });
        warn.mockRestore();
        const reported = buildDocumentPDFBytes(params, { creationDate: PINNED, onDiagnostic: () => undefined });
        expect(Buffer.from(reported).equals(Buffer.from(silent))).toBe(true);
        expect(content(reported)).toContain('0000');
        expect(content(buildDocumentPDFBytes(doc('a → b'), { creationDate: PINNED, onDiagnostic: () => undefined }))).toContain('(a ? b)');
    });

    it('never prints a control character and never reports a default-ignorable one', () => {
        // demo-language: hi (an ESC inside Devanagari text, a C1 control on the base-14 path)
        // A C0 control is a layout separator, never a glyph: nothing to report.
        expect(diagnosticsOf(doc('नमस्ते\u001B[31mलाल', [devanagari]))).toEqual([]);
        // A C1 control is reported by its code point only — never as a raw byte in the message.
        const c1 = diagnosticsOf(doc('x\u0085y'));
        expect(c1).toHaveLength(1);
        expect(c1[0].message).toContain('U+0085');
        expect(c1[0].message).not.toContain('\u0085');
        // VS16 and the word joiner are default-ignorable: silent even when the font lacks them.
        expect(diagnosticsOf(doc('नमस्ते️', [devanagari]))).toEqual([]);
        expect(diagnosticsOf(doc('नम⁠स्ते', [devanagari]))).toEqual([]);
        expect(diagnosticsOf(doc('தமிழ்️', [tamil]))).toEqual([]);
    });

    it('is raised by the table builder too, for cells and headers', () => {
        const seen: PdfDiagnostic[] = [];
        const params: PdfParams = {
            title: 'T', infoItems: [{ label: 'Flow', value: 'FlateDecode → AES' }], balanceText: '', countText: '', footerText: '',
            headers: ['A'], rows: [{ cells: ['x'], type: '', pointed: false }],
        };
        buildPDFBytes(params, { creationDate: PINNED, onDiagnostic: d => seen.push(d) });
        expect(seen.filter(d => d.code === 'TEXT_GLYPH_NOT_COVERED')).toHaveLength(1);
        const unicode: PdfParams = { ...params, infoItems: [], headers: ['→'], fontEntries: [tamil] };
        const seenCid: PdfDiagnostic[] = [];
        buildPDFBytes(unicode, { creationDate: PINNED, onDiagnostic: d => seenCid.push(d) });
        expect(seenCid.filter(d => d.code === 'TEXT_GLYPH_NOT_COVERED').map(d => d.message.includes('U+2192'))).toEqual([true]);
    });
});
