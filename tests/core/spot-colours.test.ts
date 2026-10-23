/**
 * Spot colours (v1.9.0): `{ spot, tint }` and `{ inks }` colour values over
 * the inks declared in `layout.print.spotColours` — the operators the colour
 * module emits, the Separation / DeviceN resources the builders write, the
 * object numbering around the DeviceN tint transforms, the declaration
 * errors, the OutputIntent diagnostics and `validatePdfX()` on the result.
 */

import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { validatePdfX } from '../../src/parser/pdf-x-validator.js';
import {
    parseColor, resolveColor, fillOp, strokeOp, tintOperands, rgbOperands, processOperands,
    pdfNameEncode, pdfNameDecode, spotColourSpaceName, inkMixColourSpaceName, parseColourSpaceName,
} from '../../src/core/pdf-color.js';
import { spotColourResources, validateSpotColours } from '../../src/core/pdf-spot.js';
import { buildSyntheticCmykProfile } from '../../src/tools/synthetic-profiles.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfLayoutOptions, PdfParams, SpotColourDef } from '../../src/types/pdf-types.js';

const latin: FontEntry = { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' };
const PINNED = new Date('2026-01-01T00:00:00Z');
const SPOTS: readonly SpotColourDef[] = [
    { name: 'PANTONE 300 C', alternate: [100, 44, 0, 0] },
    { name: 'Varnish', alternate: [0, 0, 0, 10] },
    { name: 'Neon', alternate: [255, 0, 128] },
];
const latin1 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };

function fakeIcc(space: string, deviceClass = 'prtr'): Uint8Array {
    const icc = new Uint8Array(200);
    icc[3] = 200;
    for (let i = 0; i < 4; i++) icc[36 + i] = 'acsp'.charCodeAt(i);
    for (let i = 0; i < 4; i++) { icc[12 + i] = deviceClass.charCodeAt(i); icc[16 + i] = space.charCodeAt(i); }
    return icc;
}

const doc: DocumentParams = {
    title: 'Brand sheet',
    blocks: [
        { type: 'heading', text: 'Brand blue', level: 1, color: { spot: 'PANTONE 300 C' } },
        { type: 'paragraph', text: 'Half tint of the brand blue.', color: { spot: 'PANTONE 300 C', tint: 0.5 } },
        { type: 'paragraph', text: 'Blue with a varnish.', color: { inks: { 'PANTONE 300 C': 1, Varnish: 0.3 } } },
    ],
    fontEntries: [latin],
};

// ── Colour values ────────────────────────────────────────────────────

describe('spot colour values', () => {
    it('encode ink names as reversible PDF name tokens', () => {
        expect(pdfNameEncode('PANTONE 300 C')).toBe('PANTONE#20300#20C');
        expect(pdfNameEncode('Or/Ange (2)')).toBe('Or#2FAnge#20#282#29');
        expect(pdfNameEncode('Été')).toBe('#C3#89t#C3#A9');
        for (const name of ['PANTONE 300 C', 'Or/Ange (2)', 'Été', 'a#b', '']) expect(pdfNameDecode(pdfNameEncode(name))).toBe(name);
        expect(spotColourSpaceName('Varnish')).toBe('Spot_Varnish');
        expect(inkMixColourSpaceName(['A B', 'C'])).toBe('DeviceN_A#20B__C');
        expect(parseColourSpaceName('Spot_PANTONE#20300#20C')).toEqual({ kind: 'separation', inks: ['PANTONE 300 C'] });
        expect(parseColourSpaceName('DeviceN_A#20B__C')).toEqual({ kind: 'devicen', inks: ['A B', 'C'] });
        expect(parseColourSpaceName('CSReg')).toBeNull();
    });

    it('parse to a canonical "/name tints" string that parses back to itself', () => {
        expect(parseColor({ spot: 'PANTONE 300 C' })).toBe('/Spot_PANTONE#20300#20C 1');
        expect(parseColor({ spot: 'Varnish', tint: 0.25 })).toBe('/Spot_Varnish 0.25');
        expect(parseColor({ inks: { Varnish: 0.3, 'PANTONE 300 C': 1 } })).toBe('/DeviceN_PANTONE#20300#20C__Varnish 1 0.3');
        expect(parseColor('/Spot_Varnish 0.25')).toBe('/Spot_Varnish 0.25');
    });

    it('resolve to the separation and DeviceN spaces with their resource name', () => {
        expect(resolveColor({ spot: 'Varnish', tint: 0.5 })).toEqual({ space: 'separation', operands: '0.5', colorSpace: 'Spot_Varnish' });
        expect(resolveColor({ inks: { A: 1, B: 0 } })).toEqual({ space: 'devicen', operands: '1 0', colorSpace: 'DeviceN_A__B' });
        expect(resolveColor([100, 0, 0, 0])).toEqual({ space: 'cmyk', operands: '1 0 0 0' });
    });

    it('emit cs/scn and CS/SCN operators, process colours unchanged', () => {
        expect(fillOp({ spot: 'PANTONE 300 C' })).toBe('/Spot_PANTONE#20300#20C cs 1 scn');
        expect(strokeOp({ spot: 'Varnish', tint: 0.2 })).toBe('/Spot_Varnish CS 0.2 SCN');
        expect(fillOp({ inks: { A: 1, B: 0.5 } })).toBe('/DeviceN_A__B cs 1 0.5 scn');
        expect(fillOp('#2563EB')).toBe('0.145 0.388 0.922 rg');
        expect(fillOp([0, 0, 0, 100])).toBe('0 0 0 1 k');
    });

    it('tint toward paper white by removing ink, keeping the colour space', () => {
        expect(tintOperands('/Spot_Varnish 1', 0.5, n => String(n))).toBe('/Spot_Varnish 0.5');
        expect(tintOperands('1 0.5', 0.5, n => String(n), 'devicen')).toBe('0.5 0.25');
        expect(tintOperands('0 0 0 1', 0.5, n => String(n))).toBe('0 0 0 0.5');
        expect(tintOperands('0 0 0', 0.5, n => String(n))).toBe('0.5 0.5 0.5');
    });

    it('reject malformed values and spot colours where PDF wants a process colour', () => {
        expect(() => parseColor({ spot: '' })).toThrow(/ink name is empty/);
        expect(() => parseColor({ spot: 'A', tint: 2 })).toThrow(/tint between 0 and 1/);
        expect(() => parseColor({ inks: {} })).toThrow(/no inks/);
        expect(() => parseColor({ inks: { A: -1 } })).toThrow(/tint between 0 and 1/);
        expect(() => rgbOperands({ spot: 'A' })).toThrow(/outline colour/);
        expect(() => processOperands({ spot: 'A' }, 'An annotation colour')).toThrow(/process colour/);
        expect(processOperands([100, 0, 0, 0], 'x')).toBe('1 0 0 0');
    });
});

// ── Resources ────────────────────────────────────────────────────────

describe('spotColourResources', () => {
    it('writes a Separation with a type-2 tint transform per ink and a DeviceN with a type-4 function per mix', () => {
        const fns: { dict: string; data: string }[] = [];
        const res = spotColourResources(SPOTS, ['Spot_PANTONE#20300#20C', 'DeviceN_PANTONE#20300#20C__Varnish', 'CSReg', 'Spot_PANTONE#20300#20C'], fn => { fns.push(fn); return `${40 + fns.length} 0 R`; });
        expect(res.entries).toBe(
            '/Spot_PANTONE#20300#20C [/Separation /PANTONE#20300#20C /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0.44 0 0] /N 1 >>] '
            + '/DeviceN_PANTONE#20300#20C__Varnish [/DeviceN [/PANTONE#20300#20C /Varnish] /DeviceCMYK 41 0 R]');
        expect(res.cmykAlternate).toBe(true);
        expect(res.rgbAlternate).toBe(false);
        expect(fns).toHaveLength(1);
        expect(fns[0].dict).toBe(`<< /FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1 0 1] /Length ${fns[0].data.length}`);
        // Two inks, four channels: C = t1·1 + t2·0, K = t1·0 + t2·0.1, every channel clamped at 1.
        expect(fns[0].data).toBe('{ 2 copy 0 mul exch 1 mul add 3 1 roll 2 copy 0 mul exch 0.44 mul add 3 1 roll 2 copy 0 mul exch 0 mul add 3 1 roll 2 copy 0.1 mul exch 0 mul add 3 1 roll 2 {pop} repeat 4 {dup 1 gt {pop 1} if 4 1 roll} repeat }');
    });

    it('writes RGB alternates over DeviceRGB, white as the zero tint', () => {
        const res = spotColourResources(SPOTS, ['Spot_Neon'], () => '1 0 R');
        expect(res.entries).toBe('/Spot_Neon [/Separation /Neon /DeviceRGB << /FunctionType 2 /Domain [0 1] /C0 [1 1 1] /C1 [1 0 0.502] /N 1 >>]');
        expect(res.rgbAlternate).toBe(true);
        expect(res.cmykAlternate).toBe(false);
    });

    it('is empty when the content selects no spot space', () => {
        expect(spotColourResources(SPOTS, ['CSReg'], () => '1 0 R')).toEqual({ entries: '', cmykAlternate: false, rgbAlternate: false });
        expect(spotColourResources(undefined, [], () => '1 0 R').entries).toBe('');
    });

    it('rejects an undeclared ink, a mix across alternate spaces, and bad declarations', () => {
        expect(() => spotColourResources(SPOTS, ['Spot_Gold'], () => '1 0 R')).toThrow(/Spot colour 'Gold' is not declared — add \{ name: 'Gold'/);
        expect(() => spotColourResources(undefined, ['Spot_Varnish'], () => '1 0 R')).toThrow(/not declared/);
        expect(() => spotColourResources(SPOTS, ['DeviceN_Neon__Varnish'], () => '1 0 R')).toThrow(/same alternate space/);
        expect(() => validateSpotColours([{ name: '', alternate: [0, 0, 0, 0] }])).toThrow(/non-empty name/);
        expect(() => validateSpotColours([{ name: 'A', alternate: [0, 0, 0, 0] }, { name: 'A', alternate: [0, 0, 0, 0] }])).toThrow(/declared twice/);
        expect(() => validateSpotColours([{ name: 'A', alternate: [0, 0, 0, 101] }])).toThrow(/percentages 0–100/);
        expect(() => validateSpotColours([{ name: 'A', alternate: [0, 0, 300] }])).toThrow(/0–255/);
        expect(() => validateSpotColours([{ name: 'A', alternate: [0, 0] as unknown as [number, number, number] }])).toThrow(/four CMYK percentages or three RGB/);
        expect(() => validateSpotColours(undefined)).not.toThrow();
    });
});

// ── Builders ─────────────────────────────────────────────────────────

describe('document builder with spot colours', () => {
    const layout: Partial<PdfLayoutOptions> = { print: { spotColours: SPOTS }, creationDate: PINNED };

    it('paints with cs/scn and writes the resources behind every name the pages select', () => {
        const bytes = buildDocumentPDFBytes(doc, layout);
        const s = latin1(bytes);
        expect(s).toContain('/Spot_PANTONE#20300#20C cs 1 scn');
        expect(s).toContain('/Spot_PANTONE#20300#20C cs 0.5 scn');
        expect(s).toContain('/DeviceN_PANTONE#20300#20C__Varnish cs 1 0.3 scn');
        expect(s).toMatch(/\/ColorSpace << \/Spot_PANTONE#20300#20C \[\/Separation \/PANTONE#20300#20C \/DeviceCMYK/);
        expect(s).toMatch(/\/DeviceN_PANTONE#20300#20C__Varnish \[\/DeviceN \[\/PANTONE#20300#20C \/Varnish\] \/DeviceCMYK \d+ 0 R\]/);
        expect(s).toMatch(/\/FunctionType 4 \/Domain \[0 1 0 1\] \/Range \[0 1 0 1 0 1 0 1\]/);
        // No ink the content does not use.
        expect(s).not.toContain('/Spot_Varnish ');
    });

    it('keeps a valid, readable file: the tint-transform object chains after /Info', () => {
        const bytes = buildDocumentPDFBytes(doc, layout);
        const reader = openPdf(bytes);
        expect(reader.pageCount).toBe(1);
        expect(extractText(bytes)[0].text).toContain('Brand blue');
        const s = latin1(bytes);
        const fnRef = /\/DeviceCMYK (\d+) 0 R\]/.exec(s)?.[1];
        expect(fnRef).toBeDefined();
        expect(s).toContain(`\n${fnRef} 0 obj\n<< /FunctionType 4`);
    });

    it('is byte-identical for a document that paints no spot colour, declared inks or not', () => {
        const plain: DocumentParams = { ...doc, blocks: [{ type: 'paragraph', text: 'Process colour only.' }] };
        const a = buildDocumentPDFBytes(plain, { creationDate: PINNED });
        const b = buildDocumentPDFBytes(plain, layout);
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    it('throws before writing when the content names an undeclared ink', () => {
        expect(() => buildDocumentPDFBytes(doc, { creationDate: PINNED })).toThrow(/Spot colour 'PANTONE 300 C' is not declared/);
        expect(() => buildDocumentPDFBytes(doc, { creationDate: PINNED, print: { spotColours: [SPOTS[0], SPOTS[0]] } })).toThrow(/declared twice/);
    });

    it('raises the CMYK diagnostic for a CMYK alternate under a non-CMYK intent, not under CMYK', () => {
        const codes = (opts: Partial<PdfLayoutOptions>): string[] => {
            const seen: PdfDiagnostic[] = [];
            buildDocumentPDFBytes(doc, { ...layout, ...opts, onDiagnostic: d => seen.push(d) });
            return seen.map(d => d.code);
        };
        expect(codes({ tagged: 'pdfa2b' })).toContain('PDFA_DEVICE_CMYK_CONTENT');
        expect(codes({ pdfx: 'pdfx4', outputIntent: { iccProfile: fakeIcc('RGB '), outputConditionIdentifier: 'sRGB' } })).toContain('PDFX_DEVICE_CMYK');
        expect(codes({ pdfx: 'pdfx4', outputIntent: { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' } })).not.toContain('PDFX_DEVICE_CMYK');
    });

    it('validates as PDF/X-4 under a CMYK press profile, and is flagged under an RGB one', () => {
        const press = { pdfx: 'pdfx4' as const, outputIntent: { iccProfile: buildSyntheticCmykProfile(), outputConditionIdentifier: 'Synthetic CMYK' }, onDiagnostic: (): void => {} };
        const ok = validatePdfX(buildDocumentPDFBytes(doc, { ...layout, ...press }));
        expect(ok.errors).toEqual([]);
        const rgb = validatePdfX(buildDocumentPDFBytes(doc, { ...layout, ...press, outputIntent: { iccProfile: fakeIcc('RGB '), outputConditionIdentifier: 'sRGB' } }));
        // The validator names the resource as the dictionary key reads: decoded.
        expect(rgb.errors.join('\n')).toMatch(/colour space \/Spot_PANTONE 300 C: DeviceCMYK colour under a RGB OutputIntent/);
    });
});

describe('table builder with spot colours', () => {
    const params: PdfParams = {
        title: 'Spot table',
        infoItems: [],
        balanceText: '',
        countText: '1 row',
        footerText: 'f',
        headers: ['Item', 'Amount'],
        rows: [{ cells: ['Varnish coat', '1'], type: 'credit', pointed: false }],
    };

    it('paints the theme colour as a Separation and keeps the page tree valid', () => {
        const bytes = buildPDFBytes(params, {
            colors: { title: { spot: 'Varnish' }, credit: '#000000', debit: '#000000', text: '#000000', thBg: '#FFFFFF', thBrd: '#000000', rowBrd: '#000000', ptdBg: '#FFFFFF', balBg: '#FFFFFF', balBrd: '#000000', label: '#000000', footer: '#000000' },
            print: { spotColours: SPOTS },
            creationDate: PINNED,
        });
        const s = latin1(bytes);
        expect(s).toContain('/Spot_Varnish cs 1 scn');
        expect(s).toMatch(/\/ColorSpace << \/Spot_Varnish \[\/Separation \/Varnish \/DeviceCMYK/);
        expect(openPdf(bytes).pageCount).toBe(1);
    });
});
