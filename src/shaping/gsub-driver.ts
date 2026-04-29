/**
 * pdfnative — GSUB Driver (shared OpenType ligature substitution)
 * ===============================================================
 * Pure-function helpers for GSUB LookupType 4 (LigatureSubst), shared by
 * Bengali, Tamil, and Devanagari shapers. Extracted in v1.1.0 (issue #25)
 * to avoid 3× duplication of the same `tryLigature()` body.
 *
 * Ligature tables are pre-baked at font compile time
 * (see `tools/build-font-data.cjs`) as:
 *
 *   ligatures[firstGid] = [ [resultGid, comp1, comp2, ...], ... ]
 *
 * Entries are sorted longest-first so a single greedy match is correct
 * for Indic conjunct formation.
 *
 * References:
 *   - OpenType spec: GSUB LookupType 4 (Ligature Substitution)
 *   - HarfBuzz: hb-ot-layout-gsub-table.hh::LigatureSubst
 */

/** Result of a successful ligature match. */
export interface LigatureMatch {
    /** Resulting (composed) glyph ID. */
    readonly resultGid: number;
    /** Number of input GIDs consumed (always >= 2). */
    readonly consumed: number;
}

/**
 * Try to match the head of `gids` against a GSUB ligature table.
 *
 * Returns the longest matching ligature (entries are pre-sorted longest-first
 * by the font baker), or null if no ligature applies.
 *
 * @param gids - Input GID sequence; only the prefix is consulted
 * @param ligatures - GSUB LookupType 4 table from FontData.ligatures
 */
export function tryLigature(
    gids: readonly number[],
    ligatures: Record<number, number[][]> | null | undefined,
): LigatureMatch | null {
    if (!ligatures || gids.length < 2) return null;
    const firstGid = gids[0];
    const entries = ligatures[firstGid];
    if (!entries) return null;

    for (const entry of entries) {
        // entry = [resultGid, comp1, comp2, ...]
        const compCount = entry.length - 1;
        if (compCount > gids.length - 1) continue;
        let match = true;
        for (let ci = 0; ci < compCount; ci++) {
            if (gids[1 + ci] !== entry[1 + ci]) { match = false; break; }
        }
        if (match) return { resultGid: entry[0], consumed: compCount + 1 };
    }
    return null;
}
