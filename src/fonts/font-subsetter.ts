/**
 * pdfnative — TTF Font Subsetter
 * ================================
 * Subset a TrueType font binary to contain only used glyphs.
 * Retains original GID numbering (Identity-H compatible).
 * Resolves compound glyph component dependencies recursively.
 *
 * Tables kept (see `PDF_TABLES`):
 *   - `head`, `hhea`, `maxp`, `OS/2`, `cmap`, `hmtx`, `name`, `post` — copied verbatim
 *     (`head` only gets `indexToLocFormat` = 1 and `checkSumAdjustment` = 0; `head.flags`
 *     and `maxp` are untouched).
 *   - `loca`, `glyf` — rebuilt with the used outlines; the bytes of a kept glyph are
 *     copied unchanged, instructions included.
 *   - `prep`, `fpgm`, `cvt `, `gasp` — copied verbatim when present, never invented.
 *     These carry the font's rasterisation hints: `prep` runs before every glyph and
 *     typically enables dropout control (`SCANCTRL` / `SCANTYPE`), which keeps thin
 *     diagonals such as a lowercase `w` from losing pixels at small sizes in hinting
 *     rasterisers; `gasp` tells the rasteriser when to grid-fit and anti-alias; `fpgm`
 *     holds the functions `prep` and the glyph instructions call, and `cvt ` the control
 *     values they read. Dropping any of them silently degrades rendering while adding
 *     nothing to the outlines — they cost a few bytes (8 for `gasp`, 7 for Noto Sans's
 *     `prep`, ~4 KB when `fpgm` is present) and are kept by every mainstream subsetter.
 * Everything else (GSUB, GPOS, GDEF, kern, DSIG, colour tables, the variation tables
 * `fvar`/`gvar`/`HVAR`/`avar`/`STAT`/`MVAR`, …) is dropped: the PDF text is already
 * positioned and shaped, so a CIDFontType2 never consults them. Dropping the variation
 * tables of a variable font leaves its default instance, which is what `glyf` and `hmtx`
 * hold.
 *
 * `SubsetTTFOptions` (v1.8.0) opens one opt-in for a subset meant as a *source* font
 * rather than a PDF embed — the Latin subsets the repository derives from Noto Sans
 * with `scripts/build-latin-subsets.ts`: `keepLayoutTables` copies `GSUB`, `GPOS` and
 * `GDEF` verbatim, which is valid because glyph ids are retained. Without options the
 * output is byte-identical to every earlier release.
 */

/**
 * Opt-ins for a subset compiled into a font-data module by `pdfnative-build-font`,
 * not embedded in a PDF. Every option defaults to `false`; with none set the output
 * is byte-identical to the two-argument call.
 *
 * @since 1.8.0
 */
export interface SubsetTTFOptions {
    /**
     * Copy `GSUB`, `GPOS` and `GDEF` verbatim. Valid because glyph ids are retained;
     * the caller must keep every glyph those tables can produce (the GSUB closure of
     * the kept set), or a substitution may land on an emptied outline.
     */
    readonly keepLayoutTables?: boolean;
    /**
     * The lean embed for a CIDFontType2 with `/CIDToGIDMap /Identity` (v1.9.0):
     * a viewer selects glyphs by id, so the source font's `cmap` (tens of
     * kilobytes for a Noto face) and `post` glyph names serve nobody. The
     * `cmap` is rebuilt over the kept glyphs only, from the code point → glyph
     * map given here (format 4, plus format 12 when a kept code point lies
     * beyond the BMP), `post` becomes a format-3 header, and `gasp` is dropped.
     * Outlines, metrics, names and hinting are untouched. Never for a simple
     * TrueType font, whose `cmap` the viewer reads.
     *
     * With `cids` (1.9.0, C28) the glyphs are renumbered in that order — the
     * document's CID space, `cids[cid]` being the source glyph id and
     * `cids[0]` the `.notdef` — so glyph i of the embed is CID i under
     * `/CIDToGIDMap /Identity`: `glyf`, `loca`, `hmtx`, `hhea.numberOfHMetrics`
     * and `maxp.numGlyphs` cover the kept glyphs only (the components of a
     * composite follow, in ascending source order, and its references are
     * rewritten), and the `cmap` maps to the new ids. A CJK face then costs
     * its outlines rather than eight bytes per glyph of the source font.
     */
    readonly lean?: { readonly cmap: Readonly<Record<number, number>>; readonly cids?: readonly number[] };
}

/**
 * Rewrite the component glyph ids of a composite glyph's outline (a copy)
 * through the compact order: the same record walk as the closure, the
 * `glyphIndex` field of every component replaced (ISO/IEC 14496-22 §5.3.4).
 */
function renumberComponents(chunk: Uint8Array, remap: ReadonlyMap<number, number>): void {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let pos = 10;
    let flags: number;
    do {
        if (pos + 4 > chunk.length) break;
        flags = view.getUint16(pos);
        view.setUint16(pos + 2, remap.get(view.getUint16(pos + 2)) ?? 0);
        pos += 4;
        if (flags & 0x0001) pos += 4; else pos += 2;
        if (flags & 0x0008) pos += 2;
        else if (flags & 0x0040) pos += 4;
        else if (flags & 0x0080) pos += 8;
    } while (flags & 0x0020);
}

/** A `post` table of format 3: the 32-byte header, no glyph names (ISO/IEC 14496-22 §5.2.8). */
function postFormat3(source: Uint8Array): Uint8Array {
    const out = new Uint8Array(32);
    out.set(source.subarray(4, Math.min(32, source.length)), 4); // italicAngle … maxMemType1 as they were
    new DataView(out.buffer).setUint32(0, 0x00030000);
    return out;
}

/**
 * A `cmap` over the kept glyphs: a (3,1) format-4 subtable for the BMP and,
 * when a kept code point lies beyond it, a (3,10) format-12 subtable for the
 * whole range. Glyph ids are the source font's, or the renumbered ones
 * through `remap` (C28).
 */
function leanCmap(cmap: Readonly<Record<number, number>>, kept: ReadonlySet<number>, remap: ReadonlyMap<number, number> | null): Uint8Array {
    const pairs: [number, number][] = [];
    for (const key of Object.keys(cmap)) {
        const cp = Number(key);
        const gid = cmap[cp];
        if (Number.isInteger(cp) && cp >= 0 && cp <= 0x10FFFF && gid > 0 && kept.has(gid)) {
            const id = remap === null ? gid : remap.get(gid);
            if (id !== undefined && id > 0) pairs.push([cp, id]);
        }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const bmp = pairs.filter(p => p[0] <= 0xFFFF);
    const supplementary = pairs.some(p => p[0] > 0xFFFF);

    // Format 4: one segment per run of consecutive code points, glyph ids
    // through glyphIdArray (idRangeOffset), the mandatory 0xFFFF terminator.
    const segments: { start: number; end: number; gids: number[] }[] = [];
    for (const [cp, gid] of bmp) {
        const last = segments[segments.length - 1];
        if (last && cp === last.end + 1 && cp !== 0xFFFF) { last.end = cp; last.gids.push(gid); }
        else segments.push({ start: cp, end: cp, gids: [gid] });
    }
    const segCount = segments.length + 1;
    let glyphIdCount = 0;
    for (const s of segments) glyphIdCount += s.gids.length;
    const f4Length = 16 + segCount * 8 + glyphIdCount * 2;
    const f4 = new Uint8Array(f4Length);
    const v4 = new DataView(f4.buffer);
    let searchRange = 1, entrySelector = 0;
    while (searchRange * 2 <= segCount) { searchRange *= 2; entrySelector++; }
    searchRange *= 2;
    v4.setUint16(0, 4);
    v4.setUint16(2, f4Length);
    v4.setUint16(4, 0);
    v4.setUint16(6, segCount * 2);
    v4.setUint16(8, searchRange);
    v4.setUint16(10, entrySelector);
    v4.setUint16(12, segCount * 2 - searchRange);
    const endAt = 14, startAt = endAt + segCount * 2 + 2, deltaAt = startAt + segCount * 2, rangeAt = deltaAt + segCount * 2, glyphsAt = rangeAt + segCount * 2;
    let gi = 0;
    segments.forEach((s, i) => {
        v4.setUint16(endAt + i * 2, s.end);
        v4.setUint16(startAt + i * 2, s.start);
        v4.setUint16(deltaAt + i * 2, 0);
        v4.setUint16(rangeAt + i * 2, (segCount - i) * 2 + gi * 2);
        for (const gid of s.gids) { v4.setUint16(glyphsAt + gi * 2, gid); gi++; }
    });
    const t = segments.length;
    v4.setUint16(endAt + t * 2, 0xFFFF);
    v4.setUint16(startAt + t * 2, 0xFFFF);
    v4.setUint16(deltaAt + t * 2, 1);
    v4.setUint16(rangeAt + t * 2, 0);

    // Format 12: groups of consecutive code points with consecutive glyph ids.
    let f12: Uint8Array | null = null;
    if (supplementary) {
        const groups: [number, number, number][] = [];
        for (const [cp, gid] of pairs) {
            const last = groups[groups.length - 1];
            if (last && cp === last[1] + 1 && gid === last[2] + (last[1] - last[0]) + 1) last[1] = cp;
            else groups.push([cp, cp, gid]);
        }
        f12 = new Uint8Array(16 + groups.length * 12);
        const v12 = new DataView(f12.buffer);
        v12.setUint16(0, 12);
        v12.setUint32(4, f12.length);
        v12.setUint32(12, groups.length);
        groups.forEach((g, i) => { v12.setUint32(16 + i * 12, g[0]); v12.setUint32(20 + i * 12, g[1]); v12.setUint32(24 + i * 12, g[2]); });
    }

    const records = f12 ? 2 : 1;
    const header = 4 + records * 8;
    const out = new Uint8Array(header + f4.length + (f12 ? f12.length : 0));
    const v = new DataView(out.buffer);
    v.setUint16(0, 0);
    v.setUint16(2, records);
    v.setUint16(4, 3); v.setUint16(6, 1); v.setUint32(8, header);
    out.set(f4, header);
    if (f12) {
        v.setUint16(12, 3); v.setUint16(14, 10); v.setUint32(16, header + f4.length);
        out.set(f12, header + f4.length);
    }
    return out;
}

/**
 * Subset a TTF binary to contain only used glyphs.
 * Returns the subset TTF as a binary string (for PDF stream embedding).
 *
 * Accepts either a pre-decoded `Uint8Array` (zero-copy, preferred for cached font data)
 * or a binary string (legacy path, used when the font was loaded via `atob`).
 *
 * @param ttfInput - Full TTF as Uint8Array (preferred) or binary string
 * @param usedGids - Set of glyph IDs used in the document
 * @param options - Source-font opt-ins (v1.8.0); omit for a PDF embed
 * @returns Subset TTF as binary string
 */
export function subsetTTF(ttfInput: Uint8Array | string, usedGids: Set<number>, options?: SubsetTTFOptions): string {
    try {
        let u8: Uint8Array;
        let len: number;

        if (ttfInput instanceof Uint8Array) {
            // Zero-copy path: use the buffer directly, no charCodeAt loop
            u8 = ttfInput;
            len = u8.length;
        } else {
            // Legacy string path: decode binary string to Uint8Array
            len = ttfInput.length;
            const buf = new ArrayBuffer(len);
            u8 = new Uint8Array(buf);
            for (let i = 0; i < len; i++) u8[i] = ttfInput.charCodeAt(i);
        }

        if (len < 12) return ttfInput instanceof Uint8Array ? uint8ToBinaryString(u8) : ttfInput; // Too small for a valid TTF offset table
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        // Parse offset table & table directory
        const numTables = view.getUint16(4);
        const dirEnd = 12 + numTables * 16;
        if (dirEnd > len) return ttfInput instanceof Uint8Array ? uint8ToBinaryString(u8) : ttfInput; // Table directory exceeds buffer
        // A tag is four bytes of the font: the directory is collected in a Map and
        // frozen into a plain record by Object.fromEntries (own data properties
        // only), so a tag spelling "__proto__" never reaches a property write.
        const directory = new Map<string, { offset: number; length: number }>();
        for (let i = 0; i < numTables; i++) {
            const off = 12 + i * 16;
            const tag = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
            directory.set(tag, {
                offset: view.getUint32(off + 8),
                length: view.getUint32(off + 12)
            });
        }
        const tables: Record<string, { offset: number; length: number }> = Object.fromEntries(directory);

        const head = tables['head'];
        const maxp = tables['maxp'];
        const loca = tables['loca'];
        const glyf = tables['glyf'];
        if (!head || !maxp || !loca || !glyf) return ttfInput instanceof Uint8Array ? uint8ToBinaryString(u8) : ttfInput;

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
        // The compact order (C28): every glyph the document shows by a CID.
        const compactOrder = options?.lean?.cids;
        if (compactOrder !== undefined) for (const g of compactOrder) if (g >= 0 && g < numGlyphs) allGids.add(g);

        // Resolve compound glyph component references recursively.
        // Iteration limit prevents excessive processing on deeply nested or malicious fonts.
        // NOTE: hitting this cap is effectively impossible for well-formed fonts
        // (the queue is bounded by the glyph count, and each compound component
        // is visited at most a few times). It exists purely as a DoS guard
        // against adversarial fonts with pathological component graphs. When the
        // cap is reached we stop expanding — already-discovered GIDs are still
        // subset correctly; only further (untrusted, likely cyclic) expansion is
        // abandoned. No diagnostic is emitted on purpose (no console output in
        // library code); the bound is generous enough that legitimate fonts
        // never reach it.
        const MAX_COMPOUND_ITERATIONS = 10_000;
        let iterations = 0;
        const queue = [...allGids];
        while (queue.length > 0) {
            if (++iterations > MAX_COMPOUND_ITERATIONS) break;
            const gid = queue.pop();
            if (gid === undefined || gid >= numGlyphs) continue;
            const off = origOffsets[gid];
            const next = origOffsets[gid + 1];
            if (off >= next) continue;
            const glyfOff = glyf.offset + off;
            if (glyfOff + 10 > len) continue; // Not enough room for glyph header
            if (view.getInt16(glyfOff) >= 0) continue; // simple glyph
            // Compound glyph — extract component GIDs
            let pos = glyfOff + 10;
            let flags;
            do {
                if (pos + 4 > len) break; // Bounds check for flags + GID
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

        // The glyph order of the output: the source order with the unused
        // outlines emptied (ids retained), or the compact order (C28) —
        // `cids` first, then the components the closure added, ascending.
        let order: number[] | null = null;
        let remap: Map<number, number> | null = null;
        if (compactOrder !== undefined) {
            order = [0];
            remap = new Map([[0, 0]]);
            for (let i = 1; i < compactOrder.length; i++) {
                const g = compactOrder[i];
                // A code outside the font shows the empty .notdef outline.
                const kept = g > 0 && g < numGlyphs && !remap.has(g) ? g : 0;
                order.push(kept);
                if (kept !== 0) remap.set(kept, i);
            }
            for (const g of [...allGids].sort((a, b) => a - b)) {
                if (!remap.has(g)) { remap.set(g, order.length); order.push(g); }
            }
        }
        const outCount = order === null ? numGlyphs : order.length;

        // Build new glyf table (only used glyph outlines)
        const glyfChunks: Uint8Array[] = [];
        const newOffsets = new Uint32Array(outCount + 1);
        let curOff = 0;
        for (let i = 0; i < outCount; i++) {
            newOffsets[i] = curOff;
            const gid = order === null ? i : order[i];
            if (order !== null || allGids.has(gid)) {
                const off = origOffsets[gid];
                const next = origOffsets[gid + 1];
                const glyphLen = next - off;
                if (glyphLen > 0 && glyf.offset + next <= len) {
                    const chunk = u8.slice(glyf.offset + off, glyf.offset + next);
                    if (remap !== null && glyphLen >= 10 && new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getInt16(0) < 0) {
                        renumberComponents(chunk, remap);
                    }
                    glyfChunks.push(chunk);
                    curOff += glyphLen;
                    if (glyphLen & 1) { glyfChunks.push(new Uint8Array(1)); curOff += 1; }
                }
            }
        }
        newOffsets[outCount] = curOff;

        // Assemble new glyf
        const newGlyf = new Uint8Array(curOff);
        let pos = 0;
        for (const chunk of glyfChunks) { newGlyf.set(chunk, pos); pos += chunk.length; }

        // Build new loca (always long format)
        const newLocaBuf = new ArrayBuffer((outCount + 1) * 4);
        const newLocaView = new DataView(newLocaBuf);
        for (let i = 0; i <= outCount; i++) newLocaView.setUint32(i * 4, newOffsets[i]);
        const newLoca = new Uint8Array(newLocaBuf);

        // Tables required for PDF CIDFontType2, plus the hinting tables (`prep`, `fpgm`,
        // `cvt ` — note the trailing space in the tag — and `gasp`) that rasterisers use for
        // dropout control and grid-fitting. Each is copied verbatim when the source has it;
        // absent tables are not synthesised (see the module header).
        const PDF_TABLES = new Set([
            'head', 'hhea', 'maxp', 'OS/2', 'cmap', 'hmtx', 'loca', 'glyf', 'name', 'post',
            'prep', 'fpgm', 'cvt ', 'gasp',
        ]);
        // Source-font mode (v1.8.0): the layout tables stay valid because glyph ids are
        // retained, so they are copied as they are — never rewritten.
        if (options?.keepLayoutTables) { PDF_TABLES.add('GSUB'); PDF_TABLES.add('GPOS'); PDF_TABLES.add('GDEF'); }
        // The lean embed (v1.9.0): no `gasp`, a `cmap` over the kept glyphs, a nameless `post`.
        if (options?.lean) PDF_TABLES.delete('gasp');
        const tableTags = Object.keys(tables).filter(t => PDF_TABLES.has(t)).sort();
        const newTableData: Record<string, Uint8Array> = {};
        for (const tag of tableTags) {
            const t = tables[tag];
            newTableData[tag] = u8.slice(t.offset, t.offset + t.length);
        }
        newTableData['glyf'] = newGlyf;
        newTableData['loca'] = newLoca;
        if (options?.lean) {
            if (newTableData['cmap']) newTableData['cmap'] = leanCmap(options.lean.cmap, allGids, remap);
            if (newTableData['post']) newTableData['post'] = postFormat3(newTableData['post']);
        }
        // The compact order carries its own metrics: one `hmtx` entry per
        // kept glyph (the source's trailing-advance rule unfolded), the
        // counts of `hhea` and `maxp` to match.
        if (order !== null) {
            const hhea = newTableData['hhea'], hmtx = newTableData['hmtx'], maxpTable = newTableData['maxp'];
            if (hhea && hmtx && maxpTable && hhea.length >= 36 && maxpTable.length >= 6) {
                const nHM = new DataView(hhea.buffer, hhea.byteOffset, hhea.byteLength).getUint16(34);
                const src = new DataView(hmtx.buffer, hmtx.byteOffset, hmtx.byteLength);
                const out = new Uint8Array(outCount * 4);
                const ov = new DataView(out.buffer);
                for (let i = 0; i < outCount; i++) {
                    const g = order[i];
                    const a = Math.min(g, nHM - 1);
                    const adv = a >= 0 && a * 4 + 2 <= hmtx.length ? src.getUint16(a * 4) : 0;
                    let lsb = 0;
                    if (g < nHM) { if (g * 4 + 4 <= hmtx.length) lsb = src.getInt16(g * 4 + 2); }
                    else { const p = nHM * 4 + (g - nHM) * 2; if (p + 2 <= hmtx.length) lsb = src.getInt16(p); }
                    ov.setUint16(i * 4, adv);
                    ov.setInt16(i * 4 + 2, lsb);
                }
                newTableData['hmtx'] = out;
                const hheaCopy = new Uint8Array(hhea);
                new DataView(hheaCopy.buffer).setUint16(34, outCount);
                newTableData['hhea'] = hheaCopy;
                const maxpCopy = new Uint8Array(maxpTable);
                new DataView(maxpCopy.buffer).setUint16(4, outCount);
                newTableData['maxp'] = maxpCopy;
            }
        }

        // Update head: indexToLocFormat = 1 (long); checkSumAdjustment is
        // zeroed here so the table checksum below excludes it, and computed
        // once the whole file is assembled (OpenType `head` table spec).
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

        // head.checkSumAdjustment = 0xB1B0AFBA − (checksum of the whole font
        // with the field at 0), so the file sums to the magic value. Written
        // as 0 from 1.0 to 1.7 — every rasteriser ignores it, font validators
        // flag it (v1.8.0).
        outView.setUint32(tableFileOffsets['head'] + 8, (0xB1B0AFBA - ttfChecksum(output)) >>> 0);

        // Convert Uint8Array back to binary string
        let result = '';
        for (let i = 0; i < output.length; i += 8192) {
            const end = Math.min(i + 8192, output.length);
            result += String.fromCharCode.apply(null, Array.from(output.subarray(i, end)));
        }
        return result;
    } catch {
        return ttfInput instanceof Uint8Array ? uint8ToBinaryString(ttfInput) : ttfInput;
    }
}

/**
 * Convert a Uint8Array to a binary string (for PDF stream embedding).
 * Uses chunked String.fromCharCode.apply to avoid call-stack overflow on large arrays.
 */
export function uint8ToBinaryString(u8: Uint8Array): string {
    let result = '';
    for (let i = 0; i < u8.length; i += 8192) {
        const end = Math.min(i + 8192, u8.length);
        result += String.fromCharCode.apply(null, Array.from(u8.subarray(i, end)));
    }
    return result;
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
