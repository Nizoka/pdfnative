/**
 * Visual-regression helper — minimal grayscale PNG encode/decode.
 *
 * Zero third-party dependency: IDAT compression uses Node's built-in `zlib`
 * (this is test-only tooling, never shipped). Encodes/decodes 8-bit grayscale
 * (colour type 0) PNGs with filter type 0 (None) per scanline — sufficient
 * for committing compact, human-inspectable baseline images of rendered text
 * geometry.
 *
 * TEST-ONLY tooling — not part of the published library.
 */

import zlib from 'node:zlib';
import type { Bitmap } from './raster.js';

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── CRC-32 (PNG polynomial) ──────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
    const body = new Uint8Array(typeBytes.length + data.length);
    body.set(typeBytes, 0);
    body.set(data, typeBytes.length);
    const out = new Uint8Array(8 + data.length + 4);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(body, 4);
    dv.setUint32(out.length - 4, crc32(body));
    return out;
}

/** Encode a grayscale bitmap as a PNG byte array. */
export function encodePng(bmp: Bitmap): Uint8Array {
    const { width, height, data } = bmp;

    // IHDR: width, height, bitDepth=8, colorType=0 (grayscale), 0,0,0
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 0;

    // Raw scanlines with filter byte 0 prefixed.
    const raw = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (width + 1)] = 0;
        raw.set(data.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
    }
    const idat = new Uint8Array(zlib.deflateSync(raw));

    const parts = [PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

/** Decode a grayscale (colour type 0, filter 0) PNG to a {@link Bitmap}. */
export function decodePng(bytes: Uint8Array): Bitmap {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8; // skip signature
    let width = 0, height = 0;
    const idatParts: Uint8Array[] = [];

    while (pos < bytes.length) {
        const len = dv.getUint32(pos);
        const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
        const dataStart = pos + 8;
        if (type === 'IHDR') {
            width = dv.getUint32(dataStart);
            height = dv.getUint32(dataStart + 4);
        } else if (type === 'IDAT') {
            idatParts.push(bytes.subarray(dataStart, dataStart + len));
        } else if (type === 'IEND') {
            break;
        }
        pos = dataStart + len + 4; // + CRC
    }

    const idat = idatParts.length === 1
        ? idatParts[0]
        : (() => {
            const total = idatParts.reduce((s, p) => s + p.length, 0);
            const merged = new Uint8Array(total);
            let o = 0;
            for (const p of idatParts) { merged.set(p, o); o += p.length; }
            return merged;
        })();

    const raw = new Uint8Array(zlib.inflateSync(idat));
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        // filter byte at start of each scanline is 0 (None)
        data.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
    }
    return { width, height, data };
}
