/**
 * Synthetic CMYK output profile — for samples and tests only
 * ==========================================================
 * The CMYK and PDF/X-4 samples need an output ICC profile, and pdfnative
 * can ship none: real press profiles (ISO Coated v2, GRACoL, SWOP) are large
 * and mostly licensed. This builds a small ICC v2 output profile (`prtr`,
 * CMYK data, Lab connection space) that is structurally complete — header,
 * tag table, `desc`, `cprt`, `wtpt`, and the `A2B0`, `B2A0` and `gamt`
 * lookup tables an output profile requires — so validators accept it.
 *
 * Its colour transform is the naive device conversion (CMYK ↔ sRGB, then
 * sRGB ↔ CIELAB under D50). It characterises no printing condition. Do not
 * use it for real print: supply the profile your printer names.
 *
 * Deterministic: the same bytes on every run.
 */

/** Growable big-endian byte writer. */
class Bytes {
    private readonly parts: number[] = [];
    get length(): number { return this.parts.length; }
    u8(v: number): this { this.parts.push(v & 0xFF); return this; }
    u16(v: number): this { return this.u8(v >> 8).u8(v); }
    u32(v: number): this { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
    s15f16(v: number): this { return this.u32(Math.round(v * 65536) >>> 0); }
    sig(s: string): this { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); return this; }
    zeros(n: number): this { for (let i = 0; i < n; i++) this.u8(0); return this; }
    bytes(b: readonly number[]): this { for (const v of b) this.u8(v); return this; }
    pad4(): this { while (this.parts.length % 4) this.u8(0); return this; }
    toArray(): number[] { return this.parts; }
}

const D50 = [0.9642, 1.0, 0.8249] as const;

// sRGB primaries adapted to D50 (the ICC sRGB profile's colorants).
const RGB_TO_XYZ = [
    [0.4360, 0.3851, 0.1431],
    [0.2225, 0.7169, 0.0606],
    [0.0139, 0.0971, 0.7141],
] as const;
const XYZ_TO_RGB = [
    [3.1339, -1.6169, -0.4906],
    [-0.9788, 1.9161, 0.0335],
    [0.0719, -0.2290, 1.4052],
] as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function cmykToLab(c: number, m: number, y: number, k: number): [number, number, number] {
    const rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)].map(toLinear);
    const xyz = RGB_TO_XYZ.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
    const [fx, fy, fz] = xyz.map((v, i) => f(v / D50[i]));
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToCmyk(L: number, a: number, b: number): [number, number, number, number] {
    const fy = (L + 16) / 116;
    const xyz = [fInv(fy + a / 500) * D50[0], fInv(fy) * D50[1], fInv(fy - b / 200) * D50[2]];
    const rgb = XYZ_TO_RGB.map(row => clamp01(toGamma(clamp01(row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]))));
    const k = 1 - Math.max(...rgb);
    if (k >= 1) return [0, 0, 0, 1];
    return [(1 - rgb[0] - k) / (1 - k), (1 - rgb[1] - k) / (1 - k), (1 - rgb[2] - k) / (1 - k), k];
}

/** lut8Type Lab encoding: L 0–100 → 0–255, a/b −128–127 → 0–255. */
const encodeLab = ([L, a, b]: readonly number[]): number[] => [
    Math.round(clamp01(L / 100) * 255),
    Math.round(Math.max(-128, Math.min(127, a)) + 128),
    Math.round(Math.max(-128, Math.min(127, b)) + 128),
];
const decodeLab = (bytes: readonly number[]): [number, number, number] => [bytes[0] * 100 / 255, bytes[1] - 128, bytes[2] - 128];

/** A lut8Type tag: identity curves and matrix around a sampled CLUT. */
function lut8(inCh: number, outCh: number, grid: number, sample: (inputs: number[]) => number[]): number[] {
    const w = new Bytes().sig('mft1').zeros(4).u8(inCh).u8(outCh).u8(grid).u8(0);
    for (const v of [1, 0, 0, 0, 1, 0, 0, 0, 1]) w.s15f16(v);
    for (let c = 0; c < inCh; c++) for (let i = 0; i < 256; i++) w.u8(i);
    // CLUT: the first input channel varies slowest.
    const total = grid ** inCh;
    for (let n = 0; n < total; n++) {
        const inputs: number[] = [];
        let rest = n;
        for (let c = inCh - 1; c >= 0; c--) {
            inputs[c] = Math.round((rest % grid) * 255 / (grid - 1));
            rest = Math.floor(rest / grid);
        }
        w.bytes(sample(inputs));
    }
    for (let c = 0; c < outCh; c++) for (let i = 0; i < 256; i++) w.u8(i);
    return w.toArray();
}

function textDescription(text: string): number[] {
    return new Bytes().sig('desc').zeros(4).u32(text.length + 1).bytes([...text].map(ch => ch.charCodeAt(0))).u8(0)
        .u32(0).u32(0).u16(0).u8(0).zeros(67).toArray();
}

/**
 * Build the synthetic CMYK output profile.
 *
 * @returns ICC v2.1 profile bytes (about 9 KB).
 */
export function buildSyntheticCmykProfile(): Uint8Array {
    const unit = (v: number): number => v / 255;
    const tags: Array<[string, number[]]> = [
        ['desc', textDescription('pdfnative synthetic CMYK (samples only, not a press condition)')],
        ['cprt', new Bytes().sig('text').zeros(4).bytes([...'No copyright, use freely'].map(ch => ch.charCodeAt(0))).u8(0).toArray()],
        ['wtpt', new Bytes().sig('XYZ ').zeros(4).s15f16(D50[0]).s15f16(D50[1]).s15f16(D50[2]).toArray()],
        ['A2B0', lut8(4, 3, 5, ([c, m, y, k]) => encodeLab(cmykToLab(unit(c), unit(m), unit(y), unit(k))))],
        ['B2A0', lut8(3, 4, 9, lab => labToCmyk(...decodeLab(lab)).map(v => Math.round(clamp01(v) * 255)))],
        ['gamt', lut8(3, 1, 2, () => [0])],
    ];

    const tableSize = 4 + tags.length * 12;
    let offset = 128 + tableSize;
    const table = new Bytes().u32(tags.length);
    const data = new Bytes();
    for (const [sig, body] of tags) {
        while ((offset + data.length) % 4) data.u8(0);
        table.sig(sig).u32(offset + data.length).u32(body.length);
        data.bytes(body);
    }
    data.pad4();
    const size = 128 + tableSize + data.length;
    offset = 0;

    const header = new Bytes()
        .u32(size).zeros(4).u32(0x02100000).sig('prtr').sig('CMYK').sig('Lab ')
        .u16(2026).u16(1).u16(1).u16(0).u16(0).u16(0)
        .sig('acsp').zeros(4).u32(0).zeros(4).zeros(4).zeros(8).u32(0)
        .s15f16(D50[0]).s15f16(D50[1]).s15f16(D50[2])
        .zeros(4).zeros(44);

    return new Uint8Array([...header.toArray(), ...table.toArray(), ...data.toArray()]);
}
