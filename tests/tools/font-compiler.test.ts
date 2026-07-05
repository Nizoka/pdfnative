import { describe, it, expect } from 'vitest';
import { parseFontData, compileFontData } from '../../src/tools/index.js';

// #60 — programmatic font compilation. `parseFontData` returns a registerable
// FontDataObject; `compileFontData` returns module source byte-identical to the
// `pdfnative-build-font` CLI. Byte-identity checks are gated on the local TTF
// (fonts/ttf/ is git-ignored, so absent in CI).

async function nodeFs(): Promise<{
    readFileSync(p: string): Uint8Array;
    existsSync(p: string): boolean;
}> {
    return (await import('node:' + 'fs')) as never;
}

const MATH_TTF = 'fonts/ttf/NotoSansMath-Regular.ttf';
const MATH_MODULE = 'fonts/noto-sans-math-data.js';

const fs = await nodeFs();
const hasTtf = fs.existsSync(MATH_TTF);
const hasModule = fs.existsSync(MATH_MODULE);

describe('parseFontData / compileFontData (#60)', () => {
    it.skipIf(!hasTtf)('parseFontData returns a well-formed FontDataObject', () => {
        const buf = fs.readFileSync(MATH_TTF);
        const data = parseFontData(buf, { fontName: 'NotoSansMath-Regular' });
        expect(data.fontName).toBe('NotoSansMath-Regular');
        expect(data.metrics.unitsPerEm).toBeGreaterThan(0);
        expect(Object.keys(data.cmap).length).toBeGreaterThan(0);
        expect(typeof data.ttfBase64).toBe('string');
        expect(data.ttfBase64.length).toBeGreaterThan(0);
        // √ (U+221A) must map to a real glyph id.
        expect(data.cmap[0x221A]).toBeGreaterThan(0);
    });

    it.skipIf(!hasTtf)('compileFontData is deterministic', () => {
        const buf = fs.readFileSync(MATH_TTF);
        const a = compileFontData(buf, { fontName: 'NotoSansMath-Regular' });
        const b = compileFontData(buf, { fontName: 'NotoSansMath-Regular' });
        expect(a).toBe(b);
    });

    it.skipIf(!hasTtf)('compileFontData emits the expected module structure', () => {
        const buf = fs.readFileSync(MATH_TTF);
        const src = compileFontData(buf, { fontName: 'NotoSansMath-Regular', format: 'esm' });
        expect(src).toContain('export const metrics =');
        expect(src).toContain('export const cmap =');
        expect(src).toContain('export const ttfBase64 =');
    });

    it.skipIf(!hasTtf)('emits CJS when requested', () => {
        const buf = fs.readFileSync(MATH_TTF);
        const src = compileFontData(buf, { fontName: 'NotoSansMath-Regular', format: 'cjs' });
        expect(src).toContain('module.exports');
        expect(src).toContain('const metrics =');
    });

    it.skipIf(!hasTtf || !hasModule)('produces byte-identical parsed data to the committed CLI module', () => {
        const buf = fs.readFileSync(MATH_TTF);
        const src = compileFontData(buf, { fontName: 'NotoSansMath-Regular' });
        const committed = new TextDecoder().decode(fs.readFileSync(MATH_MODULE));
        // The metrics line is a byte-exact serialisation of the parsed metrics.
        const metricsLine = /export const metrics = \{[^\n]*\};/.exec(committed)?.[0];
        expect(metricsLine).toBeTruthy();
        expect(src).toContain(metricsLine!);
    });
});
