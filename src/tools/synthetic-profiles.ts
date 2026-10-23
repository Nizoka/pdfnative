/**
 * Synthetic ICC output profiles — for samples, tests and fixtures only
 * ====================================================================
 * CMYK, Gray and PDF/X-4 documents need an output ICC profile, and pdfnative
 * can ship none: real press profiles (ISO Coated v2, GRACoL, SWOP) are large
 * and mostly licensed. These builders write small ICC v2 output profiles
 * (`prtr` class) that are structurally complete, so validators accept them:
 *
 * - {@link buildSyntheticCmykProfile} — CMYK data, Lab connection space,
 *   `desc`, `cprt`, `wtpt` and the `A2B0`, `B2A0`, `gamt` lookup tables an
 *   output profile requires (about 9 KB). Its colour transform is the naive
 *   device conversion (CMYK ↔ sRGB, then sRGB ↔ CIELAB under D50).
 * - {@link buildSyntheticGrayProfile} — GRAY data, XYZ connection space,
 *   `desc`, `cprt`, `wtpt` (D50) and a gamma 2.2 `kTRC` (a few hundred bytes).
 *   Monochrome PDF/X-4 and PDF/A fixtures, and the `PDFX_DEVICE_CMYK`
 *   diagnostic (CMYK content under a non-CMYK intent) (#86).
 *
 * Neither characterises a printing condition. Do not use them for real
 * print: supply the profile your printer names. Deterministic: the same
 * bytes on every run, on every host. Exported from `pdfnative/tools` since
 * 1.9.0 so downstream packages stop vendoring their own copies.
 *
 * @module tools/synthetic-profiles
 * @since 1.8.0 (CMYK, as a script helper) · 1.9.0 (Gray; `pdfnative/tools` export)
 */

/** Growable big-endian byte writer (pure functions over a number array). */
type Bytes = number[];

const u8 = (w: Bytes, v: number): Bytes => { w.push(v & 0xFF); return w; };
const u16 = (w: Bytes, v: number): Bytes => u8(u8(w, v >> 8), v);
const u32 = (w: Bytes, v: number): Bytes => u8(u8(u8(u8(w, v >>> 24), v >>> 16), v >>> 8), v);
const s15f16 = (w: Bytes, v: number): Bytes => u32(w, Math.round(v * 65536) >>> 0);
const sig = (w: Bytes, s: string): Bytes => { for (let i = 0; i < 4; i++) u8(w, s.charCodeAt(i)); return w; };
const zeros = (w: Bytes, n: number): Bytes => { for (let i = 0; i < n; i++) u8(w, 0); return w; };
const bytes = (w: Bytes, b: readonly number[]): Bytes => { for (const v of b) u8(w, v); return w; };
const ascii = (s: string): number[] => [...s].map(ch => ch.charCodeAt(0) & 0x7F);

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
const decodeLab = (b: readonly number[]): [number, number, number] => [b[0] * 100 / 255, b[1] - 128, b[2] - 128];

/** A lut8Type tag: identity curves and matrix around a sampled CLUT. */
function lut8(inCh: number, outCh: number, grid: number, sample: (inputs: number[]) => number[]): number[] {
    const w: Bytes = [];
    sig(w, 'mft1'); zeros(w, 4); u8(w, inCh); u8(w, outCh); u8(w, grid); u8(w, 0);
    for (const v of [1, 0, 0, 0, 1, 0, 0, 0, 1]) s15f16(w, v);
    for (let c = 0; c < inCh; c++) for (let i = 0; i < 256; i++) u8(w, i);
    // CLUT: the first input channel varies slowest.
    const total = grid ** inCh;
    for (let n = 0; n < total; n++) {
        const inputs: number[] = [];
        let rest = n;
        for (let c = inCh - 1; c >= 0; c--) {
            inputs[c] = Math.round((rest % grid) * 255 / (grid - 1));
            rest = Math.floor(rest / grid);
        }
        bytes(w, sample(inputs));
    }
    for (let c = 0; c < outCh; c++) for (let i = 0; i < 256; i++) u8(w, i);
    return w;
}

/** A textDescriptionType (`desc`) tag, ASCII only, Unicode and ScriptCode parts empty. */
function textDescription(text: string): number[] {
    const w: Bytes = [];
    sig(w, 'desc'); zeros(w, 4); u32(w, text.length + 1); bytes(w, ascii(text)); u8(w, 0);
    u32(w, 0); u32(w, 0); u16(w, 0); u8(w, 0); zeros(w, 67);
    return w;
}

/** A textType (`cprt`) tag. */
function textTag(text: string): number[] {
    const w: Bytes = [];
    sig(w, 'text'); zeros(w, 4); bytes(w, ascii(text)); u8(w, 0);
    return w;
}

/** An XYZType tag holding one XYZ number. */
function xyzTag(xyz: readonly [number, number, number]): number[] {
    const w: Bytes = [];
    sig(w, 'XYZ '); zeros(w, 4); s15f16(w, xyz[0]); s15f16(w, xyz[1]); s15f16(w, xyz[2]);
    return w;
}

/** A curveType tag with a single u8Fixed8 gamma value. */
function gammaCurve(gamma: number): number[] {
    const w: Bytes = [];
    sig(w, 'curv'); zeros(w, 4); u32(w, 1); u16(w, Math.round(gamma * 256));
    return w;
}

/**
 * Assemble an ICC v2.1 profile: 128-byte header, tag table, 4-byte-aligned
 * tag data. `deviceClass` is `prtr`, `dataSpace` CMYK or GRAY, `pcs` Lab or
 * XYZ. The creation date is fixed (2026-01-01) so the bytes never move.
 */
function assembleProfile(dataSpace: string, pcs: string, tags: ReadonlyArray<readonly [string, number[]]>): Uint8Array {
    const tableSize = 4 + tags.length * 12;
    const table: Bytes = [];
    u32(table, tags.length);
    const data: Bytes = [];
    const base = 128 + tableSize;
    for (const [tag, body] of tags) {
        while ((base + data.length) % 4) u8(data, 0);
        sig(table, tag); u32(table, base + data.length); u32(table, body.length);
        bytes(data, body);
    }
    while (data.length % 4) u8(data, 0);
    const size = 128 + tableSize + data.length;

    const header: Bytes = [];
    u32(header, size); zeros(header, 4); u32(header, 0x02100000);
    sig(header, 'prtr'); sig(header, dataSpace); sig(header, pcs);
    u16(header, 2026); u16(header, 1); u16(header, 1); u16(header, 0); u16(header, 0); u16(header, 0);
    sig(header, 'acsp'); zeros(header, 4); u32(header, 0); zeros(header, 4); zeros(header, 4); zeros(header, 8); u32(header, 0);
    s15f16(header, D50[0]); s15f16(header, D50[1]); s15f16(header, D50[2]);
    zeros(header, 4); zeros(header, 44);

    return new Uint8Array([...header, ...table, ...data]);
}

/**
 * Build the synthetic CMYK output profile: `prtr` class, CMYK data colour
 * space, Lab connection space, `desc`, `cprt`, `wtpt`, `A2B0`, `B2A0` and
 * `gamt`. A structural stand-in for samples and tests — not a press
 * condition.
 *
 * @returns ICC v2.1 profile bytes (about 9 KB), identical on every run.
 * @since 1.8.0 (script helper) · 1.9.0 (`pdfnative/tools`)
 */
export function buildSyntheticCmykProfile(): Uint8Array {
    const unit = (v: number): number => v / 255;
    return assembleProfile('CMYK', 'Lab ', [
        ['desc', textDescription('pdfnative synthetic CMYK (samples only, not a press condition)')],
        ['cprt', textTag('No copyright, use freely')],
        ['wtpt', xyzTag(D50)],
        ['A2B0', lut8(4, 3, 5, ([c, m, y, k]) => encodeLab(cmykToLab(unit(c), unit(m), unit(y), unit(k))))],
        ['B2A0', lut8(3, 4, 9, lab => labToCmyk(...decodeLab(lab)).map(v => Math.round(clamp01(v) * 255)))],
        ['gamt', lut8(3, 1, 2, () => [0])],
    ]);
}

/**
 * Build the synthetic Gray output profile: `prtr` class, GRAY data colour
 * space, XYZ connection space, `desc`, `cprt`, `wtpt` (D50) and a gamma 2.2
 * `kTRC` — the four tags ICC.1:2001-04 §6.3.1 requires of a monochrome
 * output profile. A structural stand-in for monochrome PDF/X-4 and PDF/A
 * fixtures (#86) — not a press condition.
 *
 * @returns ICC v2.1 profile bytes, identical on every run.
 * @since 1.9.0
 */
export function buildSyntheticGrayProfile(): Uint8Array {
    return assembleProfile('GRAY', 'XYZ ', [
        ['desc', textDescription('pdfnative synthetic Gray (samples only, not a press condition)')],
        ['cprt', textTag('No copyright, use freely')],
        ['wtpt', xyzTag(D50)],
        ['kTRC', gammaCurve(2.2)],
    ]);
}
