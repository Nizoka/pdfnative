import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { validatePdfX } from '../../src/parser/pdf-x-validator.js';
import type { FontData, FontEntry, PdfLayoutOptions } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

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

const latin: FontEntry = { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const doc: DocumentParams = {
    title: 'Print ready',
    blocks: [{ type: 'heading', text: 'PDF/X-4', level: 1 }, { type: 'paragraph', text: 'Body text in RGB' }],
    fontEntries: [latin],
};
const x4: Partial<PdfLayoutOptions> = {
    pdfx: 'pdfx4',
    outputIntent: { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' },
    creationDate: new Date('2026-01-01T00:00:00Z'),
    onDiagnostic: () => {},
};

/** Replace bytes in a PDF, keeping the length so the xref stays valid. */
function patch(bytes: Uint8Array, from: string, to: string): Uint8Array {
    expect(to.length).toBe(from.length);
    const text = Buffer.from(bytes).toString('latin1');
    const at = text.indexOf(from);
    expect(at).toBeGreaterThanOrEqual(0);
    return new Uint8Array(Buffer.from(text.slice(0, at) + to + text.slice(at + from.length), 'latin1'));
}

describe('validatePdfX', () => {
    it('accepts what the builder writes under pdfx', () => {
        const result = validatePdfX(buildDocumentPDFBytes(doc, x4));
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('accepts a bleed layout and a stated trapping', () => {
        const bytes = buildDocumentPDFBytes({ ...doc, metadata: { trapped: 'True' } }, { ...x4, print: { bleed: 9 } });
        expect(validatePdfX(bytes).errors).toEqual([]);
    });

    it('rejects a document that makes no PDF/X claim', () => {
        const { valid, errors } = validatePdfX(buildDocumentPDFBytes(doc, { creationDate: new Date('2026-01-01T00:00:00Z') }));
        expect(valid).toBe(false);
        expect(errors.join('\n')).toMatch(/no readable \/Metadata XMP/);
        expect(errors.join('\n')).toMatch(/no \/OutputIntents entry with \/S \/GTS_PDFX/);
        expect(errors.join('\n')).toMatch(/Page 1: no TrimBox or ArtBox/);
        expect(errors.join('\n')).toMatch(/font \/F1 \(Helvetica\) is not embedded/);
    });

    it('rejects a PDF/A file: its intent is GTS_PDFA1 and its header 1.7', () => {
        const { errors } = validatePdfX(buildDocumentPDFBytes(doc, { tagged: 'pdfa2b', onDiagnostic: () => {} }));
        const all = errors.join('\n');
        expect(all).toMatch(/PDF 1\.7; PDF\/X-4 is based on PDF 1\.6/);
        expect(all).toMatch(/no pdfxid:GTS_PDFXVersion/);
        expect(all).toMatch(/GTS_PDFX/);
    });

    it('rejects annotations inside the print area', () => {
        const bytes = buildDocumentPDFBytes({ ...doc, blocks: [...doc.blocks, { type: 'link', text: 'site', url: 'https://example.com' }] }, x4);
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/\/Link annotation inside the page area/);
    });

    it('rejects unembedded fonts', () => {
        const bytes = buildDocumentPDFBytes({ ...doc, fontEntries: [] }, x4);
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/is not embedded/);
    });

    it('rejects CMYK colour under an RGB press profile', () => {
        const bytes = buildDocumentPDFBytes(
            { ...doc, blocks: [{ type: 'paragraph', text: 'Cyan', color: [100, 0, 0, 0] }] },
            { ...x4, outputIntent: { iccProfile: fakeIcc('RGB '), outputConditionIdentifier: 'RGB press' } },
        );
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/DeviceCMYK colour under a RGB OutputIntent without \/DefaultCMYK/);
    });

    it('rejects RGB colour under a CMYK intent once DefaultRGB is gone', () => {
        const bytes = patch(buildDocumentPDFBytes(doc, x4), '/DefaultRGB', '/DefaultXYZ');
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/DeviceRGB colour under a CMYK OutputIntent without \/DefaultRGB/);
    });

    it('rejects an unknown trapping state and a missing document identifier', () => {
        let bytes = buildDocumentPDFBytes(doc, x4);
        bytes = patch(bytes, '<pdf:Trapped>False</pdf:Trapped>', '<pdf:Trapped>Maybe</pdf:Trapped>');
        bytes = patch(bytes, '<xmpMM:VersionID>1</xmpMM:VersionID>', '<xmpMM:VersionXX>1</xmpMM:VersionXX>');
        const all = validatePdfX(bytes).errors.join('\n');
        expect(all).toMatch(/pdf:Trapped must be True or False, found "Maybe"/);
        expect(all).toMatch(/no xmpMM:VersionID/);
    });

    it('rejects a monitor profile as the press condition', () => {
        const bytes = patch(buildDocumentPDFBytes(doc, x4), 'prtrCMYK', 'mntrCMYK');
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/class is 'mntr'/);
    });

    it('A-004: rejects an embedded profile without the acsp signature', () => {
        const bytes = patch(buildDocumentPDFBytes(doc, x4), 'acsp', 'xxxx');
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/no `acsp` signature/);
    });

    it('rejects a TrimBox outside the BleedBox', () => {
        const bytes = buildDocumentPDFBytes(doc, { ...x4, print: { bleed: 9 } });
        const text = Buffer.from(bytes).toString('latin1');
        const bleed = /\/BleedBox \[[^\]]+\]/.exec(text)![0];
        const shrunk = bleed.replace(/\[0\.00 0\.00 /, '[20.0 20.0 ');
        expect(validatePdfX(patch(bytes, bleed, shrunk)).errors.join('\n')).toMatch(/TrimBox extends beyond the BleedBox/);
    });

    it('reports unparseable input instead of throwing', () => {
        const bad = validatePdfX(new TextEncoder().encode('not a pdf'));
        expect(bad.valid).toBe(false);
        expect(bad.errors[0]).toMatch(/header/);
    });
});

// ── Requirements added after the 1.8.0 audit ─────────────────────────

function latin1Bytes(s: string): Uint8Array {
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i) & 0xFF;
    return buf;
}

/** Assemble a classic-xref PDF from 1-based object bodies (obj 1 = /Root). */
function assemblePdf(objects: readonly string[], header = '%PDF-1.6'): Uint8Array {
    let body = `${header}\n`;
    const offsets: number[] = [];
    objects.forEach((content, idx) => {
        offsets[idx] = body.length;
        body += `${idx + 1} 0 obj\n${content}\nendobj\n`;
    });
    const xrefOff = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<01> <01>] >>\nstartxref\n${xrefOff}\n%%EOF\n`;
    return latin1Bytes(body);
}

const stream = (dict: string, data: string): string => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;

describe('validatePdfX: annotations, actions, resources and filters', () => {
    const linkDoc: DocumentParams = { ...doc, blocks: [{ type: 'link', text: 'site', url: 'https://example.com' }] };

    it('exempts a Hidden annotation from the BleedBox rule', () => {
        const bytes = buildDocumentPDFBytes(linkDoc, x4);
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/\/Link annotation inside/);
        const hidden = patch(bytes, '/F 4 ', '/F 2 ');
        expect(validatePdfX(hidden).errors.join('\n')).not.toMatch(/annotation inside/);
    });

    it('warns, rather than errors, on a header below PDF 1.6', () => {
        const bytes = patch(buildDocumentPDFBytes(doc, x4), '%PDF-1.6', '%PDF-1.4');
        const { errors, warnings } = validatePdfX(bytes);
        expect(errors).toEqual([]);
        expect(warnings.join('\n')).toMatch(/expected to declare PDF 1\.6/);
    });

    it('rejects the LZWDecode filter anywhere in the file', () => {
        const bytes = patch(buildDocumentPDFBytes(doc, { ...x4, compress: true }), '/FlateDecode', '/LZWDecode  ');
        expect(validatePdfX(bytes).errors.join('\n')).toMatch(/LZWDecode/);
    });

    it('rejects actions, JavaScript and transfer functions, and sees fonts inside Form XObjects', () => {
        const bytes = assemblePdf([
            '<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] /AA << /WC 7 0 R >> /Names << /JavaScript << /Names [(init) 7 0 R] >> >> >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /TrimBox [0 0 612 792] /AA << /O 7 0 R >> '
                + '/Resources << /XObject << /Fx 5 0 R >> /ExtGState << /GS0 6 0 R /GS1 8 0 R >> >> /Contents 4 0 R '
                + '/Annots [9 0 R] >>',
            stream('', '/Fx Do'),
            stream('/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /Fh 10 0 R >> >>', 'BT /Fh 12 Tf (x) Tj ET'),
            '<< /Type /ExtGState /TR 11 0 R >>',
            '<< /S /JavaScript /JS (app.alert\\(1\\)) >>',
            '<< /Type /ExtGState /HT << /Type /Halftone /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction /Round >> >>',
            '<< /Type /Annot /Subtype /Link /Rect [0 0 0 0] /F 2 /A 7 0 R >>',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
            '<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>',
        ]);
        const { errors, warnings } = validatePdfX(bytes);
        const all = errors.join('\n');
        expect(all).toMatch(/Catalog has an \/OpenAction/);
        expect(all).toMatch(/Catalog has additional actions/);
        expect(all).toMatch(/names tree carries \/JavaScript/);
        expect(all).toMatch(/Page 1: page has additional actions/);
        expect(all).toMatch(/JavaScript action/);
        expect(all).toMatch(/xobject \/Fx: font \/Fh \(Helvetica\) is not embedded/);
        expect(all).toMatch(/transfer function/);
        expect(warnings.join('\n')).toMatch(/halftone other than \/Default/);
    });

    it('accepts /TR /Identity and /TR2 /Default', () => {
        const bytes = assemblePdf([
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /TrimBox [0 0 612 792] /Resources << /ExtGState << /A 5 0 R /B 6 0 R >> >> /Contents 4 0 R >>',
            stream('', ''),
            '<< /Type /ExtGState /TR /Identity >>',
            '<< /Type /ExtGState /TR2 /Default /HT /Default >>',
        ]);
        const { errors, warnings } = validatePdfX(bytes);
        expect(errors.join('\n')).not.toMatch(/transfer function/);
        expect(warnings.join('\n')).not.toMatch(/halftone/);
    });
});
