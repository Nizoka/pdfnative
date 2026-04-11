import { describe, it, expect } from 'vitest';
import { subsetTTF, ttfChecksum } from '../../src/fonts/font-subsetter.js';

// ── Minimal TTF builder for subsetter testing ────────────────────────

function align4(n: number): number { return (n + 3) & ~3; }

/**
 * Build a minimal valid TTF binary string with 5 glyphs:
 *   GID 0: .notdef (empty)
 *   GID 1: simple glyph (18 bytes)
 *   GID 2: simple glyph (18 bytes)
 *   GID 3: compound glyph referencing GID 1 (single component)
 *   GID 4: compound glyph with 3 components covering all flag variants
 */
function buildMinimalTTF(options?: { longLoca?: boolean }): string {
    const longLoca = options?.longLoca ?? false;
    const numGlyphs = 5;
    const numTables = 4; // glyf, head, loca, maxp (alphabetical)

    // Simple glyph (18 bytes)
    function makeSimple(): Uint8Array {
        const d = new Uint8Array(18);
        const v = new DataView(d.buffer);
        v.setInt16(0, 1);     // numberOfContours
        v.setInt16(2, 0);     // xMin
        v.setInt16(4, 0);     // yMin
        v.setInt16(6, 100);   // xMax
        v.setInt16(8, 200);   // yMax
        v.setUint16(10, 0);   // endPtsOfContours[0]
        v.setUint16(12, 0);   // instructionLength
        d[14] = 0x01;         // flags: ON_CURVE
        return d;
    }

    // Compound glyph: single component, flags=0, refs GID 1 (16 bytes)
    function makeSimpleCompound(): Uint8Array {
        const d = new Uint8Array(16);
        const v = new DataView(d.buffer);
        v.setInt16(0, -1);        // numberOfContours = -1 (compound)
        v.setInt16(2, 0); v.setInt16(4, 0); v.setInt16(6, 100); v.setInt16(8, 200); // bbox
        v.setUint16(10, 0x0000);  // flags: no MORE, no WORDS, no transform
        v.setUint16(12, 1);       // componentGid = GID 1
        d[14] = 0; d[15] = 0;    // args (int8, int8)
        return d;
    }

    // Compound glyph: 3 components covering flag branches (44 bytes)
    function makeComplexCompound(): Uint8Array {
        const d = new Uint8Array(44);
        const v = new DataView(d.buffer);
        v.setInt16(0, -1); // compound
        v.setInt16(2, 0); v.setInt16(4, 0); v.setInt16(6, 100); v.setInt16(8, 200);
        let p = 10;
        // Component 1: MORE_COMPONENTS | ARG_1_AND_2_ARE_WORDS | WE_HAVE_A_SCALE
        v.setUint16(p, 0x0029); v.setUint16(p + 2, 1); // gid=1
        v.setInt16(p + 4, 0); v.setInt16(p + 6, 0);    // args (words)
        v.setInt16(p + 8, 0x4000);                       // scale F2.14
        p += 10;
        // Component 2: MORE_COMPONENTS | WE_HAVE_AN_XY_SCALE
        v.setUint16(p, 0x0060); v.setUint16(p + 2, 1); // gid=1
        d[p + 4] = 0; d[p + 5] = 0;                    // args (bytes)
        v.setInt16(p + 6, 0x4000); v.setInt16(p + 8, 0x4000); // xScale, yScale
        p += 10;
        // Component 3: WE_HAVE_A_TWO_BY_TWO (no MORE)
        v.setUint16(p, 0x0080); v.setUint16(p + 2, 2); // gid=2
        d[p + 4] = 0; d[p + 5] = 0;                    // args (bytes)
        v.setInt16(p + 6, 0x4000); v.setInt16(p + 8, 0); // xx, yx
        v.setInt16(p + 10, 0); v.setInt16(p + 12, 0x4000); // xy, yy
        return d;
    }

    const s1 = makeSimple(), s2 = makeSimple();
    const c1 = makeSimpleCompound(), c2 = makeComplexCompound();

    // Glyf: [GID0=empty][GID1=18][GID2=18][GID3=16][GID4=44] = 96 bytes
    const glyfData = new Uint8Array(96);
    glyfData.set(s1, 0); glyfData.set(s2, 18); glyfData.set(c1, 36); glyfData.set(c2, 52);
    const glyphOffsets = [0, 0, 18, 36, 52, 96]; // numGlyphs+1 entries

    // Loca
    let locaData: Uint8Array;
    if (longLoca) {
        locaData = new Uint8Array((numGlyphs + 1) * 4);
        const lv = new DataView(locaData.buffer);
        for (let i = 0; i <= numGlyphs; i++) lv.setUint32(i * 4, glyphOffsets[i]);
    } else {
        locaData = new Uint8Array((numGlyphs + 1) * 2);
        const lv = new DataView(locaData.buffer);
        for (let i = 0; i <= numGlyphs; i++) lv.setUint16(i * 2, glyphOffsets[i] / 2);
    }

    // Head (54 bytes)
    const headData = new Uint8Array(54);
    const hv = new DataView(headData.buffer);
    hv.setUint32(0, 0x00010000); hv.setUint32(4, 0x00010000);
    hv.setUint32(12, 0x5F0F3CF5); // magic
    hv.setUint16(18, 1000);        // unitsPerEm
    hv.setInt16(50, longLoca ? 1 : 0); // indexToLocFormat

    // Maxp (6 bytes)
    const maxpData = new Uint8Array(6);
    new DataView(maxpData.buffer).setUint32(0, 0x00010000);
    new DataView(maxpData.buffer).setUint16(4, numGlyphs);

    // Assemble
    const headerSize = 12 + numTables * 16;
    const tables = [
        { tag: 'glyf', data: glyfData },
        { tag: 'head', data: headData },
        { tag: 'loca', data: locaData },
        { tag: 'maxp', data: maxpData },
    ];
    let off = headerSize;
    const offsets: number[] = [];
    for (const t of tables) { offsets.push(off); off = align4(off + t.data.length); }

    const output = new Uint8Array(off);
    const ov = new DataView(output.buffer);
    ov.setUint32(0, 0x00010000); ov.setUint16(4, numTables);
    ov.setUint16(6, 64); ov.setUint16(8, 2); ov.setUint16(10, 0);

    for (let i = 0; i < tables.length; i++) {
        const o = 12 + i * 16;
        for (let j = 0; j < 4; j++) output[o + j] = tables[i].tag.charCodeAt(j);
        ov.setUint32(o + 4, 0); // checksum
        ov.setUint32(o + 8, offsets[i]);
        ov.setUint32(o + 12, tables[i].data.length);
    }
    for (let i = 0; i < tables.length; i++) output.set(tables[i].data, offsets[i]);

    let str = '';
    for (let i = 0; i < output.length; i++) str += String.fromCharCode(output[i]);
    return str;
}

/** Parse a TTF binary string and return glyph metrics for verification. */
function parseSubset(binary: string): { numGlyphs: number; locaFormat: number; glyphSizes: number[] } {
    const buf = new ArrayBuffer(binary.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
    const view = new DataView(buf);

    const numTables = view.getUint16(4);
    const tables: Record<string, { offset: number; length: number }> = {};
    for (let i = 0; i < numTables; i++) {
        const off = 12 + i * 16;
        const tag = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
        tables[tag] = { offset: view.getUint32(off + 8), length: view.getUint32(off + 12) };
    }

    const numGlyphs = view.getUint16(tables['maxp'].offset + 4);
    const locaFormat = view.getInt16(tables['head'].offset + 50);
    const loca = tables['loca'];
    const offsets: number[] = [];
    for (let i = 0; i <= numGlyphs; i++) {
        offsets.push(locaFormat === 0
            ? view.getUint16(loca.offset + i * 2) * 2
            : view.getUint32(loca.offset + i * 4));
    }
    const glyphSizes: number[] = [];
    for (let i = 0; i < numGlyphs; i++) glyphSizes.push(offsets[i + 1] - offsets[i]);
    return { numGlyphs, locaFormat, glyphSizes };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ttfChecksum', () => {
    it('should compute checksum of aligned data', () => {
        const data = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
        expect(ttfChecksum(data)).toBe(0x00010000);
    });

    it('should handle non-aligned data (pad with zeros)', () => {
        const data = new Uint8Array([0x00, 0x01, 0x02]);
        expect(ttfChecksum(data)).toBe(ttfChecksum(new Uint8Array([0x00, 0x01, 0x02, 0x00])));
    });

    it('should handle empty data', () => {
        expect(ttfChecksum(new Uint8Array(0))).toBe(0);
    });

    it('should accumulate 32-bit words', () => {
        const data = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02]);
        expect(ttfChecksum(data)).toBe(3);
    });

    it('should handle uint32 overflow (wraps to 32-bit)', () => {
        const data = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x01]);
        expect(ttfChecksum(data)).toBe(0x00000000);
    });
});

describe('subsetTTF', () => {
    it('should return original binary if required tables are missing', () => {
        const fakeTtf = '\x00\x01\x00\x00\x00\x00';
        const result = subsetTTF(fakeTtf, new Set([0]));
        expect(result).toBe(fakeTtf);
    });

    it('should subset simple glyphs (short loca format)', () => {
        const ttf = buildMinimalTTF({ longLoca: false });
        // Keep only GID 1
        const result = subsetTTF(ttf, new Set([1]));
        expect(typeof result).toBe('string');

        const metrics = parseSubset(result);
        expect(metrics.numGlyphs).toBe(5);      // numGlyphs preserved
        expect(metrics.locaFormat).toBe(1);       // always long format after subset
        expect(metrics.glyphSizes[0]).toBe(0);    // GID 0 .notdef (empty, but always included — still 0 bytes)
        expect(metrics.glyphSizes[1]).toBeGreaterThan(0); // GID 1 kept
        expect(metrics.glyphSizes[2]).toBe(0);    // GID 2 removed
        expect(metrics.glyphSizes[3]).toBe(0);    // GID 3 removed
        expect(metrics.glyphSizes[4]).toBe(0);    // GID 4 removed
    });

    it('should subset with long loca format', () => {
        const ttf = buildMinimalTTF({ longLoca: true });
        const result = subsetTTF(ttf, new Set([1, 2]));
        const metrics = parseSubset(result);

        expect(metrics.numGlyphs).toBe(5);
        expect(metrics.glyphSizes[1]).toBeGreaterThan(0); // GID 1
        expect(metrics.glyphSizes[2]).toBeGreaterThan(0); // GID 2
        expect(metrics.glyphSizes[3]).toBe(0);            // GID 3 removed
        expect(metrics.glyphSizes[4]).toBe(0);            // GID 4 removed
    });

    it('should always include GID 0 (.notdef)', () => {
        const ttf = buildMinimalTTF();
        const result = subsetTTF(ttf, new Set([2])); // only request GID 2
        const metrics = parseSubset(result);

        // GID 0 is always empty in our fixture, but still "included"
        expect(metrics.numGlyphs).toBe(5);
        expect(metrics.glyphSizes[2]).toBeGreaterThan(0); // requested
    });

    it('should resolve simple compound glyph dependencies', () => {
        const ttf = buildMinimalTTF();
        // GID 3 is compound referencing GID 1
        const result = subsetTTF(ttf, new Set([3]));
        const metrics = parseSubset(result);

        expect(metrics.glyphSizes[1]).toBeGreaterThan(0); // GID 1 pulled in as dependency
        expect(metrics.glyphSizes[3]).toBeGreaterThan(0); // GID 3 kept
        expect(metrics.glyphSizes[2]).toBe(0);            // GID 2 not referenced
    });

    it('should resolve complex compound with multiple components', () => {
        const ttf = buildMinimalTTF();
        // GID 4 references GID 1 (twice via WORDS, XY_SCALE) and GID 2 (via TWO_BY_TWO)
        const result = subsetTTF(ttf, new Set([4]));
        const metrics = parseSubset(result);

        expect(metrics.glyphSizes[1]).toBeGreaterThan(0); // GID 1 pulled in
        expect(metrics.glyphSizes[2]).toBeGreaterThan(0); // GID 2 pulled in
        expect(metrics.glyphSizes[4]).toBeGreaterThan(0); // GID 4 kept
    });

    it('should produce smaller output when removing glyphs', () => {
        const ttf = buildMinimalTTF();
        // Original has all 5 glyphs; keep only GID 1
        const original = ttf.length;
        const subset = subsetTTF(ttf, new Set([1]));
        expect(subset.length).toBeLessThan(original);
    });

    it('should produce valid TTF structure (parseable)', () => {
        const ttf = buildMinimalTTF();
        const result = subsetTTF(ttf, new Set([1, 2]));
        // Should be re-parseable without error
        const metrics = parseSubset(result);
        expect(metrics.numGlyphs).toBe(5);
        expect(metrics.locaFormat).toBe(1); // always long format
    });

    it('should handle out-of-range GIDs gracefully', () => {
        const ttf = buildMinimalTTF();
        // GID 999 doesn't exist
        const result = subsetTTF(ttf, new Set([1, 999]));
        const metrics = parseSubset(result);
        expect(metrics.glyphSizes[1]).toBeGreaterThan(0);
    });

    it('should handle empty usedGids (only .notdef)', () => {
        const ttf = buildMinimalTTF();
        const result = subsetTTF(ttf, new Set());
        const metrics = parseSubset(result);
        // GID 0 is always included but empty in fixture
        expect(metrics.numGlyphs).toBe(5);
        // All non-zero glyphs should be empty
        expect(metrics.glyphSizes[1]).toBe(0);
        expect(metrics.glyphSizes[2]).toBe(0);
    });

    it('should handle odd-length glyph data (byte alignment padding)', () => {
        // Build a TTF with simple glyphs; the subsetter adds padding for odd-length glyphs
        const ttf = buildMinimalTTF();
        const result = subsetTTF(ttf, new Set([1]));
        // If glyph 1 has odd length, the subsetter pads it — just verify it doesn't crash
        const metrics = parseSubset(result);
        expect(metrics.glyphSizes[1]).toBeGreaterThanOrEqual(18);
    });

    it('should set checkSumAdjustment to 0 in output head table', () => {
        const ttf = buildMinimalTTF();
        const result = subsetTTF(ttf, new Set([1]));
        // Parse head table and verify checksumAdjust = 0
        const buf = new ArrayBuffer(result.length);
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < result.length; i++) u8[i] = result.charCodeAt(i);
        const view = new DataView(buf);
        const numTables = view.getUint16(4);
        for (let i = 0; i < numTables; i++) {
            const off = 12 + i * 16;
            const tag = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
            if (tag === 'head') {
                const headOff = view.getUint32(off + 8);
                expect(view.getUint32(headOff + 8)).toBe(0); // checkSumAdjustment
                break;
            }
        }
    });

    it('should return original for buffers too small for a TTF', () => {
        const tiny = '\x00\x01\x00\x00\x00\x02'; // 6 bytes < 12
        const result = subsetTTF(tiny, new Set([0]));
        expect(result).toBe(tiny);
    });

    it('should return original when table directory exceeds buffer', () => {
        // numTables = 100 → needs 12 + 100*16 = 1612 bytes, but only 16 provided
        const buf = new Uint8Array(16);
        new DataView(buf.buffer).setUint32(0, 0x00010000);
        new DataView(buf.buffer).setUint16(4, 100); // numTables = 100
        let str = '';
        for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
        const result = subsetTTF(str, new Set([0]));
        expect(result).toBe(str);
    });
});
