import { describe, it, expect } from 'vitest';
import {
    encodeCode128,
    renderCode128,
    ean13CheckDigit,
    renderEAN13,
    generateQR,
    renderQR,
    generateDataMatrix,
    renderDataMatrix,
    encodePDF417,
    renderPDF417,
    renderBarcode,
} from '../../src/core/pdf-barcode.js';

// ── Code 128 ─────────────────────────────────────────────────────────

describe('encodeCode128', () => {
    it('should encode alphanumeric string', () => {
        const symbols = encodeCode128('ABC');
        expect(symbols.length).toBeGreaterThan(3); // start + data + checksum + stop
        expect(symbols[symbols.length - 1]).toBe(106); // stop
    });

    it('should use Code C for long digit sequences', () => {
        const symbols = encodeCode128('123456');
        expect(symbols[0]).toBe(105); // START C
    });

    it('should use Code B for regular ASCII', () => {
        const symbols = encodeCode128('Hello');
        expect(symbols[0]).toBe(104); // START B
    });

    it('should throw on empty data', () => {
        expect(() => encodeCode128('')).toThrow('data must not be empty');
    });

    it('should include correct checksum', () => {
        const symbols = encodeCode128('Test');
        // Checksum is second-to-last, stop is last
        expect(symbols[symbols.length - 1]).toBe(106);
        // Verify checksum calculation
        let check = symbols[0];
        for (let i = 1; i < symbols.length - 2; i++) {
            check += symbols[i] * i;
        }
        expect(symbols[symbols.length - 2]).toBe(check % 103);
    });

    it('should handle mixed alphanumeric and digits', () => {
        const symbols = encodeCode128('A12345B');
        expect(symbols.length).toBeGreaterThan(5);
    });
});

describe('renderCode128', () => {
    it('should return valid PDF operators for simple text', () => {
        const ops = renderCode128('Hello', 50, 700, 200, 60);
        expect(ops).toContain('q');
        expect(ops).toContain('Q');
        expect(ops).toContain('0 0 0 rg');
        expect(ops).toContain('re f');
    });

    it('should position bars at specified coordinates', () => {
        const ops = renderCode128('A', 100, 500, 150, 40);
        expect(ops).toContain('q');
        // Should contain rectangle operations with y=500 and height=40
        expect(ops).toMatch(/\d+(\.\d+)? 500(\.00)? \d+(\.\d+)? 40(\.00)? re f/);
    });

    it('should handle digit-only input', () => {
        const ops = renderCode128('1234567890', 0, 0, 300, 50);
        expect(ops).toContain('re f');
    });
});

// ── EAN-13 ───────────────────────────────────────────────────────────

describe('ean13CheckDigit', () => {
    it('should calculate correct check digit for standard barcode', () => {
        expect(ean13CheckDigit('590123412345')).toBe(7);
    });

    it('should calculate check digit for another barcode', () => {
        // Verify it returns a valid digit
        const result = ean13CheckDigit('400000000000');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(9);
    });

    it('should handle all-zero input', () => {
        const result = ean13CheckDigit('000000000000');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(9);
    });
});

describe('renderEAN13', () => {
    it('should render 12-digit input (auto check digit)', () => {
        const ops = renderEAN13('590123412345', 50, 700, 200, 80);
        expect(ops).toContain('q');
        expect(ops).toContain('Q');
        expect(ops).toContain('re f');
    });

    it('should render valid 13-digit input', () => {
        const check = ean13CheckDigit('590123412345');
        const ops = renderEAN13(`590123412345${check}`, 50, 700, 200, 80);
        expect(ops).toContain('re f');
    });

    it('should throw on wrong check digit', () => {
        expect(() => renderEAN13('5901234123450', 0, 0, 200, 80)).toThrow('invalid check digit');
    });

    it('should throw on non-digit input', () => {
        expect(() => renderEAN13('ABCDEFGHIJKLM', 0, 0, 200, 80)).toThrow('12 or 13 digits');
    });

    it('should throw on short input', () => {
        expect(() => renderEAN13('123', 0, 0, 200, 80)).toThrow('12 or 13 digits');
    });

    it('should include taller guard bars', () => {
        const ops = renderEAN13('590123412345', 50, 700, 200, 80);
        // Guard bars should be height + 5 = 85
        expect(ops).toMatch(/85(\.00)? re f/);
    });
});

// ── QR Code ──────────────────────────────────────────────────────────

describe('generateQR', () => {
    it('should generate a square matrix', () => {
        const matrix = generateQR('Hello');
        expect(matrix.length).toBeGreaterThan(0);
        expect(matrix.length).toBe(matrix[0].length); // square
    });

    it('should generate Version 1 for short data', () => {
        const matrix = generateQR('Hi', 'L');
        expect(matrix.length).toBe(21); // v1 = 21x21
    });

    it('should generate larger version for longer data', () => {
        const matrix = generateQR('This is a longer test string for QR code generation', 'M');
        expect(matrix.length).toBeGreaterThan(21);
    });

    it('should have finder patterns in corners', () => {
        const matrix = generateQR('Test');
        // Top-left finder: 7x7 with dark border
        expect(matrix[0][0]).toBe(true); // top-left corner
        expect(matrix[0][6]).toBe(true); // top-right of finder
        expect(matrix[6][0]).toBe(true); // bottom-left of finder
        expect(matrix[6][6]).toBe(true); // bottom-right of finder
        // Center of finder should be dark
        expect(matrix[3][3]).toBe(true);
    });

    it('should support all error correction levels', () => {
        for (const level of ['L', 'M', 'Q', 'H'] as const) {
            const matrix = generateQR('Test', level);
            expect(matrix.length).toBeGreaterThanOrEqual(21);
        }
    });

    it('should throw on data too long', () => {
        const longStr = 'x'.repeat(3000);
        expect(() => generateQR(longStr, 'H')).toThrow('data too long');
    });

    it('should handle UTF-8 encoding', () => {
        const matrix = generateQR('café');
        expect(matrix.length).toBeGreaterThan(0);
    });

    it('should handle empty-adjacent data points', () => {
        const matrix = generateQR('1');
        expect(matrix.length).toBe(21);
    });
});

describe('renderQR', () => {
    it('should return valid PDF operators', () => {
        const ops = renderQR('Hello', 50, 600, 100);
        expect(ops).toContain('q');
        expect(ops).toContain('Q');
        expect(ops).toContain('0 0 0 rg');
        expect(ops).toContain('re f');
    });

    it('should respect size parameter', () => {
        const small = renderQR('A', 0, 0, 50, 'L');
        const large = renderQR('A', 0, 0, 200, 'L');
        // Larger size should have larger coordinate values
        expect(large.length).toBeGreaterThan(small.length);
    });
});

// ── Data Matrix ──────────────────────────────────────────────────────

describe('generateDataMatrix', () => {
    it('should generate a matrix for short ASCII', () => {
        const matrix = generateDataMatrix('ABC');
        expect(matrix.length).toBeGreaterThanOrEqual(10);
    });

    it('should have solid left column (L-shape finder)', () => {
        const matrix = generateDataMatrix('Hi');
        const rows = matrix.length;
        // Left column should be all dark (L-pattern)
        for (let r = 0; r < rows; r++) {
            expect(matrix[r][0]).toBe(true);
        }
    });

    it('should throw on data too long', () => {
        const longStr = 'x'.repeat(2000);
        expect(() => generateDataMatrix(longStr)).toThrow('data too long');
    });

    it('should handle single character', () => {
        const matrix = generateDataMatrix('A');
        expect(matrix.length).toBe(10); // smallest size
    });
});

describe('renderDataMatrix', () => {
    it('should return valid PDF operators', () => {
        const ops = renderDataMatrix('Test', 50, 600, 80);
        expect(ops).toContain('q');
        expect(ops).toContain('Q');
        expect(ops).toContain('re f');
    });
});

// ── PDF417 ───────────────────────────────────────────────────────────

describe('encodePDF417', () => {
    it('should encode text data', () => {
        const { codewords, rows, cols } = encodePDF417('Hello World');
        expect(codewords.length).toBeGreaterThan(0);
        expect(rows).toBeGreaterThanOrEqual(3);
        expect(cols).toBeGreaterThanOrEqual(1);
    });

    it('should throw on empty data', () => {
        expect(() => encodePDF417('')).toThrow('data must not be empty');
    });

    it('should throw on invalid EC level', () => {
        expect(() => encodePDF417('Test', -1)).toThrow('ecLevel must be 0-8');
        expect(() => encodePDF417('Test', 9)).toThrow('ecLevel must be 0-8');
    });

    it('should increase EC codewords with higher level', () => {
        const low = encodePDF417('Test', 0);
        const high = encodePDF417('Test', 4);
        expect(high.codewords.length).toBeGreaterThan(low.codewords.length);
    });
});

describe('renderPDF417', () => {
    it('should return valid PDF operators', () => {
        const ops = renderPDF417('Hello', 50, 600, 300, 100);
        expect(ops).toContain('q');
        expect(ops).toContain('Q');
        expect(ops).toContain('re f');
    });
});

// ── Unified renderBarcode ────────────────────────────────────────────

describe('renderBarcode', () => {
    it('should dispatch to code128', () => {
        const ops = renderBarcode('code128', 'Test', 0, 700, 200, 60);
        expect(ops).toContain('re f');
    });

    it('should dispatch to ean13', () => {
        const ops = renderBarcode('ean13', '590123412345', 0, 700, 200, 60);
        expect(ops).toContain('re f');
    });

    it('should dispatch to qr', () => {
        const ops = renderBarcode('qr', 'Hello', 0, 700, 100, 100);
        expect(ops).toContain('re f');
    });

    it('should dispatch to datamatrix', () => {
        const ops = renderBarcode('datamatrix', 'Test', 0, 700, 80, 80);
        expect(ops).toContain('re f');
    });

    it('should dispatch to pdf417', () => {
        const ops = renderBarcode('pdf417', 'Test', 0, 700, 300, 100);
        expect(ops).toContain('re f');
    });

    it('should pass ecLevel to QR', () => {
        const ops = renderBarcode('qr', 'Test', 0, 700, 100, 100, { ecLevel: 'H' });
        expect(ops).toContain('re f');
    });

    it('should pass pdf417ECLevel', () => {
        const ops = renderBarcode('pdf417', 'Test', 0, 700, 300, 100, { pdf417ECLevel: 5 });
        expect(ops).toContain('re f');
    });

    it('should throw on unknown format', () => {
        expect(() => renderBarcode('unknown' as any, 'Test', 0, 0, 100, 100)).toThrow('Unknown barcode format');
    });
});

// ── Document Builder Integration ─────────────────────────────────────

import { buildDocumentPDF } from '../../src/core/pdf-document.js';

describe('barcode in buildDocumentPDF', () => {

    it('should render a code128 barcode block', () => {
        const pdf: string = buildDocumentPDF({
            title: 'Barcode Test',
            blocks: [
                { type: 'barcode', format: 'code128', data: 'ABC-123' },
            ],
        });
        expect(pdf).toContain('%PDF-');
        expect(pdf).toContain('re f');
    });

    it('should render a QR code block', () => {
        const pdf: string = buildDocumentPDF({
            title: 'QR Test',
            blocks: [
                { type: 'barcode', format: 'qr', data: 'https://example.com' },
            ],
        });
        expect(pdf).toContain('%PDF-');
    });

    it('should render barcode with alignment', () => {
        const pdf: string = buildDocumentPDF({
            title: 'Aligned Barcode',
            blocks: [
                { type: 'barcode', format: 'code128', data: 'Test', align: 'center' },
                { type: 'barcode', format: 'qr', data: 'Test', align: 'right' },
            ],
        });
        expect(pdf).toContain('%PDF-');
    });

    it('should render barcode with custom dimensions', () => {
        const pdf: string = buildDocumentPDF({
            title: 'Custom Size',
            blocks: [
                { type: 'barcode', format: 'ean13', data: '590123412345', width: 250, height: 100 },
            ],
        });
        expect(pdf).toContain('%PDF-');
    });

    it('should render multiple barcode types on same page', () => {
        const pdf: string = buildDocumentPDF({
            title: 'Multi Barcode',
            blocks: [
                { type: 'heading', text: 'Barcodes', level: 1 },
                { type: 'barcode', format: 'code128', data: 'CODE128-TEST' },
                { type: 'barcode', format: 'ean13', data: '590123412345' },
                { type: 'barcode', format: 'qr', data: 'QR Test' },
                { type: 'barcode', format: 'datamatrix', data: 'DM Test' },
                { type: 'barcode', format: 'pdf417', data: 'PDF417 Test' },
            ],
        });
        expect(pdf).toContain('%PDF-');
    });

    it('should handle barcode in tagged mode', () => {
        const pdf: string = buildDocumentPDF({
            title: 'Tagged Barcode',
            blocks: [
                { type: 'barcode', format: 'qr', data: 'Tagged' },
            ],
            layout: { tagged: true },
        });
        expect(pdf).toContain('%PDF-');
        expect(pdf).toContain('/Figure');
    });
});
