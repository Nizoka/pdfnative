/**
 * pdfnative — COLR / CPAL Colour-Font Parser
 * ===========================================
 * Pure-JS reader for the OpenType COLR (colour layers) and CPAL (colour
 * palette) tables. Resolves each base colour glyph into a flat list of
 * {@link ColorLayer}s (base outline + paint), painted back-to-front.
 *
 * Supported:
 *   - COLR v0 — layered solid fills.
 *   - COLR v1 — PaintColrLayers, PaintGlyph, PaintColrGlyph, PaintSolid,
 *     PaintLinearGradient, PaintRadialGradient, PaintTransform,
 *     PaintTranslate, PaintScale (+ around-center).
 *
 * Unsupported paints (sweep gradients, compositing, variable paints) cause
 * the affected glyph to be skipped so the caller can fall back to the
 * monochrome emoji font. This keeps output correct (never garbled) while
 * covering the overwhelming majority of Noto Color Emoji glyphs.
 *
 * Zero external dependency.
 *
 * References:
 *   - ISO/IEC 14496-22 (OpenType) §5.7.11 COLR, §5.7.12 CPAL
 *   - https://learn.microsoft.com/typography/opentype/spec/colr
 */

import type { CpalColor, ColorGlyph, ColorLayer, ColorPaint, ColorStop, GradientExtend } from '../types/pdf-types.js';

/** 6-tuple affine matrix `[a b c d e f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function compose(outer: Mat, inner: Mat): Mat {
    // outer ∘ inner  (apply inner first, then outer)
    const [a1, b1, c1, d1, e1, f1] = outer;
    const [a2, b2, c2, d2, e2, f2] = inner;
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

class UnsupportedPaint extends Error {}

interface TableRec { offset: number; length: number; }

function tableDirectory(view: DataView): Record<string, TableRec> {
    const numTables = view.getUint16(4);
    const tables: Record<string, TableRec> = {};
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
            view.getUint8(rec), view.getUint8(rec + 1),
            view.getUint8(rec + 2), view.getUint8(rec + 3),
        );
        tables[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
    }
    return tables;
}

/** Read a 24-bit big-endian unsigned offset. */
function getUint24(view: DataView, pos: number): number {
    return (view.getUint8(pos) << 16) | (view.getUint8(pos + 1) << 8) | view.getUint8(pos + 2);
}

/** F2Dot14 (2.14 fixed) reader. */
function f2dot14(view: DataView, pos: number): number {
    return view.getInt16(pos) / 16384;
}

/** Fixed 16.16 reader. */
function fixed(view: DataView, pos: number): number {
    return view.getInt32(pos) / 65536;
}

// ── CPAL ─────────────────────────────────────────────────────────────

/**
 * Parse the CPAL table's first palette into an array of {@link CpalColor}s
 * (sRGB + alpha, each channel 0–255), indexed by palette entry.
 */
export function parseCpal(bytes: Uint8Array): CpalColor[] | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = tableDirectory(view);
    const cpal = tables['CPAL'];
    if (!cpal) return null;
    const base = cpal.offset;
    const numPaletteEntries = view.getUint16(base + 2);
    const colorRecordsArrayOffset = view.getUint32(base + 8);
    // Palette 0 uses the first numPaletteEntries colour records.
    const firstIndex = view.getUint16(base + 12); // colorRecordIndices[0]
    const recBase = base + colorRecordsArrayOffset + firstIndex * 4;
    const colors: CpalColor[] = [];
    for (let i = 0; i < numPaletteEntries; i++) {
        const p = recBase + i * 4;
        // CPAL stores BGRA.
        const b = view.getUint8(p);
        const g = view.getUint8(p + 1);
        const r = view.getUint8(p + 2);
        const a = view.getUint8(p + 3);
        colors.push([r, g, b, a]);
    }
    return colors;
}

// ── COLR ─────────────────────────────────────────────────────────────

interface ColrContext {
    view: DataView;
    palette: CpalColor[];
    colrBase: number;
    layerListBase: number; // 0 when absent
}

/** Resolve a palette index + alpha multiplier into a concrete colour. */
function resolveColor(ctx: ColrContext, paletteIndex: number, alpha: number): CpalColor {
    // 0xFFFF = "text foreground"; default to opaque black for standalone PDFs.
    const base: CpalColor = paletteIndex === 0xFFFF
        ? [0, 0, 0, 255]
        : (ctx.palette[paletteIndex] ?? [0, 0, 0, 255]);
    const a = Math.round(base[3] * Math.max(0, Math.min(1, alpha)));
    return [base[0], base[1], base[2], a];
}

const EXTEND: GradientExtend[] = ['pad', 'repeat', 'reflect'];

/** Read a ColorLine at `offset`, baking `m` into nothing (stops are scalar). */
function readColorLine(ctx: ColrContext, offset: number): { stops: ColorStop[]; extend: GradientExtend } {
    const { view } = ctx;
    const extend = EXTEND[view.getUint8(offset)] ?? 'pad';
    const numStops = view.getUint16(offset + 1);
    const stops: ColorStop[] = [];
    let p = offset + 3;
    for (let i = 0; i < numStops; i++) {
        const stopOffset = f2dot14(view, p);
        const paletteIndex = view.getUint16(p + 2);
        const alpha = f2dot14(view, p + 4);
        stops.push({ offset: stopOffset, color: resolveColor(ctx, paletteIndex, alpha) });
        p += 6;
    }
    return { stops, extend };
}

/** Apply matrix `m` to a point. */
function apply(m: Mat, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Average linear scale of a matrix (for radius transforms). */
function avgScale(m: Mat): number {
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    return (sx + sy) / 2 || 1;
}

/**
 * Resolve a *fill* paint (PaintSolid / PaintLinearGradient /
 * PaintRadialGradient), folding any inner transform `m` into the gradient
 * geometry. Throws {@link UnsupportedPaint} for anything else.
 */
function resolveFill(ctx: ColrContext, offset: number, m: Mat): ColorPaint {
    const { view } = ctx;
    const format = view.getUint8(offset);
    switch (format) {
        case 2: { // PaintSolid
            const paletteIndex = view.getUint16(offset + 1);
            const alpha = f2dot14(view, offset + 3);
            return { kind: 'solid', color: resolveColor(ctx, paletteIndex, alpha) };
        }
        case 4: { // PaintLinearGradient
            const colorLineOffset = getUint24(view, offset + 1);
            const x0 = view.getInt16(offset + 4), y0 = view.getInt16(offset + 6);
            const x1 = view.getInt16(offset + 8), y1 = view.getInt16(offset + 10);
            // (x2,y2) is the rotation vector; for axial PDF shading we use p0→p1.
            const { stops, extend } = readColorLine(ctx, offset + colorLineOffset);
            return { kind: 'linear', p0: apply(m, x0, y0), p1: apply(m, x1, y1), stops, extend };
        }
        case 6: { // PaintRadialGradient
            const colorLineOffset = getUint24(view, offset + 1);
            const x0 = view.getInt16(offset + 4), y0 = view.getInt16(offset + 6);
            const r0 = view.getUint16(offset + 8);
            const x1 = view.getInt16(offset + 10), y1 = view.getInt16(offset + 12);
            const r1 = view.getUint16(offset + 14);
            const { stops, extend } = readColorLine(ctx, offset + colorLineOffset);
            const s = avgScale(m);
            return { kind: 'radial', c0: apply(m, x0, y0), r0: r0 * s, c1: apply(m, x1, y1), r1: r1 * s, stops, extend };
        }
        case 12: { // PaintTransform → fold into inner transform
            const subOffset = getUint24(view, offset + 1);
            const transformOffset = getUint24(view, offset + 4);
            const t = readAffine(view, offset + transformOffset);
            return resolveFill(ctx, offset + subOffset, compose(m, t));
        }
        case 14: { // PaintTranslate
            const subOffset = getUint24(view, offset + 1);
            const dx = view.getInt16(offset + 4), dy = view.getInt16(offset + 6);
            return resolveFill(ctx, offset + subOffset, compose(m, [1, 0, 0, 1, dx, dy]));
        }
        case 16: { // PaintScale
            const subOffset = getUint24(view, offset + 1);
            const sx = f2dot14(view, offset + 4), sy = f2dot14(view, offset + 6);
            return resolveFill(ctx, offset + subOffset, compose(m, [sx, 0, 0, sy, 0, 0]));
        }
        default:
            throw new UnsupportedPaint(`fill paint format ${format}`);
    }
}

/** Read an Affine2x3 (xx, yx, xy, yy, dx, dy as Fixed 16.16) → Mat. */
function readAffine(view: DataView, pos: number): Mat {
    const xx = fixed(view, pos);
    const yx = fixed(view, pos + 4);
    const xy = fixed(view, pos + 8);
    const yy = fixed(view, pos + 12);
    const dx = fixed(view, pos + 16);
    const dy = fixed(view, pos + 20);
    return [xx, yx, xy, yy, dx, dy];
}

/**
 * Collect the flat layer list for a base-glyph paint subtree, applying the
 * accumulated *outline* transform `m` and recursing through structural paints.
 */
function collectLayers(ctx: ColrContext, offset: number, m: Mat, out: ColorLayer[], depth: number): void {
    if (depth > 16) throw new UnsupportedPaint('paint recursion too deep');
    const { view } = ctx;
    const format = view.getUint8(offset);
    switch (format) {
        case 1: { // PaintColrLayers
            const numLayers = view.getUint8(offset + 1);
            const firstLayerIndex = view.getUint32(offset + 2);
            if (!ctx.layerListBase) throw new UnsupportedPaint('PaintColrLayers without LayerList');
            for (let i = 0; i < numLayers; i++) {
                const idx = firstLayerIndex + i;
                const paintOffset = view.getUint32(ctx.layerListBase + 4 + idx * 4);
                collectLayers(ctx, ctx.layerListBase + paintOffset, m, out, depth + 1);
            }
            return;
        }
        case 10: { // PaintGlyph
            const subOffset = getUint24(view, offset + 1);
            const glyphId = view.getUint16(offset + 4);
            const paint = resolveFill(ctx, offset + subOffset, IDENTITY);
            out.push(m === IDENTITY ? { glyphId, paint } : { glyphId, paint, transform: m });
            return;
        }
        case 11: { // PaintColrGlyph → reference another base glyph's paint
            const glyphId = view.getUint16(offset + 1);
            const paintOffset = baseGlyphPaintOffset(ctx, glyphId);
            if (paintOffset === null) throw new UnsupportedPaint('PaintColrGlyph missing base');
            collectLayers(ctx, paintOffset, m, out, depth + 1);
            return;
        }
        case 12: { // PaintTransform
            const subOffset = getUint24(view, offset + 1);
            const transformOffset = getUint24(view, offset + 4);
            const t = readAffine(view, offset + transformOffset);
            collectLayers(ctx, offset + subOffset, compose(m, t), out, depth + 1);
            return;
        }
        case 14: { // PaintTranslate
            const subOffset = getUint24(view, offset + 1);
            const dx = view.getInt16(offset + 4), dy = view.getInt16(offset + 6);
            collectLayers(ctx, offset + subOffset, compose(m, [1, 0, 0, 1, dx, dy]), out, depth + 1);
            return;
        }
        case 16: { // PaintScale
            const subOffset = getUint24(view, offset + 1);
            const sx = f2dot14(view, offset + 4), sy = f2dot14(view, offset + 6);
            collectLayers(ctx, offset + subOffset, compose(m, [sx, 0, 0, sy, 0, 0]), out, depth + 1);
            return;
        }
        default:
            throw new UnsupportedPaint(`structural paint format ${format}`);
    }
}

/** Locate the v1 paint offset (absolute) for a base glyph id, or null. */
function baseGlyphPaintOffset(ctx: ColrContext, glyphId: number): number | null {
    const { view, colrBase } = ctx;
    const baseGlyphListOffset = view.getUint32(colrBase + 14);
    if (!baseGlyphListOffset) return null;
    const listBase = colrBase + baseGlyphListOffset;
    const numRecords = view.getUint32(listBase);
    // Records are sorted by glyphID — linear scan is fine for our scale.
    for (let i = 0; i < numRecords; i++) {
        const rec = listBase + 4 + i * 6;
        const gid = view.getUint16(rec);
        if (gid === glyphId) {
            return listBase + view.getUint32(rec + 2);
        }
    }
    return null;
}

/**
 * Parse the COLR + CPAL tables of a font into a colour-glyph map keyed by
 * base glyph id. Returns `null` when the font has no COLR table.
 *
 * @param bytes - Raw OpenType font bytes.
 */
export function parseColrCpal(bytes: Uint8Array): Record<number, ColorGlyph> | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = tableDirectory(view);
    const colr = tables['COLR'];
    if (!colr) return null;
    const palette = parseCpal(bytes) ?? [];
    const colrBase = colr.offset;
    const version = view.getUint16(colrBase);

    const result: Record<number, ColorGlyph> = {};

    // ── COLR v0: layered solid fills ─────────────────────────────────
    const numBaseGlyphRecords = view.getUint16(colrBase + 2);
    const baseGlyphRecordsOffset = view.getUint32(colrBase + 4);
    const layerRecordsOffset = view.getUint32(colrBase + 8);
    if (numBaseGlyphRecords && baseGlyphRecordsOffset && layerRecordsOffset) {
        const recBase = colrBase + baseGlyphRecordsOffset;
        const layerBase = colrBase + layerRecordsOffset;
        for (let i = 0; i < numBaseGlyphRecords; i++) {
            const rec = recBase + i * 6;
            const gid = view.getUint16(rec);
            const firstLayer = view.getUint16(rec + 2);
            const numLayers = view.getUint16(rec + 4);
            const layers: ColorLayer[] = [];
            for (let j = 0; j < numLayers; j++) {
                const lr = layerBase + (firstLayer + j) * 4;
                const layerGid = view.getUint16(lr);
                const paletteIndex = view.getUint16(lr + 2);
                const color = paletteIndex === 0xFFFF
                    ? ([0, 0, 0, 255] as CpalColor)
                    : (palette[paletteIndex] ?? [0, 0, 0, 255]);
                layers.push({ glyphId: layerGid, paint: { kind: 'solid', color } });
            }
            if (layers.length) result[gid] = { layers };
        }
    }

    // ── COLR v1: paint graphs (override v0 entries when present) ──────
    if (version >= 1) {
        const layerListOffset = view.getUint32(colrBase + 18);
        const ctx: ColrContext = {
            view, palette, colrBase,
            layerListBase: layerListOffset ? colrBase + layerListOffset : 0,
        };
        const baseGlyphListOffset = view.getUint32(colrBase + 14);
        if (baseGlyphListOffset) {
            const listBase = colrBase + baseGlyphListOffset;
            const numRecords = view.getUint32(listBase);
            for (let i = 0; i < numRecords; i++) {
                const rec = listBase + 4 + i * 6;
                const gid = view.getUint16(rec);
                const paintOffset = listBase + view.getUint32(rec + 2);
                try {
                    const layers: ColorLayer[] = [];
                    collectLayers(ctx, paintOffset, IDENTITY, layers, 0);
                    if (layers.length) result[gid] = { layers };
                } catch (e) {
                    if (!(e instanceof UnsupportedPaint)) throw e;
                    // Unsupported paint → leave any v0 entry / fall back to mono.
                }
            }
        }
    }

    return Object.keys(result).length ? result : null;
}
