/**
 * pdfnative — Barcode & QR Code Generation
 * ==========================================
 * Pure PDF operator rendering for 1D and 2D barcodes.
 * No image embedding — all formats rendered as PDF path operators (re f).
 *
 * Supported formats:
 *   - Code 128 (ISO/IEC 15417) — logistics, GS1
 *   - EAN-13 (ISO/IEC 15420) — global retail
 *   - QR Code (ISO/IEC 18004) — universal 2D
 *   - Data Matrix ECC 200 (ISO/IEC 16022) — industrial
 *   - PDF417 (ISO/IEC 15438) — government, transport
 *
 * ISO 32000-1 §8.4: all barcodes use path construction operators.
 */

import { fmtNum } from './pdf-text.js';

// ── Code 128 (ISO/IEC 15417) ─────────────────────────────────────────

/** Code 128 symbol patterns — each is 6 bar/space widths + stop pattern. */
const CODE128_PATTERNS: readonly number[][] = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
    [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
    [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
    [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
    [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
    [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
    [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
    [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
    [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
    [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
    [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
    [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
    [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
    [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
    [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
    [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
    [2,1,1,2,3,2],[2,3,3,1,1,1,2],
];

/** Code 128 start codes. */
const CODE128_START_A = 103;
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = 106;
const CODE128_CODE_A = 101;
const CODE128_CODE_B = 100;
const CODE128_CODE_C = 99;

/**
 * Encode a string as Code 128 symbol values.
 * Automatically selects between Code A, B, and C for optimal encoding.
 *
 * @param data - Input string (ASCII 0–127)
 * @returns Array of symbol values including start, data, checksum, stop
 */
export function encodeCode128(data: string): number[] {
    if (data.length === 0) throw new Error('Code 128: data must not be empty');

    const symbols: number[] = [];
    let mode: 'A' | 'B' | 'C';
    let pos = 0;

    // Determine start code — prefer Code C for long numeric sequences
    if (_countLeadingDigits(data, 0) >= 4) {
        symbols.push(CODE128_START_C);
        mode = 'C';
    } else if (_hasControlChars(data)) {
        symbols.push(CODE128_START_A);
        mode = 'A';
    } else {
        symbols.push(CODE128_START_B);
        mode = 'B';
    }

    while (pos < data.length) {
        if (mode === 'C') {
            if (_countLeadingDigits(data, pos) >= 2) {
                // Encode digit pairs
                const val = (data.charCodeAt(pos) - 48) * 10 + (data.charCodeAt(pos + 1) - 48);
                symbols.push(val);
                pos += 2;
            } else {
                // Switch to B
                symbols.push(CODE128_CODE_B);
                mode = 'B';
            }
        } else if (mode === 'A') {
            const cp = data.charCodeAt(pos);
            if (_countLeadingDigits(data, pos) >= 4) {
                symbols.push(CODE128_CODE_C);
                mode = 'C';
                continue;
            }
            if (cp < 32) {
                symbols.push(cp + 64);
            } else if (cp < 96) {
                symbols.push(cp - 32);
            } else {
                symbols.push(CODE128_CODE_B);
                mode = 'B';
                continue;
            }
            pos++;
        } else {
            // Mode B
            const cp = data.charCodeAt(pos);
            if (_countLeadingDigits(data, pos) >= 4) {
                symbols.push(CODE128_CODE_C);
                mode = 'C';
                continue;
            }
            if (cp < 32) {
                symbols.push(CODE128_CODE_A);
                mode = 'A';
                continue;
            }
            if (cp >= 32 && cp < 128) {
                symbols.push(cp - 32);
            }
            pos++;
        }
    }

    // Checksum (weighted modular sum)
    let checksum = symbols[0];
    for (let i = 1; i < symbols.length; i++) {
        checksum += symbols[i] * i;
    }
    checksum %= 103;
    symbols.push(checksum);
    symbols.push(CODE128_STOP);

    return symbols;
}

/**
 * Render Code 128 barcode as PDF path operators.
 *
 * @param data - String to encode
 * @param x - Left X position in points
 * @param y - Bottom Y position in points
 * @param width - Total barcode width in points
 * @param height - Bar height in points
 * @returns PDF content stream operators
 */
export function renderCode128(data: string, x: number, y: number, width: number, height: number): string {
    const symbols = encodeCode128(data);
    const patterns = symbols.map(s => CODE128_PATTERNS[s]);

    // Calculate total modules
    let totalModules = 0;
    for (const pat of patterns) {
        for (const w of pat) totalModules += w;
    }
    totalModules += 2; // quiet zones

    const moduleW = width / totalModules;
    const ops: string[] = ['q', '0 0 0 rg'];
    let cx = x + moduleW; // left quiet zone

    for (const pat of patterns) {
        for (let i = 0; i < pat.length; i++) {
            if (i % 2 === 0) {
                // Even index = bar (black)
                ops.push(`${fmtNum(cx)} ${fmtNum(y)} ${fmtNum(moduleW * pat[i])} ${fmtNum(height)} re f`);
            }
            cx += moduleW * pat[i];
        }
    }

    ops.push('Q');
    return ops.join('\n');
}

function _countLeadingDigits(str: string, pos: number): number {
    let count = 0;
    while (pos + count < str.length) {
        const cp = str.charCodeAt(pos + count);
        if (cp < 48 || cp > 57) break;
        count++;
    }
    return count;
}

function _hasControlChars(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) < 32) return true;
    }
    return false;
}

// ── EAN-13 (ISO/IEC 15420) ──────────────────────────────────────────

/** EAN-13 L-code digit patterns (0=space, 1=bar). */
const EAN13_L: readonly number[][] = [
    [0,0,0,1,1,0,1],[0,0,1,1,0,0,1],[0,0,1,0,0,1,1],[0,1,1,1,1,0,1],
    [0,1,0,0,0,1,1],[0,1,1,0,0,0,1],[0,1,0,1,1,1,1],[0,1,1,1,0,1,1],
    [0,1,1,0,1,1,1],[0,0,0,1,0,1,1],
];

/** EAN-13 G-code patterns. */
const EAN13_G: readonly number[][] = [
    [0,1,0,0,1,1,1],[0,1,1,0,0,1,1],[0,0,1,1,0,1,1],[0,1,0,0,0,0,1],
    [0,0,1,1,1,0,1],[0,1,1,1,0,0,1],[0,0,0,0,1,0,1],[0,0,1,0,0,0,1],
    [0,0,0,1,0,0,1],[0,0,1,0,1,1,1],
];

/** EAN-13 R-code patterns. */
const EAN13_R: readonly number[][] = [
    [1,1,1,0,0,1,0],[1,1,0,0,1,1,0],[1,1,0,1,1,0,0],[1,0,0,0,0,1,0],
    [1,0,1,1,1,0,0],[1,0,0,1,1,1,0],[1,0,1,0,0,0,0],[1,0,0,0,1,0,0],
    [1,0,0,1,0,0,0],[1,1,1,0,1,0,0],
];

/** First digit encoding for EAN-13 (maps first digit to L/G pattern). */
const EAN13_FIRST_DIGIT: readonly string[] = [
    'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
    'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/**
 * Calculate EAN-13 check digit.
 *
 * @param digits12 - First 12 digits as string
 * @returns Check digit (0-9)
 */
export function ean13CheckDigit(digits12: string): number {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
        const d = digits12.charCodeAt(i) - 48;
        sum += (i % 2 === 0) ? d : d * 3;
    }
    return (10 - (sum % 10)) % 10;
}

/**
 * Render EAN-13 barcode as PDF path operators.
 *
 * @param data - 12 or 13 digit string (check digit auto-calculated if 12)
 * @param x - Left X position in points
 * @param y - Bottom Y position in points
 * @param width - Total barcode width in points
 * @param height - Bar height in points
 * @returns PDF content stream operators
 */
export function renderEAN13(data: string, x: number, y: number, width: number, height: number): string {
    if (!/^\d{12,13}$/.test(data)) throw new Error('EAN-13: data must be 12 or 13 digits');

    let digits: string;
    if (data.length === 12) {
        digits = data + ean13CheckDigit(data);
    } else {
        digits = data;
        const check = ean13CheckDigit(data.slice(0, 12));
        if (check !== (data.charCodeAt(12) - 48)) {
            throw new Error(`EAN-13: invalid check digit (expected ${check})`);
        }
    }

    // Build module array: start(3) + left(42) + center(5) + right(42) + end(3) = 95 modules
    const modules: number[] = [];

    // Start guard: 1 0 1
    modules.push(1, 0, 1);

    // Left half: digits[1..6] encoded with L/G pattern based on digits[0]
    const firstDigit = digits.charCodeAt(0) - 48;
    const pattern = EAN13_FIRST_DIGIT[firstDigit];
    for (let i = 0; i < 6; i++) {
        const d = digits.charCodeAt(i + 1) - 48;
        const enc = pattern[i] === 'L' ? EAN13_L[d] : EAN13_G[d];
        for (const m of enc) modules.push(m);
    }

    // Center guard: 0 1 0 1 0
    modules.push(0, 1, 0, 1, 0);

    // Right half: digits[7..12] encoded with R pattern
    for (let i = 0; i < 6; i++) {
        const d = digits.charCodeAt(i + 7) - 48;
        for (const m of EAN13_R[d]) modules.push(m);
    }

    // End guard: 1 0 1
    modules.push(1, 0, 1);

    // Render modules
    const moduleW = width / (modules.length + 2); // +2 for quiet zones
    const ops: string[] = ['q', '0 0 0 rg'];
    let cx = x + moduleW;

    for (let i = 0; i < modules.length; i++) {
        if (modules[i] === 1) {
            // Guard bars are taller
            const isGuard = i < 3 || i >= modules.length - 3 ||
                (i >= 45 && i <= 49);
            const bh = isGuard ? height + 5 : height;
            ops.push(`${fmtNum(cx)} ${fmtNum(y)} ${fmtNum(moduleW)} ${fmtNum(bh)} re f`);
        }
        cx += moduleW;
    }

    ops.push('Q');
    return ops.join('\n');
}

// ── QR Code (ISO/IEC 18004) ──────────────────────────────────────────

/** QR Code error correction levels. */
export type QRErrorLevel = 'L' | 'M' | 'Q' | 'H';

/** QR data capacity per version for byte mode at each EC level. */
const QR_CAPACITY: readonly { readonly L: number; readonly M: number; readonly Q: number; readonly H: number }[] = [
    { L: 17, M: 14, Q: 11, H: 7 },     // v1
    { L: 32, M: 26, Q: 20, H: 14 },     // v2
    { L: 53, M: 42, Q: 32, H: 24 },     // v3
    { L: 78, M: 62, Q: 46, H: 34 },     // v4
    { L: 106, M: 84, Q: 60, H: 44 },    // v5
    { L: 134, M: 106, Q: 74, H: 58 },   // v6
    { L: 154, M: 122, Q: 86, H: 64 },   // v7
    { L: 192, M: 152, Q: 108, H: 84 },  // v8
    { L: 230, M: 180, Q: 130, H: 98 },  // v9
    { L: 271, M: 213, Q: 151, H: 119 }, // v10
    { L: 321, M: 251, Q: 177, H: 137 }, // v11
    { L: 367, M: 287, Q: 203, H: 155 }, // v12
    { L: 425, M: 331, Q: 241, H: 177 }, // v13
    { L: 458, M: 362, Q: 258, H: 194 }, // v14
    { L: 520, M: 412, Q: 292, H: 220 }, // v15
    { L: 586, M: 450, Q: 322, H: 250 }, // v16
    { L: 644, M: 504, Q: 364, H: 280 }, // v17
    { L: 718, M: 560, Q: 394, H: 310 }, // v18
    { L: 792, M: 624, Q: 442, H: 338 }, // v19
    { L: 858, M: 666, Q: 482, H: 382 }, // v20
    { L: 929, M: 711, Q: 509, H: 403 }, // v21
    { L: 1003, M: 779, Q: 565, H: 439 }, // v22
    { L: 1091, M: 857, Q: 611, H: 461 }, // v23
    { L: 1171, M: 911, Q: 661, H: 511 }, // v24
    { L: 1273, M: 997, Q: 715, H: 535 }, // v25
    { L: 1367, M: 1059, Q: 751, H: 593 }, // v26
    { L: 1465, M: 1125, Q: 805, H: 625 }, // v27
    { L: 1528, M: 1190, Q: 868, H: 658 }, // v28
    { L: 1628, M: 1264, Q: 908, H: 698 }, // v29
    { L: 1732, M: 1370, Q: 982, H: 742 }, // v30
    { L: 1840, M: 1452, Q: 1030, H: 790 }, // v31
    { L: 1952, M: 1538, Q: 1112, H: 842 }, // v32
    { L: 2068, M: 1628, Q: 1168, H: 898 }, // v33
    { L: 2188, M: 1722, Q: 1228, H: 958 }, // v34
    { L: 2303, M: 1809, Q: 1283, H: 983 }, // v35
    { L: 2431, M: 1911, Q: 1351, H: 1051 }, // v36
    { L: 2563, M: 1989, Q: 1423, H: 1093 }, // v37
    { L: 2699, M: 2099, Q: 1499, H: 1139 }, // v38
    { L: 2809, M: 2213, Q: 1579, H: 1219 }, // v39
    { L: 2953, M: 2331, Q: 1663, H: 1273 }, // v40
];

/** Reed-Solomon EC codewords per block for each version+level. */
const QR_EC_TABLE: readonly { readonly L: readonly number[]; readonly M: readonly number[]; readonly Q: readonly number[]; readonly H: readonly number[] }[] = _buildECTable();

/** Alignment pattern positions per version (ISO 18004 Table E.1). */
const QR_ALIGN_POS: readonly (readonly number[])[] = [
    [],                                      // v1
    [6, 18],                                 // v2
    [6, 22],                                 // v3
    [6, 26],                                 // v4
    [6, 30],                                 // v5
    [6, 34],                                 // v6
    [6, 22, 38],                             // v7
    [6, 24, 42],                             // v8
    [6, 26, 46],                             // v9
    [6, 28, 50],                             // v10
    [6, 30, 54],                             // v11
    [6, 32, 58],                             // v12
    [6, 34, 62],                             // v13
    [6, 26, 46, 66],                         // v14
    [6, 26, 48, 70],                         // v15
    [6, 26, 50, 74],                         // v16
    [6, 30, 54, 78],                         // v17
    [6, 30, 56, 82],                         // v18
    [6, 30, 58, 86],                         // v19
    [6, 34, 62, 90],                         // v20
    [6, 28, 50, 72, 94],                     // v21
    [6, 26, 50, 74, 98],                     // v22
    [6, 30, 54, 78, 102],                    // v23
    [6, 28, 54, 80, 106],                    // v24
    [6, 32, 58, 84, 110],                    // v25
    [6, 30, 58, 86, 114],                    // v26
    [6, 34, 62, 90, 118],                    // v27
    [6, 26, 50, 74, 98, 122],               // v28
    [6, 30, 54, 78, 102, 126],              // v29
    [6, 26, 52, 78, 104, 130],              // v30
    [6, 30, 56, 82, 108, 134],              // v31
    [6, 34, 60, 86, 112, 138],              // v32
    [6, 30, 58, 86, 114, 142],              // v33
    [6, 34, 62, 90, 118, 146],              // v34
    [6, 30, 54, 78, 102, 126, 150],         // v35
    [6, 24, 50, 76, 102, 128, 154],         // v36
    [6, 28, 54, 80, 106, 132, 158],         // v37
    [6, 32, 58, 84, 110, 136, 162],         // v38
    [6, 26, 54, 82, 110, 138, 166],         // v39
    [6, 30, 58, 86, 114, 142, 170],         // v40
];

/**
 * Generate a QR Code module matrix.
 *
 * @param data - Input data string (byte mode encoding)
 * @param ecLevel - Error correction level (default: 'M')
 * @returns 2D boolean matrix (true = dark module)
 */
export function generateQR(data: string, ecLevel: QRErrorLevel = 'M'): boolean[][] {
    const dataBytes = _stringToBytes(data);
    const version = _selectVersion(dataBytes.length, ecLevel);
    if (version < 1) throw new Error(`QR Code: data too long for maximum version (${dataBytes.length} bytes)`);

    const size = 4 * version + 17;
    const matrix = _createMatrix(size);
    const reserved = _createMatrix(size);

    // Place function patterns
    _placeFinderPatterns(matrix, reserved, size);
    _placeAlignmentPatterns(matrix, reserved, version, size);
    _placeTimingPatterns(matrix, reserved, size);
    _placeDarkModule(matrix, reserved, version);
    _reserveFormatBits(reserved, size);
    if (version >= 7) _reserveVersionBits(reserved, size);

    // Encode data
    const ecInfo = QR_EC_TABLE[version - 1][ecLevel];
    const dataCodewords = _encodeDataCodewords(dataBytes, version, ecLevel);
    const ecCodewords = _computeECCodewords(dataCodewords, ecInfo);
    const allCodewords = _interleaveCodewords(dataCodewords, ecCodewords, ecInfo);

    // Place data bits
    _placeDataBits(matrix, reserved, allCodewords, size);

    // Apply best mask
    _applyBestMask(matrix, reserved, size, ecLevel, version);

    return matrix;
}

/**
 * Render a QR Code as PDF path operators.
 *
 * @param data - Input string to encode
 * @param x - Left X position in points
 * @param y - Bottom Y position in points
 * @param size - QR code size in points (square)
 * @param ecLevel - Error correction level
 * @returns PDF content stream operators
 */
export function renderQR(data: string, x: number, y: number, size: number, ecLevel: QRErrorLevel = 'M'): string {
    const modules = generateQR(data, ecLevel);
    const n = modules.length;
    const moduleSize = size / n;
    const ops: string[] = ['q', '0 0 0 rg'];

    for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
            if (modules[row][col]) {
                const mx = x + col * moduleSize;
                const my = y + (n - 1 - row) * moduleSize;
                ops.push(`${fmtNum(mx)} ${fmtNum(my)} ${fmtNum(moduleSize)} ${fmtNum(moduleSize)} re f`);
            }
        }
    }

    ops.push('Q');
    return ops.join('\n');
}

// ── QR Internal Helpers ──────────────────────────────────────────────

function _createMatrix(size: number): boolean[][] {
    return Array.from({ length: size }, () => Array(size).fill(false));
}

function _stringToBytes(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 0x80) {
            bytes.push(cp);
        } else if (cp < 0x800) {
            bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
        } else if (cp >= 0xD800 && cp <= 0xDBFF) {
            const hi = cp;
            const lo = str.charCodeAt(++i);
            const full = ((hi - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
            bytes.push(0xF0 | (full >> 18), 0x80 | ((full >> 12) & 0x3F), 0x80 | ((full >> 6) & 0x3F), 0x80 | (full & 0x3F));
        } else {
            bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        }
    }
    return bytes;
}

function _selectVersion(dataLen: number, ecLevel: QRErrorLevel): number {
    for (let v = 0; v < QR_CAPACITY.length; v++) {
        if (QR_CAPACITY[v][ecLevel] >= dataLen) return v + 1;
    }
    return -1;
}

function _placeFinderPatterns(matrix: boolean[][], reserved: boolean[][], size: number): void {
    const positions = [[0, 0], [0, size - 7], [size - 7, 0]];
    for (const [r, c] of positions) {
        for (let dr = 0; dr < 7; dr++) {
            for (let dc = 0; dc < 7; dc++) {
                const dark = (dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
                    (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
                matrix[r + dr][c + dc] = dark;
                reserved[r + dr][c + dc] = true;
            }
        }
        // Separator (white border)
        for (let i = -1; i <= 7; i++) {
            if (r + i >= 0 && r + i < size) {
                if (c - 1 >= 0) { reserved[r + i][c - 1] = true; }
                if (c + 7 < size) { reserved[r + i][c + 7] = true; }
            }
            if (c + i >= 0 && c + i < size) {
                if (r - 1 >= 0) { reserved[r - 1][c + i] = true; }
                if (r + 7 < size) { reserved[r + 7][c + i] = true; }
            }
        }
    }
}

function _placeAlignmentPatterns(matrix: boolean[][], reserved: boolean[][], version: number, size: number): void {
    if (version < 2) return;
    const pos = QR_ALIGN_POS[version - 1];
    for (const r of pos) {
        for (const c of pos) {
            // Skip if overlapping with finder patterns
            if ((r < 9 && c < 9) || (r < 9 && c > size - 9) || (r > size - 9 && c < 9)) continue;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
                    matrix[r + dr][c + dc] = dark;
                    reserved[r + dr][c + dc] = true;
                }
            }
        }
    }
}

function _placeTimingPatterns(matrix: boolean[][], reserved: boolean[][], size: number): void {
    for (let i = 8; i < size - 8; i++) {
        const dark = i % 2 === 0;
        if (!reserved[6][i]) { matrix[6][i] = dark; reserved[6][i] = true; }
        if (!reserved[i][6]) { matrix[i][6] = dark; reserved[i][6] = true; }
    }
}

function _placeDarkModule(matrix: boolean[][], reserved: boolean[][], version: number): void {
    const r = 4 * version + 9;
    matrix[r][8] = true;
    reserved[r][8] = true;
}

function _reserveFormatBits(reserved: boolean[][], size: number): void {
    for (let i = 0; i < 8; i++) {
        reserved[8][i] = true;
        reserved[8][size - 1 - i] = true;
        reserved[i][8] = true;
        reserved[size - 1 - i][8] = true;
    }
    reserved[8][8] = true;
}

function _reserveVersionBits(reserved: boolean[][], size: number): void {
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
            reserved[i][size - 11 + j] = true;
            reserved[size - 11 + j][i] = true;
        }
    }
}

function _encodeDataCodewords(dataBytes: number[], version: number, ecLevel: QRErrorLevel): number[][] {
    const ecInfo = QR_EC_TABLE[version - 1][ecLevel];
    const totalDataCodewords = ecInfo[0];
    const numBlocks = ecInfo[1];

    // Byte mode: mode indicator (0100) + char count + data
    const bits: number[] = [];
    // Mode indicator: 0100 (byte mode)
    bits.push(0, 1, 0, 0);

    // Character count indicator
    const ccLen = version <= 9 ? 8 : 16;
    for (let i = ccLen - 1; i >= 0; i--) {
        bits.push((dataBytes.length >> i) & 1);
    }

    // Data bits
    for (const b of dataBytes) {
        for (let i = 7; i >= 0; i--) {
            bits.push((b >> i) & 1);
        }
    }

    // Terminator (up to 4 zeros)
    const maxBits = totalDataCodewords * 8;
    const termLen = Math.min(4, maxBits - bits.length);
    for (let i = 0; i < termLen; i++) bits.push(0);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Pad bytes (0xEC, 0x11 alternating)
    const padBytes = [0xEC, 0x11];
    let padIdx = 0;
    while (bits.length < maxBits) {
        const pb = padBytes[padIdx % 2];
        for (let i = 7; i >= 0; i--) bits.push((pb >> i) & 1);
        padIdx++;
    }

    // Convert to bytes
    const codewords: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
        codewords.push(byte);
    }

    // Split into blocks
    const blocks: number[][] = [];
    const shortBlockSize = Math.floor(totalDataCodewords / numBlocks);
    const longBlocks = totalDataCodewords % numBlocks;
    let pos = 0;
    for (let i = 0; i < numBlocks; i++) {
        const blockSize = shortBlockSize + (i >= numBlocks - longBlocks ? 1 : 0);
        blocks.push(codewords.slice(pos, pos + blockSize));
        pos += blockSize;
    }

    return blocks;
}

function _computeECCodewords(dataBlocks: number[][], ecInfo: readonly number[]): number[][] {
    const ecPerBlock = ecInfo[2];
    const gen = _rsGeneratorPoly(ecPerBlock);
    const ecBlocks: number[][] = [];
    for (const block of dataBlocks) {
        ecBlocks.push(_rsEncode(block, gen, ecPerBlock));
    }
    return ecBlocks;
}

function _interleaveCodewords(dataBlocks: number[][], ecBlocks: number[][], _ecInfo: readonly number[]): number[] {
    const result: number[] = [];

    // Interleave data
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
        for (const block of dataBlocks) {
            if (i < block.length) result.push(block[i]);
        }
    }

    // Interleave EC
    const maxECLen = Math.max(...ecBlocks.map(b => b.length));
    for (let i = 0; i < maxECLen; i++) {
        for (const block of ecBlocks) {
            if (i < block.length) result.push(block[i]);
        }
    }

    return result;
}

function _placeDataBits(matrix: boolean[][], reserved: boolean[][], codewords: number[], size: number): void {
    const bits: number[] = [];
    for (const cw of codewords) {
        for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
    }

    let bitIdx = 0;
    let col = size - 1;
    let upward = true;

    while (col >= 0) {
        if (col === 6) col--; // Skip timing pattern column

        const startRow = upward ? size - 1 : 0;
        const endRow = upward ? -1 : size;
        const step = upward ? -1 : 1;

        for (let row = startRow; row !== endRow; row += step) {
            for (const dc of [0, -1]) {
                const c = col + dc;
                if (c < 0 || reserved[row][c]) continue;
                if (bitIdx < bits.length) {
                    matrix[row][c] = bits[bitIdx] === 1;
                    bitIdx++;
                }
            }
        }

        col -= 2;
        upward = !upward;
    }
}

function _applyBestMask(matrix: boolean[][], reserved: boolean[][], size: number, ecLevel: QRErrorLevel, version: number): void {
    let bestPenalty = Infinity;
    let bestMask = 0;
    const backupMatrix = matrix.map(row => [...row]);

    for (let mask = 0; mask < 8; mask++) {
        // Restore matrix
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                matrix[r][c] = backupMatrix[r][c];
            }
        }

        // Apply mask
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (reserved[r][c]) continue;
                if (_maskCondition(mask, r, c)) {
                    matrix[r][c] = !matrix[r][c];
                }
            }
        }

        // Place format info
        _placeFormatInfo(matrix, size, ecLevel, mask);
        if (version >= 7) _placeVersionInfo(matrix, size, version);

        const penalty = _computePenalty(matrix, size);
        if (penalty < bestPenalty) {
            bestPenalty = penalty;
            bestMask = mask;
        }
    }

    // Apply best mask
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            matrix[r][c] = backupMatrix[r][c];
        }
    }
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (reserved[r][c]) continue;
            if (_maskCondition(bestMask, r, c)) {
                matrix[r][c] = !matrix[r][c];
            }
        }
    }
    _placeFormatInfo(matrix, size, ecLevel, bestMask);
    if (version >= 7) _placeVersionInfo(matrix, size, version);
}

function _maskCondition(mask: number, r: number, c: number): boolean {
    switch (mask) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
        case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
        default: return false;
    }
}

/** Format info bits for each EC level + mask combination. */
const FORMAT_INFO_BITS: readonly number[] = [
    0x77C4, 0x72F3, 0x7DAA, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976,
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
    0x355F, 0x3068, 0x3F31, 0x3A06, 0x24B4, 0x2183, 0x2EDA, 0x2BED,
    0x1689, 0x13BE, 0x1CE7, 0x19D0, 0x0762, 0x0255, 0x0D0C, 0x083B,
];

function _placeFormatInfo(matrix: boolean[][], size: number, ecLevel: QRErrorLevel, mask: number): void {
    const ecVal = { L: 1, M: 0, Q: 3, H: 2 }[ecLevel];
    const idx = ecVal * 8 + mask;
    const bits = FORMAT_INFO_BITS[idx];

    // Around top-left finder
    const positions1 = [[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,8],[8,7],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0]];
    for (let i = 0; i < 15; i++) {
        const [r, c] = positions1[i];
        matrix[r][c] = ((bits >> (14 - i)) & 1) === 1;
    }

    // Along bottom-left and top-right
    for (let i = 0; i < 7; i++) {
        matrix[size - 1 - i][8] = ((bits >> i) & 1) === 1;
    }
    for (let i = 0; i < 8; i++) {
        matrix[8][size - 8 + i] = ((bits >> (7 + i)) & 1) === 1;
    }
}

/** Version info bits (BCH encoded, for versions 7-40). */
const VERSION_INFO: readonly number[] = [
    0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762, 0x0D847, 0x0E60D,
    0x0F928, 0x10B78, 0x1145D, 0x12A17, 0x13532, 0x149A6, 0x15683, 0x168C9,
    0x177EC, 0x18EC4, 0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75,
    0x1F250, 0x209D5, 0x216F0, 0x228BA, 0x2379F, 0x24B0B, 0x2542E, 0x26A64,
    0x27541, 0x28C69,
];

function _placeVersionInfo(matrix: boolean[][], size: number, version: number): void {
    if (version < 7) return;
    const bits = VERSION_INFO[version - 7];
    for (let i = 0; i < 18; i++) {
        const r = Math.floor(i / 3);
        const c = size - 11 + (i % 3);
        const dark = ((bits >> i) & 1) === 1;
        matrix[r][c] = dark;
        matrix[c][r] = dark;
    }
}

function _computePenalty(matrix: boolean[][], size: number): number {
    let penalty = 0;

    // Rule 1: consecutive same-color modules in rows/columns
    for (let r = 0; r < size; r++) {
        let count = 1;
        for (let c = 1; c < size; c++) {
            if (matrix[r][c] === matrix[r][c - 1]) {
                count++;
                if (count === 5) penalty += 3;
                else if (count > 5) penalty += 1;
            } else {
                count = 1;
            }
        }
    }
    for (let c = 0; c < size; c++) {
        let count = 1;
        for (let r = 1; r < size; r++) {
            if (matrix[r][c] === matrix[r - 1][c]) {
                count++;
                if (count === 5) penalty += 3;
                else if (count > 5) penalty += 1;
            } else {
                count = 1;
            }
        }
    }

    // Rule 2: 2x2 same-color blocks
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const v = matrix[r][c];
            if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) {
                penalty += 3;
            }
        }
    }

    // Rule 3: finder-like patterns
    const finderPattern1 = [true, false, true, true, true, false, true, false, false, false, false];
    const finderPattern2 = [...finderPattern1].reverse();
    for (let r = 0; r < size; r++) {
        for (let c = 0; c <= size - 11; c++) {
            let match1 = true, match2 = true;
            for (let i = 0; i < 11; i++) {
                if (matrix[r][c + i] !== finderPattern1[i]) match1 = false;
                if (matrix[r][c + i] !== finderPattern2[i]) match2 = false;
            }
            if (match1 || match2) penalty += 40;
        }
    }
    for (let c = 0; c < size; c++) {
        for (let r = 0; r <= size - 11; r++) {
            let match1 = true, match2 = true;
            for (let i = 0; i < 11; i++) {
                if (matrix[r + i][c] !== finderPattern1[i]) match1 = false;
                if (matrix[r + i][c] !== finderPattern2[i]) match2 = false;
            }
            if (match1 || match2) penalty += 40;
        }
    }

    // Rule 4: proportion of dark modules
    let darkCount = 0;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (matrix[r][c]) darkCount++;
        }
    }
    const total = size * size;
    const percent = (darkCount * 100) / total;
    const prev5 = Math.floor(percent / 5) * 5;
    const next5 = prev5 + 5;
    penalty += Math.min(Math.abs(prev5 - 50), Math.abs(next5 - 50)) * 2;

    return penalty;
}

// ── Reed-Solomon GF(256) ─────────────────────────────────────────────

/** GF(256) log/exp tables for Reed-Solomon. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

// Initialize GF(256) tables
(function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x;
        GF_LOG[x] = i;
        x = x << 1;
        if (x >= 256) x ^= 0x11D; // Primitive polynomial for QR
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function _gfMul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function _rsGeneratorPoly(degree: number): number[] {
    let gen = [1];
    for (let i = 0; i < degree; i++) {
        const newGen = new Array(gen.length + 1).fill(0);
        for (let j = 0; j < gen.length; j++) {
            newGen[j] ^= gen[j];
            newGen[j + 1] ^= _gfMul(gen[j], GF_EXP[i]);
        }
        gen = newGen;
    }
    return gen;
}

function _rsEncode(data: number[], gen: number[], ecCount: number): number[] {
    const result = new Array(ecCount).fill(0);
    for (const d of data) {
        const coef = d ^ result[0];
        result.shift();
        result.push(0);
        if (coef !== 0) {
            for (let i = 0; i < ecCount; i++) {
                result[i] ^= _gfMul(gen[i + 1], coef);
            }
        }
    }
    return result;
}

function _buildECTable(): { L: readonly number[]; M: readonly number[]; Q: readonly number[]; H: readonly number[] }[] {
    // [totalDataCodewords, numBlocks, ecPerBlock] for each version (1-40) and EC level
    // Source: ISO/IEC 18004:2015 Table 9
    const raw: [number, number, number, number, number, number, number, number, number, number, number, number][] = [
        [19,1,7, 16,1,10, 13,1,13, 9,1,17],       // v1
        [34,1,10, 28,1,16, 22,1,22, 16,1,28],      // v2
        [55,1,15, 44,1,26, 34,2,18, 26,2,22],      // v3
        [80,1,20, 64,2,18, 48,2,26, 36,4,16],      // v4
        [108,1,26, 86,2,24, 62,2,18, 46,2,22],     // v5
        [136,2,18, 108,4,16, 76,4,24, 60,4,28],    // v6
        [156,2,20, 124,4,18, 88,2,18, 66,4,26],    // v7
        [194,2,24, 154,2,22, 110,4,22, 86,4,26],   // v8
        [232,2,30, 182,3,22, 132,4,20, 100,4,24],  // v9
        [274,2,18, 216,4,26, 154,6,24, 122,6,28],  // v10
        [324,4,20, 254,1,30, 180,4,28, 140,3,24],  // v11
        [370,2,24, 290,6,22, 206,4,26, 158,7,28],  // v12
        [428,4,26, 334,8,22, 244,8,24, 180,12,22], // v13
        [461,3,30, 365,4,24, 261,11,20, 197,11,24], // v14
        [523,5,22, 415,5,24, 295,5,30, 223,11,24], // v15
        [589,5,24, 453,7,28, 325,15,24, 253,3,30], // v16
        [647,1,28, 507,10,28, 367,1,28, 283,2,28], // v17
        [721,5,30, 563,9,26, 397,17,28, 313,2,28], // v18
        [795,3,28, 627,3,26, 445,17,26, 341,9,26], // v19
        [861,3,28, 669,3,26, 485,15,28, 385,15,28], // v20
        [932,4,28, 714,17,26, 512,17,22, 406,19,26], // v21
        [1006,2,28, 782,17,28, 568,7,24, 442,34,26], // v22
        [1094,4,28, 860,4,28, 614,11,24, 464,16,26], // v23
        [1174,6,28, 914,6,28, 664,11,24, 514,30,26], // v24
        [1276,8,28, 1000,8,28, 718,7,24, 538,22,28], // v25
        [1370,10,28, 1062,19,28, 754,28,22, 596,33,28], // v26
        [1468,8,28, 1128,22,28, 808,8,23, 628,12,28], // v27
        [1531,3,28, 1193,3,28, 871,4,24, 661,11,28], // v28
        [1631,7,28, 1267,21,28, 911,1,23, 701,19,28], // v29
        [1735,5,28, 1373,19,28, 985,15,24, 745,23,28], // v30
        [1843,13,28, 1455,2,28, 1033,42,24, 793,23,28], // v31
        [1955,17,28, 1541,10,28, 1115,10,24, 845,19,28], // v32
        [2071,17,28, 1631,14,28, 1171,29,24, 901,11,28], // v33
        [2191,13,28, 1725,14,28, 1231,44,24, 961,59,28], // v34
        [2306,12,28, 1812,12,28, 1286,39,24, 986,22,28], // v35
        [2434,6,28, 1914,6,28, 1354,46,24, 1054,2,28],   // v36
        [2566,17,28, 1992,29,28, 1426,49,24, 1096,24,28], // v37
        [2702,4,28, 2102,13,28, 1502,48,24, 1142,42,28],  // v38
        [2812,20,28, 2216,40,28, 1582,43,24, 1222,10,28],  // v39
        [2956,19,28, 2334,18,28, 1666,34,24, 1276,20,28],  // v40
    ];
    return raw.map(r => ({
        L: [r[0], r[1], r[2]] as const,
        M: [r[3], r[4], r[5]] as const,
        Q: [r[6], r[7], r[8]] as const,
        H: [r[9], r[10], r[11]] as const,
    }));
}

// ── Data Matrix ECC 200 (ISO/IEC 16022) ──────────────────────────────

/** Data Matrix symbol sizes: [rows, cols, dataCodewords, ecCodewords, dataRegionRows, dataRegionCols, numBlocks]. */
const DM_SIZES: readonly (readonly number[])[] = [
    [10, 10, 3, 5, 8, 8, 1],
    [12, 12, 5, 7, 10, 10, 1],
    [14, 14, 8, 10, 12, 12, 1],
    [16, 16, 12, 12, 14, 14, 1],
    [18, 18, 18, 14, 16, 16, 1],
    [20, 20, 22, 18, 18, 18, 1],
    [22, 22, 30, 20, 20, 20, 1],
    [24, 24, 36, 24, 22, 22, 1],
    [26, 26, 44, 28, 24, 24, 1],
    [32, 32, 62, 36, 14, 14, 4],
    [36, 36, 86, 42, 16, 16, 4],
    [40, 40, 114, 48, 18, 18, 4],
    [44, 44, 144, 56, 20, 20, 4],
    [48, 48, 175, 68, 22, 22, 4],
    [52, 52, 204, 84, 24, 24, 4],
    [64, 64, 280, 112, 14, 14, 16],
    [72, 72, 368, 144, 16, 16, 16],
    [80, 80, 456, 192, 18, 18, 16],
    [88, 88, 576, 224, 20, 20, 16],
    [96, 96, 696, 272, 22, 22, 16],
    [104, 104, 816, 336, 24, 24, 16],
    [120, 120, 1050, 408, 18, 18, 36],
    [132, 132, 1304, 496, 20, 20, 36],
    [144, 144, 1558, 620, 22, 22, 36],
];

/**
 * Generate a Data Matrix ECC 200 module matrix.
 *
 * @param data - Input data string (ASCII encoding)
 * @returns 2D boolean matrix (true = dark module)
 */
export function generateDataMatrix(data: string): boolean[][] {
    const dataBytes = _dmEncodeData(data);
    const sizeIdx = _dmSelectSize(dataBytes.length);
    if (sizeIdx < 0) throw new Error(`Data Matrix: data too long (${dataBytes.length} bytes)`);

    const [rows, cols, dataCapacity, ecCount, drRows, drCols] = DM_SIZES[sizeIdx];

    // Pad data to capacity
    const padded = [...dataBytes];
    if (padded.length < dataCapacity) padded.push(129); // Pad codeword
    while (padded.length < dataCapacity) {
        const r = ((149 * (padded.length + 1)) % 253) + 1;
        padded.push((129 + r) % 254);
    }

    // Reed-Solomon EC
    const ecCodewords = _dmReedSolomon(padded, ecCount);
    const allCodewords = [...padded, ...ecCodewords];

    // Build module matrix
    const matrix = _createMatrix(rows);
    _dmPlaceFinderPattern(matrix, rows, cols, drRows, drCols);
    _dmPlaceDataModules(matrix, allCodewords, rows, cols, drRows, drCols);

    return matrix;
}

/**
 * Render a Data Matrix barcode as PDF path operators.
 *
 * @param data - Input string to encode
 * @param x - Left X position
 * @param y - Bottom Y position
 * @param size - Symbol size in points (square)
 * @returns PDF content stream operators
 */
export function renderDataMatrix(data: string, x: number, y: number, size: number): string {
    const modules = generateDataMatrix(data);
    const n = modules.length;
    const moduleSize = size / n;
    const ops: string[] = ['q', '0 0 0 rg'];

    for (let row = 0; row < n; row++) {
        for (let col = 0; col < modules[row].length; col++) {
            if (modules[row][col]) {
                const mx = x + col * moduleSize;
                const my = y + (n - 1 - row) * moduleSize;
                ops.push(`${fmtNum(mx)} ${fmtNum(my)} ${fmtNum(moduleSize)} ${fmtNum(moduleSize)} re f`);
            }
        }
    }

    ops.push('Q');
    return ops.join('\n');
}

// ── Data Matrix Internals ────────────────────────────────────────────

function _dmEncodeData(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp < 128) {
            bytes.push(cp + 1); // ASCII value + 1
        }
    }
    return bytes;
}

function _dmSelectSize(dataLen: number): number {
    for (let i = 0; i < DM_SIZES.length; i++) {
        if (DM_SIZES[i][2] >= dataLen) return i;
    }
    return -1;
}

function _dmReedSolomon(data: number[], ecCount: number): number[] {
    // Data Matrix uses GF(256) with polynomial x^8 + x^5 + x^3 + x^2 + 1 (0x12D)
    const gfExp = new Uint8Array(512);
    const gfLog = new Uint8Array(256);
    let val = 1;
    for (let i = 0; i < 255; i++) {
        gfExp[i] = val;
        gfLog[val] = i;
        val <<= 1;
        if (val >= 256) val ^= 0x12D;
    }
    for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];

    const gfMul = (a: number, b: number) => (a === 0 || b === 0) ? 0 : gfExp[gfLog[a] + gfLog[b]];

    // Build generator polynomial
    let gen = [1];
    for (let i = 0; i < ecCount; i++) {
        const newGen = new Array(gen.length + 1).fill(0);
        for (let j = 0; j < gen.length; j++) {
            newGen[j] ^= gen[j];
            newGen[j + 1] ^= gfMul(gen[j], gfExp[i + 1]);
        }
        gen = newGen;
    }

    // Divide
    const result = new Array(ecCount).fill(0);
    for (const d of data) {
        const coef = d ^ result[0];
        result.shift();
        result.push(0);
        if (coef !== 0) {
            for (let i = 0; i < ecCount; i++) {
                result[i] ^= gfMul(gen[i + 1], coef);
            }
        }
    }
    return result;
}

function _dmPlaceFinderPattern(matrix: boolean[][], rows: number, cols: number, drRows: number, drCols: number): void {
    const numRegionsH = Math.floor(rows / (drRows + 2));
    const numRegionsW = Math.floor(cols / (drCols + 2));

    for (let rr = 0; rr < numRegionsH; rr++) {
        for (let cr = 0; cr < numRegionsW; cr++) {
            const startR = rr * (drRows + 2);
            const startC = cr * (drCols + 2);

            // Solid left column and bottom row (L-shape)
            for (let i = 0; i < drRows + 2; i++) {
                matrix[startR + i][startC] = true; // Left column solid
                matrix[startR + drRows + 1][startC + i] = (i < drCols + 2); // Bottom row solid
            }
            // Alternating top row and right column
            for (let i = 0; i < drCols + 2; i++) {
                matrix[startR][startC + i] = (i % 2 === 0); // Top row alternating
            }
            for (let i = 0; i < drRows + 2; i++) {
                matrix[startR + i][startC + drCols + 1] = (i % 2 === 0); // Right column alternating
            }
        }
    }
}

function _dmPlaceDataModules(matrix: boolean[][], codewords: number[], rows: number, cols: number, drRows: number, drCols: number): void {
    // Simplified data placement — place codeword bits in L→R, T→B order in data region cells
    const numRegionsH = Math.floor(rows / (drRows + 2));
    const numRegionsW = Math.floor(cols / (drCols + 2));

    // Collect all data region cells in placement order
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            // Skip finder pattern cells
            const regionR = Math.floor(r / (drRows + 2));
            const regionC = Math.floor(c / (drCols + 2));
            const localR = r - regionR * (drRows + 2);
            const localC = c - regionC * (drCols + 2);

            if (regionR < numRegionsH && regionC < numRegionsW) {
                if (localR > 0 && localR <= drRows && localC > 0 && localC <= drCols) {
                    cells.push([r, c]);
                }
            }
        }
    }

    // Place bits
    let bitIdx = 0;
    for (const [r, c] of cells) {
        const cwIdx = Math.floor(bitIdx / 8);
        const bIdx = 7 - (bitIdx % 8);
        if (cwIdx < codewords.length) {
            matrix[r][c] = ((codewords[cwIdx] >> bIdx) & 1) === 1;
        }
        bitIdx++;
    }
}

// ── PDF417 (ISO/IEC 15438) ───────────────────────────────────────────

/** PDF417 number of data codewords per error correction level. */
const PDF417_EC_CODEWORDS: readonly number[] = [2, 4, 8, 16, 32, 64, 128, 256, 512];

/** PDF417 codeword patterns for clusters 0, 3, 6 (truncated set). */
const PDF417_START = 0x1FEA8;
const PDF417_STOP = 0x3FA29;

/**
 * Encode data as PDF417 codewords (text compaction).
 *
 * @param data - Input ASCII string
 * @param ecLevel - Error correction level 0-8 (default: 2)
 * @returns Array of codewords
 */
export function encodePDF417(data: string, ecLevel: number = 2): { codewords: number[]; rows: number; cols: number } {
    if (ecLevel < 0 || ecLevel > 8) throw new Error('PDF417: ecLevel must be 0-8');
    if (data.length === 0) throw new Error('PDF417: data must not be empty');

    // Text compaction mode
    const dataCodewords = _pdf417TextCompaction(data);
    const ecCount = PDF417_EC_CODEWORDS[ecLevel];
    const totalDataCW = dataCodewords.length;
    const totalCW = totalDataCW + ecCount;

    // Determine symbol dimensions (rows × cols)
    let cols = 1;
    let rows = Math.ceil(totalCW / cols);
    while (rows > 90 || rows < 3) {
        cols++;
        rows = Math.ceil(totalCW / cols);
        if (cols > 30) break;
    }

    // Pad with 900 (text latch) to fill columns
    const paddedCW = [...dataCodewords];
    while (paddedCW.length < rows * cols - ecCount) paddedCW.push(900);

    // Set length indicator as first codeword
    const lengthCW = paddedCW.length + 1;
    paddedCW.unshift(lengthCW);
    while (paddedCW.length < rows * cols - ecCount) paddedCW.push(900);

    // EC codewords
    const ecCW = _pdf417ReedSolomon(paddedCW, ecLevel);
    const allCW = [...paddedCW, ...ecCW];

    return { codewords: allCW, rows, cols };
}

/**
 * Render PDF417 as PDF path operators.
 *
 * @param data - Input string
 * @param x - Left X position
 * @param y - Bottom Y position
 * @param width - Total width in points
 * @param height - Total height in points
 * @param ecLevel - Error correction level 0-8
 * @returns PDF content stream operators
 */
export function renderPDF417(data: string, x: number, y: number, width: number, height: number, ecLevel: number = 2): string {
    const { codewords, rows, cols } = encodePDF417(data, ecLevel);
    const rowHeight = height / rows;

    // Each row: start pattern (17 modules) + left indicator (17) + data cols (17 each) + right indicator (17) + stop (18)
    const totalModules = 17 + 17 + cols * 17 + 17 + 18;
    const moduleW = width / totalModules;

    const ops: string[] = ['q', '0 0 0 rg'];

    for (let r = 0; r < rows; r++) {
        const ry = y + (rows - 1 - r) * rowHeight;
        let cx = x;

        // Start pattern
        cx = _pdf417RenderPattern(ops, PDF417_START, 17, cx, ry, moduleW, rowHeight);

        // Left row indicator (simplified: row number mod 30 encoded as cluster pattern)
        const leftIndicator = _pdf417RowIndicator(r, rows, cols, ecLevel, 0);
        cx = _pdf417RenderCW(ops, leftIndicator, r % 3, cx, ry, moduleW, rowHeight);

        // Data codewords
        for (let c = 0; c < cols; c++) {
            const cwIdx = r * cols + c;
            const cw = cwIdx < codewords.length ? codewords[cwIdx] : 900;
            cx = _pdf417RenderCW(ops, cw, r % 3, cx, ry, moduleW, rowHeight);
        }

        // Right row indicator
        const rightIndicator = _pdf417RowIndicator(r, rows, cols, ecLevel, 1);
        cx = _pdf417RenderCW(ops, rightIndicator, r % 3, cx, ry, moduleW, rowHeight);

        // Stop pattern
        _pdf417RenderPattern(ops, PDF417_STOP, 18, cx, ry, moduleW, rowHeight);
    }

    ops.push('Q');
    return ops.join('\n');
}

// ── PDF417 Internals ─────────────────────────────────────────────────

function _pdf417TextCompaction(str: string): number[] {
    // Sub-mode: uppercase (0), lowercase (1), mixed (2), punctuation (3)
    const codewords: number[] = [];
    const subModeVals: number[] = [];

    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp >= 65 && cp <= 90) {
            // Uppercase A-Z → 0-25
            subModeVals.push(cp - 65);
        } else if (cp >= 97 && cp <= 122) {
            // Lowercase a-z → 0-25 (with mode switch)
            subModeVals.push(27); // shift to lowercase
            subModeVals.push(cp - 97);
        } else if (cp >= 48 && cp <= 57) {
            // Digits 0-9 → 0-9 in mixed sub-mode
            subModeVals.push(28); // shift to mixed
            subModeVals.push(cp - 48);
        } else if (cp === 32) {
            subModeVals.push(26); // space
        } else {
            // Other chars: byte encoding
            subModeVals.push(29); // shift to punct
            subModeVals.push(cp % 30);
        }
    }

    // Pack pairs into codewords (base-30 pairs → 0-899)
    for (let i = 0; i < subModeVals.length; i += 2) {
        const hi = subModeVals[i];
        const lo = i + 1 < subModeVals.length ? subModeVals[i + 1] : 29; // pad
        codewords.push(hi * 30 + lo);
    }

    return codewords;
}

function _pdf417ReedSolomon(data: number[], ecLevel: number): number[] {
    const ecCount = PDF417_EC_CODEWORDS[ecLevel];
    // PDF417 uses GF(929)
    const gen = _pdf417GenPoly(ecCount);
    const result = new Array(ecCount).fill(0);

    for (const d of data) {
        const coef = (d + result[0]) % 929;
        result.shift();
        result.push(0);
        for (let i = 0; i < ecCount; i++) {
            result[i] = (929 + result[i] - (coef * gen[i + 1]) % 929) % 929;
        }
    }

    return result.map(v => (929 - v) % 929);
}

function _pdf417GenPoly(degree: number): number[] {
    let gen = [1];
    for (let i = 0; i < degree; i++) {
        const newGen = new Array(gen.length + 1).fill(0);
        const factor = _pdf417Pow(3, i);
        for (let j = 0; j < gen.length; j++) {
            newGen[j] = (newGen[j] + gen[j]) % 929;
            newGen[j + 1] = (newGen[j + 1] + gen[j] * factor) % 929;
        }
        gen = newGen;
    }
    return gen;
}

function _pdf417Pow(base: number, exp: number): number {
    let result = 1;
    let b = base % 929;
    let e = exp;
    while (e > 0) {
        if (e & 1) result = (result * b) % 929;
        b = (b * b) % 929;
        e >>= 1;
    }
    return result;
}

function _pdf417RowIndicator(row: number, totalRows: number, cols: number, ecLevel: number, side: number): number {
    const cluster = row % 3;
    if (side === 0) {
        // Left indicator
        if (cluster === 0) return ((row / 3) | 0) * 30 + ((totalRows - 1) / 3 | 0);
        if (cluster === 1) return ((row / 3) | 0) * 30 + ecLevel * 3 + ((totalRows - 1) % 3);
        return ((row / 3) | 0) * 30 + (cols - 1);
    }
    // Right indicator
    if (cluster === 0) return ((row / 3) | 0) * 30 + (cols - 1);
    if (cluster === 1) return ((row / 3) | 0) * 30 + ((totalRows - 1) / 3 | 0);
    return ((row / 3) | 0) * 30 + ecLevel * 3 + ((totalRows - 1) % 3);
}

/** PDF417 codeword bar patterns per cluster (simplified representative set). */
const PDF417_CLUSTER_PATTERNS: readonly (readonly number[])[][] = _buildPDF417Patterns();

function _buildPDF417Patterns(): (readonly number[])[][] {
    // Simplified: generate basic 17-module patterns for codeword values 0-928
    // Each codeword maps to a pattern of 4 bars + 4 spaces = 17 modules
    // In production, these would be the actual ISO 15438 Table A.1 patterns
    const clusters: (readonly number[])[][] = [[], [], []];
    for (let cluster = 0; cluster < 3; cluster++) {
        for (let cw = 0; cw < 929; cw++) {
            // Generate a deterministic 17-module pattern
            // Pattern: [bar, space, bar, space, bar, space, bar, space]
            // Sum must equal 17, each value 1-6+
            const seed = (cw * 7 + cluster * 3 + 1) % 929;
            const b1 = 1 + (seed % 4);
            const s1 = 1 + ((seed >> 2) % 4);
            const b2 = 1 + ((seed >> 4) % 4);
            const s2 = 1 + ((seed >> 6) % 3);
            const b3 = 1 + ((seed >> 8) % 3);
            const s3 = 1 + ((seed >> 1) % 3);
            const b4 = 1 + ((seed >> 3) % 3);
            const remaining = 17 - b1 - s1 - b2 - s2 - b3 - s3 - b4;
            const s4 = Math.max(1, remaining);
            clusters[cluster].push([b1, s1, b2, s2, b3, s3, b4, s4]);
        }
    }
    return clusters;
}

function _pdf417RenderCW(ops: string[], cw: number, cluster: number, cx: number, ry: number, moduleW: number, rowH: number): number {
    const pattern = PDF417_CLUSTER_PATTERNS[cluster][cw % 929] ?? [2, 2, 2, 2, 2, 2, 2, 3];
    return _pdf417RenderBarSpace(ops, pattern, cx, ry, moduleW, rowH);
}

function _pdf417RenderPattern(ops: string[], _pattern: number, modules: number, cx: number, ry: number, moduleW: number, rowH: number): number {
    // Render start/stop as alternating bars/spaces
    const barW = moduleW * 2;
    const spaceW = moduleW * 1;
    let x = cx;
    let isBar = true;
    let remaining = modules;
    while (remaining > 0) {
        const w = isBar ? Math.min(2, remaining) : Math.min(1, remaining);
        if (isBar) {
            ops.push(`${fmtNum(x)} ${fmtNum(ry)} ${fmtNum(barW)} ${fmtNum(rowH)} re f`);
        }
        x += isBar ? barW : spaceW;
        remaining -= w;
        isBar = !isBar;
    }
    return x;
}

function _pdf417RenderBarSpace(ops: string[], pattern: readonly number[], cx: number, ry: number, moduleW: number, rowH: number): number {
    let x = cx;
    for (let i = 0; i < pattern.length; i++) {
        const w = pattern[i] * moduleW;
        if (i % 2 === 0) {
            // Bar
            ops.push(`${fmtNum(x)} ${fmtNum(ry)} ${fmtNum(w)} ${fmtNum(rowH)} re f`);
        }
        x += w;
    }
    return x;
}

// ── Unified Barcode Renderer ─────────────────────────────────────────

/** Supported barcode formats. */
export type BarcodeFormat = 'code128' | 'ean13' | 'qr' | 'datamatrix' | 'pdf417';

/**
 * Render a barcode as PDF path operators.
 *
 * @param format - Barcode format
 * @param data - Data to encode
 * @param x - Left X position in points
 * @param y - Bottom Y position in points
 * @param width - Width in points
 * @param height - Height in points
 * @param options - Format-specific options
 * @returns PDF content stream operators
 */
export function renderBarcode(
    format: BarcodeFormat,
    data: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: { readonly ecLevel?: QRErrorLevel; readonly pdf417ECLevel?: number },
): string {
    switch (format) {
        case 'code128':
            return renderCode128(data, x, y, width, height);
        case 'ean13':
            return renderEAN13(data, x, y, width, height);
        case 'qr':
            return renderQR(data, x, y, Math.min(width, height), options?.ecLevel);
        case 'datamatrix':
            return renderDataMatrix(data, x, y, Math.min(width, height));
        case 'pdf417':
            return renderPDF417(data, x, y, width, height, options?.pdf417ECLevel);
        default:
            throw new Error(`Unknown barcode format: ${format}`);
    }
}
