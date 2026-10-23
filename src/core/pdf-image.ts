/**
 * pdfnative — PDF Image Support
 * ===============================
 * Parse JPEG and PNG images, build PDF XObject streams.
 * Zero dependencies — pure binary parsing from Uint8Array.
 *
 * JPEG: DCTDecode — raw bytes injected directly into PDF stream.
 * PNG: FlateDecode — IDAT chunks concatenated; alpha separated to SMask.
 *
 * ISO 32000-1 §8.9 — Image XObjects
 * ISO 32000-1 §7.4.4 — DCTDecode filter (JPEG)
 * ISO 32000-1 §7.4.4 — FlateDecode filter (PNG/zlib)
 */

// ── Types ────────────────────────────────────────────────────────────

/** Parsed image data ready for PDF embedding. */
export interface ParsedImage {
    readonly width: number;
    readonly height: number;
    /** The device space of the samples; for a JPEG 2000 image, the space its colour channels stand for. */
    readonly colorSpace: '/DeviceRGB' | '/DeviceGray' | '/DeviceCMYK';
    readonly bitsPerComponent: number;
    /** `/JPXDecode` since 1.9.0: the JPEG 2000 bytes pass through as the JPEG bytes do. */
    readonly filter: '/DCTDecode' | '/FlateDecode' | '/JPXDecode';
    readonly data: string;
    readonly smask: string | null;
    readonly smaskWidth: number;
    readonly smaskHeight: number;
    readonly smaskBpc: number;
    /** JPEG 2000 facts the XObject needs; present for `/JPXDecode` only. @since 1.9.0 */
    readonly jpx?: JpxInfo;
}

/**
 * What a JPEG 2000 image declares about itself (ISO/IEC 15444-1), read from
 * the JP2 header boxes and the codestream's SIZ marker.
 *
 * @since 1.9.0
 */
export interface JpxInfo {
    /**
     * The JP2 wrapper carries a `colr` box (enumerated sRGB / greyscale /
     * sYCC / CMYK, or an ICC profile): the XObject then leaves `/ColorSpace`
     * and `/BitsPerComponent` to the codestream (ISO 32000-1 §8.9.5.1). A raw
     * codestream declares none, so the XObject states the device space its
     * component count implies.
     */
    readonly colourSpecified: boolean;
    /** An opacity channel is present (`cdef` box, or one channel beyond the colour channels): the XObject sets `/SMaskInData 1`. */
    readonly alpha: boolean;
    /** Colour channels, alpha excluded. */
    readonly channels: number;
    /** Component bit depth from the SIZ marker. */
    readonly bitDepth: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Convert Uint8Array to byte string (charCode ≤ 0xFF).
 * Same pattern as base64ToByteString in font-embedder.ts.
 */
function uint8ToByteString(bytes: Uint8Array): string {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        const end = Math.min(i + 8192, bytes.length);
        let chunk = '';
        for (let j = i; j < end; j++) {
            chunk += String.fromCharCode(bytes[j]);
        }
        chunks.push(chunk);
    }
    return chunks.join('');
}

/**
 * Read a 16-bit big-endian unsigned integer.
 */
function readU16BE(data: Uint8Array, offset: number): number {
    return (data[offset] << 8) | data[offset + 1];
}

/**
 * Read a 32-bit big-endian unsigned integer.
 */
function readU32BE(data: Uint8Array, offset: number): number {
    return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

// ── JPEG Parser ──────────────────────────────────────────────────────

/**
 * Detect the image format from magic bytes.
 *
 * @param bytes - Raw image file bytes
 * @returns 'jpeg' | 'png' | null
 */
export function detectImageFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'jpx' | null {
    if (bytes.length < 8) return null;
    // JPEG: FF D8 FF
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
        bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
    // JPEG 2000 (v1.9.0): the JP2 signature box 00 00 00 0C 6A 50 20 20 0D 0A 87 0A,
    // or a raw codestream opening with SOC + SIZ (FF 4F FF 51).
    if (bytes.length >= 12 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x0C &&
        bytes[4] === 0x6A && bytes[5] === 0x50 && bytes[6] === 0x20 && bytes[7] === 0x20 &&
        bytes[8] === 0x0D && bytes[9] === 0x0A && bytes[10] === 0x87 && bytes[11] === 0x0A) return 'jpx';
    if (bytes[0] === 0xFF && bytes[1] === 0x4F && bytes[2] === 0xFF && bytes[3] === 0x51) return 'jpx';
    return null;
}

/**
 * Parse a JPEG image to extract dimensions and color space.
 * JPEG bytes are used as-is with DCTDecode — no decompression needed.
 *
 * @param bytes - Raw JPEG file bytes
 * @returns ParsedImage with DCTDecode filter
 */
export function parseJPEG(bytes: Uint8Array): ParsedImage {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
        throw new Error('parseJPEG: not a valid JPEG (missing SOI marker)');
    }

    let offset = 2;
    while (offset < bytes.length - 1) {
        if (bytes[offset] !== 0xFF) {
            throw new Error(`parseJPEG: invalid marker at offset ${offset}`);
        }

        const marker = bytes[offset + 1];

        // Skip fill bytes (0xFF padding)
        if (marker === 0xFF) {
            offset++;
            continue;
        }

        // SOF markers: SOF0 (0xC0) through SOF15 (0xCF), excluding DHT (0xC4), JPG (0xC8), DAC (0xCC)
        const isSOF = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;

        if (isSOF) {
            if (offset + 9 >= bytes.length) {
                throw new Error('parseJPEG: truncated SOF marker');
            }
            const bpc = bytes[offset + 4];
            const height = readU16BE(bytes, offset + 5);
            const width = readU16BE(bytes, offset + 7);
            const components = bytes[offset + 9];

            let colorSpace: '/DeviceRGB' | '/DeviceGray' | '/DeviceCMYK';
            if (components === 1) colorSpace = '/DeviceGray';
            else if (components === 3) colorSpace = '/DeviceRGB';
            else if (components === 4) colorSpace = '/DeviceCMYK';
            else throw new Error(`parseJPEG: unsupported component count (${components})`);

            return {
                width,
                height,
                colorSpace,
                bitsPerComponent: bpc,
                filter: '/DCTDecode',
                data: uint8ToByteString(bytes),
                smask: null,
                smaskWidth: 0,
                smaskHeight: 0,
                smaskBpc: 0,
            };
        }

        // Markers without length (standalone): RST0-RST7 (D0-D7), SOI (D8), EOI (D9)
        if ((marker >= 0xD0 && marker <= 0xD9) || marker === 0x01) {
            offset += 2;
            continue;
        }

        // Skip marker segment
        if (offset + 3 >= bytes.length) break;
        const segLen = readU16BE(bytes, offset + 2);
        if (segLen < 2) throw new Error('parseJPEG: invalid segment length');
        if (offset + 2 + segLen > bytes.length) break;
        offset += 2 + segLen;
    }

    throw new Error('parseJPEG: no SOF marker found — cannot determine image dimensions');
}

// ── PNG Parser ───────────────────────────────────────────────────────

/**
 * Parse a PNG image to extract dimensions, color type, and compressed image data.
 * Concatenates all IDAT chunks for FlateDecode. Separates alpha channel into SMask.
 *
 * Limitations:
 *   - Interlaced PNGs (interlace method 1) are rejected
 *   - 16-bit depth is rejected (PDF viewers support 8-bit per component)
 *
 * @param bytes - Raw PNG file bytes
 * @returns ParsedImage with FlateDecode filter
 */
export function parsePNG(bytes: Uint8Array): ParsedImage {
    // Validate PNG signature
    if (bytes.length < 8 ||
        bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47 ||
        bytes[4] !== 0x0D || bytes[5] !== 0x0A || bytes[6] !== 0x1A || bytes[7] !== 0x0A) {
        throw new Error('parsePNG: not a valid PNG (missing signature)');
    }

    let offset = 8;

    // IHDR must be first chunk
    if (offset + 8 > bytes.length) throw new Error('parsePNG: truncated file');
    const ihdrLen = readU32BE(bytes, offset);
    const ihdrType = readU32BE(bytes, offset + 4);
    if (ihdrType !== 0x49484452) throw new Error('parsePNG: first chunk must be IHDR');
    if (ihdrLen !== 13) throw new Error('parsePNG: IHDR chunk must be 13 bytes');

    const ihdrData = offset + 8;
    const width = readU32BE(bytes, ihdrData);
    const height = readU32BE(bytes, ihdrData + 4);
    const bitDepth = bytes[ihdrData + 8];
    const colorType = bytes[ihdrData + 9];
    const interlace = bytes[ihdrData + 12];

    if (interlace !== 0) {
        throw new Error('parsePNG: interlaced PNGs are not supported');
    }
    if (bitDepth !== 8) {
        throw new Error(`parsePNG: only 8-bit depth is supported (got ${bitDepth})`);
    }

    // Collect IDAT chunks
    offset += 8 + ihdrLen + 4; // skip IHDR length + type + data + CRC
    const idatChunks: Uint8Array[] = [];

    while (offset + 8 <= bytes.length) {
        const chunkLen = readU32BE(bytes, offset);
        const chunkType = readU32BE(bytes, offset + 4);
        const chunkData = offset + 8;

        // IDAT = 0x49444154
        if (chunkType === 0x49444154) {
            if (chunkData + chunkLen > bytes.length) break;
            idatChunks.push(bytes.subarray(chunkData, chunkData + chunkLen));
        }

        // IEND = 0x49454E44
        if (chunkType === 0x49454E44) break;

        offset = chunkData + chunkLen + 4; // data + CRC
    }

    if (idatChunks.length === 0) {
        throw new Error('parsePNG: no IDAT chunks found');
    }

    // Concatenate IDAT data
    const totalLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
    const compressedData = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of idatChunks) {
        compressedData.set(chunk, pos);
        pos += chunk.length;
    }

    // Determine color space and channel count
    // Color types: 0=Grayscale, 2=RGB, 4=Grayscale+Alpha, 6=RGBA
    let colorSpace: '/DeviceRGB' | '/DeviceGray';
    const hasAlpha = colorType === 4 || colorType === 6;

    if (colorType === 0 || colorType === 4) {
        colorSpace = '/DeviceGray';
    } else if (colorType === 2 || colorType === 6) {
        colorSpace = '/DeviceRGB';
    } else {
        throw new Error(`parsePNG: unsupported color type ${colorType} (palette-based PNGs not supported)`);
    }

    // For PNG, the compressed data includes the zlib header and per-row filter bytes.
    // PDF FlateDecode with /DecodeParms /Predictor 15 handles this natively.
    // We pass the concatenated IDAT data directly.
    //
    // If the PNG has alpha, we need to decompress to separate channels.
    // For non-alpha PNGs, we can pass-through the compressed data directly.

    if (!hasAlpha) {
        return {
            width,
            height,
            colorSpace,
            bitsPerComponent: 8,
            filter: '/FlateDecode',
            data: uint8ToByteString(compressedData),
            smask: null,
            smaskWidth: 0,
            smaskHeight: 0,
            smaskBpc: 0,
        };
    }

    // Alpha PNG — PDF does not natively support RGBA in a single XObject (ISO 32000-1 §8.9.5.3).
    // Proper alpha separation requires decompressing IDAT, splitting channels, and recompressing.
    // This is not feasible without a zlib dependency. Reject explicitly instead of producing
    // corrupt output with wrong stride.
    throw new Error(
        `parsePNG: alpha channel PNGs (color type ${colorType}) are not supported — ` +
        'preprocess the image to remove the alpha channel before embedding'
    );
}

// ── JPEG 2000 Parser (v1.9.0) ────────────────────────────────────────

/** Four-character box types as big-endian integers. */
const BOX_JP2H = 0x6A703268, BOX_IHDR = 0x69686472, BOX_COLR = 0x636F6C72, BOX_CDEF = 0x63646566, BOX_JP2C = 0x6A703263;

/** The facts the SIZ marker segment states about a codestream. */
interface JpxSiz { readonly width: number; readonly height: number; readonly components: number; readonly bitDepth: number }

/** Read the SIZ marker that follows SOC at `start`. */
function readJpxSiz(bytes: Uint8Array, start: number): JpxSiz {
    if (start + 42 > bytes.length || bytes[start] !== 0xFF || bytes[start + 1] !== 0x4F || bytes[start + 2] !== 0xFF || bytes[start + 3] !== 0x51) {
        throw new Error('parseJPX: codestream does not start with SOC and SIZ markers');
    }
    // SIZ layout after the marker: Lsiz Rsiz Xsiz Ysiz XOsiz YOsiz XTsiz YTsiz XTOsiz YTOsiz Csiz, then Ssiz XRsiz YRsiz per component.
    const siz = start + 2;
    const components = readU16BE(bytes, siz + 38);
    if (components < 1) throw new Error('parseJPX: SIZ declares no component');
    if (siz + 40 + 3 * components > bytes.length) throw new Error('parseJPX: truncated SIZ marker');
    const width = readU32BE(bytes, siz + 6) - readU32BE(bytes, siz + 14);
    const height = readU32BE(bytes, siz + 10) - readU32BE(bytes, siz + 18);
    if (width <= 0 || height <= 0) throw new Error('parseJPX: SIZ declares an empty image');
    const bitDepth = (bytes[siz + 40] & 0x7F) + 1;
    return { width, height, components, bitDepth };
}

/** Device space for a colour-channel count. */
function jpxColourSpace(channels: number): ParsedImage['colorSpace'] {
    if (channels === 1) return '/DeviceGray';
    if (channels === 3) return '/DeviceRGB';
    if (channels === 4) return '/DeviceCMYK';
    throw new Error(`parseJPX: unsupported colour channel count (${channels}) — 1 (grey), 3 (RGB) or 4 (CMYK) expected`);
}

/**
 * Parse a JPEG 2000 image — a JP2 file (ISO/IEC 15444-1 Annex I boxes) or a
 * raw codestream — for the facts the Image XObject needs. The bytes are
 * embedded as they are with `/JPXDecode`: the viewer decodes them, exactly
 * as it does the DCT data of a JPEG.
 *
 * A JP2 `colr` box (enumerated sRGB 16, greyscale 17, sYCC 18, CMYK 12, or
 * an ICC profile) makes the colour space the codestream's own business; a
 * raw codestream gets a device space from its component count. An opacity
 * channel (`cdef`, or one component beyond the colour channels) becomes
 * `/SMaskInData 1`.
 *
 * @param bytes - JP2 file or J2K codestream bytes
 * @returns ParsedImage with the JPXDecode filter and {@link JpxInfo}
 * @since 1.9.0
 */
export function parseJPX(bytes: Uint8Array): ParsedImage {
    const raw = bytes[0] === 0xFF && bytes[1] === 0x4F;
    let ihdr: { readonly nc: number } | null = null;
    let colr: { readonly channels: number | null } | null = null;
    let cdefAlpha = false;
    let codestream = raw ? 0 : -1;

    if (!raw) {
        // Walk the top-level boxes; descend into the JP2 header superbox.
        const walk = (from: number, to: number, depth: number): void => {
            let at = from;
            while (at + 8 <= to) {
                let length = readU32BE(bytes, at);
                const type = readU32BE(bytes, at + 4);
                let header = 8;
                if (length === 1) {
                    if (at + 16 > to) break;
                    if (readU32BE(bytes, at + 8) !== 0) throw new Error('parseJPX: box larger than 4 GB');
                    length = readU32BE(bytes, at + 12);
                    header = 16;
                } else if (length === 0) {
                    length = to - at;
                }
                if (length < header || at + length > to) throw new Error('parseJPX: box runs past the end of the file');
                const body = at + header;
                if (type === BOX_JP2H && depth === 0) {
                    walk(body, at + length, 1);
                } else if (type === BOX_IHDR) {
                    if (length < header + 14) throw new Error('parseJPX: truncated ihdr box');
                    ihdr = { nc: readU16BE(bytes, body + 8) };
                } else if (type === BOX_COLR) {
                    const meth = bytes[body];
                    if (meth === 1 && length >= header + 7) {
                        const enumCs = readU32BE(bytes, body + 3);
                        const channels = enumCs === 17 ? 1 : enumCs === 12 ? 4 : (enumCs === 16 || enumCs === 18 || enumCs === 20 || enumCs === 21) ? 3 : null;
                        if (colr === null) colr = { channels };
                    } else if (colr === null) {
                        colr = { channels: null }; // ICC profile (meth 2/3): the channel count comes from ihdr
                    }
                } else if (type === BOX_CDEF) {
                    const n = readU16BE(bytes, body);
                    for (let k = 0; k < n && body + 2 + k * 6 + 6 <= at + length; k++) {
                        const typ = readU16BE(bytes, body + 2 + k * 6 + 2);
                        if (typ === 1 || typ === 2) cdefAlpha = true;
                    }
                } else if (type === BOX_JP2C && codestream === -1) {
                    codestream = body;
                }
                at += length;
            }
        };
        walk(0, bytes.length, 0);
        if (codestream === -1) throw new Error('parseJPX: JP2 file has no contiguous codestream (jp2c) box');
    }

    const siz = readJpxSiz(bytes, codestream);
    const nc = (ihdr as { readonly nc: number } | null)?.nc ?? siz.components;
    const colrChannels = (colr as { readonly channels: number | null } | null)?.channels ?? null;
    // Colour channels: what the colour specification says, else every
    // component but a declared alpha, else the components themselves.
    let channels = colrChannels ?? nc;
    let alpha = cdefAlpha;
    if (colrChannels !== null && nc > colrChannels) alpha = true;
    if (colrChannels === null && (nc === 2 || (cdefAlpha && nc > 1))) { channels = cdefAlpha ? nc - 1 : 1; alpha = true; }
    if (!raw && colrChannels !== null) channels = colrChannels;
    const colorSpace = jpxColourSpace(channels);
    return {
        width: siz.width,
        height: siz.height,
        colorSpace,
        bitsPerComponent: siz.bitDepth,
        filter: '/JPXDecode',
        data: uint8ToByteString(bytes),
        smask: null,
        smaskWidth: 0,
        smaskHeight: 0,
        smaskBpc: 0,
        jpx: { colourSpecified: colr !== null, alpha, channels, bitDepth: siz.bitDepth },
    };
}

// ── Image Parsing Entry Point ────────────────────────────────────────

/**
 * Parse an image from raw bytes (auto-detect JPEG, PNG or JPEG 2000).
 *
 * @param bytes - Raw image file bytes (JPEG, PNG, JP2 or J2K codestream)
 * @returns ParsedImage ready for PDF embedding
 */
export function parseImage(bytes: Uint8Array): ParsedImage {
    if (!bytes || bytes.length < 8) {
        throw new Error('parseImage: input must be a non-empty Uint8Array');
    }

    const format = detectImageFormat(bytes);
    if (format === 'jpeg') return parseJPEG(bytes);
    if (format === 'png') return parsePNG(bytes);
    if (format === 'jpx') return parseJPX(bytes);

    throw new Error('parseImage: unsupported image format (only JPEG, PNG and JPEG 2000 are supported)');
}

// ── PDF XObject Builder ──────────────────────────────────────────────

/**
 * Build a PDF Image XObject dictionary + stream for an image.
 * Returns the complete object content (dictionary + stream).
 *
 * @param img - Parsed image data
 * @param smaskObjNum - Object number for the SMask (0 = no SMask)
 * @returns PDF object content string
 */
export function buildImageXObject(img: ParsedImage, smaskObjNum?: number): string {
    const decodeParms = img.filter === '/FlateDecode'
        ? ` /DecodeParms << /Predictor 15 /Colors ${img.colorSpace === '/DeviceGray' ? 1 : 3} /BitsPerComponent ${img.bitsPerComponent} /Columns ${img.width} >>`
        : '';

    const smaskRef = smaskObjNum ? ` /SMask ${smaskObjNum} 0 R` : '';

    if (img.filter === '/JPXDecode') {
        // ISO 32000-1 §8.9.5.1: with JPXDecode, /ColorSpace is optional and
        // overrides the codestream's own colour specification when present;
        // /BitsPerComponent is ignored. State them only when the codestream
        // has nothing to say (a raw J2K). /SMaskInData 1 uses the opacity
        // channel the codestream carries.
        const colour = img.jpx?.colourSpecified ? '' : `/ColorSpace ${img.colorSpace} /BitsPerComponent ${img.bitsPerComponent} `;
        const smaskInData = img.jpx?.alpha ? ' /SMaskInData 1' : '';
        return `<< /Type /XObject /Subtype /Image ` +
            `/Width ${img.width} /Height ${img.height} ` +
            colour +
            `/Filter /JPXDecode${smaskInData}${smaskRef} ` +
            `/Length ${img.data.length} >>\nstream\n${img.data}\nendstream`;
    }

    return `<< /Type /XObject /Subtype /Image ` +
        `/Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace ${img.colorSpace} ` +
        `/BitsPerComponent ${img.bitsPerComponent} ` +
        `/Filter ${img.filter}${decodeParms}${smaskRef} ` +
        `/Length ${img.data.length} >>\nstream\n${img.data}\nendstream`;
}

/**
 * Build a PDF SMask (soft mask) XObject for PNG alpha channel.
 *
 * @param smaskData - Alpha channel byte string
 * @param width - Image width
 * @param height - Image height
 * @returns PDF SMask object content string
 */
export function buildSMaskXObject(smaskData: string, width: number, height: number): string {
    return `<< /Type /XObject /Subtype /Image ` +
        `/Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 8 ` +
        `/Filter /FlateDecode ` +
        `/Length ${smaskData.length} >>\nstream\n${smaskData}\nendstream`;
}

/**
 * Build the content stream operators to paint an image at the given position and size.
 * Uses the cm operator to position and scale the image.
 *
 * @param imgRef - Image XObject name (e.g. '/Im1')
 * @param x - X position in points (left edge)
 * @param y - Y position in points (bottom edge)
 * @param width - Display width in points
 * @param height - Display height in points
 * @returns Content stream operators string
 */
export function buildImageOperators(
    imgRef: string,
    x: number,
    y: number,
    width: number,
    height: number,
): string {
    return `q\n${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n${imgRef} Do\nQ`;
}
