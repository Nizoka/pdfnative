/**
 * JPEG 2000 pass-through (v1.9.0): detection, the JP2 box walk and the SIZ
 * marker, the Image XObject (`/JPXDecode`, colour left to the codestream or
 * stated from the component count, `/SMaskInData`), the PDF 1.5 header, and
 * the PDF/A diagnostics (none under PDF/A-1; channel and opacity rules under
 * PDF/A-2). The fixtures are the minimal valid codestreams the sample helpers
 * build; nothing is decoded on the way in.
 */

import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { detectImageFormat, parseImage, parseJPX, buildImageXObject } from '../../src/core/pdf-image.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { makeMinimalJ2K, makeMinimalJP2, makeMinimalJPEG } from '../../scripts/helpers/images.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfLayoutOptions, PdfParams } from '../../src/types/pdf-types.js';

const latin: FontEntry = { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const PINNED = new Date('2026-01-01T00:00:00Z');
const latin1 = (b: Uint8Array): string => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

describe('JPEG 2000 detection and parsing', () => {
    it('detects a JP2 file by its signature box and a raw codestream by SOC + SIZ', () => {
        expect(detectImageFormat(makeMinimalJP2(1))).toBe('jpx');
        expect(detectImageFormat(makeMinimalJ2K(3))).toBe('jpx');
        expect(detectImageFormat(makeMinimalJPEG())).toBe('jpeg');
        expect(detectImageFormat(new Uint8Array([0xFF, 0x4F, 0xFF, 0x50, 0, 0, 0, 0]))).toBeNull();
    });

    it('reads width, height, component count and bit depth from the SIZ marker of a raw codestream', () => {
        const img = parseJPX(makeMinimalJ2K(3, 16));
        expect([img.width, img.height, img.bitsPerComponent, img.filter, img.colorSpace]).toEqual([16, 16, 8, '/JPXDecode', '/DeviceRGB']);
        expect(img.jpx).toEqual({ colourSpecified: false, alpha: false, channels: 3, bitDepth: 8 });
        expect(parseJPX(makeMinimalJ2K(1)).colorSpace).toBe('/DeviceGray');
        expect(parseJPX(makeMinimalJ2K(4)).colorSpace).toBe('/DeviceCMYK');
        expect(img.data.length).toBe(makeMinimalJ2K(3, 16).length);
        expect(img.smask).toBeNull();
    });

    it('reads the JP2 header: the colr box specifies the colour, a cdef box the opacity channel', () => {
        const rgb = parseJPX(makeMinimalJP2(3));
        expect(rgb.jpx).toEqual({ colourSpecified: true, alpha: false, channels: 3, bitDepth: 8 });
        expect(rgb.colorSpace).toBe('/DeviceRGB');
        expect(parseJPX(makeMinimalJP2(1)).colorSpace).toBe('/DeviceGray');
        expect(parseJPX(makeMinimalJP2(4)).colorSpace).toBe('/DeviceCMYK');
        const rgba = parseJPX(makeMinimalJP2(4, { alpha: true }));
        expect(rgba.jpx).toEqual({ colourSpecified: true, alpha: true, channels: 3, bitDepth: 8 });
        expect(rgba.colorSpace).toBe('/DeviceRGB');
        // A grey + alpha codestream without boxes: one colour channel and an opacity channel.
        expect(parseJPX(makeMinimalJ2K(2)).jpx).toEqual({ colourSpecified: false, alpha: true, channels: 1, bitDepth: 8 });
    });

    it('goes through parseImage like JPEG and PNG do', () => {
        expect(parseImage(makeMinimalJP2(3)).filter).toBe('/JPXDecode');
        expect(() => parseImage(new Uint8Array(16))).toThrow(/JPEG, PNG and JPEG 2000/);
    });

    it('rejects a broken file with the reason', () => {
        expect(() => parseJPX(makeMinimalJ2K(5))).toThrow(/unsupported colour channel count \(5\)/);
        expect(() => parseJPX(new Uint8Array([0xFF, 0x4F, 0xFF, 0x51, 0, 0]))).toThrow(/truncated SIZ|SOC and SIZ/);
        const noCodestream = makeMinimalJP2(1).slice(0, 12 + 20 + 45); // boxes up to jp2h, no jp2c
        expect(() => parseJPX(noCodestream)).toThrow(/no contiguous codestream/);
        const overrun = makeMinimalJP2(1); overrun[3] = 0xFF; // a box longer than the file
        expect(() => parseJPX(overrun)).toThrow(/runs past the end/);
    });
});

describe('JPEG 2000 Image XObject', () => {
    it('leaves /ColorSpace and /BitsPerComponent to a JP2 codestream', () => {
        const x = buildImageXObject(parseJPX(makeMinimalJP2(3, { size: 16 })));
        expect(x).toMatch(/^<< \/Type \/XObject \/Subtype \/Image \/Width 16 \/Height 16 \/Filter \/JPXDecode \/Length \d+ >>\nstream\n/);
        expect(x).not.toContain('/ColorSpace');
        expect(x).not.toContain('/BitsPerComponent');
        expect(x).not.toContain('/DecodeParms');
    });

    it('states the device space for a raw codestream and /SMaskInData 1 for an opacity channel', () => {
        expect(buildImageXObject(parseJPX(makeMinimalJ2K(1)))).toContain('/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /Length');
        expect(buildImageXObject(parseJPX(makeMinimalJP2(4, { alpha: true })))).toContain('/Filter /JPXDecode /SMaskInData 1 /Length');
        expect(buildImageXObject(parseJPX(makeMinimalJP2(3)), 42)).toContain('/Filter /JPXDecode /SMask 42 0 R /Length');
    });

    it('embeds the bytes untouched', () => {
        const src = makeMinimalJP2(1);
        const x = buildImageXObject(parseJPX(src));
        const payload = x.slice(x.indexOf('stream\n') + 7, x.lastIndexOf('\nendstream'));
        expect(payload.length).toBe(src.length);
        expect(payload.charCodeAt(4)).toBe(0x6A); // 'j' of the signature box
    });
});

describe('documents with JPEG 2000 images', () => {
    const image = (data: Uint8Array): DocumentParams => ({
        title: 'JPX', blocks: [{ type: 'image', data, width: 80, height: 80, alt: 'jpx' }], fontEntries: [latin],
    });

    it('raises the header to PDF 1.5 and writes a readable file', () => {
        const bytes = buildDocumentPDFBytes(image(makeMinimalJP2(3)), { creationDate: PINNED });
        const s = latin1(bytes);
        expect(s.startsWith('%PDF-1.5')).toBe(true);
        expect(s).toContain('/Filter /JPXDecode');
        expect(openPdf(bytes).pageCount).toBe(1);
        // A JPEG keeps the 1.4 header.
        expect(latin1(buildDocumentPDFBytes(image(makeMinimalJPEG()), { creationDate: PINNED })).startsWith('%PDF-1.4')).toBe(true);
    });

    it('keeps PDF 1.7 under PDF/A-2 and claims nothing extra', () => {
        const seen: PdfDiagnostic[] = [];
        const s = latin1(buildDocumentPDFBytes(image(makeMinimalJP2(3)), { tagged: 'pdfa2b', creationDate: PINNED, onDiagnostic: d => seen.push(d) }));
        expect(s.startsWith('%PDF-1.7')).toBe(true);
        expect(seen.map(d => d.code)).toEqual([]);
    });

    it('warns under PDF/A-1 and keeps that claim\'s PDF 1.4 header', () => {
        const seen: PdfDiagnostic[] = [];
        const s = latin1(buildDocumentPDFBytes(image(makeMinimalJP2(1)), { tagged: 'pdfa1b', creationDate: PINNED, onDiagnostic: d => seen.push(d) }));
        expect(s.startsWith('%PDF-1.4')).toBe(true);
        expect(seen.map(d => d.code)).toContain('PDFA1_JPX_IMAGE');
        expect(() => buildDocumentPDFBytes(image(makeMinimalJP2(1)), { tagged: 'pdfa1b', strict: true })).toThrow(/PDFA1_JPX_IMAGE|JPXDecode filter/);
    });

    it('warns under PDF/A-2 about an opacity channel, and about a CMYK codestream under the sRGB intent', () => {
        const codes = (data: Uint8Array, layout: Partial<PdfLayoutOptions> = {}): string[] => {
            const seen: PdfDiagnostic[] = [];
            buildDocumentPDFBytes(image(data), { tagged: 'pdfa2b', creationDate: PINNED, onDiagnostic: d => seen.push(d), ...layout });
            return seen.map(d => d.code);
        };
        expect(codes(makeMinimalJP2(4, { alpha: true }))).toContain('PDFA_JPX_IMAGE');
        expect(codes(makeMinimalJP2(4))).toContain('PDFA_DEVICE_CMYK_IMAGE');
        expect(codes(makeMinimalJP2(3))).toEqual([]);
    });

    it('treats a JPEG 2000 watermark image the same way in the table builder', () => {
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '1 row', footerText: 'f', headers: ['A'],
            rows: [{ cells: ['x'], type: 'credit', pointed: false }],
        };
        const s = latin1(buildPDFBytes(params, { watermark: { image: { data: makeMinimalJP2(1), opacity: 0.2 } }, creationDate: PINNED }));
        expect(s.startsWith('%PDF-1.5')).toBe(true);
        expect(s).toContain('/Filter /JPXDecode');
        const seen: PdfDiagnostic[] = [];
        buildPDFBytes({ ...params, fontEntries: [latin] }, { watermark: { image: { data: makeMinimalJP2(1), opacity: 1 } }, tagged: 'pdfa1b', creationDate: PINNED, onDiagnostic: d => seen.push(d) });
        expect(seen.map(d => d.code)).toContain('PDFA1_JPX_IMAGE');
    });

    it('is byte-identical for documents without a JPEG 2000 image', () => {
        const doc: DocumentParams = { title: 'plain', blocks: [{ type: 'paragraph', text: 'No image.' }] };
        const a = latin1(buildDocumentPDFBytes(doc, { creationDate: PINNED }));
        expect(a.startsWith('%PDF-1.4')).toBe(true);
    });
});
