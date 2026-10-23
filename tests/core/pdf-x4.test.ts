import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { inspectDocumentLayout } from '../../src/core/pdf-layout-inspect.js';
import {
    resolvePdfXConfig, resolveOutputIntent, pdfxDocumentId, buildPdfXXMPMetadata, PDF_X_CONFORMANCE_TARGETS,
} from '../../src/core/pdf-tags.js';
import { pdfxBoxes } from '../../src/core/pdf-print.js';
import { validatePdfX } from '../../src/parser/pdf-x-validator.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfLayoutOptions, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// PDF/X-4 (ISO 15930-7) claim, v1.8.0. veraPDF does not cover PDF/X; the
// structure these tests pin was checked by hand against the requirements
// (PDF 1.6, GTS_PDFXVersion, xmpMM identifiers, Trapped, GTS_PDFX intent,
// TrimBox) and is checked again by validatePdfX().

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

const cmykPress = { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'CGATS TR 001', registryName: 'http://www.color.org' };
const latin: FontEntry = { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const doc: DocumentParams = {
    title: 'Print ready',
    blocks: [{ type: 'heading', text: 'PDF/X-4', level: 1 }, { type: 'paragraph', text: 'Body text' }],
    fontEntries: [latin],
};
const x4: Partial<PdfLayoutOptions> = {
    pdfx: 'pdfx4', outputIntent: cmykPress, creationDate: new Date('2026-01-01T00:00:00Z'), onDiagnostic: () => {},
};

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

describe('resolvePdfXConfig', () => {
    const intent = resolveOutputIntent(cmykPress);
    const base = { pdfx: 'pdfx4', tagged: undefined, encrypted: false, outputIntent: intent, trapped: undefined } as const;

    it('is null when pdfx is not set', () => {
        expect(resolvePdfXConfig({ ...base, pdfx: undefined })).toBeNull();
    });

    it('resolves PDF 1.6 and defaults trapping to False', () => {
        expect(resolvePdfXConfig(base)).toEqual({ pdfVersion: '1.6', trapped: 'False' });
        expect(resolvePdfXConfig({ ...base, trapped: 'True' })?.trapped).toBe('True');
    });

    it('rejects every incoherent combination with its remedy', () => {
        expect(() => resolvePdfXConfig({ ...base, pdfx: 'pdfx1a' })).toThrow(/unknown target 'pdfx1a'/);
        expect(() => resolvePdfXConfig({ ...base, tagged: 'pdfa1b' })).toThrow(/cannot be combined with tagged: 'pdfa1b'/);
        expect(() => resolvePdfXConfig({ ...base, tagged: 'pdfa3b' })).toThrow(/cannot be combined with tagged: 'pdfa3b'/);
        // PDF/A-2 and PDF/X-4 share a file since 1.9.0.
        expect(resolvePdfXConfig({ ...base, tagged: true })).toEqual({ pdfVersion: '1.6', trapped: 'False' });
        expect(resolvePdfXConfig({ ...base, tagged: 'pdfa2u' })).toEqual({ pdfVersion: '1.6', trapped: 'False' });
        expect(() => resolvePdfXConfig({ ...base, encrypted: true })).toThrow(/forbids encryption/);
        expect(() => resolvePdfXConfig({ ...base, outputIntent: null })).toThrow(/requires layout.outputIntent/);
        expect(() => resolvePdfXConfig({ ...base, outputIntent: resolveOutputIntent({ iccProfile: fakeIcc('RGB ', 'mntr') }) }))
            .toThrow(/output \(printer\) profile.*'mntr'/);
        expect(() => resolvePdfXConfig({ ...base, trapped: 'Unknown' })).toThrow(/trapping state to be known/);
    });

    it('lists the accepted targets', () => {
        expect(PDF_X_CONFORMANCE_TARGETS).toEqual(['pdfx4']);
    });
});

describe('pdfxDocumentId', () => {
    it('is a stable uuid derived from its seed', () => {
        const id = pdfxDocumentId('Title|D:20260101');
        expect(id).toMatch(/^uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(pdfxDocumentId('Title|D:20260101')).toBe(id);
        expect(pdfxDocumentId('Other|D:20260101')).not.toBe(id);
    });
});

describe('buildPdfXXMPMetadata', () => {
    const xmp = buildPdfXXMPMetadata('A & B', '2026-01-01T00:00:00+00:00', 'False', 'uuid:x', 'Ann', 'Sub', 'k1, k2');

    it('declares PDF/X-4 and identifies the document', () => {
        expect(xmp).toContain('xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"');
        expect(xmp).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
        expect(xmp).toContain('<xmpMM:DocumentID>uuid:x</xmpMM:DocumentID>');
        expect(xmp).toContain('<xmpMM:VersionID>1</xmpMM:VersionID>');
        expect(xmp).toContain('<xmpMM:RenditionClass>default</xmpMM:RenditionClass>');
        expect(xmp).toContain('<pdf:Trapped>False</pdf:Trapped>');
        for (const d of ['CreateDate', 'ModifyDate', 'MetadataDate']) expect(xmp).toContain(`<xmp:${d}>2026-01-01T00:00:00+00:00</xmp:${d}>`);
    });

    it('escapes text and carries no PDF/A identification', () => {
        expect(xmp).toContain('A &amp; B');
        expect(xmp).toContain('<dc:creator><rdf:Seq><rdf:li>Ann</rdf:li>');
        expect(xmp).not.toContain('pdfaid');
        expect(xmp).not.toContain('pdfaExtension');
    });
});

describe('pdfxBoxes', () => {
    it('declares the MediaBox as TrimBox when print sets no finished size', () => {
        expect(pdfxBoxes(undefined, 595.28, 841.89)).toBe(' /TrimBox [0.00 0.00 595.28 841.89]');
        expect(pdfxBoxes({ userUnit: 2 }, 100, 200)).toBe(' /TrimBox [0.00 0.00 100.00 200.00]');
    });

    it('adds nothing when a TrimBox or an ArtBox is already set', () => {
        expect(pdfxBoxes({ bleed: 9 }, 612, 792)).toBe('');
        expect(pdfxBoxes({ trimBox: [10, 10, 600, 780] }, 612, 792)).toBe('');
        expect(pdfxBoxes({ artBox: [10, 10, 600, 780] }, 612, 792)).toBe('');
    });

    it('rejects a TrimBox and an ArtBox together', () => {
        expect(() => pdfxBoxes({ bleed: 9, artBox: [20, 20, 500, 700] }, 612, 792)).toThrow(/not both/);
    });
});

describe('document builder under pdfx', () => {
    it('writes a PDF/X-4 file and no PDF/A claim', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, x4));
        expect(pdf.startsWith('%PDF-1.6\n')).toBe(true);
        expect(pdf).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
        expect(pdf).toContain('/S /GTS_PDFX');
        expect(pdf).toContain('/OutputConditionIdentifier (CGATS TR 001)');
        expect(pdf).toContain('/N 4 /Length 200');
        expect(pdf).toContain('/Trapped /False');
        expect(pdf).toMatch(/\/Type \/Catalog \/Pages 2 0 R \/Metadata \d+ 0 R \/OutputIntents \[\d+ 0 R\]/);
        expect(pdf).not.toContain('pdfaid');
        expect(pdf).not.toContain('/StructTreeRoot');
        expect(pdf).not.toContain('/MarkInfo');
    });

    it('puts a TrimBox and the calibrated DefaultRGB on every page', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, x4));
        const pages = pdf.match(/\/Type \/Page \/Parent[^\n]*/g) ?? [];
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) {
            expect(page).toContain('/TrimBox [0.00 0.00 ');
            expect(page).toContain('/DefaultRGB [/CalRGB');
        }
    });

    it('embeds every font: no base-14 Helvetica dictionary', () => {
        expect(latin1(buildDocumentPDFBytes(doc, x4))).not.toContain('/BaseFont /Helvetica');
    });

    it('keeps the stated trapping state', () => {
        const pdf = latin1(buildDocumentPDFBytes({ ...doc, metadata: { trapped: 'True' } }, x4));
        expect(pdf).toContain('/Trapped /True');
        expect(pdf).toContain('<pdf:Trapped>True</pdf:Trapped>');
    });

    it('respects a TrimBox derived from bleed', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, { ...x4, print: { bleed: 9 } }));
        expect(pdf).toContain('/BleedBox [0.00 0.00 ');
        expect(pdf).toContain('/TrimBox [9.00 9.00 ');
        expect(pdf.match(/\/TrimBox/g)?.length).toBe(pdf.match(/\/Type \/Page \/Parent/g)?.length);
    });

    it('is byte-stable for identical input', () => {
        expect(buildDocumentPDFBytes(doc, x4)).toEqual(buildDocumentPDFBytes(doc, x4));
    });

    it('throws before writing on an incoherent request', () => {
        expect(() => buildDocumentPDFBytes(doc, { ...x4, tagged: 'pdfa1b' })).toThrow(/cannot be combined with tagged: 'pdfa1b'/);
        expect(() => buildDocumentPDFBytes(doc, { ...x4, outputIntent: undefined })).toThrow(/requires layout.outputIntent/);
        expect(() => buildDocumentPDFBytes(doc, { ...x4, encryption: { userPassword: 'u', ownerPassword: 'o' } })).toThrow(/forbids encryption/);
        expect(() => buildDocumentPDFBytes({ ...doc, metadata: { trapped: 'Unknown' } }, x4)).toThrow(/trapping/);
    });

    it('leaves documents without pdfx untouched', () => {
        const pdf = latin1(buildDocumentPDFBytes(doc, { creationDate: new Date('2026-01-01T00:00:00Z') }));
        expect(pdf).not.toContain('GTS_PDFX');
        expect(pdf).not.toContain('/TrimBox');
    });
});

describe('table builder under pdfx', () => {
    it('writes the same PDF/X-4 structure', () => {
        const params: PdfParams = {
            title: 'Statement', infoItems: [], balanceText: '', countText: '',
            headers: ['A', 'B'], rows: [{ cells: ['1', '2'], type: 'credit', pointed: false }],
            footerText: 'f', fontEntries: [latin],
        };
        const pdf = latin1(buildPDFBytes(params, x4));
        expect(pdf.startsWith('%PDF-1.6\n')).toBe(true);
        expect(pdf).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
        expect(pdf).toContain('/S /GTS_PDFX');
        expect(pdf).toContain('/Trapped /False');
        expect(pdf).toContain('/TrimBox');
        expect(pdf).not.toContain('pdfaid');
        expect(pdf).not.toContain('/StructTreeRoot');
    });
});

describe('PDF/X diagnostics', () => {
    const codes = (params: DocumentParams, layout: Partial<PdfLayoutOptions>): string[] => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(params, { ...layout, onDiagnostic: d => seen.push(d) });
        return seen.map(d => d.code);
    };

    it('PDFX_NO_FONT_ENTRIES without an embedded font', () => {
        expect(codes({ ...doc, fontEntries: [] }, x4)).toContain('PDFX_NO_FONT_ENTRIES');
        expect(codes(doc, x4)).not.toContain('PDFX_NO_FONT_ENTRIES');
    });

    it('PDFX_DEVICE_CMYK for CMYK colour under an RGB press profile, not under CMYK', () => {
        const cmykDoc: DocumentParams = { ...doc, blocks: [{ type: 'paragraph', text: 'Cyan', color: [100, 0, 0, 0] }] };
        const rgbPress = { iccProfile: fakeIcc('RGB '), outputConditionIdentifier: 'RGB press' };
        const underRgb = codes(cmykDoc, { ...x4, outputIntent: rgbPress });
        expect(underRgb).toContain('PDFX_DEVICE_CMYK');
        expect(underRgb).not.toContain('PDFA_DEVICE_CMYK_CONTENT');
        expect(codes(cmykDoc, x4)).not.toContain('PDFX_DEVICE_CMYK');
    });

    it('PDFX_ANNOTATIONS for form fields and links', () => {
        expect(codes({ ...doc, blocks: [{ type: 'formField', fieldType: 'text', name: 'n', label: 'Name' }] }, x4))
            .toContain('PDFX_ANNOTATIONS');
        expect(codes({ ...doc, blocks: [{ type: 'link', text: 'site', url: 'https://example.com' }] }, x4))
            .toContain('PDFX_ANNOTATIONS');
        expect(codes(doc, x4)).not.toContain('PDFX_ANNOTATIONS');
    });

    it('throws the first one under strict', () => {
        expect(() => buildDocumentPDFBytes({ ...doc, fontEntries: [] }, { ...x4, strict: true })).toThrow(/PDF\/X-4/);
    });
});

describe('pdfxBoxes and the BleedBox', () => {
    const bleed: [number, number, number, number] = [10, 10, 585, 832];

    it('declares the MediaBox as the TrimBox when nothing else is set', () => {
        expect(pdfxBoxes(undefined, 595.28, 841.89)).toBe(' /TrimBox [0.00 0.00 595.28 841.89]');
    });

    it('declares the BleedBox as the TrimBox when only a BleedBox is set', () => {
        // A TrimBox equal to the MediaBox would extend past the BleedBox,
        // which ISO 15930-7 forbids and validatePdfX() rejects.
        expect(pdfxBoxes({ bleedBox: bleed }, 595.28, 841.89)).toBe(' /TrimBox [10.00 10.00 585.00 832.00]');
    });

    it('adds nothing when the caller set a TrimBox or ArtBox', () => {
        expect(pdfxBoxes({ bleed: 8.5 }, 595.28, 841.89)).toBe('');
        expect(pdfxBoxes({ artBox: bleed }, 595.28, 841.89)).toBe('');
    });

    it('builds a file its own validator accepts for every box configuration', () => {
        const configs: (Partial<PdfLayoutOptions>['print'] | undefined)[] = [
            undefined,
            { bleedBox: bleed },
            { bleed: 8.5 },
            { trimBox: [20, 20, 575, 822] },
            { trimBox: [20, 20, 575, 822], bleedBox: bleed },
            { artBox: [30, 30, 565, 812] },
        ];
        for (const print of configs) {
            const bytes = buildDocumentPDFBytes(doc, { ...x4, print });
            const report = validatePdfX(bytes);
            expect(report.errors, JSON.stringify(print)).toEqual([]);
            expect(report.valid).toBe(true);
        }
    });
});

describe('inspectDocumentLayout under pdfx', () => {
    it('measures text as the build does', () => {
        const mixed: DocumentParams = {
            title: 'Mixed',
            blocks: [{ type: 'paragraph', text: 'Latin text with a symbol → and more words to wrap across lines. '.repeat(20) }],
            fontEntries: [latin],
        };
        const asX = inspectDocumentLayout(mixed, x4);
        const asA = inspectDocumentLayout(mixed, { tagged: 'pdfa2b' });
        expect(asX.pages.map(p => p.blocks.map(b => b.height))).toEqual(asA.pages.map(p => p.blocks.map(b => b.height)));
    });
});

describe('dual claim: PDF/A-2 and PDF/X-4 in one file (1.9.0)', () => {
    const dual: Partial<PdfLayoutOptions> = { ...x4, tagged: 'pdfa2b' };
    const latin1 = (b: Uint8Array): string => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

    it('writes both identifications in one XMP packet, with the PDF/X ID schema declared for PDF/A', () => {
        const s = latin1(buildDocumentPDFBytes(doc, dual));
        expect(s.startsWith('%PDF-1.6')).toBe(true);
        expect(s).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(s).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
        expect(s).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
        expect(s).toMatch(/<xmpMM:DocumentID>uuid:[0-9a-f-]{36}<\/xmpMM:DocumentID>/);
        expect(s).toContain('<xmpMM:RenditionClass>default</xmpMM:RenditionClass>');
        expect(s).toContain('<pdf:Trapped>False</pdf:Trapped>');
        expect(s).toContain('<pdfaSchema:namespaceURI>http://www.npes.org/pdfx/ns/id/</pdfaSchema:namespaceURI>');
        expect(s).toContain('<pdfaProperty:name>GTS_PDFXVersion</pdfaProperty:name>');
        expect(s).toContain('<pdfaProperty:name>Trapped</pdfaProperty:name>');
        expect(s).toContain('/Trapped /False');
    });

    it('writes one OutputIntent per claim, both on the same profile stream', () => {
        const s = latin1(buildDocumentPDFBytes(doc, dual));
        const intents = /\/OutputIntents \[(\d+) 0 R (\d+) 0 R\]/.exec(s);
        expect(intents).not.toBeNull();
        const dictOf = (n: string): string => new RegExp(`\\n${n} 0 obj\\n([^\\n]*)`).exec(s)?.[1] ?? '';
        const a = dictOf(intents![1]);
        const x = dictOf(intents![2]);
        expect(a).toContain('/S /GTS_PDFA1');
        expect(x).toContain('/S /GTS_PDFX');
        const profile = (d: string): string => /\/DestOutputProfile (\d+) 0 R/.exec(d)?.[1] ?? '';
        expect(profile(a)).toBe(profile(x));
        expect((s.match(/\/Type \/OutputIntent/g) ?? []).length).toBe(2);
    });

    it('passes validatePdfX, which notes the PDF/A claim as a warning', () => {
        const result = validatePdfX(buildDocumentPDFBytes(doc, dual));
        expect(result.errors).toEqual([]);
        expect(result.warnings.join('\n')).toMatch(/also claims PDF\/A/);
    });

    it('accepts pdfa2u and the table builder alike', () => {
        const s = latin1(buildDocumentPDFBytes(doc, { ...x4, tagged: 'pdfa2u' }));
        expect(s).toContain('<pdfaid:conformance>U</pdfaid:conformance>');
        expect(s).toContain('<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>');
        const tableParams: PdfParams = { title: 'T', infoItems: [], balanceText: '', countText: '1 row', footerText: 'f', headers: ['A'], rows: [{ cells: ['x'], type: 'credit', pointed: false }], fontEntries: [latin] };
        const t = latin1(buildPDFBytes(tableParams, dual));
        expect(t).toContain('<pdfaid:part>2</pdfaid:part>');
        expect((t.match(/\/Type \/OutputIntent/g) ?? []).length).toBe(2);
    });

    it('refuses PDF/A-1b and PDF/A-3b next to PDF/X-4 with the reason', () => {
        expect(() => buildDocumentPDFBytes(doc, { ...x4, tagged: 'pdfa1b' })).toThrow(/PDF\/A-1 is PDF 1\.4/);
        expect(() => buildDocumentPDFBytes(doc, { ...x4, tagged: 'pdfa3b' })).toThrow(/embedded files/);
    });

    it('leaves a PDF/A-only and a PDF/X-only file as they were: one intent, one identification', () => {
        const a = latin1(buildDocumentPDFBytes(doc, { tagged: 'pdfa2b', creationDate: x4.creationDate, onDiagnostic: () => {} }));
        expect((a.match(/\/Type \/OutputIntent/g) ?? []).length).toBe(1);
        expect(a).not.toContain('pdfxid');
        const x = latin1(buildDocumentPDFBytes(doc, x4));
        expect((x.match(/\/Type \/OutputIntent/g) ?? []).length).toBe(1);
        expect(x).not.toContain('pdfaid');
    });
});
