#!/usr/bin/env node
/**
 * BUILD FONT DATA — TTF → JS Data Module Generator
 * ==================================================
 *
 * Parses a TrueType font (.ttf) file and extracts:
 *   - cmap: Unicode → Glyph ID mapping (for text encoding)
 *   - widths: Glyph ID → Advance Width (for text positioning)
 *   - metrics: unitsPerEm, ascent, descent, capHeight, bbox
 *   - Raw TTF binary as base64 (for FontFile2 embedding in PDF)
 *
 * Output: ES module exporting pre-built lookup tables
 *
 * Usage:
 *   node scripts/build-font-data.cjs <input.ttf> <output.js> [--var-name=fontData]
 *
 * Example:
 *   node scripts/build-font-data.cjs assets/fonts/NotoSansThai-Regular.ttf assets/fonts/noto-thai-data.js
 *
 * Dependencies: NONE (pure Node.js Buffer/fs)
 * License: Font files must be OFL (Open Font License) or equivalent
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── TTF Binary Reader ────────────────────────────────────────────────

class TTFReader {
    constructor(buffer) {
        this.buf = buffer;
        this.pos = 0;
    }

    seek(offset) { this.pos = offset; }
    skip(n) { this.pos += n; }

    readUint8() { return this.buf.readUInt8(this.pos++); }
    readUint16() { const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
    readInt16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
    readUint32() { const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
    readTag() {
        const t = this.buf.toString('ascii', this.pos, this.pos + 4);
        this.pos += 4;
        return t;
    }
}

// ── TTF Table Parser ─────────────────────────────────────────────────

function parseTTF(buffer) {
    const r = new TTFReader(buffer);

    // Offset table
    const sfVersion = r.readUint32();
    if (sfVersion !== 0x00010000 && sfVersion !== 0x74727565) {
        throw new Error(`Not a TrueType font (sfVersion: 0x${sfVersion.toString(16)})`);
    }

    const numTables = r.readUint16();
    r.skip(6); // searchRange, entrySelector, rangeShift

    // Table directory
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const tag = r.readTag();
        r.skip(4); // checksum
        const offset = r.readUint32();
        const length = r.readUint32();
        tables[tag] = { offset, length };
    }

    // ── Parse 'head' table ───────────────────────────────────────────
    if (!tables['head']) throw new Error('Missing head table');
    r.seek(tables['head'].offset);
    r.skip(18); // version, fontRevision, checksumAdjust, magic, flags
    const unitsPerEm = r.readUint16();
    r.skip(16); // created, modified
    const xMin = r.readInt16();
    const yMin = r.readInt16();
    const xMax = r.readInt16();
    const yMax = r.readInt16();

    // ── Parse 'hhea' table ───────────────────────────────────────────
    if (!tables['hhea']) throw new Error('Missing hhea table');
    r.seek(tables['hhea'].offset);
    r.skip(4); // version
    const ascent = r.readInt16();
    const descent = r.readInt16();
    r.skip(26); // lineGap + bunch of fields
    const numberOfHMetrics = r.readUint16();

    // ── Parse 'maxp' table ───────────────────────────────────────────
    if (!tables['maxp']) throw new Error('Missing maxp table');
    r.seek(tables['maxp'].offset);
    r.skip(4); // version
    const numGlyphs = r.readUint16();

    // ── Parse 'OS/2' table (optional, for capHeight) ─────────────────
    let capHeight = Math.round(ascent * 0.7); // fallback
    let stemV = 80;
    if (tables['OS/2']) {
        r.seek(tables['OS/2'].offset);
        const os2Version = r.readUint16();
        r.skip(30); // xAvgCharWidth, usWeightClass, ... through panose[10]
        // Skip to sTypoAscender (offset 68 from table start)
        r.seek(tables['OS/2'].offset + 68);
        const sTypoAscender = r.readInt16();
        const sTypoDescender = r.readInt16();
        r.skip(4); // sTypoLineGap, usWinAscent
        // capHeight at offset 88 (OS/2 v2+)
        if (os2Version >= 2 && tables['OS/2'].length >= 90) {
            r.seek(tables['OS/2'].offset + 88);
            capHeight = r.readInt16();
        }
        // usWeightClass at offset 4
        r.seek(tables['OS/2'].offset + 4);
        const weightClass = r.readUint16();
        stemV = Math.round(weightClass * 0.12);
    }

    // ── Parse 'hmtx' table (glyph widths) ────────────────────────────
    if (!tables['hmtx']) throw new Error('Missing hmtx table');
    r.seek(tables['hmtx'].offset);
    const widths = {};
    let lastWidth = 0;
    for (let i = 0; i < numberOfHMetrics; i++) {
        const advanceWidth = r.readUint16();
        r.skip(2); // lsb
        widths[i] = advanceWidth;
        lastWidth = advanceWidth;
    }
    // Remaining glyphs use the last advanceWidth
    for (let i = numberOfHMetrics; i < numGlyphs; i++) {
        widths[i] = lastWidth;
    }

    // ── Parse 'cmap' table ───────────────────────────────────────────
    if (!tables['cmap']) throw new Error('Missing cmap table');
    const cmapOffset = tables['cmap'].offset;
    r.seek(cmapOffset);
    r.skip(2); // version
    const numSubtables = r.readUint16();

    // Find best subtable: prefer format 12 (full Unicode), fallback to format 4 (BMP)
    let bestSubtableOffset = -1;
    let bestFormat = 0;

    for (let i = 0; i < numSubtables; i++) {
        const platformID = r.readUint16();
        const encodingID = r.readUint16();
        const subtableOffset = r.readUint32();

        // Platform 3 (Windows) encoding 1 (UCS-2) or 10 (UCS-4)
        // Platform 0 (Unicode) encoding 3 (UCS-2) or 4 (UCS-4)
        if ((platformID === 3 && (encodingID === 1 || encodingID === 10)) ||
            (platformID === 0 && (encodingID === 3 || encodingID === 4))) {
            // Check format
            const savedPos = r.pos;
            r.seek(cmapOffset + subtableOffset);
            const format = r.readUint16();
            r.pos = savedPos;

            if (format === 12 && bestFormat < 12) {
                bestSubtableOffset = cmapOffset + subtableOffset;
                bestFormat = 12;
            } else if (format === 4 && bestFormat < 4) {
                bestSubtableOffset = cmapOffset + subtableOffset;
                bestFormat = 4;
            }
        }
    }

    if (bestSubtableOffset === -1) {
        throw new Error('No suitable cmap subtable found (need format 4 or 12)');
    }

    const cmap = {};

    if (bestFormat === 12) {
        // Format 12: Segmented coverage (full Unicode)
        r.seek(bestSubtableOffset);
        r.skip(2); // format
        r.skip(2); // reserved
        r.skip(4); // length
        r.skip(4); // language
        const numGroups = r.readUint32();
        for (let i = 0; i < numGroups; i++) {
            const startCharCode = r.readUint32();
            const endCharCode = r.readUint32();
            const startGlyphID = r.readUint32();
            for (let c = startCharCode; c <= endCharCode; c++) {
                const gid = startGlyphID + (c - startCharCode);
                if (gid > 0 && gid < numGlyphs) {
                    cmap[c] = gid;
                }
            }
        }
    } else {
        // Format 4: Segment mapping to delta values (BMP only)
        r.seek(bestSubtableOffset);
        r.skip(2); // format
        r.skip(2); // length
        r.skip(2); // language
        const segCountX2 = r.readUint16();
        const segCount = segCountX2 / 2;
        r.skip(6); // searchRange, entrySelector, rangeShift

        const endCodes = [];
        for (let i = 0; i < segCount; i++) endCodes.push(r.readUint16());
        r.skip(2); // reservedPad
        const startCodes = [];
        for (let i = 0; i < segCount; i++) startCodes.push(r.readUint16());
        const idDeltas = [];
        for (let i = 0; i < segCount; i++) idDeltas.push(r.readInt16());
        const idRangeOffsetPos = r.pos;
        const idRangeOffsets = [];
        for (let i = 0; i < segCount; i++) idRangeOffsets.push(r.readUint16());

        for (let i = 0; i < segCount; i++) {
            if (startCodes[i] === 0xFFFF) break;
            for (let c = startCodes[i]; c <= endCodes[i]; c++) {
                let gid;
                if (idRangeOffsets[i] === 0) {
                    gid = (c + idDeltas[i]) & 0xFFFF;
                } else {
                    const offset = idRangeOffsetPos + i * 2 + idRangeOffsets[i] + (c - startCodes[i]) * 2;
                    r.seek(offset);
                    gid = r.readUint16();
                    if (gid !== 0) {
                        gid = (gid + idDeltas[i]) & 0xFFFF;
                    }
                }
                if (gid > 0 && gid < numGlyphs) {
                    cmap[c] = gid;
                }
            }
        }
    }

    // ── Compute default width ────────────────────────────────────────
    // Use width of space (U+0020) or glyph 0
    const spaceGid = cmap[0x20] || 0;
    const defaultWidth = widths[spaceGid] || widths[0] || 600;

    // ── Parse 'GSUB' table — Single Substitutions for Thai ───────────
    // We extract LookupType 1 (SingleSubst) corresponding to features:
    //   'abvs' (above-base substitution), 'blwsSub', 'locl', and generic
    //   substitutions that remap consonant glyphs when stacked with
    //   above/below-base vowels or tone marks.
    // Result: gsub[baseGid] = substituteGid (or vice-versa for above-base forms)
    const gsub = parseTTFGSUB(r, tables);

    // ── Parse 'GPOS' table — MarkToBase + MarkToMark anchor offsets ──
    // LookupType 4 (MarkToBase): mark glyph anchored to base glyph
    // LookupType 6 (MarkToMark): mark glyph anchored to another mark
    //   (used for Thai vowel+tone stacking: tone positioned relative to vowel)
    const markAnchors = parseTTFGPOS(r, tables);

    return {
        metrics: {
            unitsPerEm,
            ascent,
            descent,
            capHeight,
            stemV,
            bbox: [xMin, yMin, xMax, yMax],
            defaultWidth,
            numGlyphs
        },
        cmap,
        widths,
        gsub,
        markAnchors
    };
}

// ── GSUB Parser — LookupType 1 (SingleSubst) ─────────────────────────
/**
 * Parse GSUB table and extract SingleSubst (LookupType 1) mappings.
 * These are used for Thai "short" consonant variants (e.g. ป→ป variant)
 * when stacked with above-base marks whose descenders would clash.
 *
 * Returns a sparse object: { fromGid: toGid, ... }
 * Only LookupType 1 (Single Substitution) is extracted.
 * Lookup subtable Format 1 (delta) and Format 2 (explicit mapping) both handled.
 */
function parseTTFGSUB(r, tables) {
    const gsub = {};
    if (!tables['GSUB']) return gsub;

    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version (major.minor uint16+uint16)
        const scriptListOffset = r.readUint16();
        const featureListOffset = r.readUint16();
        const lookupListOffset = r.readUint16();

        // ── Collect LookupType 1 lookup indices from FeatureList ─────
        // We want ALL SingleSubst lookups regardless of feature tag:
        // Thai uses 'abvm', 'blwm', 'abvs', 'blws', 'calt', 'locl', etc.
        r.seek(base + featureListOffset);
        const featureCount = r.readUint16();
        const singleSubstLookupIndices = new Set();

        // Collect per-feature lookup indices
        for (let fi = 0; fi < featureCount; fi++) {
            r.skip(4); // feature tag (4 bytes ASCII)
            const featureOffset = r.readUint16();
            const savedPos = r.pos;
            r.seek(base + featureListOffset + featureOffset);
            r.skip(2); // featureParamsOffset
            const lookupCount = r.readUint16();
            const indices = [];
            for (let li = 0; li < lookupCount; li++) {
                indices.push(r.readUint16());
            }
            r.pos = savedPos;

            // Store indices to check once we read LookupList
            for (const idx of indices) singleSubstLookupIndices.add(idx);
        }

        // ── Read LookupList ──────────────────────────────────────────
        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            r.seek(base + lookupListOffset + lookupOffsets[li]);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const subtableOffsets = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());

            // LookupType 1 = SingleSubst
            if (lookupType !== 1) continue;

            for (const stOffset of subtableOffsets) {
                const stBase = base + lookupListOffset + lookupOffsets[li] + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();

                // Read Coverage table
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);

                if (substFormat === 1) {
                    // Format 1: apply delta to all covered glyphs
                    const delta = r.readInt16();
                    for (const gid of coverageGlyphs) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) gsub[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    // Format 2: explicit list
                    const glyphCount = r.readUint16();
                    for (let gi = 0; gi < glyphCount && gi < coverageGlyphs.length; gi++) {
                        const sub = r.readUint16();
                        if (sub > 0) gsub[coverageGlyphs[gi]] = sub;
                    }
                }
            }
        }
    } catch (e) {
        // Non-fatal: GSUB parsing failure degrades gracefully (no shaping)
        console.warn('[build-font-data] GSUB parse error (non-fatal):', e.message);
    }
    return gsub;
}

// ── GPOS Parser — LookupType 4 (MarkToBase) + LookupType 6 (MarkToMark) ──
/**
 * Parse GPOS table and extract MarkToBase (LookupType 4) and
 * MarkToMark (LookupType 6) anchor data.
 *
 * MarkToBase (Type 4):
 *   For each mark glyph, record its mark anchor point.
 *   For each base glyph, record attachment anchor for each mark class.
 *
 * MarkToMark (Type 6):
 *   For each mark2 glyph (the "combining" mark, e.g. a tone above a vowel),
 *   record how it attaches to a mark1 glyph (the "base" mark, e.g. an above vowel).
 *   Structure identical to MarkToBase but mark1 plays the role of base.
 *
 * Result: markAnchors = {
 *   marks: { [markGid]: { classIdx, x, y } },
 *   bases: { [baseGid]: { [classIdx]: { x, y } } },
 *   mark2mark: { mark1Anchors: { [mark1Gid]: { [classIdx]: { x, y } } },
 *                mark2Classes: { [mark2Gid]: { classIdx, x, y } } }
 * }
 */
function parseTTFGPOS(r, tables) {
    const result = { marks: {}, bases: {}, mark2mark: { mark1Anchors: {}, mark2Classes: {} } };
    if (!tables['GPOS']) return result;

    try {
        const base = tables['GPOS'].offset;
        r.seek(base);
        r.skip(4); // version
        r.skip(2); // scriptListOffset
        r.skip(2); // featureListOffset
        const lookupListOffset = r.readUint16();

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            r.seek(base + lookupListOffset + lookupOffsets[li]);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const stOffsets = [];
            for (let si = 0; si < subtableCount; si++) stOffsets.push(r.readUint16());

            // LookupType 4 = MarkToBase, LookupType 6 = MarkToMark
            if (lookupType !== 4 && lookupType !== 6) continue;

            for (const stOff of stOffsets) {
                const stBase = base + lookupListOffset + lookupOffsets[li] + stOff;
                r.seek(stBase);
                r.skip(2); // posFormat (always 1)
                const mark1CoverageOffset = r.readUint16();  // mark coverage (Type 4) or mark2 coverage (Type 6)
                const mark2CoverageOffset = r.readUint16();  // base coverage (Type 4) or mark1 coverage (Type 6)
                const markClassCount = r.readUint16();
                const mark1ArrayOffset = r.readUint16();
                const mark2ArrayOffset = r.readUint16();

                // Read coverage tables
                const mark1Glyphs = readCoverageTable(r, stBase + mark1CoverageOffset);
                const mark2Glyphs = readCoverageTable(r, stBase + mark2CoverageOffset);

                // Read Mark1Array (MarkArray): array of { markClass, markAnchorOffset }
                r.seek(stBase + mark1ArrayOffset);
                const markCount = r.readUint16();
                const mark1Data = []; // temp storage for mark1 entries
                for (let mi = 0; mi < markCount && mi < mark1Glyphs.length; mi++) {
                    const markClass = r.readUint16();
                    const anchorOffset = r.readUint16();
                    const savedPos = r.pos;
                    r.seek(stBase + mark1ArrayOffset + anchorOffset);
                    const anchorFormat = r.readUint16();
                    const ax = anchorFormat >= 1 ? r.readInt16() : 0;
                    const ay = anchorFormat >= 1 ? r.readInt16() : 0;
                    r.pos = savedPos;
                    mark1Data.push({ gid: mark1Glyphs[mi], classIdx: markClass, x: ax, y: ay });
                }

                // Read Mark2Array / BaseArray
                r.seek(stBase + mark2ArrayOffset);
                const baseCount = r.readUint16();
                const baseRecords = [];
                for (let bi = 0; bi < baseCount; bi++) {
                    const recs = [];
                    for (let mc = 0; mc < markClassCount; mc++) recs.push(r.readUint16());
                    baseRecords.push(recs);
                }

                if (lookupType === 4) {
                    // MarkToBase: store in marks + bases
                    for (const md of mark1Data) {
                        result.marks[md.gid] = { classIdx: md.classIdx, x: md.x, y: md.y };
                    }
                    for (let bi = 0; bi < baseCount && bi < mark2Glyphs.length; bi++) {
                        const baseGid = mark2Glyphs[bi];
                        result.bases[baseGid] = {};
                        for (let mc = 0; mc < markClassCount; mc++) {
                            const anchorOff = baseRecords[bi][mc];
                            if (!anchorOff) continue;
                            r.seek(stBase + mark2ArrayOffset + anchorOff);
                            r.skip(2); // anchorFormat
                            const bx = r.readInt16();
                            const by = r.readInt16();
                            result.bases[baseGid][mc] = { x: bx, y: by };
                        }
                    }
                } else {
                    // LookupType 6: MarkToMark
                    // mark1Glyphs = the "combining" marks (mark2 in spec: tones)
                    // mark2Glyphs = the "base" marks (mark1 in spec: vowels)
                    for (const md of mark1Data) {
                        result.mark2mark.mark2Classes[md.gid] = { classIdx: md.classIdx, x: md.x, y: md.y };
                    }
                    for (let bi = 0; bi < baseCount && bi < mark2Glyphs.length; bi++) {
                        const m1Gid = mark2Glyphs[bi];
                        result.mark2mark.mark1Anchors[m1Gid] = {};
                        for (let mc = 0; mc < markClassCount; mc++) {
                            const anchorOff = baseRecords[bi][mc];
                            if (!anchorOff) continue;
                            r.seek(stBase + mark2ArrayOffset + anchorOff);
                            r.skip(2); // anchorFormat
                            const mx = r.readInt16();
                            const my = r.readInt16();
                            result.mark2mark.mark1Anchors[m1Gid][mc] = { x: mx, y: my };
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[build-font-data] GPOS parse error (non-fatal):', e.message);
    }
    return result;
}

// ── Coverage Table Reader (shared by GSUB + GPOS) ────────────────────
/**
 * Read an OpenType Coverage table and return the list of covered glyph IDs.
 * Format 1: explicit list. Format 2: ranges.
 * @param {TTFReader} r
 * @param {number} absOffset - Absolute byte offset in the file
 * @returns {number[]} Sorted array of glyph IDs
 */
function readCoverageTable(r, absOffset) {
    const glyphs = [];
    r.seek(absOffset);
    const format = r.readUint16();
    if (format === 1) {
        const count = r.readUint16();
        for (let i = 0; i < count; i++) glyphs.push(r.readUint16());
    } else if (format === 2) {
        const rangeCount = r.readUint16();
        for (let i = 0; i < rangeCount; i++) {
            const start = r.readUint16();
            const end = r.readUint16();
            r.skip(2); // startCoverageIndex
            for (let g = start; g <= end; g++) glyphs.push(g);
        }
    }
    return glyphs;
}

// ── JS Module Generator ──────────────────────────────────────────────

function generateModule(fontName, parsed, ttfBase64) {
    const { metrics, cmap, widths, gsub, markAnchors } = parsed;

    // Compact cmap: only entries where glyph exists
    const cmapEntries = Object.entries(cmap)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

    // Compact widths: group consecutive same-width glyphs
    // For simplicity, use sparse format: only glyph IDs with non-default widths
    const defaultW = metrics.defaultWidth;
    const widthEntries = Object.entries(widths)
        .filter(([, w]) => w !== defaultW)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

    // Compact gsub: sparse object { fromGid: toGid }
    const gsubEntries = Object.entries(gsub || {})
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

    // Compact markAnchors — split into marks and bases sub-maps
    // marks[gid] = { classIdx, x, y }
    const marksEntries = Object.entries((markAnchors && markAnchors.marks) || {})
        .map(([gid, a]) => `${gid}:[${a.classIdx},${a.x},${a.y}]`)
        .join(',');
    // bases[gid] = { classIdx: { x, y } } — serialise as { gid: { mc: [x,y] } }
    const basesEntries = Object.entries((markAnchors && markAnchors.bases) || {})
        .map(([gid, anchors]) => {
            const inner = Object.entries(anchors)
                .map(([mc, a]) => `${mc}:[${a.x},${a.y}]`)
                .join(',');
            return `${gid}:{${inner}}`;
        })
        .join(',');

    // Compact mark2mark — LookupType 6 (MarkToMark) anchors
    // mark1Anchors[mark1Gid] = { classIdx: [x, y] }  (the "base" mark, e.g. above vowel)
    // mark2Classes[mark2Gid] = [classIdx, x, y]       (the "combining" mark, e.g. tone)
    const m2m = (markAnchors && markAnchors.mark2mark) || { mark1Anchors: {}, mark2Classes: {} };
    const m2mMark1Entries = Object.entries(m2m.mark1Anchors)
        .map(([gid, anchors]) => {
            const inner = Object.entries(anchors)
                .map(([mc, a]) => `${mc}:[${a.x},${a.y}]`)
                .join(',');
            return `${gid}:{${inner}}`;
        })
        .join(',');
    const m2mMark2Entries = Object.entries(m2m.mark2Classes)
        .map(([gid, a]) => `${gid}:[${a.classIdx},${a.x},${a.y}]`)
        .join(',');

    // Build W array for PDF CIDFont /W entry
    // Format: [gid [width]] for each unique width
    // For efficiency, group consecutive glyphs with individual widths
    const wArray = buildPDFWidthArray(widths, metrics.numGlyphs, defaultW);

    return `/**
 * PRE-BUILT FONT DATA — ${fontName}
 * ===================================
 * Generated by: scripts/build-font-data.cjs
 * Source: ${fontName}.ttf
 * License: SIL Open Font License 1.1
 *
 * DO NOT EDIT — Regenerate with:
 *   node scripts/build-font-data.cjs assets/fonts/${fontName}.ttf assets/fonts/${fontName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-data.js
 */

// Font metrics
export const metrics = ${JSON.stringify(metrics)};

// Font name for PDF /BaseFont
export const fontName = '${fontName.replace(/[^A-Za-z0-9-]/g, '')}';

// Unicode codepoint → Glyph ID mapping (sparse object, ~O(1) lookup)
export const cmap = {${cmapEntries}};

// Glyph ID → Advance Width (only non-default widths; default = ${defaultW})
export const defaultWidth = ${defaultW};
export const widths = {${widthEntries}};

// GSUB SingleSubst: fromGid → substituteGid
// Used by the Thai mini-shaper to select below-clash variants of consonants.
export const gsub = {${gsubEntries}};

// GPOS MarkToBase anchors — used by the Thai mini-shaper for mark positioning.
// marks[gid] = [classIdx, anchorX, anchorY]  (design units)
// bases[gid] = { classIdx: [anchorX, anchorY] }
export const markAnchors = {
  marks: {${marksEntries}},
  bases: {${basesEntries}}
};

// GPOS MarkToMark anchors — used for Thai vowel+tone stacking.
// mark1Anchors[mark1Gid] = { classIdx: [anchorX, anchorY] }  (base mark, e.g. above vowel)
// mark2Classes[mark2Gid] = [classIdx, anchorX, anchorY]       (combining mark, e.g. tone)
export const mark2mark = {
  mark1Anchors: {${m2mMark1Entries}},
  mark2Classes: {${m2mMark2Entries}}
};

// PDF /W array string (pre-formatted for CIDFont object)
export const pdfWidthArray = '${wArray}';

// Raw TTF binary as base64 (for PDF FontFile2 embedding)
export const ttfBase64 = '${ttfBase64}';

// Utility: get glyph width
export function getGlyphWidth(glyphId) {
    return widths[glyphId] !== undefined ? widths[glyphId] : ${defaultW};
}

// Utility: get glyph ID for unicode code point
export function getGlyphId(codePoint) {
    return cmap[codePoint] || 0;
}
`;
}

/**
 * Build PDF /W array for CIDFont width definitions.
 * Groups consecutive glyphs: [startGid [w1 w2 w3 ...]]
 */
function buildPDFWidthArray(widths, numGlyphs, defaultWidth) {
    // Collect all glyph widths as array
    const allWidths = [];
    for (let i = 0; i < numGlyphs; i++) {
        allWidths.push(widths[i] !== undefined ? widths[i] : defaultWidth);
    }

    // Build grouped /W array entries
    const parts = [];
    let i = 0;
    while (i < numGlyphs) {
        // Skip glyphs with default width
        if (allWidths[i] === defaultWidth) { i++; continue; }

        // Find consecutive run of non-default widths
        let j = i;
        while (j < numGlyphs && allWidths[j] !== defaultWidth) j++;

        // Emit group: startGid [w_i w_{i+1} ... w_{j-1}]
        const ws = allWidths.slice(i, j).join(' ');
        parts.push(`${i} [${ws}]`);
        i = j;
    }

    return parts.join(' ');
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node scripts/build-font-data.cjs <input.ttf> <output.js>');
        console.error('Example: node scripts/build-font-data.cjs assets/fonts/NotoSansThai-Regular.ttf assets/fonts/noto-thai-data.js');
        process.exit(2);
    }

    const inputPath = path.resolve(args[0]);
    const outputPath = path.resolve(args[1]);

    if (!fs.existsSync(inputPath)) {
        console.error(`❌ Input file not found: ${inputPath}`);
        process.exit(2);
    }

    console.log(`📖 Reading: ${inputPath}`);
    const buffer = fs.readFileSync(inputPath);
    console.log(`   Size: ${(buffer.length / 1024).toFixed(1)} KB`);

    console.log('🔍 Parsing TTF tables...');
    const parsed = parseTTF(buffer);

    console.log(`   unitsPerEm: ${parsed.metrics.unitsPerEm}`);
    console.log(`   numGlyphs: ${parsed.metrics.numGlyphs}`);
    console.log(`   cmap entries: ${Object.keys(parsed.cmap).length}`);
    console.log(`   ascent: ${parsed.metrics.ascent}, descent: ${parsed.metrics.descent}`);
    console.log(`   capHeight: ${parsed.metrics.capHeight}`);
    console.log(`   bbox: [${parsed.metrics.bbox.join(', ')}]`);

    console.log('📦 Encoding TTF to base64...');
    const ttfBase64 = buffer.toString('base64');
    console.log(`   base64 size: ${(ttfBase64.length / 1024).toFixed(1)} KB`);

    // Derive font name from filename
    const fontName = path.basename(inputPath, '.ttf');

    console.log('📝 Generating JS module...');
    const moduleCode = generateModule(fontName, parsed, ttfBase64);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, moduleCode, 'utf8');
    console.log(`✅ Written: ${outputPath} (${(moduleCode.length / 1024).toFixed(1)} KB)`);
    console.log('');
    console.log('📋 Summary:');
    console.log(`   Font: ${fontName}`);
    console.log(`   Glyphs: ${parsed.metrics.numGlyphs}`);
    console.log(`   Cmap entries: ${Object.keys(parsed.cmap).length}`);
    console.log(`   TTF binary: ${(buffer.length / 1024).toFixed(1)} KB`);
    console.log(`   Output module: ${(moduleCode.length / 1024).toFixed(1)} KB`);
}

main();
