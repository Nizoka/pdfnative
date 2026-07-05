import { describe, it, expect } from 'vitest';
import { parseFontData, compileFontData } from '../../src/tools/index.js';
// Committed, subsetted font-data module (checked into git). Its `ttfBase64`
// carries a real, parseable SFNT (head/hhea/maxp/OS·2/cmap/hmtx/loca/glyf/name/
// post are preserved by the subsetter), so it lets us exercise the compiler in
// CI without the git-ignored raw TTF — mirroring the way tests/fonts/* cover
// src/fonts/ from committed data modules.
import * as notoSansMath from '../../fonts/noto-sans-math-data.js';

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

/** Decode a base64 string to bytes without relying on Node's `Buffer`. */
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
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

// CI-runnable coverage: parse/compile from a COMMITTED subsetted font, so these
// run everywhere (no git-ignored raw TTF needed), the same way tests/fonts/*
// decode committed `ttfBase64` to cover src/fonts/.
describe('parseFontData / compileFontData from committed subset (#60)', () => {
    const bytes = base64ToBytes(notoSansMath.ttfBase64);

    it('parseFontData returns a well-formed FontDataObject', () => {
        const data = parseFontData(bytes, { fontName: 'NotoSansMath-Regular' });
        expect(data.fontName).toBe('NotoSansMath-Regular');
        expect(data.metrics.unitsPerEm).toBeGreaterThan(0);
        expect(data.metrics.numGlyphs).toBeGreaterThan(0);
        expect(Object.keys(data.cmap).length).toBeGreaterThan(0);
        expect(typeof data.ttfBase64).toBe('string');
        expect(data.ttfBase64.length).toBeGreaterThan(0);
        expect(typeof data.pdfWidthArray).toBe('string');
    });

    it('exposes the full registerable runtime shape', () => {
        const data = parseFontData(bytes, { fontName: 'NotoSansMath-Regular' });
        expect(data.metrics.ascent).toBeGreaterThan(0);
        expect(typeof data.metrics.descent).toBe('number');
        expect(Array.isArray(data.metrics.bbox)).toBe(true);
        expect(data.metrics.bbox).toHaveLength(4);
        expect(typeof data.defaultWidth).toBe('number');
        expect(typeof data.widths).toBe('object');
        expect(typeof data.gsub).toBe('object');
        expect(typeof data.ligatures).toBe('object');
        expect(typeof data.markAnchors.marks).toBe('object');
        expect(typeof data.markAnchors.bases).toBe('object');
        expect(typeof data.mark2mark.mark1Anchors).toBe('object');
        expect(typeof data.mark2mark.mark2Classes).toBe('object');
        // Non-default widths are filtered out of the sparse map.
        for (const w of Object.values(data.widths)) {
            expect(w).not.toBe(data.defaultWidth);
        }
    });

    it('derives a font name from the name table when none is supplied', () => {
        const data = parseFontData(bytes);
        expect(typeof data.fontName).toBe('string');
        expect(data.fontName.length).toBeGreaterThan(0);
        // Sanitised to [A-Za-z0-9-].
        expect(data.fontName).toMatch(/^[A-Za-z0-9-]+$/);
    });

    it('sanitises an explicit font name to [A-Za-z0-9-]', () => {
        const data = parseFontData(bytes, { fontName: 'My Font! v2.0' });
        expect(data.fontName).toMatch(/^[A-Za-z0-9-]+$/);
    });

    it('compileFontData is deterministic', () => {
        const a = compileFontData(bytes, { fontName: 'NotoSansMath-Regular' });
        const b = compileFontData(bytes, { fontName: 'NotoSansMath-Regular' });
        expect(a).toBe(b);
    });

    it('emits the expected ESM module structure', () => {
        const src = compileFontData(bytes, { fontName: 'NotoSansMath-Regular', format: 'esm' });
        expect(src).toContain('export const metrics =');
        expect(src).toContain('export const fontName =');
        expect(src).toContain('export const cmap =');
        expect(src).toContain('export const widths =');
        expect(src).toContain('export const gsub =');
        expect(src).toContain('export const ligatures =');
        expect(src).toContain('export const markAnchors =');
        expect(src).toContain('export const mark2mark =');
        expect(src).toContain('export const pdfWidthArray =');
        expect(src).toContain('export const ttfBase64 =');
        expect(src).toContain('export function getGlyphWidth');
        expect(src).toContain('export function getGlyphId');
        // The emitted ttfBase64 is a faithful round-trip of the input bytes.
        expect(src).toContain(notoSansMath.ttfBase64);
    });

    it('emits CJS when requested', () => {
        const src = compileFontData(bytes, { fontName: 'NotoSansMath-Regular', format: 'cjs' });
        expect(src).toContain('module.exports');
        expect(src).toContain('const metrics =');
        expect(src).not.toContain('export const');
        expect(src).toContain('function getGlyphWidth');
    });

    it('defaults to ESM format', () => {
        const src = compileFontData(bytes, { fontName: 'NotoSansMath-Regular' });
        expect(src).toContain('export const metrics =');
        expect(src).not.toContain('module.exports');
    });
});
