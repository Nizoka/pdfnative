/**
 * Synthetic ICC output profiles (v1.9.0, #86): the Gray `prtr` profile that
 * joins the 1.8.0 CMYK one, both exported from `pdfnative/tools` so
 * downstream packages stop vendoring their own. Structural stand-ins for
 * fixtures — never press conditions.
 */

import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { buildSyntheticGrayProfile, buildSyntheticCmykProfile } from '../../src/tools/synthetic-profiles.js';
import * as tools from '../../src/tools/index.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { validatePdfX } from '../../src/parser/pdf-x-validator.js';
import { resolveOutputIntent } from '../../src/core/pdf-tags.js';
import type { FontData, PdfDiagnostic } from '../../src/types/pdf-types.js';

const icc = buildSyntheticGrayProfile();
const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
const sig = (at: number): string => String.fromCharCode(...icc.subarray(at, at + 4));

function tags(): Map<string, { offset: number; size: number }> {
    const out = new Map<string, { offset: number; size: number }>();
    const count = view.getUint32(128);
    for (let i = 0; i < count; i++) {
        const at = 132 + i * 12;
        out.set(sig(at), { offset: view.getUint32(at + 4), size: view.getUint32(at + 8) });
    }
    return out;
}

describe('buildSyntheticGrayProfile', () => {
    it('writes a 408-byte ICC v2 monochrome output profile header', () => {
        expect(icc.length).toBe(408);
        expect(view.getUint32(0)).toBe(icc.length);
        expect(view.getUint32(8)).toBe(0x02100000);
        expect(sig(12)).toBe('prtr');
        expect(sig(16)).toBe('GRAY');
        expect(sig(20)).toBe('XYZ ');
        expect(sig(36)).toBe('acsp');
    });

    it('carries exactly the four tags a monochrome output profile requires', () => {
        const table = tags();
        expect([...table.keys()].sort()).toEqual(['cprt', 'desc', 'kTRC', 'wtpt']);
        for (const [name, { offset, size }] of table) {
            expect(offset % 4, name).toBe(0);
            expect(offset + size, name).toBeLessThanOrEqual(icc.length);
        }
        const trc = table.get('kTRC')!.offset;
        expect(sig(trc)).toBe('curv');
        expect(view.getUint32(trc + 8)).toBe(1); // one entry = a gamma
        expect(view.getUint16(trc + 12)).toBe(Math.round(2.2 * 256)); // u8Fixed8 2.2
        const wtpt = table.get('wtpt')!.offset;
        expect(sig(wtpt)).toBe('XYZ ');
        expect(view.getUint32(wtpt + 12) / 65536).toBeCloseTo(1.0, 4); // D50 Y
    });

    it('is deterministic', () => {
        expect(buildSyntheticGrayProfile()).toEqual(icc);
    });

    it('resolves as a Gray output intent', () => {
        expect(resolveOutputIntent({ iccProfile: icc })).toMatchObject({ space: 'gray', components: 1, deviceClass: 'prtr' });
    });

    it('yields a valid monochrome PDF/X-4 document and trips PDFX_DEVICE_CMYK for CMYK content', () => {
        const fontEntries = [{ fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' }];
        const intent = { iccProfile: icc, outputConditionIdentifier: 'Synthetic Gray' };
        const mono = buildDocumentPDFBytes(
            { title: 'Monochrome', blocks: [{ type: 'paragraph', text: 'Monochrome print stream' }], fontEntries },
            { pdfx: 'pdfx4', outputIntent: intent, onDiagnostic: () => {} },
        );
        expect(validatePdfX(mono).errors).toEqual([]);

        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(
            { title: 'CMYK under Gray', blocks: [{ type: 'paragraph', text: 'Cyan', color: [100, 0, 0, 0] }], fontEntries },
            { pdfx: 'pdfx4', outputIntent: intent, onDiagnostic: d => seen.push(d) },
        );
        expect(seen.map(d => d.code)).toContain('PDFX_DEVICE_CMYK');
    });
});

describe('pdfnative/tools exports both builders', () => {
    it('exposes buildSyntheticCmykProfile and buildSyntheticGrayProfile', () => {
        expect(tools.buildSyntheticGrayProfile()).toEqual(icc);
        expect(tools.buildSyntheticCmykProfile()).toEqual(buildSyntheticCmykProfile());
    });

    it('the CMYK profile kept its 1.8.0 shape through the move', () => {
        const cmyk = buildSyntheticCmykProfile();
        expect(cmyk.length).toBe(9968);
        expect(String.fromCharCode(...cmyk.subarray(16, 20))).toBe('CMYK');
    });
});
