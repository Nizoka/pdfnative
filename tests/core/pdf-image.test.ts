import { describe, it, expect } from 'vitest';
import {
    detectImageFormat,
    parseJPEG,
    parsePNG,
    parseImage,
    buildImageXObject,
    buildSMaskXObject,
    buildImageOperators,
} from '../../src/core/pdf-image.js';
import { buildDocumentPDF, buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── Minimal JPEG fixture (2x2 RGB, baseline DCT) ────────────────────
// Smallest valid JPEG with SOI, APP0, DQT, SOF0, DHT, SOS, data, EOI
function makeMinimalJPEG(): Uint8Array {
    // A minimal valid JPEG: 2x2 pixels, 3 components (RGB)
    // This is a hand-crafted minimal JPEG that contains valid markers
    const bytes = [
        // SOI
        0xFF, 0xD8,
        // APP0 (JFIF marker)
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
        0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        // DQT
        0xFF, 0xDB, 0x00, 0x43, 0x00,
        0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07,
        0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14,
        0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13,
        0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A,
        0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22,
        0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C,
        0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39,
        0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32,
        // SOF0 (Baseline DCT) — height=2, width=2, components=3
        0xFF, 0xC0, 0x00, 0x11, 0x08,
        0x00, 0x02, // height = 2
        0x00, 0x02, // width = 2
        0x03,       // components = 3 (RGB)
        0x01, 0x11, 0x00,
        0x02, 0x11, 0x01,
        0x03, 0x11, 0x01,
        // DHT
        0xFF, 0xC4, 0x00, 0x1F, 0x00,
        0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0A, 0x0B,
        // SOS
        0xFF, 0xDA, 0x00, 0x0C, 0x03,
        0x01, 0x00, 0x02, 0x11, 0x03, 0x11,
        0x00, 0x3F, 0x00,
        // Minimal scan data (not valid image data but structurally valid)
        0x00, 0x00, 0x00, 0x00,
        // EOI
        0xFF, 0xD9,
    ];
    return new Uint8Array(bytes);
}

/** Minimal JPEG with grayscale (1 component) */
function makeGrayscaleJPEG(): Uint8Array {
    const bytes = [
        0xFF, 0xD8,
        // SOF0 — height=4, width=4, components=1
        0xFF, 0xC0, 0x00, 0x0B, 0x08,
        0x00, 0x04, // height = 4
        0x00, 0x04, // width = 4
        0x01,       // components = 1 (grayscale)
        0x01, 0x11, 0x00,
        // EOI
        0xFF, 0xD9,
    ];
    return new Uint8Array(bytes);
}

// ── Minimal PNG fixture (1x1 RGB) ───────────────────────────────────
function makeMinimalPNG(opts?: { colorType?: number; width?: number; height?: number }): Uint8Array {
    const width = opts?.width ?? 1;
    const height = opts?.height ?? 1;
    const colorType = opts?.colorType ?? 2; // 2=RGB, 0=Gray, 6=RGBA, 4=GrayA

    // CRC32 helper
    let crcTable: Uint32Array | null = null;
    function crc32(data: number[]): number {
        if (!crcTable) {
            crcTable = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                crcTable[n] = c;
            }
        }
        let crc = 0xFFFFFFFF;
        for (const byte of data) {
            crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function u32be(n: number): number[] {
        return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
    }

    function makeChunk(type: number[], data: number[]): number[] {
        const len = u32be(data.length);
        const crcData = [...type, ...data];
        const crc = u32be(crc32(crcData));
        return [...len, ...crcData, ...crc];
    }

    // PNG signature
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    // IHDR: width, height, bitDepth=8, colorType, compression=0, filter=0, interlace=0
    const ihdrData = [...u32be(width), ...u32be(height), 8, colorType, 0, 0, 0];
    const ihdr = makeChunk([0x49, 0x48, 0x44, 0x52], ihdrData);

    // IDAT: minimal compressed data (zlib header + deflate + adler32)
    // For a minimal PNG we just need some bytes — format is zlib compressed
    // Using: zlib header (78 01) + stored block + adler32
    const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
    const rawData: number[] = [];
    for (let r = 0; r < height; r++) {
        rawData.push(0); // filter byte = None
        for (let c = 0; c < width * channels; c++) {
            rawData.push(0x80); // mid-gray pixel data
        }
    }

    // Build minimal zlib (stored block)
    const len = rawData.length;
    const stored = [
        0x78, 0x01, // zlib header (deflate, fastest)
        0x01,       // final block, stored
        len & 0xFF, (len >> 8) & 0xFF,        // len
        (~len) & 0xFF, ((~len) >> 8) & 0xFF,  // nlen (one's complement)
        ...rawData,
    ];
    // Adler32
    let a = 1, b = 0;
    for (const byte of rawData) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    stored.push((b >> 8) & 0xFF, b & 0xFF, (a >> 8) & 0xFF, a & 0xFF);

    const idat = makeChunk([0x49, 0x44, 0x41, 0x54], stored);

    // IEND
    const iend = makeChunk([0x49, 0x45, 0x4E, 0x44], []);

    return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

// ═════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════

describe('detectImageFormat', () => {
    it('detects JPEG from magic bytes', () => {
        const jpeg = makeMinimalJPEG();
        expect(detectImageFormat(jpeg)).toBe('jpeg');
    });

    it('detects PNG from magic bytes', () => {
        const png = makeMinimalPNG();
        expect(detectImageFormat(png)).toBe('png');
    });

    it('returns null for unknown format', () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
        expect(detectImageFormat(data)).toBeNull();
    });

    it('returns null for too-short input', () => {
        expect(detectImageFormat(new Uint8Array([0xFF, 0xD8]))).toBeNull();
    });
});

describe('parseJPEG', () => {
    it('parses minimal RGB JPEG dimensions and color', () => {
        const jpeg = makeMinimalJPEG();
        const result = parseJPEG(jpeg);
        expect(result.width).toBe(2);
        expect(result.height).toBe(2);
        expect(result.colorSpace).toBe('/DeviceRGB');
        expect(result.bitsPerComponent).toBe(8);
        expect(result.filter).toBe('/DCTDecode');
        expect(result.data.length).toBe(jpeg.length);
        expect(result.smask).toBeNull();
    });

    it('parses grayscale JPEG', () => {
        const jpeg = makeGrayscaleJPEG();
        const result = parseJPEG(jpeg);
        expect(result.width).toBe(4);
        expect(result.height).toBe(4);
        expect(result.colorSpace).toBe('/DeviceGray');
    });

    it('throws for empty input', () => {
        expect(() => parseJPEG(new Uint8Array([]))).toThrow('not a valid JPEG');
    });

    it('throws for wrong magic bytes', () => {
        expect(() => parseJPEG(new Uint8Array([0x89, 0x50, 0x4E, 0x47]))).toThrow('not a valid JPEG');
    });

    it('throws for JPEG with no SOF marker', () => {
        // Just SOI + EOI
        const bytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
        expect(() => parseJPEG(bytes)).toThrow('no SOF marker found');
    });
});

describe('parsePNG', () => {
    it('parses minimal RGB PNG', () => {
        const png = makeMinimalPNG({ width: 3, height: 2, colorType: 2 });
        const result = parsePNG(png);
        expect(result.width).toBe(3);
        expect(result.height).toBe(2);
        expect(result.colorSpace).toBe('/DeviceRGB');
        expect(result.bitsPerComponent).toBe(8);
        expect(result.filter).toBe('/FlateDecode');
        expect(result.data.length).toBeGreaterThan(0);
    });

    it('parses grayscale PNG', () => {
        const png = makeMinimalPNG({ width: 4, height: 4, colorType: 0 });
        const result = parsePNG(png);
        expect(result.colorSpace).toBe('/DeviceGray');
    });

    it('parses RGBA PNG (alpha noted as limitation)', () => {
        const png = makeMinimalPNG({ width: 2, height: 2, colorType: 6 });
        const result = parsePNG(png);
        expect(result.width).toBe(2);
        expect(result.height).toBe(2);
        expect(result.colorSpace).toBe('/DeviceRGB');
        // SMask is null due to zero-dep limitation
        expect(result.smask).toBeNull();
    });

    it('parses GrayAlpha PNG', () => {
        const png = makeMinimalPNG({ width: 2, height: 2, colorType: 4 });
        const result = parsePNG(png);
        expect(result.colorSpace).toBe('/DeviceGray');
    });

    it('throws for wrong magic bytes', () => {
        expect(() => parsePNG(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]))).toThrow('not a valid PNG');
    });

    it('throws for truncated file', () => {
        // Just the signature
        expect(() => parsePNG(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toThrow('truncated');
    });
});

describe('parseImage', () => {
    it('auto-detects and parses JPEG', () => {
        const jpeg = makeMinimalJPEG();
        const result = parseImage(jpeg);
        expect(result.filter).toBe('/DCTDecode');
        expect(result.width).toBe(2);
    });

    it('auto-detects and parses PNG', () => {
        const png = makeMinimalPNG({ width: 5, height: 3 });
        const result = parseImage(png);
        expect(result.filter).toBe('/FlateDecode');
        expect(result.width).toBe(5);
        expect(result.height).toBe(3);
    });

    it('throws for unsupported format', () => {
        const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
        expect(() => parseImage(data)).toThrow('unsupported image format');
    });

    it('throws for null/empty input', () => {
        expect(() => parseImage(new Uint8Array([]))).toThrow('non-empty');
    });
});

describe('buildImageXObject', () => {
    it('builds XObject with DCTDecode for JPEG', () => {
        const jpeg = makeMinimalJPEG();
        const img = parseJPEG(jpeg);
        const obj = buildImageXObject(img);
        expect(obj).toContain('/Type /XObject');
        expect(obj).toContain('/Subtype /Image');
        expect(obj).toContain('/Width 2');
        expect(obj).toContain('/Height 2');
        expect(obj).toContain('/ColorSpace /DeviceRGB');
        expect(obj).toContain('/Filter /DCTDecode');
        expect(obj).toContain('stream');
        expect(obj).toContain('endstream');
    });

    it('builds XObject with FlateDecode for PNG', () => {
        const png = makeMinimalPNG({ width: 3, height: 2 });
        const img = parsePNG(png);
        const obj = buildImageXObject(img);
        expect(obj).toContain('/Filter /FlateDecode');
        expect(obj).toContain('/DecodeParms');
        expect(obj).toContain('/Predictor 15');
        expect(obj).toContain('/Colors 3');
        expect(obj).toContain('/Columns 3');
    });

    it('includes SMask reference when provided', () => {
        const jpeg = makeMinimalJPEG();
        const img = parseJPEG(jpeg);
        const obj = buildImageXObject(img, 42);
        expect(obj).toContain('/SMask 42 0 R');
    });

    it('does not include DecodeParms for JPEG', () => {
        const jpeg = makeMinimalJPEG();
        const img = parseJPEG(jpeg);
        const obj = buildImageXObject(img);
        expect(obj).not.toContain('/DecodeParms');
    });
});

describe('buildSMaskXObject', () => {
    it('builds a DeviceGray soft mask object', () => {
        const obj = buildSMaskXObject('alphaData', 10, 20);
        expect(obj).toContain('/ColorSpace /DeviceGray');
        expect(obj).toContain('/Width 10');
        expect(obj).toContain('/Height 20');
        expect(obj).toContain('/BitsPerComponent 8');
        expect(obj).toContain('/Filter /FlateDecode');
    });
});

describe('buildImageOperators', () => {
    it('produces q/cm/Do/Q operators', () => {
        const ops = buildImageOperators('/Im1', 50, 100, 200, 150);
        expect(ops).toContain('q');
        expect(ops).toContain('200.00 0 0 150.00 50.00 100.00 cm');
        expect(ops).toContain('/Im1 Do');
        expect(ops).toContain('Q');
    });
});

describe('ImageBlock integration with buildDocumentPDF', () => {
    function makeJPEG(): Uint8Array {
        return makeMinimalJPEG();
    }

    function makePNG(w = 1, h = 1): Uint8Array {
        return makeMinimalPNG({ width: w, height: h });
    }

    it('renders a document with one JPEG ImageBlock', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG() },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('%PDF-1.4');
        expect(pdf).toContain('/Type /XObject');
        expect(pdf).toContain('/Subtype /Image');
        expect(pdf).toContain('/Im1');
        expect(pdf).toContain('Do');
        expect(pdf).toContain('%%EOF');
    });

    it('renders a document with one PNG ImageBlock', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makePNG(4, 3) },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('/Type /XObject');
        expect(pdf).toContain('/FlateDecode');
    });

    it('renders multiple images with correct XObject references', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'paragraph', text: 'Before image' },
                { type: 'image', data: makeJPEG() },
                { type: 'paragraph', text: 'Between images' },
                { type: 'image', data: makePNG(2, 2) },
                { type: 'paragraph', text: 'After image' },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('/Im1');
        expect(pdf).toContain('/Im2');
        expect(pdf).toContain('/XObject');
    });

    it('respects explicit width/height on ImageBlock', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), width: 100, height: 50 },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('100.00 0 0 50.00');
    });

    it('centers image with align center', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), align: 'center' },
            ],
        };
        const pdf = buildDocumentPDF(params);
        // Should contain cm operator — center calculation depends on page width
        expect(pdf).toContain('cm');
        expect(pdf).toContain('Do');
    });

    it('right-aligns image', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), align: 'right' },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('cm');
    });

    it('produces valid PDF bytes via buildDocumentPDFBytes', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG() },
            ],
        };
        const bytes = buildDocumentPDFBytes(params);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
        // Check PDF magic
        expect(bytes[0]).toBe(0x25); // %
        expect(bytes[1]).toBe(0x50); // P
        expect(bytes[2]).toBe(0x44); // D
        expect(bytes[3]).toBe(0x46); // F
    });

    it('handles tagged mode with alt text on image', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), alt: 'A photo' },
            ],
            layout: { tagged: true },
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('BDC');
        expect(pdf).toContain('EMC');
        expect(pdf).toContain('/Figure');
    });

    it('handles mix of text and images across pages', () => {
        const blocks = [];
        for (let i = 0; i < 20; i++) {
            blocks.push({ type: 'paragraph' as const, text: `Paragraph ${i}` });
            blocks.push({ type: 'image' as const, data: makeJPEG(), height: 80 });
        }
        const params: DocumentParams = {
            title: 'Multi-page Images',
            blocks,
            footerText: 'Footer',
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('%PDF-1.4');
        expect(pdf).toContain('%%EOF');
        // Should have multiple pages
        expect(pdf).toContain('/Type /Pages');
    });

    it('document with no images has no /XObject resource', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'paragraph', text: 'No images here' },
            ],
        };
        const pdf = buildDocumentPDF(params);
        expect(pdf).not.toContain('/XObject');
    });

    it('image block with only width auto-calculates height', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), width: 50 },
            ],
        };
        // 2x2 JPEG → aspect 1:1, so height should be 50
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('50.00 0 0 50.00');
    });

    it('image block with only height auto-calculates width', () => {
        const params: DocumentParams = {
            blocks: [
                { type: 'image', data: makeJPEG(), height: 100 },
            ],
        };
        // 2x2 JPEG → aspect 1:1, so width should be 100
        const pdf = buildDocumentPDF(params);
        expect(pdf).toContain('100.00 0 0 100.00');
    });
});
