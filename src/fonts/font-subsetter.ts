/**
 * pdfnative — TTF Font Subsetter
 * ================================
 * Subset a TrueType font binary to contain only used glyphs.
 * Retains original GID numbering (Identity-H compatible).
 * Resolves compound glyph component dependencies recursively.
 */

/**
 * Subset a TTF binary string to only include used glyphs.
 * Returns the subset TTF as a binary string.
 *
 * @param ttfBinaryStr - Full TTF as binary string (from atob/Buffer)
 * @param usedGids - Set of glyph IDs used in the document
 * @returns Subset TTF as binary string
 */
export function subsetTTF(ttfBinaryStr: string, usedGids: Set<number>): string {
    try {
        const len = ttfBinaryStr.length;
        const buf = new ArrayBuffer(len);
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < len; i++) u8[i] = ttfBinaryStr.charCodeAt(i);
        const view = new DataView(buf);

        // Parse offset table & table directory
        const numTables = view.getUint16(4);
        const tables: Record<string, { offset: number; length: number }> = {};
        for (let i = 0; i < numTables; i++) {
            const off = 12 + i * 16;
            const tag = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
            tables[tag] = {
                offset: view.getUint32(off + 8),
                length: view.getUint32(off + 12)
            };
        }

        const head = tables['head'];
        const maxp = tables['maxp'];
        const loca = tables['loca'];
        const glyf = tables['glyf'];
        if (!head || !maxp || !loca || !glyf) return ttfBinaryStr;

        const numGlyphs = view.getUint16(maxp.offset + 4);
        const locaFormat = view.getInt16(head.offset + 50);

        // Read original loca offsets
        const origOffsets = new Uint32Array(numGlyphs + 1);
        for (let i = 0; i <= numGlyphs; i++) {
            origOffsets[i] = locaFormat === 0
                ? view.getUint16(loca.offset + i * 2) * 2
                : view.getUint32(loca.offset + i * 4);
        }

        // Always include GID 0 (.notdef — required by PDF spec)
        const allGids = new Set(usedGids);
        allGids.add(0);

        // Resolve compound glyph component references recursively
        const queue = [...allGids];
        while (queue.length > 0) {
            const gid = queue.pop();
            if (gid === undefined || gid >= numGlyphs) continue;
            const off = origOffsets[gid];
            const next = origOffsets[gid + 1];
            if (off >= next) continue;
            const glyfOff = glyf.offset + off;
            if (view.getInt16(glyfOff) >= 0) continue; // simple glyph
            // Compound glyph — extract component GIDs
            let pos = glyfOff + 10;
            let flags;
            do {
                flags = view.getUint16(pos);
                const componentGid = view.getUint16(pos + 2);
                if (!allGids.has(componentGid)) {
                    allGids.add(componentGid);
                    queue.push(componentGid);
                }
                pos += 4;
                if (flags & 0x0001) pos += 4; else pos += 2;
                if (flags & 0x0008) pos += 2;
                else if (flags & 0x0040) pos += 4;
                else if (flags & 0x0080) pos += 8;
            } while (flags & 0x0020);
        }

        // Build new glyf table (only used glyph outlines)
        const glyfChunks: Uint8Array[] = [];
        const newOffsets = new Uint32Array(numGlyphs + 1);
        let curOff = 0;
        for (let gid = 0; gid < numGlyphs; gid++) {
            newOffsets[gid] = curOff;
            if (allGids.has(gid)) {
                const off = origOffsets[gid];
                const next = origOffsets[gid + 1];
                const glyphLen = next - off;
                if (glyphLen > 0) {
                    glyfChunks.push(u8.slice(glyf.offset + off, glyf.offset + next));
                    curOff += glyphLen;
                    if (glyphLen & 1) { glyfChunks.push(new Uint8Array(1)); curOff += 1; }
                }
            }
        }
        newOffsets[numGlyphs] = curOff;

        // Assemble new glyf
        const newGlyf = new Uint8Array(curOff);
        let pos = 0;
        for (const chunk of glyfChunks) { newGlyf.set(chunk, pos); pos += chunk.length; }

        // Build new loca (always long format)
        const newLocaBuf = new ArrayBuffer((numGlyphs + 1) * 4);
        const newLocaView = new DataView(newLocaBuf);
        for (let i = 0; i <= numGlyphs; i++) newLocaView.setUint32(i * 4, newOffsets[i]);
        const newLoca = new Uint8Array(newLocaBuf);

        // Tables required for PDF CIDFontType2
        const PDF_TABLES = new Set(['head', 'hhea', 'maxp', 'OS/2', 'cmap', 'hmtx', 'loca', 'glyf', 'name', 'post']);
        const tableTags = Object.keys(tables).filter(t => PDF_TABLES.has(t)).sort();
        const newTableData: Record<string, Uint8Array> = {};
        for (const tag of tableTags) {
            const t = tables[tag];
            newTableData[tag] = u8.slice(t.offset, t.offset + t.length);
        }
        newTableData['glyf'] = newGlyf;
        newTableData['loca'] = newLoca;

        // Update head: indexToLocFormat = 1 (long), zero checkSumAdjustment
        const headCopy = new Uint8Array(newTableData['head']);
        new DataView(headCopy.buffer, headCopy.byteOffset, headCopy.byteLength).setInt16(50, 1);
        new DataView(headCopy.buffer, headCopy.byteOffset, headCopy.byteLength).setUint32(8, 0);
        newTableData['head'] = headCopy;

        // Assemble new TTF binary
        const numNewTables = tableTags.length;
        const headerSize = 12 + numNewTables * 16;
        let totalSize = headerSize;
        const tableFileOffsets: Record<string, number> = {};
        for (const tag of tableTags) {
            tableFileOffsets[tag] = totalSize;
            totalSize += newTableData[tag].length;
            if (totalSize & 3) totalSize += 4 - (totalSize & 3);
        }

        const output = new Uint8Array(totalSize);
        const outView = new DataView(output.buffer);

        // Offset table header
        outView.setUint32(0, 0x00010000);
        outView.setUint16(4, numNewTables);
        let entrySelector = 0, searchRange = 1;
        while (searchRange * 2 <= numNewTables) { searchRange *= 2; entrySelector++; }
        searchRange *= 16;
        outView.setUint16(6, searchRange);
        outView.setUint16(8, entrySelector);
        outView.setUint16(10, numNewTables * 16 - searchRange);

        // Table directory entries
        for (let i = 0; i < tableTags.length; i++) {
            const tag = tableTags[i];
            const off = 12 + i * 16;
            for (let j = 0; j < 4; j++) output[off + j] = tag.charCodeAt(j);
            outView.setUint32(off + 4, ttfChecksum(newTableData[tag]));
            outView.setUint32(off + 8, tableFileOffsets[tag]);
            outView.setUint32(off + 12, newTableData[tag].length);
        }

        // Write table data
        for (const tag of tableTags) output.set(newTableData[tag], tableFileOffsets[tag]);

        // Convert Uint8Array back to binary string
        let result = '';
        for (let i = 0; i < output.length; i += 8192) {
            const end = Math.min(i + 8192, output.length);
            result += String.fromCharCode.apply(null, Array.from(output.subarray(i, end)));
        }
        return result;
    } catch {
        return ttfBinaryStr;
    }
}

/**
 * Compute TTF table checksum (sum of 32-bit big-endian words).
 */
export function ttfChecksum(data: Uint8Array): number {
    const len = data.length;
    const padded = len & 3 ? new Uint8Array([...data, ...new Uint8Array(4 - (len & 3))]) : data;
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    return sum;
}
