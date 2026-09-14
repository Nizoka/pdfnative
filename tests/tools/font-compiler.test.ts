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

// ── B-007 — GSUB SingleSubst parser locked on a synthetic font ────────
//
// The 1.8.0 fix (single substitutions read from the wrong offset, extension
// lookups missed, discretionary features merged) had no parser-level lock:
// the only guard was `verify:fonts`, which skips when fonts/ttf is absent.
// This font is built in memory — eight glyphs, one cmap group, and a GSUB
// with three lookups reached through `locl` (default) and `smcp`
// (discretionary): a format-1 delta, a LookupType 7 extension wrapping a
// format-2 list, and a format-2 list only a discretionary feature wants.

class Sfnt {
    private readonly bytes: number[] = [];
    get length(): number { return this.bytes.length; }
    u8(v: number): this { this.bytes.push(v & 0xFF); return this; }
    u16(v: number): this { return this.u8(v >> 8).u8(v); }
    i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v); }
    u32(v: number): this { return this.u16(v >>> 16).u16(v & 0xFFFF); }
    tag(s: string): this { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
    zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
    toUint8Array(): Uint8Array { return new Uint8Array(this.bytes); }
}

function sfnt(tables: Record<string, Uint8Array>): Uint8Array {
    const tags = Object.keys(tables);
    const dir = 12 + tags.length * 16;
    let size = dir;
    for (const t of tags) size += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x00010000);
    v.setUint16(4, tags.length);
    let off = dir;
    tags.forEach((tag, i) => {
        for (let c = 0; c < 4; c++) out[12 + i * 16 + c] = tag.charCodeAt(c);
        v.setUint32(12 + i * 16 + 8, off);
        v.setUint32(12 + i * 16 + 12, tables[tag].length);
        out.set(tables[tag], off);
        off += (tables[tag].length + 3) & ~3;
    });
    return out;
}

/** GSUB: locl → lookups 0 (fmt 1, +4) and 1 (ext → fmt 2, 2→6); smcp → lookup 2 (fmt 2, 3→7). */
function syntheticGsub(): Uint8Array {
    const g = new Sfnt();
    g.u32(0x00010000).u16(10).u16(12).u16(40);      // header: script 10, feature 12, lookup 40
    g.u16(0);                                        // ScriptList (10): no scripts
    g.u16(2).tag('locl').u16(14).tag('smcp').u16(22); // FeatureList (12): two records
    g.u16(0).u16(2).u16(0).u16(1);                   // locl (FL+14): lookups 0, 1
    g.u16(0).u16(1).u16(2);                          // smcp (FL+22): lookup 2
    g.u16(3).u16(8).u16(28).u16(58);                 // LookupList (40): three lookups
    // Lookup 0 (LL+8): type 1, one subtable at +8 — format 1, coverage at +6, delta +4, covers gid 1.
    g.u16(1).u16(0).u16(1).u16(8);
    g.u16(1).u16(6).i16(4);
    g.u16(1).u16(1).u16(1);
    // Lookup 1 (LL+28): type 7 extension → inner type 1 format 2 at ext+8, covers gid 2 → 6.
    g.u16(7).u16(0).u16(1).u16(8);
    g.u16(1).u16(1).u32(8);
    g.u16(2).u16(8).u16(1).u16(6);
    g.u16(1).u16(1).u16(2);
    // Lookup 2 (LL+58): type 1 format 2, covers gid 3 → 7 — wanted by smcp only.
    g.u16(1).u16(0).u16(1).u16(8);
    g.u16(2).u16(8).u16(1).u16(7);
    g.u16(1).u16(1).u16(3);
    return g.toUint8Array();
}

function syntheticFont(): Uint8Array {
    const head = new Sfnt().zeros(18).u16(1000).zeros(16).i16(0).i16(-200).i16(1000).i16(800).zeros(10).toUint8Array();
    const hhea = new Sfnt().u32(0x00010000).i16(800).i16(-200).zeros(26).u16(8).toUint8Array();
    const maxp = new Sfnt().u32(0x00005000).u16(8).zeros(26).toUint8Array();
    const hmtx = new Sfnt();
    for (let i = 0; i < 8; i++) hmtx.u16(600).i16(0);
    // cmap: one (3, 10) format-12 subtable mapping U+0041–U+0047 to gids 1–7.
    const cmap = new Sfnt().u16(0).u16(1).u16(3).u16(10).u32(12)
        .u16(12).u16(0).u32(28).u32(0).u32(1).u32(0x41).u32(0x47).u32(1).toUint8Array();
    return sfnt({ head, hhea, maxp, hmtx: hmtx.toUint8Array(), cmap, GSUB: syntheticGsub() });
}

describe('GSUB SingleSubst parsing (B-007, v1.8.0 parser fix)', () => {
    const data = parseFontData(syntheticFont(), { fontName: 'Synthetic' });

    it('B-007: reads a format-1 delta substitution from the subtable, not from the coverage table', () => {
        expect(data.gsub[1]).toBe(5);
    });

    it('B-007: resolves a LookupType 7 extension to its inner format-2 list', () => {
        expect(data.gsub[2]).toBe(6);
    });

    it('B-007: keeps a lookup wanted only by a discretionary feature out of the default table', () => {
        expect(data.gsub[3]).toBeUndefined();
        expect(Object.keys(data.gsub).sort()).toEqual(['1', '2']);
    });

    it('B-007: exposes the discretionary substitution under its own feature tag', () => {
        expect(data.features).not.toBeNull();
        expect(data.features!['smcp']).toEqual({ 3: 7 });
        expect(data.features!['locl']).toBeUndefined();
    });

    it('B-007: maps the cmap group to the eight glyphs', () => {
        expect(data.cmap[0x41]).toBe(1);
        expect(data.cmap[0x47]).toBe(7);
    });
});
