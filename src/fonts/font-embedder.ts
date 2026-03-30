/**
 * pdfnative — Font Embedder
 * ===========================
 * Helpers for embedding CIDFont Type2 fonts in PDF:
 *   - Base64 → binary string decoder
 *   - ToUnicode CMap builder
 *   - Compact /W width array builder
 */

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
 * Build a PDF ToUnicode CMap stream for CIDFont.
 * Maps glyph IDs back to Unicode code points for text selection/search.
 *
 * @param cmap - Unicode codepoint → glyph ID mapping
 * @param usedGids - Only include these glyph IDs (subset optimization)
 */
export function buildToUnicodeCMap(cmap: Record<number, number>, usedGids: Set<number>): string {
    // Invert cmap: glyphId → unicode codepoint (keep lowest codepoint)
    const glyphToUnicode: Record<number, number> = {};
    for (const [cp, gid] of Object.entries(cmap)) {
        const cpNum = Number(cp);
        if (!glyphToUnicode[gid] || cpNum < glyphToUnicode[gid]) {
            glyphToUnicode[gid] = cpNum;
        }
    }

    // Build bfchar entries (max 100 per block per PDF spec)
    const entries: [number, number][] = Object.entries(glyphToUnicode)
        .map(([gid, cp]) => [Number(gid), cp] as [number, number])
        .filter(([gid]) => !usedGids || usedGids.has(gid))
        .sort((a, b) => a[0] - b[0]);

    const chunks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        const lines = batch.map(([gid, cp]) => {
            const gidHex = gid.toString(16).padStart(4, '0').toUpperCase();
            if (cp > 0xFFFF) {
                const hi = 0xD800 + ((cp - 0x10000) >> 10);
                const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
                return `<${gidHex}> <${hi.toString(16).toUpperCase()}${lo.toString(16).toUpperCase()}>`;
            }
            return `<${gidHex}> <${cp.toString(16).padStart(4, '0').toUpperCase()}>`;
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
export function buildSubsetWidthArray(widths: Record<number, number>, usedGids: Set<number>): string | null {
    if (!usedGids || usedGids.size === 0) return null;
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
