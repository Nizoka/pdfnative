/**
 * pdfnative — OpenType feature application (v1.8.0)
 * ===================================================
 * Declarative access to the single-substitution features a font declares:
 * tabular figures, slashed zero, small capitals and their relatives.
 *
 * Only substitutions that replace one glyph with one glyph are supported.
 * That restriction is what makes them safe here: they need no shaping engine
 * and no reordering, so they can be applied to text that otherwise takes a
 * plain per-codepoint path. Features that reorder or combine glyphs
 * (`liga`, `calt`, `frac`) are contextual or ligature lookups and are out of
 * scope.
 *
 * The headline case is `tnum`. Proportional digits make a column of amounts
 * ragged because `1` is narrower than `8`; tabular figures give every digit
 * the same advance, which is the difference between a financial table that
 * lines up and one that does not.
 *
 * @module fonts/font-features
 */

import type { FontData, TextRun } from '../types/pdf-types.js';

/**
 * Feature tags pdfnative extracts and can apply.
 *
 * A font only offers what it actually declares; asking for a tag a face does
 * not carry is a silent no-op rather than an error, because the same document
 * may be built with different fonts.
 */
export const SUPPORTED_FEATURES = [
    'tnum', // tabular (fixed-width) figures
    'pnum', // proportional figures
    'lnum', // lining figures
    'onum', // old-style (text) figures
    'zero', // slashed zero
    'ordn', // ordinals
    'sups', // superscripts
    'subs', // subscripts
    'smcp', // small capitals
    'c2sc', // capitals to small capitals
    'case', // case-sensitive forms
] as const;

/** One of {@link SUPPORTED_FEATURES}. */
export type FontFeatureTag = typeof SUPPORTED_FEATURES[number];

/**
 * Compose the requested features into one glyph → glyph map for a font.
 *
 * Later tags win where two features touch the same glyph, so the caller's
 * order is meaningful: `['lnum', 'tnum']` reads as "lining figures, tabular".
 *
 * Returns `null` when nothing applies, so callers can skip the work entirely.
 */
export function composeFeatureMap(
    fd: FontData,
    tags: readonly string[],
): Record<number, number> | null {
    const available = fd.features;
    if (!available || tags.length === 0) return null;

    let map: Record<number, number> | null = null;
    for (const tag of tags) {
        const sub = available[tag];
        if (!sub) continue;
        if (map === null) map = {};
        for (const from of Object.keys(sub)) {
            map[Number(from)] = sub[Number(from)];
        }
    }
    return map;
}

/** Parse a run's `<hex>` glyph string into glyph ids. */
function parseGids(hexStr: string): number[] | null {
    if (!hexStr.startsWith('<') || !hexStr.endsWith('>')) return null;
    const body = hexStr.slice(1, -1);
    if (body.length === 0 || body.length % 4 !== 0) return null;
    const gids: number[] = [];
    for (let i = 0; i < body.length; i += 4) {
        const n = Number.parseInt(body.slice(i, i + 4), 16);
        if (Number.isNaN(n)) return null;
        gids.push(n);
    }
    return gids;
}

function toHex(gids: readonly number[]): string {
    let out = '';
    for (const g of gids) out += g.toString(16).toUpperCase().padStart(4, '0');
    return `<${out}>`;
}

/**
 * Apply feature substitutions to already-built text runs.
 *
 * Shaped runs are left untouched: a shaper has already chosen contextual
 * forms and positioned marks against specific glyphs, and substituting
 * underneath it would invalidate that work. In practice the features here
 * target digits and Latin letters, which are never shaped.
 *
 * Widths are recomputed from the substituted glyphs — the whole point of
 * `tnum` is that the advances change.
 *
 * A substituted glyph is reachable only through the feature, never through
 * the font's cmap, so the glyph bookkeeping that the cmap path performs on
 * the way in (`trackGid`) has to be redone here on the way out: the subsetter
 * keeps only tracked glyphs, the `/W` array lists only tracked glyphs, and
 * ToUnicode inverts the cmap. `onSubstitute` is the seam for all three.
 *
 * @param runs Runs from `EncodingContext.textRuns()`.
 * @param tags Feature tags to apply, in order of increasing precedence.
 * @param sz   Font size in points, for the recomputed advances.
 * @param onSubstitute Called once per substituted glyph occurrence with the
 *   run's font ref, the glyph that was replaced and the glyph that replaced
 *   it. Absent in pure measurement contexts.
 */
export function applyFeaturesToRuns(
    runs: readonly TextRun[],
    tags: readonly string[],
    sz: number,
    onSubstitute?: (fontRef: string, fromGid: number, toGid: number, fd: FontData) => void,
): TextRun[] {
    if (tags.length === 0) return runs as TextRun[];

    const out: TextRun[] = [];
    let cache: { fd: FontData; map: Record<number, number> | null } | null = null;

    for (const run of runs) {
        if (run.shaped || !run.hexStr) { out.push(run); continue; }

        if (cache === null || cache.fd !== run.fontData) {
            cache = { fd: run.fontData, map: composeFeatureMap(run.fontData, tags) };
        }
        const map = cache.map;
        if (map === null) { out.push(run); continue; }

        const gids = parseGids(run.hexStr);
        if (gids === null) { out.push(run); continue; }

        let changed = false;
        const fd = run.fontData;
        const substituted = gids.map(g => {
            const s = map[g];
            if (s === undefined || s === g) return g;
            changed = true;
            onSubstitute?.(run.fontRef, g, s, fd);
            return s;
        });
        if (!changed) { out.push(run); continue; }

        const upm = fd.metrics.unitsPerEm;
        let design = 0;
        for (const g of substituted) design += fd.widths[g] ?? fd.defaultWidth;

        out.push({ ...run, hexStr: toHex(substituted), widthPt: design * sz / upm });
    }
    return out;
}
