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

// ── Glyph outline presence (loca) ────────────────────────────────────

/**
 * Code points that are *meant* to have no outline, and must stay in the cmap
 * even though their glyph is empty: controls and the whole space family,
 * zero-width joiners, separators and the bidi isolates.
 *
 * Everything else with an empty outline was stripped by a subsetter.
 */
function isIntentionallyBlank(cp) {
    return cp <= 0x20                       // C0 controls + SPACE
        || cp === 0xA0                      // NO-BREAK SPACE
        || cp === 0x034F                    // COMBINING GRAPHEME JOINER
        || cp === 0x061C                    // ARABIC LETTER MARK (bidi control)
        || cp === 0x115F || cp === 0x1160   // Hangul choseong/jungseong fillers
        || cp === 0x17B4 || cp === 0x17B5   // Khmer inherent vowels
        || cp === 0x180E                    // MONGOLIAN VOWEL SEPARATOR
        || (cp >= 0x2000 && cp <= 0x200F)   // en/em spaces, ZWSP, ZWNJ, ZWJ, LRM/RLM
        || (cp >= 0x2028 && cp <= 0x202F)   // separators, embedding controls, NNBSP
        || (cp >= 0x205F && cp <= 0x206F)   // MMSP, word joiner, invisible operators
        || cp === 0x3000                    // IDEOGRAPHIC SPACE
        || cp === 0x3164                    // HANGUL FILLER
        || (cp >= 0xFE00 && cp <= 0xFE0F)   // variation selectors
        || (cp >= 0xFFF9 && cp <= 0xFFFB)   // interlinear annotation
        || cp === 0xFEFF;                   // ZERO WIDTH NO-BREAK SPACE
}

/**
 * Flag, per glyph id, whether the glyph has an outline.
 *
 * A subsetted font routinely keeps its full glyph count and its full cmap
 * while emptying the outlines it dropped — `pyftsubset --retain-gids` does
 * exactly this. Trusting the cmap alone then makes the module advertise
 * thousands of code points the font cannot draw: the text renders blank
 * instead of falling through to another registered font.
 *
 * Returns `null` for fonts with no `glyf`/`loca` (CFF outlines), where this
 * cannot be determined and every cmap entry is kept.
 */
function readOutlineFlags(r, tables, numGlyphs) {
    if (!tables['loca'] || !tables['glyf'] || !tables['head']) return null;
    try {
        r.seek(tables['head'].offset + 50);
        const indexToLocFormat = r.readInt16();
        const loca = tables['loca'].offset;
        const flags = new Uint8Array(numGlyphs);
        for (let g = 0; g < numGlyphs; g++) {
            let a, b;
            if (indexToLocFormat === 0) {
                r.seek(loca + g * 2); a = r.readUint16() * 2;
                r.seek(loca + (g + 1) * 2); b = r.readUint16() * 2;
            } else {
                r.seek(loca + g * 4); a = r.readUint32();
                r.seek(loca + (g + 1) * 4); b = r.readUint32();
            }
            if (b > a) flags[g] = 1;
        }
        return flags;
    } catch (e) {
        console.warn('[build-font-data] loca parse error (non-fatal):', e.message);
        return null;
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

    // Outline presence, so a subsetted font cannot advertise glyphs whose
    // outlines it has emptied (see readOutlineFlags).
    const outlines = readOutlineFlags(r, tables, numGlyphs);
    const keepGlyph = (cp, gid) => outlines === null || outlines[gid] === 1 || isIntentionallyBlank(cp);

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
                if (gid > 0 && gid < numGlyphs && keepGlyph(c, gid)) {
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
                if (gid > 0 && gid < numGlyphs && keepGlyph(c, gid)) {
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

    // ── Parse 'GSUB' table — Ligature Substitutions for Indic ────────
    // We extract LookupType 4 (LigatureSubst) for conjunct formation:
    //   C + Halant + C → single ligature glyph (Bengali, Tamil, Devanagari)
    const ligatures = parseTTFGSUBLigatures(r, tables);

    // ── Parse 'GPOS' table — MarkToBase + MarkToMark anchor offsets ──
    // LookupType 4 (MarkToBase): mark glyph anchored to base glyph
    // LookupType 6 (MarkToMark): mark glyph anchored to another mark
    //   (used for Thai vowel+tone stacking: tone positioned relative to vowel)
    const markAnchors = parseTTFGPOS(r, tables);

    // ── Parse GSUB per-feature SingleSubst (v1.8.0) ─────────────────
    // Kept separate from `gsub` so a caller can request tabular figures
    // without also getting every other single substitution in the face.
    const features = parseTTFGSUBFeatures(r, tables);

    // ── Parse GPOS LookupType 2 — pair kerning (v1.8.0) ─────────────
    const kern = parseTTFGPOSKerning(r, tables);

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
        ligatures,
        features,
        kern,
        markAnchors
    };
}

/**
 * Tags a font declares but a renderer must not turn on by itself: stylistic
 * sets, character variants, figure styles, small caps, swashes. They are the
 * user's choice, exposed through `features` (see FEATURE_TAGS), and merging
 * them into the default table makes every document render as if the user had
 * ticked every box. Noto Sans Thai puts 27 substitutions behind `aalt` alone.
 */
function isDiscretionaryFeature(tag) {
    return /^(ss\d\d|cv\d\d)$/.test(tag)
        || [
            'aalt', 'salt', 'nalt', 'rand', 'swsh', 'cswh', 'titl', 'hist',
            'ornm', 'unic', 'smcp', 'c2sc', 'pcap', 'c2pc', 'sups', 'subs',
            'sinf', 'numr', 'dnom', 'frac', 'afrc', 'zero', 'ordn', 'case',
            'tnum', 'pnum', 'lnum', 'onum',
        ].includes(tag);
}

// ── GSUB Parser — LookupType 1 (SingleSubst) ─────────────────────────
/**
 * Parse GSUB and extract the SingleSubst (LookupType 1) mappings a shaper
 * may apply by default: `{ fromGid: toGid, ... }`.
 *
 * These carry the contextual variants the mini-shapers need — the Thai tall
 * consonant whose ascender would collide with an above mark, the Lao mark
 * that shifts when its base has a descender. Those live in lookups the font
 * reaches through chained-context rules, so they belong to no feature of
 * their own; the shaper supplies the context instead, from its own cluster
 * analysis.
 *
 * Two things are deliberately excluded:
 *
 *   - **Lookups reachable only through a discretionary feature.** See
 *     {@link isDiscretionaryFeature}. A lookup shared with a default
 *     feature is kept, since something other than the user's preference
 *     wants it.
 *   - **Nothing else.** A lookup attached to no feature at all is a
 *     context-only target and is exactly what the shapers consume.
 *
 * Both subtable formats are handled, and LookupType 7 (Extension
 * Substitution) is resolved: large fonts put most of their lookups behind
 * one, and ignoring it cost Noto Sans 382 substitutions and Noto Sans JP
 * 1469 of its 1477.
 *
 * OpenType spec: §5.2 FeatureList, §6.2.1 SingleSubstFormat1/2, §6.7
 * Extension Substitution.
 */
function parseTTFGSUB(r, tables) {
    const gsub = {};
    if (!tables['GSUB']) return gsub;

    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version (major.minor uint16+uint16)
        r.skip(2); // scriptListOffset
        const featureListOffset = r.readUint16();
        const lookupListOffset = r.readUint16();

        // ── Which lookups only a discretionary feature asks for ──────
        r.seek(base + featureListOffset);
        const featureCount = r.readUint16();
        const wantedBy = new Map(); // lookupIndex → { default, discretionary }
        for (let fi = 0; fi < featureCount; fi++) {
            const tag = r.readTag();
            const featureOffset = r.readUint16();
            const saved = r.pos;
            r.seek(base + featureListOffset + featureOffset);
            r.skip(2); // featureParamsOffset
            const lookupCount = r.readUint16();
            const discretionary = isDiscretionaryFeature(tag);
            for (let li = 0; li < lookupCount; li++) {
                const idx = r.readUint16();
                const seen = wantedBy.get(idx) ?? { default: false, discretionary: false };
                if (discretionary) seen.discretionary = true; else seen.default = true;
                wantedBy.set(idx, seen);
            }
            r.pos = saved;
        }

        // ── Read LookupList ──────────────────────────────────────────
        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            const seen = wantedBy.get(li);
            if (seen && seen.discretionary && !seen.default) continue;

            const lookupBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lookupBase);
            let lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const rawOffsets = [];
            for (let si = 0; si < subtableCount; si++) rawOffsets.push(r.readUint16());

            // LookupType 7 (Extension) wraps the real subtable behind a
            // 32-bit offset so it can sit beyond the 16-bit window.
            let subtables = rawOffsets.map(o => lookupBase + o);
            if (lookupType === 7) {
                const resolved = [];
                let innerType = 0;
                for (const abs of subtables) {
                    r.seek(abs);
                    r.skip(2); // substFormat (1)
                    innerType = r.readUint16();
                    resolved.push(abs + r.readUint32());
                }
                lookupType = innerType;
                subtables = resolved;
            }
            if (lookupType !== 1) continue;

            for (const stBase of subtables) {
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();

                // Read the coverage first, then seek back: reading it moves
                // the cursor, and the fields below sit at a fixed offset.
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);

                if (substFormat === 1) {
                    r.seek(stBase + 4);
                    const delta = r.readInt16();
                    for (const gid of coverageGlyphs) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) gsub[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    r.seek(stBase + 4);
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
// ── GSUB Parser — per-feature SingleSubst (LookupType 1) ─────────────

/**
 * OpenType features extracted per tag, for declarative styling.
 *
 * Unlike {@link parseTTFGSUB}, which deliberately merges every SingleSubst
 * lookup in the font because the Indic and Thai shapers want them all, this
 * keeps each feature separate so a caller can ask for tabular figures
 * without also getting every contextual alternate in the face.
 *
 * Only single substitutions (one glyph in, one glyph out) are extracted:
 * they need no shaping engine, which is what makes them safe to apply to
 * Latin text that currently takes a plain per-codepoint path.
 */
const FEATURE_TAGS = [
    'tnum', // tabular figures — the one that matters for money columns
    'pnum', // proportional figures
    'lnum', // lining figures
    'onum', // old-style figures
    'zero', // slashed zero
    'ordn', // ordinals
    'sups', // superscripts
    'subs', // subscripts
    'smcp', // small capitals
    'c2sc', // capitals to small capitals
    'case', // case-sensitive forms
];

/**
 * Parse GSUB and return `{ tag: { fromGid: toGid } }` for {@link FEATURE_TAGS}.
 *
 * Returns `null` when the font declares none of them, so fonts that gain
 * nothing carry no extra bytes.
 *
 * OpenType spec: §5.2 FeatureList, §6.2.1 SingleSubstFormat1/2.
 */
function parseTTFGSUBFeatures(r, tables) {
    if (!tables['GSUB']) return null;
    const wanted = new Set(FEATURE_TAGS);

    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version
        r.readUint16(); // scriptListOffset — features apply across scripts here
        const featureListOffset = r.readUint16();
        const lookupListOffset = r.readUint16();

        // ── FeatureList: tag → lookup indices ────────────────────────
        r.seek(base + featureListOffset);
        const featureCount = r.readUint16();
        const lookupsByTag = new Map();
        for (let fi = 0; fi < featureCount; fi++) {
            const tag = r.readTag();
            const featureOffset = r.readUint16();
            if (!wanted.has(tag)) continue;
            const saved = r.pos;
            r.seek(base + featureListOffset + featureOffset);
            r.skip(2); // featureParamsOffset
            const lookupCount = r.readUint16();
            const list = lookupsByTag.get(tag) ?? new Set();
            for (let li = 0; li < lookupCount; li++) list.add(r.readUint16());
            lookupsByTag.set(tag, list);
            r.pos = saved;
        }
        if (lookupsByTag.size === 0) return null;

        // ── LookupList offsets ───────────────────────────────────────
        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        /** Collect the SingleSubst pairs of one lookup into `target`. */
        const collect = (lookupIndex, target) => {
            if (lookupIndex >= lookupCount) return;
            const lkBase = base + lookupListOffset + lookupOffsets[lookupIndex];
            r.seek(lkBase);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const subtableOffsets = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());
            if (lookupType !== 1) return; // single substitutions only

            for (const stOffset of subtableOffsets) {
                const stBase = lkBase + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const covered = readCoverageTable(r, stBase + coverageOffset);

                if (substFormat === 1) {
                    r.seek(stBase + 4);
                    const delta = r.readInt16();
                    for (const gid of covered) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) target[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    r.seek(stBase + 4);
                    const glyphCount = r.readUint16();
                    for (let gi = 0; gi < glyphCount && gi < covered.length; gi++) {
                        const sub = r.readUint16();
                        if (sub > 0) target[covered[gi]] = sub;
                    }
                }
            }
        };

        const out = {};
        for (const [tag, indices] of lookupsByTag) {
            const map = {};
            for (const idx of indices) collect(idx, map);
            if (Object.keys(map).length > 0) out[tag] = map;
        }
        return Object.keys(out).length > 0 ? out : null;
    } catch (e) {
        // Non-fatal: a font without usable features simply offers none.
        console.warn('[build-font-data] GSUB feature parse error (non-fatal):', e.message);
        return null;
    }
}

// ── GSUB Parser — LookupType 4 (LigatureSubst) ───────────────────────
/**
 * Parse GSUB table and extract LigatureSubst (LookupType 4) mappings.
 * These are used for Indic conjunct formation: C + Halant + C → ligature glyph.
 *
 * Returns a sparse object keyed by first glyph ID:
 *   { [firstGid]: [[resultGid, comp1, comp2, ...], ...] }
 * Each entry is sorted longest-first for greedy matching.
 * Only LookupType 4 (Ligature Substitution) is extracted.
 *
 * OpenType spec: §6.2.4 — LigatureSubstFormat1
 * Coverage table identifies first glyph; LigatureSet per covered glyph
 * contains Ligature records: substituteGlyph + component[componentCount-1].
 */
function parseTTFGSUBLigatures(r, tables) {
    const ligatures = {};
    if (!tables['GSUB']) return ligatures;

    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version (major.minor uint16+uint16)
        r.skip(2); // scriptListOffset
        r.skip(2); // featureListOffset
        const lookupListOffset = r.readUint16();

        // ── Read LookupList ──────────────────────────────────────────
        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            const lookupBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lookupBase);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const subtableOffsets = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());

            // LookupType 4 = LigatureSubst
            if (lookupType !== 4) continue;

            for (const stOffset of subtableOffsets) {
                const stBase = lookupBase + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                if (substFormat !== 1) continue; // Only Format 1 defined for LigatureSubst

                const coverageOffset = r.readUint16();
                const ligSetCount = r.readUint16();
                const ligSetOffsets = [];
                for (let lsi = 0; lsi < ligSetCount; lsi++) ligSetOffsets.push(r.readUint16());

                // Read Coverage table — identifies first glyph of each ligature
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);

                for (let lsi = 0; lsi < ligSetCount && lsi < coverageGlyphs.length; lsi++) {
                    const firstGid = coverageGlyphs[lsi];
                    const ligSetBase = stBase + ligSetOffsets[lsi];
                    r.seek(ligSetBase);
                    const ligCount = r.readUint16();
                    const ligOffsets = [];
                    for (let lgi = 0; lgi < ligCount; lgi++) ligOffsets.push(r.readUint16());

                    for (const ligOff of ligOffsets) {
                        r.seek(ligSetBase + ligOff);
                        const ligatureGlyph = r.readUint16();
                        const componentCount = r.readUint16();
                        // componentCount includes the first glyph, so components array has componentCount-1 entries
                        const components = [];
                        for (let ci = 0; ci < componentCount - 1; ci++) {
                            components.push(r.readUint16());
                        }

                        if (!ligatures[firstGid]) ligatures[firstGid] = [];
                        // Store as [resultGid, comp1, comp2, ...]
                        ligatures[firstGid].push([ligatureGlyph, ...components]);
                    }
                }
            }
        }

        // Sort entries for each first glyph: longest component list first (greedy matching)
        for (const gid of Object.keys(ligatures)) {
            ligatures[gid].sort((a, b) => b.length - a.length);
        }
    } catch (e) {
        console.warn('[build-font-data] GSUB ligature parse error (non-fatal):', e.message);
    }
    return ligatures;
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
// ── GPOS Parser — LookupType 2 (PairPos / kerning) ───────────────────

/**
 * Read a ClassDef table into `{ gid: classIndex }`. Glyphs absent from the
 * table are class 0 by definition (OpenType §5.1).
 */
function readClassDef(r, absOffset) {
    const classes = {};
    r.seek(absOffset);
    const format = r.readUint16();
    if (format === 1) {
        const startGid = r.readUint16();
        const count = r.readUint16();
        for (let i = 0; i < count; i++) {
            const c = r.readUint16();
            if (c !== 0) classes[startGid + i] = c;
        }
    } else if (format === 2) {
        const rangeCount = r.readUint16();
        for (let i = 0; i < rangeCount; i++) {
            const start = r.readUint16();
            const end = r.readUint16();
            const c = r.readUint16();
            if (c !== 0) for (let g = start; g <= end; g++) classes[g] = c;
        }
    }
    return classes;
}

/** Number of bytes a ValueRecord occupies for a given valueFormat mask. */
function valueRecordSize(valueFormat) {
    let n = 0;
    for (let bit = 0; bit < 8; bit++) if (valueFormat & (1 << bit)) n += 2;
    return n;
}

/**
 * Read a ValueRecord and return its XAdvance, skipping the rest.
 * XAdvance is bit 2 (0x0004), preceded by XPlacement (0x0001) and
 * YPlacement (0x0002).
 */
function readXAdvance(r, valueFormat) {
    let x = 0;
    if (valueFormat & 0x0001) r.skip(2);           // XPlacement
    if (valueFormat & 0x0002) r.skip(2);           // YPlacement
    if (valueFormat & 0x0004) x = r.readInt16();   // XAdvance
    if (valueFormat & 0x0008) r.skip(2);           // YAdvance
    if (valueFormat & 0x0010) r.skip(2);           // XPlaDevice
    if (valueFormat & 0x0020) r.skip(2);           // YPlaDevice
    if (valueFormat & 0x0040) r.skip(2);           // XAdvDevice
    if (valueFormat & 0x0080) r.skip(2);           // YAdvDevice
    return x;
}

/**
 * Parse GPOS LookupType 2 (PairPos) into a compact kerning table.
 *
 * Kerning is the most visible typographic refinement a font carries and
 * pdfnative extracted none of it: the generator skipped every GPOS lookup
 * that was not MarkToBase or MarkToMark, so "AV", "To" and "Yo" were set with
 * their nominal advances in every script.
 *
 * The shape mirrors how OpenType stores it, deliberately:
 *
 *   { p: { leftGid: { rightGid: adjust } },
 *     c: [ { l: { gid: class }, r: { gid: class }, n: class2Count,
 *            m: { c1 * n + c2: adjust } } ] }
 *
 * `p` holds format-1 subtables, which list glyph pairs directly. `c` holds
 * format-2 subtables, which are class-based, with a SPARSE matrix keyed by
 * the flattened class index.
 *
 * Expanding the class matrix to glyph pairs was tried first and rejected: it
 * turned Noto Sans's kerning into 71 094 pairs and 594 KB, a fifth of the
 * module, paid at parse time by every consumer whether or not they enable
 * kerning. Keeping the class form costs a second lookup and a fraction of the
 * bytes.
 *
 * Returns `null` when the font carries no pair positioning.
 */
function parseTTFGPOSKerning(r, tables) {
    if (!tables['GPOS']) return null;
    const pairMap = {};
    const classSubtables = [];
    let pairs = 0;

    const add = (left, right, adjust) => {
        if (adjust === 0) return;
        let row = pairMap[left];
        if (row === undefined) { row = {}; pairMap[left] = row; }
        if (row[right] === undefined) pairs++;
        row[right] = adjust;
    };

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
            const lkBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lkBase);
            let lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const rawOffsets = [];
            for (let si = 0; si < subtableCount; si++) rawOffsets.push(r.readUint16());

            // LookupType 9 (Extension Positioning) wraps the real subtable so
            // it can sit beyond the 16-bit offset window. Large fonts put most
            // of their kerning behind one — Noto Sans hides all but two
            // subtables there — so skipping type 9 means missing the kerning.
            let stAbs = rawOffsets.map(o => lkBase + o);
            if (lookupType === 9) {
                const resolved = [];
                let innerType = 0;
                for (const abs of stAbs) {
                    r.seek(abs);
                    r.skip(2); // posFormat (1)
                    innerType = r.readUint16();
                    resolved.push(abs + r.readUint32());
                }
                lookupType = innerType;
                stAbs = resolved;
            }
            if (lookupType !== 2) continue;

            for (const stBase of stAbs) {
                r.seek(stBase);
                const posFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const valueFormat1 = r.readUint16();
                const valueFormat2 = r.readUint16();
                const covered = readCoverageTable(r, stBase + coverageOffset);

                if (posFormat === 1) {
                    r.seek(stBase + 8);
                    const pairSetCount = r.readUint16();
                    const pairSetOffsets = [];
                    for (let i = 0; i < pairSetCount; i++) pairSetOffsets.push(r.readUint16());

                    for (let i = 0; i < pairSetCount && i < covered.length; i++) {
                        const psBase = stBase + pairSetOffsets[i];
                        r.seek(psBase);
                        const pairValueCount = r.readUint16();
                        for (let p = 0; p < pairValueCount; p++) {
                            const second = r.readUint16();
                            const adjust = readXAdvance(r, valueFormat1);
                            // The second glyph's own record is not applied:
                            // PDF positions the pair by the first advance.
                            r.skip(valueRecordSize(valueFormat2));
                            add(covered[i], second, adjust);
                        }
                    }
                } else if (posFormat === 2) {
                    r.seek(stBase + 8);
                    const classDef1Offset = r.readUint16();
                    const classDef2Offset = r.readUint16();
                    const class1Count = r.readUint16();
                    const class2Count = r.readUint16();
                    const recordsBase = r.pos;

                    const cd1 = readClassDef(r, stBase + classDef1Offset);
                    const cd2 = readClassDef(r, stBase + classDef2Offset);

                    // Only classes the coverage table can actually reach.
                    const liveClass1 = new Set();
                    for (const left of covered) {
                        const c1 = cd1[left] ?? 0;
                        if (c1 < class1Count) liveClass1.add(c1);
                    }
                    const liveClass2 = new Set(Object.values(cd2).filter(c => c < class2Count));

                    const recSize = valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);
                    const matrix = {};
                    let cells = 0;
                    for (const c1 of liveClass1) {
                        for (const c2 of liveClass2) {
                            r.seek(recordsBase + (c1 * class2Count + c2) * recSize);
                            const adjust = readXAdvance(r, valueFormat1);
                            if (adjust === 0) continue;
                            matrix[c1 * class2Count + c2] = adjust;
                            cells++;
                        }
                    }
                    if (cells === 0) continue;

                    // Keep only the class assignments the matrix can use.
                    const usedC1 = new Set();
                    const usedC2 = new Set();
                    for (const key of Object.keys(matrix)) {
                        const k = Number(key);
                        usedC1.add(Math.floor(k / class2Count));
                        usedC2.add(k % class2Count);
                    }
                    const left = {};
                    for (const gid of covered) {
                        const c1 = cd1[gid] ?? 0;
                        if (usedC1.has(c1)) left[gid] = c1;
                    }
                    // Class 0 is the ClassDef default, so glyphs in it are
                    // left out and the runtime falls back to 0. Spelling them
                    // out would list most of the font for no information.
                    const right = {};
                    for (const [gidStr, c2] of Object.entries(cd2)) {
                        if (c2 !== 0 && usedC2.has(c2)) right[Number(gidStr)] = c2;
                    }
                    classSubtables.push({ l: left, r: right, n: class2Count, m: matrix });
                    pairs += cells;
                }
            }
        }
    } catch (e) {
        console.warn('[build-font-data] GPOS kerning parse error (non-fatal):', e.message);
        return null;
    }
    if (pairs === 0) return null;
    return {
        p: Object.keys(pairMap).length > 0 ? pairMap : null,
        c: classSubtables.length > 0 ? classSubtables : null,
    };
}

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
    const { metrics, cmap, widths, gsub, ligatures, features, kern, markAnchors } = parsed;

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

    // Compact ligatures: { firstGid: [[resultGid, comp1, ...], ...] }
    const ligaturesEntries = Object.entries(ligatures || {})
        .map(([gid, ligs]) => {
            const inner = ligs.map(lig => `[${lig.join(',')}]`).join(',');
            return `${gid}:[${inner}]`;
        })
        .join(',');

    // Compact kerning, mirroring the OpenType shape (see parseTTFGPOSKerning).
    const numMap = (o) => `{${Object.entries(o).map(([k, v]) => `${k}:${v}`).join(',')}}`;
    const kernLiteral = kern === null ? 'null' : (() => {
        const p = kern.p === null ? 'null'
            : `{${Object.entries(kern.p).map(([l, row]) => `${l}:${numMap(row)}`).join(',')}}`;
        const c = kern.c === null ? 'null'
            : `[${kern.c.map(s => `{l:${numMap(s.l)},r:${numMap(s.r)},n:${s.n},m:${numMap(s.m)}}`).join(',')}]`;
        return `{p:${p},c:${c}}`;
    })();

    // Compact per-feature single substitutions: { tag: { fromGid: toGid } }
    const featuresEntries = Object.entries(features || {})
        .map(([tag, map]) => {
            const inner = Object.entries(map).map(([k, v]) => `${k}:${v}`).join(',');
            return `${JSON.stringify(tag)}:{${inner}}`;
        })
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

// GSUB LigatureSubst: firstGid → [[resultGid, comp1, comp2, ...], ...]
// Used by Indic shapers for conjunct formation (C + Halant + C → ligature).
// Entries sorted longest-first for greedy matching.
export const ligatures = {${ligaturesEntries}};

// GSUB per-feature single substitutions (v1.8.0) — { tag: { fromGid: toGid } }.
// Kept apart from the merged gsub table above, which unions every SingleSubst
// lookup in the font, so a caller can ask for tabular figures alone.
export const features = ${features ? `{${featuresEntries}}` : 'null'};

// GPOS PairPos kerning (v1.8.0), design units, negative pulls a pair together.
//   p = format-1 glyph pairs        { leftGid: { rightGid: adjust } }
//   c = format-2 class subtables    [{ l, r, n, m }] with a sparse matrix
//       keyed by (class1 * n + class2)
// The class form is kept rather than expanded: expanding Noto Sans produced
// 71 094 pairs and 594 KB, paid at parse time by every consumer.
export const kern = ${kernLiteral};

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
