/**
 * Visual-regression helper — glyph rasteriser.
 *
 * Reproduces a PDF page bitmap from extracted show operators by scan-filling
 * the embedded TrueType outlines at their absolute positions. Quadratic
 * curves are flattened to line segments; contours are filled with the
 * non-zero winding rule. The output is an 8-bit grayscale bitmap (0 = ink,
 * 255 = paper) — a deterministic, low-resolution fingerprint of the rendered
 * text geometry that catches shaping/positioning regressions.
 *
 * TEST-ONLY tooling — not part of the published library.
 */

import { parseGlyfFont, extractGlyphContours, type GlyfFont, type Contour } from '../../../src/fonts/glyf-outline.js';
import type { PageExtract, ShowOp } from './extract.js';

/** An 8-bit grayscale bitmap (row-major, 1 byte per pixel). */
export interface Bitmap {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
}

const CURVE_STEPS = 6; // quadratic flattening segments

/**
 * Rasterise a page at the given scale (device px per PDF point).
 *
 * @param page  - Extracted page (ops + embedded fonts).
 * @param scale - Pixels per point (e.g. 0.5 → ~298×421 for A4).
 * @returns Grayscale {@link Bitmap}.
 */
export function rasterizePage(page: PageExtract, scale: number): Bitmap {
    const width = Math.max(1, Math.round(page.width * scale));
    const height = Math.max(1, Math.round(page.height * scale));
    const data = new Uint8Array(width * height).fill(255);

    const fontCache = new Map<string, GlyfFont | null>();
    const getFont = (name: string): GlyfFont | null => {
        if (fontCache.has(name)) return fontCache.get(name) ?? null;
        const bytes = page.fonts.get(name) ?? null;
        const font = bytes ? parseGlyfFont(bytes) : null;
        fontCache.set(name, font);
        return font;
    };

    for (const op of page.ops) {
        const font = getFont(op.font);
        if (!font) continue;
        renderRun(data, width, height, page.height, scale, op, font);
    }

    return { width, height, data };
}

function renderRun(
    data: Uint8Array,
    width: number,
    height: number,
    pageHeight: number,
    scale: number,
    op: ShowOp,
    font: GlyfFont,
): void {
    const upm = font.unitsPerEm;
    const unitToPt = op.size / upm;
    let penX = op.x;

    for (const gid of op.gids) {
        const contours = extractGlyphContours(font, gid);
        if (contours.length > 0) {
            fillGlyph(data, width, height, contours, penX, op.y, unitToPt, scale, pageHeight);
        }
        // Per-glyph absolute Td placement is used by the generator, so the pen
        // advance here only matters for multi-glyph Tj runs (headings). Use the
        // font's advance approximation via the glyph bbox is unavailable; rely
        // on hmtx-free spacing: advance by em-size is wrong, so for multi-glyph
        // runs we space by the glyph's contour extent. To stay deterministic and
        // simple we advance by the nominal size (covers heading fingerprints).
        penX += op.size * 0.5;
    }
}

function fillGlyph(
    data: Uint8Array,
    width: number,
    height: number,
    contours: readonly Contour[],
    originX: number,
    originY: number,
    unitToPt: number,
    scale: number,
    pageHeight: number,
): void {
    // Flatten contours to device-space polygons.
    const polys: Array<Array<[number, number]>> = [];
    let minY = Infinity;
    let maxY = -Infinity;

    for (const contour of contours) {
        const poly = flattenContour(contour);
        if (poly.length < 3) continue;
        const dev: Array<[number, number]> = [];
        for (const [fx, fy] of poly) {
            const px = (originX + fx * unitToPt) * scale;
            const py = (pageHeight - (originY + fy * unitToPt)) * scale; // flip Y
            dev.push([px, py]);
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        polys.push(dev);
    }
    if (polys.length === 0) return;

    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(height - 1, Math.ceil(maxY));

    for (let y = y0; y <= y1; y++) {
        const cy = y + 0.5;
        // Collect crossings with winding direction.
        const xs: Array<{ x: number; dir: number }> = [];
        for (const poly of polys) {
            for (let i = 0; i < poly.length; i++) {
                const [ax, ay] = poly[i];
                const [bx, by] = poly[(i + 1) % poly.length];
                if (ay === by) continue;
                if ((cy >= ay && cy < by) || (cy >= by && cy < ay)) {
                    const t = (cy - ay) / (by - ay);
                    xs.push({ x: ax + t * (bx - ax), dir: by > ay ? 1 : -1 });
                }
            }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p.x - q.x);

        let winding = 0;
        for (let i = 0; i < xs.length - 1; i++) {
            winding += xs[i].dir;
            if (winding !== 0) {
                const xa = Math.max(0, Math.round(xs[i].x));
                const xb = Math.min(width - 1, Math.round(xs[i + 1].x));
                const row = y * width;
                for (let x = xa; x <= xb; x++) data[row + x] = 0;
            }
        }
    }
}

function flattenContour(contour: Contour): Array<[number, number]> {
    // TrueType quadratic: insert implied on-curve midpoints between consecutive
    // off-curve points, then flatten each quadratic segment.
    const pts = contour;
    const n = pts.length;
    if (n === 0) return [];

    // Build a normalised on/off sequence starting on an on-curve point.
    const seq: Array<{ x: number; y: number; on: boolean }> = [];
    let startIdx = pts.findIndex((p) => p.onCurve);
    if (startIdx < 0) {
        // All off-curve: synthesise a start midpoint.
        const a = pts[0], b = pts[n - 1];
        seq.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
        startIdx = 0;
        for (let i = 0; i < n; i++) {
            const p = pts[(startIdx + i) % n];
            seq.push({ x: p.x, y: p.y, on: p.onCurve });
        }
    } else {
        for (let i = 0; i <= n; i++) {
            const p = pts[(startIdx + i) % n];
            const prev = seq[seq.length - 1];
            if (prev && !prev.on && !p.onCurve) {
                seq.push({ x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2, on: true });
            }
            seq.push({ x: p.x, y: p.y, on: p.onCurve });
        }
    }

    const out: Array<[number, number]> = [];
    let i = 0;
    while (i < seq.length - 1) {
        const cur = seq[i];
        const next = seq[i + 1];
        if (next.on) {
            out.push([cur.x, cur.y]);
            i++;
        } else {
            const ctrl = next;
            const end = seq[i + 2] ?? seq[0];
            for (let s = 0; s <= CURVE_STEPS; s++) {
                const t = s / CURVE_STEPS;
                const mt = 1 - t;
                const x = mt * mt * cur.x + 2 * mt * t * ctrl.x + t * t * end.x;
                const y = mt * mt * cur.y + 2 * mt * t * ctrl.y + t * t * end.y;
                out.push([x, y]);
            }
            i += 2;
        }
    }
    return out;
}

/**
 * Compare two equal-size bitmaps. Returns the fraction of differing pixels
 * (0 = identical, 1 = fully different).
 */
export function bitmapDiff(a: Bitmap, b: Bitmap): number {
    if (a.width !== b.width || a.height !== b.height) return 1;
    let diff = 0;
    const n = a.data.length;
    for (let i = 0; i < n; i++) {
        if (Math.abs(a.data[i] - b.data[i]) > 64) diff++;
    }
    return diff / n;
}
