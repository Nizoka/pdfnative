/**
 * Synthetic image generators for sample PDFs.
 */

/** Minimal valid 2×2 RGB JPEG for image embedding samples */
export function makeMinimalJPEG(): Uint8Array {
    return new Uint8Array([
        // SOI
        0xFF, 0xD8,
        // APP0 JFIF
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
        0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        // DQT – quantization table 0 (standard luminance)
        0xFF, 0xDB, 0x00, 0x43, 0x00,
        0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07,
        0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
        0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13,
        0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
        0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22,
        0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C,
        0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39,
        0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
        // SOF0 – 2×2 RGB, all 3 components use QT table 0
        0xFF, 0xC0, 0x00, 0x11, 0x08,
        0x00, 0x02, 0x00, 0x02,
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
        // DHT – DC Huffman table 0 (standard luminance)
        0xFF, 0xC4, 0x00, 0x1F, 0x00,
        0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B,
        // DHT – AC Huffman table 0 (minimal: 1 symbol = EOB)
        0xFF, 0xC4, 0x00, 0x14, 0x10,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
        // SOS – all 3 components use DC table 0 + AC table 0
        0xFF, 0xDA, 0x00, 0x0C, 0x03,
        0x01, 0x00, 0x02, 0x00, 0x03, 0x00,
        0x00, 0x3F, 0x00,
        // Scan data: 3 blocks of (DC=0 + EOB), padded with 1-bits
        0x00, 0x7F,
        // EOI
        0xFF, 0xD9,
    ]);
}

/**
 * Generate a valid JPEG of approximately `targetSize` bytes.
 * Uses the minimal 2×2 JPEG header and pads the scan data segment to reach the target size.
 */
export function makeLargeJPEG(targetSize: number): Uint8Array {
    const header = [
        0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
        0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xDB, 0x00, 0x43, 0x00,
        0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07,
        0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
        0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13,
        0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
        0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22,
        0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C,
        0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39,
        0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
        0xFF, 0xC0, 0x00, 0x11, 0x08,
        0x00, 0x02, 0x00, 0x02,
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
        0xFF, 0xC4, 0x00, 0x1F, 0x00,
        0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B,
        0xFF, 0xC4, 0x00, 0x14, 0x10,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00,
        0xFF, 0xDA, 0x00, 0x0C, 0x03,
        0x01, 0x00, 0x02, 0x00, 0x03, 0x00,
        0x00, 0x3F, 0x00,
        0x00, 0x7F,
    ];
    const headerLen = header.length;
    const trailerLen = 2; // EOI: 0xFF 0xD9
    const padLen = Math.max(0, targetSize - headerLen - trailerLen);

    const result = new Uint8Array(headerLen + padLen + trailerLen);
    result.set(header);
    for (let i = headerLen; i < headerLen + padLen; i++) result[i] = 0x42;
    result[result.length - 2] = 0xFF;
    result[result.length - 1] = 0xD9;
    return result;
}

/** Minimal valid 4×4 RGB PNG (no alpha) for image embedding samples. */
export function makeSyntheticPNG(): Uint8Array {
    const w = 4, h = 4;
    const raw: number[] = [];
    for (let y = 0; y < h; y++) {
        raw.push(0); // filter: None
        for (let x = 0; x < w; x++) {
            raw.push(Math.floor((x / w) * 255));
            raw.push(Math.floor((y / h) * 255));
            raw.push(128);
        }
    }
    const rawBytes = new Uint8Array(raw);
    const len = rawBytes.length;
    const lo = len & 0xFF, hi = (len >> 8) & 0xFF;
    const nlo = (~len) & 0xFF, nhi = ((~len) >> 8) & 0xFF;
    let s1 = 1, s2 = 0;
    for (let i = 0; i < len; i++) { s1 = (s1 + rawBytes[i]) % 65521; s2 = (s2 + s1) % 65521; }
    const adler = ((s2 << 16) | s1) >>> 0;
    const zlibData = new Uint8Array([
        0x78, 0x01,
        0x01,
        lo, hi, nlo, nhi,
        ...rawBytes,
        (adler >> 24) & 0xFF, (adler >> 16) & 0xFF, (adler >> 8) & 0xFF, adler & 0xFF,
    ]);

    function crc32(data: Uint8Array): number {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function makeChunk(type: string, data: Uint8Array): Uint8Array {
        const typeBytes = new Uint8Array([...type].map(c => c.charCodeAt(0)));
        const combined = new Uint8Array(typeBytes.length + data.length);
        combined.set(typeBytes); combined.set(data, 4);
        const crc = crc32(combined);
        const chunk = new Uint8Array(4 + 4 + data.length + 4);
        chunk[0] = (data.length >> 24) & 0xFF;
        chunk[1] = (data.length >> 16) & 0xFF;
        chunk[2] = (data.length >> 8) & 0xFF;
        chunk[3] = data.length & 0xFF;
        chunk.set(typeBytes, 4);
        chunk.set(data, 8);
        chunk[8 + data.length] = (crc >> 24) & 0xFF;
        chunk[8 + data.length + 1] = (crc >> 16) & 0xFF;
        chunk[8 + data.length + 2] = (crc >> 8) & 0xFF;
        chunk[8 + data.length + 3] = crc & 0xFF;
        return chunk;
    }

    const ihdrData = new Uint8Array(13);
    new DataView(ihdrData.buffer).setUint32(0, w);
    new DataView(ihdrData.buffer).setUint32(4, h);
    ihdrData[8] = 8; ihdrData[9] = 2;
    ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;

    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = makeChunk('IHDR', ihdrData);
    const idat = makeChunk('IDAT', zlibData);
    const iend = makeChunk('IEND', new Uint8Array(0));

    const result = new Uint8Array(sig.length + ihdr.length + idat.length + iend.length);
    let offset = 0;
    result.set(sig, offset); offset += sig.length;
    result.set(ihdr, offset); offset += ihdr.length;
    result.set(idat, offset); offset += idat.length;
    result.set(iend, offset);
    return result;
}

// ── JPEG 2000 (v1.9.0) ───────────────────────────────────────────────

/** Big-endian helpers for the fixtures below. */
const u16 = (n: number): number[] => [(n >>> 8) & 0xFF, n & 0xFF];
const u32 = (n: number): number[] => [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
const fourcc = (s: string): number[] => Array.from(s, c => c.charCodeAt(0));
const box = (type: string, body: readonly number[]): number[] => [...u32(8 + body.length), ...fourcc(type), ...body];

/**
 * A minimal, valid JPEG 2000 codestream (ISO/IEC 15444-1): `size` × `size`
 * pixels, `components` 8-bit unsigned components, one tile, one quality
 * layer, no wavelet decomposition, the reversible 5/3 transform and no
 * quantization. Every packet is empty, so every coefficient is zero and the
 * image decodes to mid grey (128 after the DC level shift) in each
 * component — a flat tone any JPEG 2000 decoder reproduces, which is what a
 * pass-through fixture needs: the engine never decodes it.
 */
export function makeMinimalJ2K(components = 1, size = 8): Uint8Array {
    const siz = [
        ...u16(38 + 3 * components), ...u16(0),
        ...u32(size), ...u32(size), ...u32(0), ...u32(0),       // image size and offset
        ...u32(size), ...u32(size), ...u32(0), ...u32(0),       // one tile covering the image
        ...u16(components),
    ];
    for (let c = 0; c < components; c++) siz.push(0x07, 0x01, 0x01); // 8-bit unsigned, no subsampling
    const cod = [...u16(12), 0x00, 0x00, ...u16(1), components === 3 ? 0x01 : 0x00, 0x00, 0x04, 0x04, 0x00, 0x01];
    const qcd = [...u16(4), 0x40, 0x40]; // no quantization, 2 guard bits; LL exponent 8
    const packets = Array.from({ length: components }, () => 0x00); // one empty packet per component
    const psot = 12 + 2 + packets.length; // SOT segment + SOD + data
    const sot = [...u16(10), ...u16(0), ...u32(psot), 0x00, 0x01];
    return new Uint8Array([
        0xFF, 0x4F,                 // SOC
        0xFF, 0x51, ...siz,         // SIZ
        0xFF, 0x52, ...cod,         // COD
        0xFF, 0x5C, ...qcd,         // QCD
        0xFF, 0x90, ...sot,         // SOT
        0xFF, 0x93, ...packets,     // SOD + the empty packets
        0xFF, 0xD9,                 // EOC
    ]);
}

/**
 * The JP2 file wrapping {@link makeMinimalJ2K}: signature and file-type
 * boxes, a JP2 header (ihdr; a colr box naming sRGB, greyscale or CMYK by
 * the component count), optionally a cdef box declaring the last component
 * as opacity, and the codestream box.
 */
export function makeMinimalJP2(components = 1, options: { readonly alpha?: boolean; readonly size?: number } = {}): Uint8Array {
    const size = options.size ?? 8;
    const colourChannels = options.alpha ? components - 1 : components;
    const enumCs = colourChannels === 1 ? 17 : colourChannels === 4 ? 12 : 16;
    const codestream = makeMinimalJ2K(components, size);
    const ihdr = box('ihdr', [...u32(size), ...u32(size), ...u16(components), 0x07, 0x07, 0x00, 0x00]);
    const colr = box('colr', [0x01, 0x00, 0x00, ...u32(enumCs)]);
    const cdef = options.alpha
        ? box('cdef', [...u16(components), ...Array.from({ length: components }, (_, i) => (i === components - 1 ? [...u16(i), ...u16(1), ...u16(0)] : [...u16(i), ...u16(0), ...u16(i + 1)])).flat()])
        : [];
    return new Uint8Array([
        ...box('jP  ', [0x0D, 0x0A, 0x87, 0x0A]),
        ...box('ftyp', [...fourcc('jp2 '), ...u32(0), ...fourcc('jp2 ')]),
        ...box('jp2h', [...ihdr, ...colr, ...cdef]),
        ...box('jp2c', Array.from(codestream)),
    ]);
}
