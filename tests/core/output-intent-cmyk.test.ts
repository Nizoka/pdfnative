import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import * as colorEmoji from '../../fonts/noto-color-emoji-data.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { resolveOutputIntent, defaultRgbResource } from '../../src/core/pdf-tags.js';
import { buildAppearanceStreamDict } from '../../src/core/pdf-form.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// CMYK and Gray OutputIntents (v1.8.0). The builders' conformance under a
// real CMYK profile was checked with veraPDF (PDF/A-1b and 2b: text, table,
// colour emoji, RGB image, form fields); these tests pin the mechanics.

/** Minimal fake ICC: a 128-byte header with class and data space set. */
function fakeIcc(space: string, deviceClass = 'prtr'): Uint8Array {
    const icc = new Uint8Array(200);
    icc[3] = 200; // size field (bytes 0-3, big-endian)
    for (let i = 0; i < 4; i++) icc[36 + i] = 'acsp'.charCodeAt(i);
    for (let i = 0; i < 4; i++) {
        icc[12 + i] = deviceClass.charCodeAt(i);
        icc[16 + i] = space.charCodeAt(i);
    }
    return icc;
}

const cmykIntent = { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' };
const latin: FontEntry = { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const pinned = { creationDate: new Date('2026-01-01T00:00:00Z'), onDiagnostic: () => {} };

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

describe('resolveOutputIntent', () => {
    it('defaults to the built-in sRGB profile', () => {
        const r = resolveOutputIntent();
        expect(r).toMatchObject({ space: 'rgb', components: 3, deviceClass: 'mntr' });
        expect(r.profile.length).toBeGreaterThan(128);
    });

    it('reads space, component count and class from the header', () => {
        expect(resolveOutputIntent({ iccProfile: fakeIcc('CMYK') })).toMatchObject({ space: 'cmyk', components: 4, deviceClass: 'prtr' });
        expect(resolveOutputIntent({ iccProfile: fakeIcc('GRAY', 'mntr') })).toMatchObject({ space: 'gray', components: 1, deviceClass: 'mntr' });
        expect(resolveOutputIntent({ iccProfile: fakeIcc('RGB ') })).toMatchObject({ space: 'rgb', components: 3 });
    });

    it('rejects a truncated profile and an unsupported space', () => {
        expect(() => resolveOutputIntent({ iccProfile: new Uint8Array(40) })).toThrow(/too short/);
        expect(() => resolveOutputIntent({ iccProfile: fakeIcc('XYZ ') })).toThrow(/RGB, CMYK or Gray/);
    });

    it('A-004: rejects a buffer without the acsp signature, and a size field beyond the buffer', () => {
        // A 200-byte buffer that merely spells CMYK at byte 16 was accepted until 1.8.0.
        const noSignature = fakeIcc('CMYK');
        noSignature.fill(0, 36, 40);
        expect(() => resolveOutputIntent({ iccProfile: noSignature })).toThrow(/acsp/);

        const truncated = fakeIcc('CMYK');
        truncated[0] = 0; truncated[1] = 0; truncated[2] = 0x10; truncated[3] = 0; // declares 4096 bytes
        expect(() => resolveOutputIntent({ iccProfile: truncated })).toThrow(/declares 4096 bytes but 200 were supplied/);

        const tooSmall = fakeIcc('CMYK');
        tooSmall[3] = 64; // declares 64 bytes, under the 128-byte header
        expect(() => resolveOutputIntent({ iccProfile: tooSmall })).toThrow(/truncated or corrupt/);
    });

    it('A-004: accepts a profile whose size field is smaller than the buffer (trailing padding)', () => {
        const padded = fakeIcc('CMYK');
        padded[3] = 160;
        expect(resolveOutputIntent({ iccProfile: padded })).toMatchObject({ space: 'cmyk', components: 4 });
    });
});

describe('defaultRgbResource', () => {
    it('adds nothing without an intent or under an RGB one', () => {
        expect(defaultRgbResource(null)).toBe('');
        expect(defaultRgbResource(resolveOutputIntent())).toBe('');
    });

    it('declares a calibrated DefaultRGB under CMYK and Gray intents', () => {
        for (const space of ['CMYK', 'GRAY']) {
            const res = defaultRgbResource(resolveOutputIntent({ iccProfile: fakeIcc(space) }));
            expect(res).toMatch(/^ \/ColorSpace << \/DefaultRGB \[\/CalRGB << \/WhitePoint \[0\.9505 1 1\.089\]/);
        }
    });
});

describe('RGB content under a CMYK OutputIntent', () => {
    const doc: DocumentParams = {
        title: 'CMYK intent',
        blocks: [
            { type: 'paragraph', text: 'Black RGB text' },
            { type: 'formField', fieldType: 'text', name: 'n', label: 'Name' },
        ],
        fontEntries: [latin],
    };

    it('puts DefaultRGB in every page and appearance stream resource dictionary', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, { ...pinned, tagged: 'pdfa2b', outputIntent: cmykIntent }));
        const pages = pdf.match(/\/Type \/Page \/Parent[^\n]*/g) ?? [];
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) expect(page).toContain('/DefaultRGB [/CalRGB');
        const forms = pdf.match(/\/Subtype \/Form[^\n]*/g) ?? [];
        expect(forms.length).toBeGreaterThan(0);
        for (const form of forms) expect(form).toContain('/DefaultRGB [/CalRGB');
        expect(pdf).toContain('/N 4 /Length 200');
    });

    it('puts DefaultRGB in colour-emoji form resources too', () => {
        const emoji: FontEntry = { fontData: colorEmoji as unknown as FontData, fontRef: '/F4', lang: 'emoji' };
        const pdf = latin1(buildDocumentPDFBytes(
            { title: 'Emoji', blocks: [{ type: 'paragraph', text: 'Hi \u{1F600}' }], fontEntries: [latin, emoji] },
            { ...pinned, tagged: 'pdfa2b', outputIntent: cmykIntent },
        ));
        const emojiForms = pdf.match(/\/Subtype \/Form \/BBox[^\n]*/g) ?? [];
        expect(emojiForms.length).toBeGreaterThan(0);
        for (const form of emojiForms) expect(form).toContain('/DefaultRGB');
    });

    it('does the same in the table builder', () => {
        const params: PdfParams = {
            title: 'Statement', infoItems: [], balanceText: '', countText: '',
            headers: ['A', 'B'], rows: [{ cells: ['1', '2'], type: 'credit', pointed: false }],
            footerText: 'f', fontEntries: [latin],
        };
        const pdf = latin1(buildPDFBytes(params, { ...pinned, tagged: 'pdfa2b', outputIntent: cmykIntent }));
        const pages = pdf.match(/\/Type \/Page \/Parent[^\n]*/g) ?? [];
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) expect(page).toContain('/DefaultRGB');
    });

    it('adds nothing under the default sRGB intent', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, { ...pinned, tagged: 'pdfa2b' }));
        expect(pdf).not.toContain('/DefaultRGB');
        expect(pdf).toContain('/N 3');
    });

    it('extends appearance stream resources only when asked', () => {
        expect(buildAppearanceStreamDict(10, 10, 5, 7)).toBe(
            '<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /Font << /Helv 7 0 R >> >> /Length 5');
        expect(buildAppearanceStreamDict(10, 10, 5, 7, ' /X 1')).toContain('/Font << /Helv 7 0 R >> /X 1 >>');
    });
});

describe('PDFA_DEVICE_CMYK_CONTENT', () => {
    const cmykDoc: DocumentParams = {
        title: 'CMYK colour',
        blocks: [{ type: 'paragraph', text: 'Cyan', color: [100, 0, 0, 0] }],
        fontEntries: [latin],
    };

    const codes = (layout: Record<string, unknown>): string[] => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(cmykDoc, { ...layout, onDiagnostic: d => seen.push(d) });
        return seen.map(d => d.code);
    };

    it('fires for CMYK colour under the default sRGB intent', () => {
        expect(codes({ tagged: 'pdfa2b' })).toContain('PDFA_DEVICE_CMYK_CONTENT');
    });

    it('fires under a Gray intent', () => {
        expect(codes({ tagged: 'pdfa2b', outputIntent: { iccProfile: fakeIcc('GRAY'), outputConditionIdentifier: 'g' } }))
            .toContain('PDFA_DEVICE_CMYK_CONTENT');
    });

    it('stays silent under a CMYK intent, and without a PDF/A claim', () => {
        expect(codes({ tagged: 'pdfa2b', outputIntent: cmykIntent })).not.toContain('PDFA_DEVICE_CMYK_CONTENT');
        expect(codes({})).not.toContain('PDFA_DEVICE_CMYK_CONTENT');
    });

    it('stays silent for RGB colour', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes({ ...cmykDoc, blocks: [{ type: 'paragraph', text: 'x', color: '#2563EB' }] },
            { tagged: 'pdfa2b', onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).not.toContain('PDFA_DEVICE_CMYK_CONTENT');
    });

    it('throws before writing under strict', () => {
        expect(() => buildDocumentPDFBytes(cmykDoc, { tagged: 'pdfa2b', strict: true })).toThrow(/CMYK colour/);
    });

    it('fires in the table builder for a CMYK theme colour', () => {
        const seen: PdfDiagnostic[] = [];
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '',
            headers: ['A'], rows: [{ cells: ['1'], type: 'credit', pointed: false }], footerText: 'f', fontEntries: [latin],
        };
        buildPDFBytes(params, {
            tagged: 'pdfa2b', onDiagnostic: d => seen.push(d),
            colors: {
                title: [0, 0, 0, 100], credit: '#0F9179', debit: '#C82D3E', text: '#374151', thBg: '#F0F2F4',
                thBrd: '#CFD6DB', rowBrd: '#E6EAED', ptdBg: '#F6F9FB', balBg: '#F8F8FE', balBrd: '#CFCFF6',
                label: '#66717F', footer: '#66717F',
            },
        });
        expect(seen.map(d => d.code)).toContain('PDFA_DEVICE_CMYK_CONTENT');
    });
});
