/**
 * pdfnative — Font Data Validator
 * ================================
 * `validateFontData()` performs a read-only structural sanity check on a
 * {@link FontData} module before it is used for rendering. The bundled font
 * modules under `pdfnative/fonts/*` are already trusted; this validator exists
 * for consumers who **build their own** font data (via `tools/build-font-data.cjs`
 * or by hand) from an untrusted or unfamiliar TTF/OTF.
 *
 * It catches the common failure modes — a corrupt/empty base64 payload, a
 * non-SFNT binary, an empty `cmap`, glyph ids that point outside the metrics,
 * a malformed `pdfWidthArray`, or non-finite metrics — and reports them as
 * descriptive errors instead of letting a cryptic `.notdef`/`NaN` failure
 * surface deep inside the encoding/subsetting pipeline.
 *
 * The check is **opt-in and standalone**: it is NOT invoked automatically by
 * `registerFont()` (that would add cost to every load and risks false-rejecting
 * edge-valid fonts). Call it yourself when ingesting third-party font data.
 *
 * @since 1.4.0
 */

import type { FontData } from '../types/pdf-types.js';

/** Result of {@link validateFontData}. */
export interface FontValidationResult {
    /** True when no blocking errors were found. */
    readonly valid: boolean;
    /** Blocking structural problems that would break rendering. */
    readonly errors: readonly string[];
    /** Non-blocking concerns (suspicious but not necessarily fatal). */
    readonly warnings: readonly string[];
}

/** Known SFNT version tags (big-endian) accepted by PDF CIDFont embedding. */
const SFNT_MAGIC = new Set<number>([
    0x00010000, // TrueType outlines
    0x4f54544f, // 'OTTO' — CFF/OpenType outlines
    0x74727565, // 'true' — legacy Apple TrueType
    0x74746366, // 'ttcf' — TrueType Collection
]);

/** Decode a base64 string to bytes without Buffer/atob assumptions. */
function decodeBase64Prefix(b64: string, maxBytes: number): Uint8Array | null {
    // Validate the alphabet first (cheap, catches obvious corruption).
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
    if (b64.length % 4 !== 0) return null;
    const g = globalThis as Record<string, unknown>;
    try {
        const atobFn = g['atob'] as ((s: string) => string) | undefined;
        if (typeof atobFn === 'function') {
            // Decode only the leading chunk we need (4 b64 chars → 3 bytes).
            const need = Math.ceil((maxBytes / 3) * 4 / 4) * 4;
            const slice = b64.slice(0, Math.min(b64.length, need));
            const bin = atobFn(slice);
            const out = new Uint8Array(Math.min(bin.length, maxBytes));
            for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
            return out;
        }
        const bufCtor = (g['Buffer'] as { from?: (s: string, e: string) => Uint8Array } | undefined);
        if (bufCtor?.from) {
            return bufCtor.from(b64, 'base64').subarray(0, maxBytes);
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * Structurally validate a {@link FontData} module. Returns `{ valid, errors,
 * warnings }`; `valid` is `false` when any blocking problem is found. Does not
 * throw on malformed input — it reports.
 *
 * @param data The font data to validate (typically the default export of a
 *             generated `*-data.js` module).
 * @since 1.4.0
 */
export function validateFontData(data: unknown): FontValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (data === null || typeof data !== 'object') {
        return { valid: false, errors: ['font data must be a non-null object'], warnings };
    }
    const f = data as Partial<FontData>;

    // ── Metrics ──────────────────────────────────────────────────────
    const m = f.metrics;
    if (!m || typeof m !== 'object') {
        errors.push('missing or invalid `metrics` object');
    } else {
        const finiteFields: (keyof typeof m)[] = ['unitsPerEm', 'numGlyphs', 'ascent', 'descent', 'capHeight', 'stemV'];
        const mRec = m as unknown as Record<string, unknown>;
        for (const k of finiteFields) {
            const v = mRec[k as string];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                errors.push(`metrics.${String(k)} must be a finite number`);
            }
        }
        if (typeof m.unitsPerEm === 'number' && m.unitsPerEm <= 0) {
            errors.push('metrics.unitsPerEm must be positive');
        }
        if (!Array.isArray(m.bbox) || m.bbox.length !== 4 || !m.bbox.every(n => typeof n === 'number' && Number.isFinite(n))) {
            errors.push('metrics.bbox must be a 4-number array [xMin yMin xMax yMax]');
        }
    }

    if (typeof f.fontName !== 'string' || f.fontName.length === 0) {
        errors.push('`fontName` must be a non-empty string');
    }

    // ── cmap ─────────────────────────────────────────────────────────
    const cmap = f.cmap;
    let cmapEntries = 0;
    if (!cmap || typeof cmap !== 'object') {
        errors.push('missing or invalid `cmap` (codepoint → glyph id map)');
    } else {
        cmapEntries = Object.keys(cmap).length;
        if (cmapEntries === 0) {
            errors.push('`cmap` is empty — the font maps no characters');
        }
    }

    // ── widths ───────────────────────────────────────────────────────
    const widths = f.widths;
    if (!widths || typeof widths !== 'object') {
        errors.push('missing or invalid `widths` (glyph id → advance map)');
    }

    // ── Cross-check: cmap glyph ids should resolve to a width ─────────
    if (cmap && typeof cmap === 'object' && widths && typeof widths === 'object') {
        const numGlyphs = (m && typeof m.numGlyphs === 'number') ? m.numGlyphs : Infinity;
        let missingWidth = 0;
        let outOfRange = 0;
        for (const gid of Object.values(cmap as Record<number, number>)) {
            if (typeof gid !== 'number' || !Number.isInteger(gid) || gid < 0) { outOfRange++; continue; }
            if (Number.isFinite(numGlyphs) && gid >= numGlyphs) outOfRange++;
            if ((widths as Record<number, number>)[gid] === undefined) missingWidth++;
        }
        if (outOfRange > 0) {
            errors.push(`${outOfRange} cmap entr${outOfRange === 1 ? 'y maps' : 'ies map'} to an out-of-range glyph id`);
        }
        if (missingWidth > 0) {
            // Non-fatal: defaultWidth covers gaps, but it is usually a sign of a
            // truncated widths table.
            warnings.push(`${missingWidth} cmap glyph id(s) have no explicit width (defaultWidth will be used)`);
        }
    }

    // ── pdfWidthArray ────────────────────────────────────────────────
    if (typeof f.pdfWidthArray !== 'string' || f.pdfWidthArray.length === 0) {
        errors.push('`pdfWidthArray` must be a non-empty PDF /W array string');
    } else if (!/^\s*\d/.test(f.pdfWidthArray)) {
        warnings.push('`pdfWidthArray` does not begin with a glyph index — verify the /W array format');
    }

    // ── ttfBase64 (the embedded SFNT binary) ─────────────────────────
    if (typeof f.ttfBase64 !== 'string' || f.ttfBase64.length === 0) {
        errors.push('`ttfBase64` must be a non-empty base64 string');
    } else {
        const head = decodeBase64Prefix(f.ttfBase64, 4);
        if (!head || head.length < 4) {
            errors.push('`ttfBase64` is not valid base64');
        } else {
            const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
            if (!SFNT_MAGIC.has(magic)) {
                errors.push(`\`ttfBase64\` is not an SFNT font (unexpected magic 0x${magic.toString(16).padStart(8, '0')})`);
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}
