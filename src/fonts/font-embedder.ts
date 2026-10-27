/**
 * pdfnative — Font Embedder
 * ===========================
 * Helpers for embedding CIDFont Type2 fonts in PDF:
 *   - Base64 → binary string decoder
 *   - ToUnicode CMap builder
 *   - Compact /W width array builder
 */

import { preferredCodepoint } from './unicode-preference.js';

/**
 * Decode a base64 string to a single-byte binary string.
 * Each character maps to exactly one byte (charCode ≤ 0xFF).
 */
export function base64ToByteString(b64: string): string {
    if (typeof atob === 'function') {
        return atob(b64);
    }
    // Node.js fallback
    const buf = (globalThis as Record<string, unknown>)['Buffer'] as { from(s: string, e: string): Uint8Array };
    const bytes = buf.from(b64, 'base64');
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        result += String.fromCharCode(bytes[i]);
    }
    return result;
}

/**
 * The code point(s) each glyph is named by, from the strongest evidence down:
 * the code point the document actually encoded for the glyph (`encoded`),
 * then what a shaper reported for a glyph it produced (`overrides`), then the
 * inverted cmap — where a glyph several code points share is named by the
 * ordinary character rather than a compatibility form, the lowest code point
 * among equals ({@link preferredCodepoint}, 1.9.0, #84). A legitimately
 * mapped U+0000 keeps its glyph (strict `undefined` checks).
 */
function resolveGlyphNames(
    cmap: Record<number, number>,
    overrides?: ReadonlyMap<number, number | readonly number[]>,
    encoded?: ReadonlyMap<number, number>,
): Record<number, number | readonly number[]> {
    const glyphToUnicode: Record<number, number | readonly number[]> = {};
    for (const [cp, gid] of Object.entries(cmap)) {
        const cpNum = Number(cp);
        const prev = glyphToUnicode[gid];
        if (prev === undefined) glyphToUnicode[gid] = cpNum;
        else if (typeof prev === 'number') glyphToUnicode[gid] = preferredCodepoint(prev, cpNum);
    }
    // Glyph 0 is `.notdef`: naming it would hide a character the font does
    // not cover behind a Unicode value (PDF/A-2 forbids the glyph outright).
    if (overrides) {
        for (const [gid, cp] of overrides) if (gid !== 0) glyphToUnicode[gid] = cp;
    }
    if (encoded) {
        for (const [gid, cp] of encoded) if (gid !== 0) glyphToUnicode[gid] = cp;
    }
    delete glyphToUnicode[0];
    return glyphToUnicode;
}

/**
 * The used glyph ids a ToUnicode CMap built from the same evidence would
 * leave unnamed — what a PDF/A level-U claim cannot tolerate (ISO 19005-2
 * §6.2.11.7.2). Glyph 0 (`.notdef`) counts: a character the font does not
 * cover is still a used code without a Unicode value.
 *
 * @since 1.9.0
 */
export function unmappedUsedGids(
    cmap: Record<number, number>,
    usedGids: ReadonlySet<number>,
    overrides?: ReadonlyMap<number, number | readonly number[]>,
    encoded?: ReadonlyMap<number, number>,
): number[] {
    const names = resolveGlyphNames(cmap, overrides, encoded);
    return [...usedGids].filter(gid => names[gid] === undefined).sort((a, b) => a - b);
}

/**
 * Build a PDF ToUnicode CMap stream for CIDFont.
 * Maps glyph IDs back to Unicode code points for text selection/search.
 *
 * @param cmap - Unicode codepoint → glyph ID mapping
 * @param usedGids - Only include these glyph IDs (subset optimization)
 * @param overrides - Glyph ID → code point(s) for glyphs the cmap cannot
 *   name: the output of an OpenType substitution (`smcp`, `onum`, …) is
 *   reached through GSUB, not the cmap, and must map back to the character
 *   it replaced; a conjunct or a contextual form a shaper produced names
 *   every code point it stands for (a `bfchar` destination may hold several,
 *   ISO 32000-1 §9.10.3). Since 1.9.0 an override outranks the inverted
 *   cmap: it is what the text actually produced. (v1.8.0)
 * @param encoded - Glyph ID → the code point the document encoded for it
 *   through the cmap; the strongest evidence, consulted first (v1.9.0, #84).
 * @param cids - The document's CID space (`cids[cid]` = glyph id, C28): the
 *   entries are then keyed by CID, the code the content streams show.
 *   Without it the codes are the glyph ids.
 */
export function buildToUnicodeCMap(
    cmap: Record<number, number>,
    usedGids: Set<number>,
    overrides?: ReadonlyMap<number, number | readonly number[]>,
    encoded?: ReadonlyMap<number, number>,
    cids?: readonly number[],
): string {
    const glyphToUnicode = resolveGlyphNames(cmap, overrides, encoded);

    // Build bfchar entries (max 100 per block per PDF spec)
    const entries: [number, number | readonly number[]][] = cids !== undefined
        ? cids.flatMap((gid, cid) => {
            const cp = glyphToUnicode[gid];
            return cp !== undefined && (!usedGids || usedGids.has(gid)) ? [[cid, cp] as [number, number | readonly number[]]] : [];
        })
        : Object.entries(glyphToUnicode)
            .map(([gid, cp]) => [Number(gid), cp] as [number, number | readonly number[]])
            .filter(([gid]) => !usedGids || usedGids.has(gid))
            .sort((a, b) => a[0] - b[0]);

    const utf16 = (cp: number): string => {
        if (cp > 0xFFFF) {
            const hi = 0xD800 + ((cp - 0x10000) >> 10);
            const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
            return `${hi.toString(16).toUpperCase()}${lo.toString(16).toUpperCase()}`;
        }
        return cp.toString(16).padStart(4, '0').toUpperCase();
    };
    const chunks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        const lines = batch.map(([gid, cp]) => {
            const gidHex = gid.toString(16).padStart(4, '0').toUpperCase();
            const dst = typeof cp === 'number' ? utf16(cp) : cp.map(utf16).join('');
            return `<${gidHex}> <${dst}>`;
        });
        chunks.push(`${batch.length} beginbfchar\n${lines.join('\n')}\nendbfchar`);
    }

    return [
        '/CIDInit /ProcSet findresource begin',
        '12 dict begin',
        'begincmap',
        '/CIDSystemInfo',
        '<< /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /Adobe-Identity-UCS def',
        '/CMapType 2 def',
        '1 begincodespacerange',
        '<0000> <FFFF>',
        'endcodespacerange',
        ...chunks,
        'endcmap',
        'CMapName currentdict /CMap defineresource pop',
        'end',
        'end'
    ].join('\n');
}

/**
 * Build a compact /W array string for the CIDFont dictionary using only used GIDs.
 * Groups consecutive GIDs into ranges.
 *
 * @param widths - Full glyph widths table
 * @param usedGids - Set of used glyph IDs
 * @returns Compact /W array string, or null if no valid entries
 */
/**
 * The six-uppercase-letter tag ISO 32000-1 §9.6.4 puts in front of a subset
 * font's name (`ABCDEF+NotoSans-Regular`), derived from the font name and the
 * kept glyph set (FNV-1a, base 26): two subsets of one face differ, identical
 * ones agree, and the bytes stay deterministic (1.9.0, C21). Preflight tools
 * and font-merging RIPs read the tag to tell subsets apart.
 */
export function subsetTag(fontName: string, usedGids: ReadonlySet<number>): string {
    let h = 0x811C9DC5;
    const mix = (v: number): void => { h ^= v & 0xFF; h = Math.imul(h, 0x01000193) >>> 0; };
    for (let i = 0; i < fontName.length; i++) mix(fontName.charCodeAt(i));
    for (const g of [...usedGids].sort((a, b) => a - b)) { mix(g); mix(g >>> 8); }
    let tag = '';
    let x = h;
    for (let i = 0; i < 6; i++) { tag += String.fromCharCode(65 + (x % 26)); x = Math.floor(x / 26); }
    return tag;
}

/**
 * The `/W` array of a font whose codes are the document's CIDs (C28):
 * `cids[cid]` is the glyph behind each code, and the widths of consecutive
 * CIDs form one `c [w w …]` group — broken only by a glyph without a width
 * entry, which `/DW` covers exactly as the layout engine measured it. CID 0
 * is listed only when the document drew `.notdef`. `null` when nothing is
 * listed (the `/W []` of an unused font).
 *
 * @since 1.9.0
 */
export function buildCidWidthArray(widths: Record<number, number>, cids: readonly number[], usedGids: ReadonlySet<number>): string | null {
    const parts: string[] = [];
    let start = -1;
    let run: number[] = [];
    const flush = (): void => {
        if (run.length > 0) parts.push(`${start} [${run.join(' ')}]`);
        run = [];
        start = -1;
    };
    for (let cid = 0; cid < cids.length; cid++) {
        const gid = cids[cid];
        const w = widths[gid];
        if (w === undefined || (cid === 0 && !usedGids.has(0))) { flush(); continue; }
        if (start < 0) start = cid;
        run.push(w);
    }
    flush();
    return parts.length > 0 ? parts.join(' ') : null;
}

export function buildSubsetWidthArray(widths: Record<number, number>, usedGids: Set<number>): string | null {
    if (!usedGids || usedGids.size === 0) return null;
    // GIDs without a width entry are omitted here on purpose: the CIDFont
    // dictionary always carries /DW (the font's defaultWidth), which is
    // exactly the advance the layout engine used for those glyphs — the
    // viewer's /DW fallback therefore matches layout (ISO 32000-1 §9.7.4.3).
    const sorted = [...usedGids].filter(g => widths[g] !== undefined).sort((a, b) => a - b);
    if (sorted.length === 0) return null;

    const parts: string[] = [];
    let i = 0;
    while (i < sorted.length) {
        const start = sorted[i];
        const run = [widths[start]];
        while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) {
            i++;
            run.push(widths[sorted[i]]);
        }
        parts.push(`${start} [${run.join(' ')}]`);
        i++;
    }
    return parts.join(' ');
}
