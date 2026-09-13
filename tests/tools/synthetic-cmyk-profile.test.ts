import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import { buildSyntheticCmykProfile } from '../../scripts/lib/synthetic-cmyk-profile.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { validatePdfX } from '../../src/parser/pdf-x-validator.js';
import { resolveOutputIntent } from '../../src/core/pdf-tags.js';
import type { FontData } from '../../src/types/pdf-types.js';

// The synthetic CMYK output profile the print samples embed (v1.8.0). It is
// a structural stand-in, not a characterised press condition; veraPDF
// accepted a PDF/A-2b file carrying it when it was introduced.

const icc = buildSyntheticCmykProfile();
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

/** Evaluate a lut8 CLUT at a grid node (identity curves and matrix). */
function lutNode(tag: string, node: readonly number[]): number[] {
    const { offset } = tags().get(tag)!;
    const inCh = icc[offset + 8];
    const outCh = icc[offset + 9];
    const grid = icc[offset + 10];
    let index = 0;
    for (const n of node) index = index * grid + n;
    const clut = offset + 48 + inCh * 256;
    return [...icc.subarray(clut + index * outCh, clut + index * outCh + outCh)];
}

describe('buildSyntheticCmykProfile', () => {
    it('writes an ICC v2 output profile header', () => {
        expect(view.getUint32(0)).toBe(icc.length);
        expect(view.getUint32(8)).toBe(0x02100000);
        expect(sig(12)).toBe('prtr');
        expect(sig(16)).toBe('CMYK');
        expect(sig(20)).toBe('Lab ');
        expect(sig(36)).toBe('acsp');
        expect(icc.length % 4).toBe(0);
    });

    it('carries the tags an output profile requires, inside the file', () => {
        const table = tags();
        expect([...table.keys()].sort()).toEqual(['A2B0', 'B2A0', 'cprt', 'desc', 'gamt', 'wtpt']);
        for (const [name, { offset, size }] of table) {
            expect(offset % 4, name).toBe(0);
            expect(offset + size, name).toBeLessThanOrEqual(icc.length);
        }
        expect(sig(table.get('A2B0')!.offset)).toBe('mft1');
        expect(icc[table.get('A2B0')!.offset + 8]).toBe(4);
        expect(icc[table.get('B2A0')!.offset + 9]).toBe(4);
    });

    it('is deterministic', () => {
        expect(buildSyntheticCmykProfile()).toEqual(icc);
    });

    it('maps paper to white and full black ink to black', () => {
        const paper = lutNode('A2B0', [0, 0, 0, 0]);
        expect(paper[0]).toBe(255);
        expect(Math.abs(paper[1] - 128)).toBeLessThanOrEqual(1);
        expect(Math.abs(paper[2] - 128)).toBeLessThanOrEqual(1);
        const black = lutNode('A2B0', [0, 0, 0, 4]);
        expect(black[0]).toBe(0);
        // Lab white back to CMYK: no ink.
        expect(lutNode('B2A0', [8, 4, 4])).toEqual([0, 0, 0, 0]);
    });

    it('resolves as a CMYK output intent and yields a valid PDF/X-4 document', () => {
        expect(resolveOutputIntent({ iccProfile: icc })).toMatchObject({ space: 'cmyk', components: 4, deviceClass: 'prtr' });
        const bytes = buildDocumentPDFBytes(
            {
                title: 'Synthetic profile',
                blocks: [{ type: 'paragraph', text: 'Cyan', color: [100, 0, 0, 0] }],
                fontEntries: [{ fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' }],
            },
            { pdfx: 'pdfx4', outputIntent: { iccProfile: icc, outputConditionIdentifier: 'Synthetic CMYK' }, onDiagnostic: () => {} },
        );
        expect(validatePdfX(bytes).errors).toEqual([]);
    });
});
