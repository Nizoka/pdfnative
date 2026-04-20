/**
 * Fuzz tests for xref /Prev chain depth limit (CWE-400).
 *
 * A malicious PDF can chain thousands of /Prev pointers, or create a cycle,
 * causing CPU/memory exhaustion. We verify both limits are enforced.
 */

import { describe, it, expect } from 'vitest';
import { parseXrefTable, MAX_XREF_CHAIN } from '../../src/index.js';

/**
 * Build a minimal PDF with N chained xref tables, each referencing the previous
 * via /Prev. All xrefs share the same entries (object 1: catalog).
 */
const ENC = new TextEncoder();

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
}

/**
 * Build a minimal PDF with N chained xref tables, each referencing the previous
 * via /Prev. All xrefs share the same entries (object 1: catalog).
 */
function buildChainedXrefPdf(chainLength: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let offset = 0;
    const xrefOffsets: number[] = [];

    // Header (avoid non-ASCII chars so byte length === char length)
    const header = ENC.encode('%PDF-1.7\n%binary\n');
    parts.push(header);
    offset += header.length;

    // Object 1: minimal catalog
    const obj1 = ENC.encode('1 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n');
    const obj1Offset = offset;
    parts.push(obj1);
    offset += obj1.length;

    // Build N xref sections, each pointing to the previous via /Prev
    for (let i = 0; i < chainLength; i++) {
        xrefOffsets.push(offset);
        const prevField = i === 0 ? '' : ` /Prev ${xrefOffsets[i - 1]}`;
        const xrefBlock = ENC.encode(
            `xref\n` +
            `0 2\n` +
            `0000000000 65535 f \n` +
            `${String(obj1Offset).padStart(10, '0')} 00000 n \n` +
            `trailer\n<< /Size 2 /Root 1 0 R${prevField} >>\n`
        );
        parts.push(xrefBlock);
        offset += xrefBlock.length;
    }

    // Final startxref / EOF
    parts.push(ENC.encode(`startxref\n${xrefOffsets[xrefOffsets.length - 1]}\n%%EOF\n`));
    return concat(parts);
}

/** Build a PDF whose xref has a /Prev that points back to itself (cycle). */
function buildCyclicXrefPdf(): Uint8Array {
    const header = ENC.encode('%PDF-1.7\n%binary\n');
    const obj1 = ENC.encode('1 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n');
    const obj1Offset = header.length;
    const xrefOffset = header.length + obj1.length;
    const xrefBlock = ENC.encode(
        `xref\n` +
        `0 2\n` +
        `0000000000 65535 f \n` +
        `${String(obj1Offset).padStart(10, '0')} 00000 n \n` +
        `trailer\n<< /Size 2 /Root 1 0 R /Prev ${xrefOffset} >>\n`
    );
    const tail = ENC.encode(`startxref\n${xrefOffset}\n%%EOF\n`);
    return concat([header, obj1, xrefBlock, tail]);
}

describe('xref — /Prev chain depth limit', () => {
    it('exposes MAX_XREF_CHAIN as a positive integer', () => {
        expect(Number.isInteger(MAX_XREF_CHAIN)).toBe(true);
        expect(MAX_XREF_CHAIN).toBeGreaterThan(0);
    });

    it('accepts a chain just below the limit', () => {
        const pdf = buildChainedXrefPdf(Math.min(10, MAX_XREF_CHAIN - 1));
        expect(() => parseXrefTable(pdf)).not.toThrow();
    });

    it('rejects a chain exceeding MAX_XREF_CHAIN with a descriptive error', () => {
        const pdf = buildChainedXrefPdf(MAX_XREF_CHAIN + 5);
        expect(() => parseXrefTable(pdf)).toThrow(/Prev chain|maximum depth/i);
    });

    it('detects self-referential cycles', () => {
        const pdf = buildCyclicXrefPdf();
        expect(() => parseXrefTable(pdf)).toThrow(/cycle/i);
    });
});
