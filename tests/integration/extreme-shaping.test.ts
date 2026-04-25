/**
 * Integration tests for extreme-script shaping.
 *
 * Confirms that the document builder produces a valid PDF when fed the
 * same extreme inputs used by `scripts/generators/extreme-shaping.ts`:
 * deep BiDi mixing across 3+ scripts, complex Indic conjuncts with reph
 * + multi-halant chains, isolated Arabic harakat, and Thai mark stacking
 * on tall consonants.
 *
 * These tests guard against regressions in the shaping pipeline. They
 * use mock font data (no GSUB/GPOS lookups), so they validate the
 * pipeline integrity rather than visual correctness — the latter is
 * verified by visually reviewing the generated PDFs in `test-output/extreme/`.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

/** Minimal mock FontData covering arbitrary Unicode codepoints. */
function makeMockFontData(name: string): FontData {
    // Generic cmap that maps every codepoint to itself + 1 (avoid GID 0).
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 0xFFFF, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: name,
        cmap: new Proxy(cmap, {
            get(_target, prop) {
                if (typeof prop === 'string') {
                    const cp = Number(prop);
                    if (!Number.isNaN(cp) && cp > 0) return cp;
                }
                return 0;
            },
            has() { return true; },
        }),
        defaultWidth: 500,
        widths: new Proxy(widths, { get() { return 500; }, has() { return true; } }),
        pdfWidthArray: '',
        ttfBase64: 'AAAAAAAAAA==',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
}

function makeFontEntries(): FontEntry[] {
    return [
        { fontData: makeMockFontData('MockArabic'), fontRef: '/F3', lang: 'ar' },
        { fontData: makeMockFontData('MockHebrew'), fontRef: '/F4', lang: 'he' },
        { fontData: makeMockFontData('MockThai'), fontRef: '/F5', lang: 'th' },
        { fontData: makeMockFontData('MockTamil'), fontRef: '/F6', lang: 'ta' },
        { fontData: makeMockFontData('MockBengali'), fontRef: '/F7', lang: 'bn' },
        { fontData: makeMockFontData('MockHindi'), fontRef: '/F8', lang: 'hi' },
    ];
}

function expectValidPdfBytes(bytes: Uint8Array): void {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 8));
    expect(header.startsWith('%PDF-')).toBe(true);
    const tail = new TextDecoder('latin1').decode(bytes.slice(-32));
    expect(tail).toContain('%%EOF');
}

describe('Extreme shaping — integration', () => {
    const fontEntries = makeFontEntries();

    it('builds extreme BiDi mix (Arabic + Hebrew + Thai + Latin + digits)', () => {
        const params: DocumentParams = {
            title: 'Extreme BiDi',
            blocks: [
                { type: 'heading', text: 'Extreme BiDi — Arabic + Hebrew + Thai + Latin + Numerals', level: 1 },
                { type: 'paragraph', text: 'مثال BiDi قوي: السلام عليكم 654321 — שלום עולם — สวัสดี + Hello from Thailand 789.' },
                { type: 'list', items: [
                    'اختبار shaping عربي: الله أكبر',
                    'בדיקת עברית: ברכות',
                    'การทดสอบภาษาไทย: สวัสดีครับ',
                    'مثال مختلط: مرحبا — שלום — สวัสดี',
                ], style: 'bullet' },
            ],
            fontEntries,
        };
        expectValidPdfBytes(buildDocumentPDFBytes(params));
    });

    it('builds extreme Tamil with conjuncts, split vowels, BiDi mix', () => {
        const params: DocumentParams = {
            title: 'Extreme Tamil',
            blocks: [
                { type: 'heading', text: 'Tamil ultra-extreme', level: 1 },
                { type: 'paragraph', text: 'எழுத்துக்களின் stacking: க கா கி கீ கு கூ கெ கே கை கொ கோ கௌ க்ஷ க்ஷி க்ஷீ க்ஷு க்ஷூ.' },
                { type: 'paragraph', text: 'BiDi mix: வணக்கம் ௧௨௩௪௫ — 123456 — السلام عليكم — Hello from தமிழ்நாடு.' },
            ],
            fontEntries,
        };
        expectValidPdfBytes(buildDocumentPDFBytes(params));
    });

    it('builds extreme Bengali + Devanagari with reph + multi-halant chains', () => {
        const params: DocumentParams = {
            title: 'Extreme Bengali + Devanagari',
            blocks: [
                { type: 'heading', text: 'Bengali & Devanagari extreme', level: 1 },
                { type: 'paragraph', text: 'বাংলা: ক ক্ত ক্ক ক্ষ ক্ষ্ম ক্ষ্ণ ক্ল ক্ব ক্য ক্র লক্ষ্মী.' },
                { type: 'paragraph', text: 'देवनागरी: क क्त क्क क्ष क्ष्म क्ष्ण क्ल क्व क्म क्य क्र क्लु क्ष्मी.' },
                { type: 'paragraph', text: 'BiDi mix: বাংলা ১২৩৪৫ — हिंदी ६७८९० — السلام عليكم — Hello.' },
            ],
            fontEntries,
        };
        expectValidPdfBytes(buildDocumentPDFBytes(params));
    });

    it('builds extreme Arabic with isolated harakat + tatweel', () => {
        const params: DocumentParams = {
            title: 'Extreme Arabic harakat',
            blocks: [
                { type: 'heading', text: 'Arabic harakat — isolated and contextual', level: 1 },
                { type: 'paragraph', text: 'بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ' },
                { type: 'paragraph', text: 'علامات التشكيل المعزولة على التطويل: ـَ ـِ ـُ ـً ـٍ ـٌ ـّ ـْ.' },
                { type: 'list', items: [
                    'فتحة: ـَ',
                    'كسرة: ـِ',
                    'ضمة: ـُ',
                    'شدة: ـّ',
                    'سكون: ـْ',
                ], style: 'bullet' },
            ],
            fontEntries,
        };
        expectValidPdfBytes(buildDocumentPDFBytes(params));
    });

    it('handles overlong heading with em-dashes (regression: heading hard-break)', () => {
        const params: DocumentParams = {
            title: 'Long heading test',
            blocks: [
                { type: 'heading', text: 'Test Bengali + Devanagari ULTRA EXTREME — Shaping & Positioning — pdfnative', level: 1 },
                { type: 'paragraph', text: 'Body.' },
            ],
            fontEntries,
        };
        expectValidPdfBytes(buildDocumentPDFBytes(params));
    });
});
