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

    it('v1.8.0: a font whose GSUB lists no script yields no OpenType Layout tables', () => {
        expect(data.otl).toBeNull();
    });
});

// ── v1.8.0 — OpenType Layout (`otl`) and per-subtable GPOS mark classes ──
//
// The Indic correction needs what the flat `gsub` / `ligatures` tables cannot
// express: which feature a lookup belongs to (Noto Sans Devanagari maps
// Ra + virama to a reph under `rphf` and to a rakar under `blwf`), Multiple
// substitutions, and mark classes that stay distinct across GPOS subtables
// (before 1.8.0 every subtable's class 0 collided and only the last survived).
// The font below is assembled in memory with computed offsets; the last test
// runs the reference CLI on the same bytes and requires byte identity, which
// is the "two generators, one output" rule of CONTRIBUTING.md made executable.

function concat(parts: Uint8Array[]): Uint8Array {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

/** Lay `children` after a header of `headerSize` bytes; the header receives each child's offset. */
function pack(header: (offsets: number[]) => Uint8Array, headerSize: number, children: Uint8Array[]): Uint8Array {
    const offsets: number[] = [];
    let off = headerSize;
    for (const c of children) { offsets.push(off); off += c.length; }
    const h = header(offsets);
    if (h.length !== headerSize) throw new Error(`header is ${h.length} bytes, expected ${headerSize}`);
    return concat([h, ...children]);
}

const sortedKeys = (o: Record<number, unknown>): number[] => Object.keys(o).map(Number).sort((a, b) => a - b);

function coverage1(gids: number[]): Uint8Array {
    const s = new Sfnt().u16(1).u16(gids.length);
    for (const g of gids) s.u16(g);
    return s.toUint8Array();
}

function singleSubst2(map: Record<number, number>): Uint8Array {
    const gids = sortedKeys(map);
    return pack(([cov]) => {
        const s = new Sfnt().u16(2).u16(cov).u16(gids.length);
        for (const g of gids) s.u16(map[g]);
        return s.toUint8Array();
    }, 6 + 2 * gids.length, [coverage1(gids)]);
}

function multipleSubst1(map: Record<number, number[]>): Uint8Array {
    const gids = sortedKeys(map);
    const seqs = gids.map(g => {
        const s = new Sfnt().u16(map[g].length);
        for (const x of map[g]) s.u16(x);
        return s.toUint8Array();
    });
    return pack((offs) => {
        const s = new Sfnt().u16(1).u16(offs[0]).u16(gids.length);
        for (let i = 0; i < gids.length; i++) s.u16(offs[i + 1]);
        return s.toUint8Array();
    }, 6 + 2 * gids.length, [coverage1(gids), ...seqs]);
}

function ligatureSubst1(map: Record<number, number[][]>): Uint8Array {
    const gids = sortedKeys(map);
    const sets = gids.map(g => {
        const ligs = map[g].map(l => {
            const s = new Sfnt().u16(l[0]).u16(l.length);
            for (let i = 1; i < l.length; i++) s.u16(l[i]);
            return s.toUint8Array();
        });
        return pack((offs) => {
            const s = new Sfnt().u16(ligs.length);
            for (const o of offs) s.u16(o);
            return s.toUint8Array();
        }, 2 + 2 * ligs.length, ligs);
    });
    return pack((offs) => {
        const s = new Sfnt().u16(1).u16(offs[0]).u16(gids.length);
        for (let i = 0; i < gids.length; i++) s.u16(offs[i + 1]);
        return s.toUint8Array();
    }, 6 + 2 * gids.length, [coverage1(gids), ...sets]);
}

function extension(innerType: number, inner: Uint8Array): Uint8Array {
    return concat([new Sfnt().u16(1).u16(innerType).u32(8).toUint8Array(), inner]);
}

function lookup(type: number, flag: number, subtables: Uint8Array[]): Uint8Array {
    return pack((offs) => {
        const s = new Sfnt().u16(type).u16(flag).u16(subtables.length);
        for (const o of offs) s.u16(o);
        return s.toUint8Array();
    }, 6 + 2 * subtables.length, subtables);
}

function lookupList(lookups: Uint8Array[]): Uint8Array {
    return pack((offs) => {
        const s = new Sfnt().u16(lookups.length);
        for (const o of offs) s.u16(o);
        return s.toUint8Array();
    }, 2 + 2 * lookups.length, lookups);
}

function featureList(features: { tag: string; lookups: number[] }[]): Uint8Array {
    const tables = features.map(f => {
        const s = new Sfnt().u16(0).u16(f.lookups.length);
        for (const i of f.lookups) s.u16(i);
        return s.toUint8Array();
    });
    return pack((offs) => {
        const s = new Sfnt().u16(features.length);
        features.forEach((f, i) => s.tag(f.tag).u16(offs[i]));
        return s.toUint8Array();
    }, 2 + 6 * features.length, tables);
}

/** Each script carries one default LangSys naming `features` (indices into the FeatureList). */
function scriptList(scripts: { tag: string; features: number[] }[]): Uint8Array {
    const tables = scripts.map(sc => {
        const s = new Sfnt().u16(4).u16(0).u16(0).u16(0xFFFF).u16(sc.features.length);
        for (const i of sc.features) s.u16(i);
        return s.toUint8Array();
    });
    return pack((offs) => {
        const s = new Sfnt().u16(scripts.length);
        scripts.forEach((sc, i) => s.tag(sc.tag).u16(offs[i]));
        return s.toUint8Array();
    }, 2 + 6 * scripts.length, tables);
}

function layoutTable(scripts: Uint8Array, features: Uint8Array, lookups: Uint8Array): Uint8Array {
    return pack(([s, f, l]) => new Sfnt().u32(0x00010000).u16(s).u16(f).u16(l).toUint8Array(), 10, [scripts, features, lookups]);
}

interface MarkSpec { gid: number; cls: number; x: number; y: number; }
interface BaseSpec { gid: number; anchors: Record<number, [number, number]>; }

/** MarkBasePos / MarkMarkPos format 1 (the two share a layout). Inputs are sorted by gid. */
function markPos1(marks: MarkSpec[], bases: BaseSpec[], classCount: number): Uint8Array {
    const ms = [...marks].sort((a, b) => a.gid - b.gid);
    const bs = [...bases].sort((a, b) => a.gid - b.gid);
    const markArray = (() => {
        const n = ms.length;
        const s = new Sfnt().u16(n);
        for (let i = 0; i < n; i++) s.u16(ms[i].cls).u16(2 + 4 * n + 6 * i);
        for (const m of ms) s.u16(1).i16(m.x).i16(m.y);
        return s.toUint8Array();
    })();
    const baseArray = (() => {
        const n = bs.length;
        const headerSize = 2 + 2 * n * classCount;
        const anchors: [number, number][] = [];
        const recs: number[][] = bs.map(b => {
            const rec: number[] = [];
            for (let c = 0; c < classCount; c++) {
                const a = b.anchors[c];
                if (a) { rec.push(headerSize + 6 * anchors.length); anchors.push(a); } else rec.push(0);
            }
            return rec;
        });
        const s = new Sfnt().u16(n);
        for (const rec of recs) for (const o of rec) s.u16(o);
        for (const a of anchors) s.u16(1).i16(a[0]).i16(a[1]);
        return s.toUint8Array();
    })();
    return pack(([mc, bc, ma, ba]) => new Sfnt().u16(1).u16(mc).u16(bc).u16(classCount).u16(ma).u16(ba).toUint8Array(), 12,
        [coverage1(ms.map(m => m.gid)), coverage1(bs.map(b => b.gid)), markArray, baseArray]);
}

function gdefMarks(ranges: [number, number][]): Uint8Array {
    const s = new Sfnt().u16(1).u16(0).u16(12).u16(0).u16(0).u16(0).u16(2).u16(ranges.length);
    for (const [a, b] of ranges) s.u16(a).u16(b).u16(3);
    return s.toUint8Array();
}

// Glyph roles in the layout font (20 glyphs, U+0041–U+0053 → 1–19).
const RA = 2, VIRAMA = 3, KA = 4, SSA = 5, I = 6, ACUTE = 7, GRAVE = 8, E = 9;
const REPH = 10, RAKAR = 11, KSSA = 12, DOTLESS_I = 13, SPLIT = 14;

/** ChainContextSubst format 3: coverage-based backtrack / input / lookahead, then records. */
function chainContext3(bt: number[][], inp: number[][], la: number[][], records: [number, number][]): Uint8Array {
    const covs = [...bt, ...la, ...inp].map(coverage1);
    // Layout: header, then the coverages in the order they are referenced.
    const headerSize = 2 + 2 + 2 * bt.length + 2 + 2 * inp.length + 2 + 2 * la.length + 2 + 4 * records.length;
    const ordered = [...bt.map(coverage1), ...inp.map(coverage1), ...la.map(coverage1)];
    void covs;
    return pack((offs) => {
        const s = new Sfnt().u16(3);
        s.u16(bt.length); for (let k = 0; k < bt.length; k++) s.u16(offs[k]);
        s.u16(inp.length); for (let k = 0; k < inp.length; k++) s.u16(offs[bt.length + k]);
        s.u16(la.length); for (let k = 0; k < la.length; k++) s.u16(offs[bt.length + inp.length + k]);
        s.u16(records.length); for (const [seq, li] of records) s.u16(seq).u16(li);
        return s.toUint8Array();
    }, headerSize, ordered);
}

/** ContextSubst format 1: per-glyph rules (glyphCount, substCount, input[1..], records). */
function context1(rules: { first: number; input: number[]; records: [number, number][] }[]): Uint8Array {
    const firsts = [...new Set(rules.map(r => r.first))].sort((a, b) => a - b);
    const sets = firsts.map(f => {
        const own = rules.filter(r => r.first === f).map(r => {
            const s = new Sfnt().u16(r.input.length + 1).u16(r.records.length);
            for (const g of r.input) s.u16(g);
            for (const [seq, li] of r.records) s.u16(seq).u16(li);
            return s.toUint8Array();
        });
        return pack((offs) => { const s = new Sfnt().u16(own.length); for (const o of offs) s.u16(o); return s.toUint8Array(); }, 2 + 2 * own.length, own);
    });
    return pack((offs) => {
        const s = new Sfnt().u16(1).u16(offs[0]).u16(firsts.length);
        for (let k = 0; k < firsts.length; k++) s.u16(offs[k + 1]);
        return s.toUint8Array();
    }, 6 + 2 * firsts.length, [coverage1(firsts), ...sets]);
}

const ACUTE_ON_E = 18, HALF_KA = 19;

function layoutGsub(): Uint8Array {
    const lookups = lookupList([
        lookup(4, 0, [ligatureSubst1({ [RA]: [[REPH, VIRAMA]] })]),              // 0 rphf: Ra + virama → reph
        lookup(4, 0, [ligatureSubst1({ [RA]: [[RAKAR, VIRAMA]] })]),             // 1 blwf: the same input → rakar
        lookup(7, 8, [extension(4, ligatureSubst1({ [KA]: [[KSSA, VIRAMA, SSA]] }))]), // 2 akhn behind Extension, IgnoreMarks
        lookup(2, 0, [multipleSubst1({ [SPLIT]: [15, 16] })]),                   // 3 pres: a split form
        lookup(1, 0, [singleSubst2({ [I]: DOTLESS_I })]),                        // 4 ccmp, shared by three scripts
        lookup(1, 0, [singleSubst2({ [SSA]: 17 })]),                             // 5 rphf under DFLT only — must be dropped
        // 6 half: ChainContext format 3 — Ka before a virama, not after Ra → nested 8 (reached by no feature)
        lookup(6, 0, [chainContext3([[RA]], [[KA], [VIRAMA]], [[SSA, I]], [[0, 8]])]),
        // 7 psts: Context format 1 — E followed by ACUTE → nested 9 on the mark
        lookup(5, 0, [context1([{ first: E, input: [ACUTE], records: [[1, 9]] }])]),
        lookup(1, 0, [singleSubst2({ [KA]: HALF_KA })]),                         // 8 nested only
        lookup(1, 0, [singleSubst2({ [ACUTE]: ACUTE_ON_E })]),                   // 9 nested only
    ]);
    const features = featureList([
        { tag: 'rphf', lookups: [0] }, { tag: 'blwf', lookups: [1] }, { tag: 'akhn', lookups: [2] },
        { tag: 'pres', lookups: [3] }, { tag: 'ccmp', lookups: [4] }, { tag: 'rphf', lookups: [5] },
        { tag: 'half', lookups: [6] }, { tag: 'psts', lookups: [7] },
    ]);
    const scripts = scriptList([
        { tag: 'DFLT', features: [4, 5] },
        { tag: 'dev2', features: [3, 0, 1, 2, 4, 6, 7] },
        { tag: 'latn', features: [4] },
    ]);
    return layoutTable(scripts, features, lookups);
}

function layoutGpos(): Uint8Array {
    const lookups = lookupList([
        // Two MarkToBase subtables, each calling its only class "0".
        lookup(4, 0, [markPos1([{ gid: ACUTE, cls: 0, x: 0, y: 500 }], [{ gid: E, anchors: { 0: [300, 600] } }], 1)]),
        lookup(4, 0, [markPos1(
            [{ gid: ACUTE, cls: 0, x: 5, y: 480 }, { gid: GRAVE, cls: 0, x: 0, y: -50 }],
            [{ gid: E, anchors: { 0: [300, -100] } }], 1)]),
        // MarkToMark behind an Extension: grave stacks on acute.
        lookup(9, 0, [extension(6, markPos1([{ gid: GRAVE, cls: 0, x: 0, y: -20 }], [{ gid: ACUTE, anchors: { 0: [0, 700] } }], 1))]),
    ]);
    return layoutTable(scriptList([]), featureList([]), lookups);
}

function layoutFont(): Uint8Array {
    const head = new Sfnt().zeros(18).u16(1000).zeros(16).i16(0).i16(-200).i16(1000).i16(800).zeros(10).toUint8Array();
    const hhea = new Sfnt().u32(0x00010000).i16(800).i16(-200).zeros(26).u16(20).toUint8Array();
    const maxp = new Sfnt().u32(0x00005000).u16(20).zeros(26).toUint8Array();
    const hmtx = new Sfnt();
    for (let i = 0; i < 20; i++) hmtx.u16(600).i16(0);
    const cmap = new Sfnt().u16(0).u16(1).u16(3).u16(10).u32(12)
        .u16(12).u16(0).u32(28).u32(0).u32(1).u32(0x41).u32(0x53).u32(1).toUint8Array();
    return sfnt({ head, hhea, maxp, hmtx: hmtx.toUint8Array(), cmap, GSUB: layoutGsub(), GPOS: layoutGpos(), GDEF: gdefMarks([[ACUTE, GRAVE]]) });
}

describe('OpenType Layout tables and GPOS mark classes (v1.8.0)', () => {
    const bytes = layoutFont();
    const data = parseFontData(bytes, { fontName: 'Layout' });
    const otl = data.otl!;

    it('keeps rphf and blwf apart although both consume Ra + virama', () => {
        expect(otl).not.toBeNull();
        const rphf = otl.gsub.lookups[otl.gsub.scripts['dev2']['rphf'][0]];
        const blwf = otl.gsub.lookups[otl.gsub.scripts['dev2']['blwf'][0]];
        expect(rphf).toEqual({ t: 4, f: 0, m: { [RA]: [[REPH, VIRAMA]] } });
        expect(blwf).toEqual({ t: 4, f: 0, m: { [RA]: [[RAKAR, VIRAMA]] } });
        // The flat table cannot: it holds both under the same first glyph.
        expect(data.ligatures[RA]).toHaveLength(2);
    });

    it('resolves an Extension lookup and keeps its lookupFlag', () => {
        expect(otl.gsub.lookups[otl.gsub.scripts['dev2']['akhn'][0]]).toEqual({ t: 4, f: 8, m: { [KA]: [[KSSA, VIRAMA, SSA]] } });
    });

    it('reads Multiple substitutions', () => {
        expect(otl.gsub.lookups[otl.gsub.scripts['dev2']['pres'][0]]).toEqual({ t: 2, f: 0, m: { [SPLIT]: [15, 16] } });
    });

    it('serialises a lookup shared by several scripts once, under each script', () => {
        expect(otl.gsub.scripts['DFLT']['ccmp']).toEqual([4]);
        expect(otl.gsub.scripts['dev2']['ccmp']).toEqual([4]);
        expect(otl.gsub.scripts['latn']['ccmp']).toEqual([4]);
        expect(Object.keys(otl.gsub.lookups).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9]);
    });

    it('reads a chained context (format 3) with its backtrack, input, lookahead and nested lookup', () => {
        const half = otl.gsub.lookups[6];
        expect(half.t).toBe(6);
        if (half.t !== 6) return;
        expect(half.m).toHaveLength(1);
        const rule = half.m[0];
        const set = (idx: number): readonly number[] => otl.gsub.sets![idx];
        expect(rule.b.map(set)).toEqual([[RA, RA]]);
        expect(rule.i.map(set)).toEqual([[KA, KA], [VIRAMA, VIRAMA]]);
        expect(rule.l.map(set)).toEqual([[SSA, I]]);                  // a coverage of 5 and 6 → one merged range
        expect(rule.a).toEqual([[0, 8]]);
        // The nested lookup is serialised although no feature lists it.
        expect(otl.gsub.lookups[8]).toEqual({ t: 1, f: 0, m: { [KA]: HALF_KA } });
    });

    it('reads a plain context (format 1) in the same chained shape', () => {
        const psts = otl.gsub.lookups[7];
        expect(psts.t).toBe(6);
        if (psts.t !== 6) return;
        const rule = psts.m[0];
        const set = (idx: number): readonly number[] => otl.gsub.sets![idx];
        expect(rule.b).toEqual([]);
        expect(rule.l).toEqual([]);
        expect(rule.i.map(set)).toEqual([[E, E], [ACUTE, ACUTE]]);
        expect(rule.a).toEqual([[1, 9]]);
        expect(otl.gsub.lookups[9]).toEqual({ t: 1, f: 0, m: { [ACUTE]: ACUTE_ON_E } });
    });

    it('shares identical glyph sets between rules through the set pool', () => {
        const sets = otl.gsub.sets!;
        expect(new Set(sets.map(s => s.join(','))).size).toBe(sets.length);
    });

    it('keeps only ccmp under DFLT and latn', () => {
        expect(otl.gsub.scripts['DFLT']).toEqual({ ccmp: [4] });
        expect(otl.gsub.scripts['latn']).toEqual({ ccmp: [4] });
        expect(otl.gsub.lookups[5]).toBeUndefined();
    });

    it('lists feature lookups in ascending index order whatever the LangSys order', () => {
        expect(Object.keys(otl.gsub.scripts['dev2'])).toEqual(['pres', 'rphf', 'blwf', 'akhn', 'ccmp', 'half', 'psts']);
    });

    it('carries the GDEF mark class as glyph ranges', () => {
        expect(otl.gdef).toEqual({ marks: [[ACUTE, GRAVE]] });
    });

    it('keeps mark classes distinct across MarkToBase subtables and merges base anchors', () => {
        expect(data.markAnchors.marks[ACUTE]).toEqual([0, 0, 500, 1, 5, 480]);
        expect(data.markAnchors.marks[GRAVE]).toEqual([1, 0, -50]);
        expect(data.markAnchors.bases[E]).toEqual({ 0: [300, 600], 1: [300, -100] });
    });

    it('resolves an Extension positioning lookup to its MarkToMark subtable', () => {
        expect(data.mark2mark.mark2Classes[GRAVE]).toEqual([0, 0, -20]);
        expect(data.mark2mark.mark1Anchors[ACUTE]).toEqual({ 0: [0, 700] });
    });

    it('emits the otl export in the module source', () => {
        const src = compileFontData(bytes, { fontName: 'Layout' });
        expect(src).toContain('export const otl = {gsub:{scripts:{"DFLT":{"ccmp":[4]},"dev2":{"pres":[3],"rphf":[0],"blwf":[1],"akhn":[2],"ccmp":[4],"half":[6],"psts":[7]},"latn":{"ccmp":[4]}},lookups:{');
        expect(src).toContain('6:{t:6,f:0,m:[{b:[0],i:[1,2],l:[3],a:[[0,8]]}]}');
        expect(src).toContain(',sets:[[2,2],[4,4],[3,3],[5,6],[9,9],[7,7]]');
        expect(src).toContain('gdef:{marks:[[7,8]]}');
        const cjs = compileFontData(bytes, { fontName: 'Layout', format: 'cjs' });
        expect(cjs).toContain('module.exports = { metrics, fontName, cmap, defaultWidth, widths, gsub, ligatures, features, kern, markAnchors, mark2mark, otl, pdfWidthArray, ttfBase64, getGlyphWidth, getGlyphId };');
    });

    it('is byte-identical to what the reference CLI writes for the same font', async () => {
        const os = (await import('node:' + 'os')) as { tmpdir(): string };
        const path = (await import('node:' + 'path')) as { join(...p: string[]): string };
        const cp = (await import('node:' + 'child_process')) as { spawnSync(cmd: string, args: string[], o: object): { status: number | null } };
        const nfs = (await import('node:' + 'fs')) as {
            mkdtempSync(p: string): string; writeFileSync(p: string, d: Uint8Array): void;
            readFileSync(p: string, e: string): string; rmSync(p: string, o: object): void;
        };
        const dir = nfs.mkdtempSync(path.join(os.tmpdir(), 'pdfnative-layout-'));
        try {
            const ttf = path.join(dir, 'Layout.ttf');
            const out = path.join(dir, 'layout-data.js');
            nfs.writeFileSync(ttf, bytes);
            const run = cp.spawnSync(process.execPath, ['tools/build-font-data.cjs', ttf, out], { stdio: 'ignore' });
            expect(run.status).toBe(0);
            expect(nfs.readFileSync(out, 'utf8')).toBe(compileFontData(bytes, { fontName: 'Layout' }));
        } finally {
            nfs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
