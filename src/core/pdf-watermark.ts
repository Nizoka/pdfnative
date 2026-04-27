/**
 * pdfnative — PDF Watermark Rendering
 * ======================================
 * Builds PDF content operators for text and image watermarks.
 * Supports ExtGState transparency, rotation, and centering.
 *
 * ISO 32000-1 (PDF 1.7) compliant.
 */

import type { WatermarkOptions, WatermarkText, WatermarkImage, EncodingContext } from '../types/pdf-types.js';
import { parseColor } from './pdf-color.js';
import { parseImage, buildImageXObject } from './pdf-image.js';
import type { ParsedImage } from './pdf-image.js';
import { fmtNum } from './pdf-text.js';

// ── Types ────────────────────────────────────────────────────────────

/** Resolved watermark state for use during PDF assembly. */
export interface WatermarkState {
    /** ExtGState object content string (each keyed by gs name). */
    readonly extGStates: Map<string, string>;
    /** Image XObject content (if watermark has image). */
    readonly imageXObj: string | null;
    /** Parsed image data (if watermark has image). */
    readonly parsedImage: ParsedImage | null;
    /** Content operators for background watermark (before page content). */
    readonly backgroundOps: string;
    /** Content operators for foreground watermark (after page content). */
    readonly foregroundOps: string;
    /** ExtGState resource references: `/GS1 N 0 R ...` (set during assembly). */
    gsResourceStr: string;
    /** Image resource references: `/ImW1 N 0 R` (set during assembly). */
    imgResourceStr: string;
}

// ── Constants ────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_TEXT_FONT_SIZE = 60;
const DEFAULT_TEXT_COLOR = '0.75 0.75 0.75';
const DEFAULT_TEXT_OPACITY = 0.15;
const DEFAULT_TEXT_ANGLE = -45;
const DEFAULT_IMAGE_OPACITY = 0.10;

/**
 * Default cap-height ratio for centering text vertically when the encoding
 * context does not expose font metrics (Latin/Helvetica path). Helvetica's
 * cap height is 718 of 1000 units per em, so the visual center of all-caps
 * text sits at capHeight/2 ≈ 0.359 × fontSize above the baseline.
 *
 * Using fontSize/2 (the previous heuristic) over-shifted the baseline
 * downward by ~14% of the font size, which — combined with rotation —
 * caused the watermark to drift off centre on the page.
 */
const DEFAULT_CAP_HEIGHT_RATIO = 0.718;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Validate watermark options against PDF/A constraints.
 * PDF/A-1b (ISO 19005-1 §6.4) forbids transparency.
 *
 * @param watermark - Watermark options
 * @param pdfaLevel - Tagged mode value (false, true, 'pdfa1b', etc.)
 * @throws When transparency is used with PDF/A-1b
 */
export function validateWatermark(
    watermark: WatermarkOptions,
    pdfaLevel: boolean | string | undefined,
): void {
    if (pdfaLevel === 'pdfa1b') {
        const textOpacity = watermark.text?.opacity ?? DEFAULT_TEXT_OPACITY;
        const imageOpacity = watermark.image?.opacity ?? DEFAULT_IMAGE_OPACITY;
        if ((watermark.text && textOpacity < 1.0) || (watermark.image && imageOpacity < 1.0)) {
            throw new Error('Watermark transparency is not allowed with PDF/A-1b (ISO 19005-1 §6.4)');
        }
    }
}

/**
 * Build watermark content operators and collect resources.
 * Returns operators split into background/foreground based on `position`.
 *
 * @param watermark - Watermark configuration
 * @param pgW - Page width in points
 * @param pgH - Page height in points
 * @param enc - Encoding context for text rendering
 * @returns Watermark state with operators and resources
 */
export function buildWatermarkState(
    watermark: WatermarkOptions,
    pgW: number,
    pgH: number,
    enc: EncodingContext,
): WatermarkState {
    const extGStates = new Map<string, string>();
    let ops = '';
    let imageXObj: string | null = null;
    let parsedImage: ParsedImage | null = null;
    let gsIdx = 0;

    // Text watermark
    if (watermark.text) {
        gsIdx++;
        const gsName = `/GS${gsIdx}`;
        const textOps = _buildTextWatermarkOps(watermark.text, pgW, pgH, enc, gsName);
        ops += textOps;
        const opacity = watermark.text.opacity ?? DEFAULT_TEXT_OPACITY;
        extGStates.set(gsName, `<< /Type /ExtGState /ca ${fmtNum(opacity)} >>`);
    }

    // Image watermark
    if (watermark.image) {
        gsIdx++;
        const gsName = `/GS${gsIdx}`;
        const { ops: imgOps, xobj, parsed } = _buildImageWatermarkOps(watermark.image, pgW, pgH, gsName);
        ops += imgOps;
        imageXObj = xobj;
        parsedImage = parsed;
        const opacity = watermark.image.opacity ?? DEFAULT_IMAGE_OPACITY;
        extGStates.set(gsName, `<< /Type /ExtGState /ca ${fmtNum(opacity)} >>`);
    }

    const position = watermark.position ?? 'background';

    return {
        extGStates,
        imageXObj,
        parsedImage,
        backgroundOps: position === 'background' ? ops : '',
        foregroundOps: position === 'foreground' ? ops : '',
        gsResourceStr: '',
        imgResourceStr: '',
    };
}

// ── Internal Helpers ─────────────────────────────────────────────────

/**
 * Build content operators for a text watermark.
 * Renders rotated, semi-transparent text centered on the page.
 */
function _buildTextWatermarkOps(
    wm: WatermarkText,
    pgW: number,
    pgH: number,
    enc: EncodingContext,
    gsName: string,
): string {
    const sz = wm.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const color = parseColor(wm.color ?? DEFAULT_TEXT_COLOR);
    const angle = (wm.angle ?? DEFAULT_TEXT_ANGLE) * DEG_TO_RAD;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // Center of page
    const cx = pgW / 2;
    const cy = pgH / 2;

    // Approximate text width to center it
    const textWidth = enc.tw(wm.text, sz);
    const offsetX = -textWidth / 2;

    // Vertical centering: position the visual middle of the glyph box at the
    // page centre. The PDF text matrix `Tm` places the *baseline* of the
    // first glyph at (tx, ty), so we shift the baseline downward by half the
    // cap height. When the encoding context exposes font metrics we use the
    // actual cap height; otherwise we fall back to Helvetica's 0.718 ratio.
    const fd = enc.fontData;
    const capHeightRatio = fd
        ? fd.metrics.capHeight / fd.metrics.unitsPerEm
        : DEFAULT_CAP_HEIGHT_RATIO;
    const offsetY = -sz * capHeightRatio / 2;

    // Apply rotation offset to center
    const tx = cx + offsetX * cos - offsetY * sin;
    const ty = cy + offsetX * sin + offsetY * cos;

    // Use the encoding context's text encoder so the bytes match the font
    // referenced by `enc.f2`. In Latin mode this returns a WinAnsi literal
    // `(...)`; in Unicode/CIDFont mode it returns a 2-byte GID hex string
    // `<...>`. Using `pdfString` unconditionally produced garbage glyphs
    // (and an incorrect width measurement) under CIDFont encoding.
    const escapedText = enc.ps(wm.text);

    const ops: string[] = [
        'q',
        `${gsName} gs`,
        'BT',
        `${color} rg`,
        `${enc.f2} ${fmtNum(sz)} Tf`,
        `${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} ${fmtNum(tx)} ${fmtNum(ty)} Tm`,
        `${escapedText} Tj`,
        'ET',
        'Q',
    ];

    return ops.join('\n') + '\n';
}

/**
 * Build content operators for an image watermark.
 * Renders a semi-transparent image centered on the page.
 */
function _buildImageWatermarkOps(
    wm: WatermarkImage,
    pgW: number,
    pgH: number,
    gsName: string,
): { ops: string; xobj: string; parsed: ParsedImage } {
    const parsed = parseImage(wm.data);

    const aspect = parsed.width / parsed.height;
    let displayW = wm.width ?? parsed.width;
    let displayH = wm.height ?? parsed.height;

    // If only one dimension specified, preserve aspect ratio
    if (wm.width && !wm.height) displayH = displayW / aspect;
    if (wm.height && !wm.width) displayW = displayH * aspect;

    // Clamp to page dimensions (80% max)
    const maxW = pgW * 0.8;
    const maxH = pgH * 0.8;
    if (displayW > maxW) { displayW = maxW; displayH = displayW / aspect; }
    if (displayH > maxH) { displayH = maxH; displayW = displayH * aspect; }

    // Center on page
    const x = (pgW - displayW) / 2;
    const y = (pgH - displayH) / 2;

    const ops: string[] = [
        'q',
        `${gsName} gs`,
        `${fmtNum(displayW)} 0 0 ${fmtNum(displayH)} ${fmtNum(x)} ${fmtNum(y)} cm`,
        '/ImW1 Do',
        'Q',
    ];

    return {
        ops: ops.join('\n') + '\n',
        xobj: buildImageXObject(parsed),
        parsed,
    };
}
