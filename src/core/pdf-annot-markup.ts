/**
 * pdfnative — Markup & Drawing Annotations (ISO 32000-1 §12.5)
 * ============================================================
 * Typed builders for the common non-link annotation types: text (sticky
 * note), the text-markup family (highlight / underline / strike-out /
 * squiggly), the drawing family (square / circle / line), and free text.
 *
 * Each builder emits a single self-contained indirect object. Annotations
 * are referenced from a page's `/Annots` array — use the parser's
 * `PdfModifier.addAnnotation()` to attach one to an existing document, or
 * emit the object directly when assembling a PDF.
 *
 * Security: `/Contents` and `/T` are encoded via `encodePdfTextString`
 * (PDFDocEncoding literal or UTF-16BE hex), so arbitrary user text — including
 * newlines and non-Latin scripts — is safely escaped.
 *
 * @since 1.5.0
 */

import { fmtNum, encodePdfTextString } from './pdf-text.js';
import { parseColor } from './pdf-color.js';
import type { PdfColor } from '../types/pdf-types.js';

// ── Types ────────────────────────────────────────────────────────────

/** Rectangle `[x1, y1, x2, y2]` in PDF user space (points). */
export type AnnotationRect = readonly [number, number, number, number];

/** Fields shared by every markup / drawing annotation. */
export interface AnnotationBase {
    /** Annotation rectangle `[x1, y1, x2, y2]`. */
    readonly rect: AnnotationRect;
    /** Text content / note body (`/Contents`). Safely encoded. */
    readonly contents?: string;
    /** Annotation colour (`/C`) — border/line/icon colour. */
    readonly color?: PdfColor;
    /** Constant opacity `/CA` in `[0, 1]`. */
    readonly opacity?: number;
    /** Author / title (`/T`). */
    readonly title?: string;
    /** Modification date string, e.g. `D:20260705120000Z` (`/M`). */
    readonly modified?: string;
    /** Annotation flags bitfield (`/F`). Default `4` (Print). */
    readonly flags?: number;
}

/** Sticky-note text annotation (`/Subtype /Text`). */
export interface TextAnnotation extends AnnotationBase {
    readonly type: 'text';
    /** Whether the note pop-up is initially open (`/Open`). */
    readonly open?: boolean;
    /** Icon name (`/Name`): `Note`, `Comment`, `Key`, `Help`, `Insert`, … */
    readonly icon?: string;
}

/** Text-markup annotation (highlight / underline / strike-out / squiggly). */
export interface TextMarkupAnnotation extends AnnotationBase {
    readonly type: 'highlight' | 'underline' | 'strikeout' | 'squiggly';
    /**
     * Quadrilateral points (`/QuadPoints`), 8 numbers per marked region:
     * `x1 y1 x2 y2 x3 y3 x4 y4` (upper-left, upper-right, lower-left,
     * lower-right). When omitted, the `rect` corners are used.
     */
    readonly quadPoints?: readonly number[];
}

/** Rectangle / ellipse drawing annotation. */
export interface ShapeAnnotation extends AnnotationBase {
    readonly type: 'square' | 'circle';
    /** Interior fill colour (`/IC`). */
    readonly interiorColor?: PdfColor;
    /** Border width in points (`/BS /W`). Default `1`. */
    readonly borderWidth?: number;
}

/** Straight-line annotation (`/Subtype /Line`). */
export interface LineAnnotation extends AnnotationBase {
    readonly type: 'line';
    /** Line start point `[x, y]`. */
    readonly start: readonly [number, number];
    /** Line end point `[x, y]`. */
    readonly end: readonly [number, number];
    /** Line width in points (`/BS /W`). Default `1`. */
    readonly borderWidth?: number;
}

/** Free-text (typewriter) annotation (`/Subtype /FreeText`). */
export interface FreeTextAnnotation extends AnnotationBase {
    readonly type: 'freetext';
    /** Font size in points for the default appearance (`/DA`). Default `12`. */
    readonly fontSize?: number;
}

/** Any builder-supported annotation. */
export type MarkupAnnotation =
    | TextAnnotation
    | TextMarkupAnnotation
    | ShapeAnnotation
    | LineAnnotation
    | FreeTextAnnotation;

// ── Subtype mapping ──────────────────────────────────────────────────

const SUBTYPE: Record<MarkupAnnotation['type'], string> = {
    text: 'Text',
    highlight: 'Highlight',
    underline: 'Underline',
    strikeout: 'StrikeOut',
    squiggly: 'Squiggly',
    square: 'Square',
    circle: 'Circle',
    line: 'Line',
    freetext: 'FreeText',
};

// ── Helpers ──────────────────────────────────────────────────────────

function rectStr(r: AnnotationRect): string {
    return `[${fmtNum(r[0])} ${fmtNum(r[1])} ${fmtNum(r[2])} ${fmtNum(r[3])}]`;
}

/** Default quad points derived from the annotation rectangle. */
function quadFromRect(r: AnnotationRect): number[] {
    const [x1, y1, x2, y2] = r;
    // upper-left, upper-right, lower-left, lower-right
    return [x1, y2, x2, y2, x1, y1, x2, y1];
}

function commonEntries(a: AnnotationBase): string {
    const parts: string[] = [];
    if (a.contents !== undefined) parts.push(`/Contents ${encodePdfTextString(a.contents)}`);
    if (a.title !== undefined) parts.push(`/T ${encodePdfTextString(a.title)}`);
    if (a.color !== undefined) parts.push(`/C [${parseColor(a.color)}]`);
    if (a.opacity !== undefined) parts.push(`/CA ${fmtNum(a.opacity)}`);
    if (a.modified !== undefined) parts.push(`/M ${encodePdfTextString(a.modified)}`);
    parts.push(`/F ${a.flags ?? 4}`);
    return parts.join(' ');
}

// ── Builder ──────────────────────────────────────────────────────────

/**
 * Build a markup / drawing annotation as a PDF indirect object.
 *
 * @param annot  The typed annotation description.
 * @param objNum Object number to assign.
 * @returns `"<objNum> 0 obj … endobj"` string.
 */
export function buildAnnotation(annot: MarkupAnnotation, objNum: number): string {
    return `${objNum} 0 obj\n${buildAnnotationBody(annot)}\nendobj`;
}

/**
 * Build just the annotation dictionary (`<< … >>`), without the
 * `obj`/`endobj` wrapper. Use this with the parser's
 * `PdfModifier.addAnnotation()` to attach an annotation to an existing page.
 *
 * @param annot The typed annotation description.
 * @returns The annotation dictionary string.
 */
export function buildAnnotationBody(annot: MarkupAnnotation): string {
    const entries: string[] = [
        `/Type /Annot`,
        `/Subtype /${SUBTYPE[annot.type]}`,
        `/Rect ${rectStr(annot.rect)}`,
        commonEntries(annot),
    ];

    switch (annot.type) {
        case 'text': {
            if (annot.open !== undefined) entries.push(`/Open ${annot.open ? 'true' : 'false'}`);
            if (annot.icon !== undefined) entries.push(`/Name /${annot.icon}`);
            break;
        }
        case 'highlight':
        case 'underline':
        case 'strikeout':
        case 'squiggly': {
            const quad = annot.quadPoints && annot.quadPoints.length >= 8
                ? annot.quadPoints
                : quadFromRect(annot.rect);
            entries.push(`/QuadPoints [${quad.map(fmtNum).join(' ')}]`);
            break;
        }
        case 'square':
        case 'circle': {
            if (annot.interiorColor !== undefined) entries.push(`/IC [${parseColor(annot.interiorColor)}]`);
            entries.push(`/BS << /W ${fmtNum(annot.borderWidth ?? 1)} >>`);
            break;
        }
        case 'line': {
            entries.push(`/L [${fmtNum(annot.start[0])} ${fmtNum(annot.start[1])} ${fmtNum(annot.end[0])} ${fmtNum(annot.end[1])}]`);
            entries.push(`/BS << /W ${fmtNum(annot.borderWidth ?? 1)} >>`);
            break;
        }
        case 'freetext': {
            const sz = annot.fontSize ?? 12;
            const col = annot.color !== undefined ? parseColor(annot.color) : '0 0 0';
            // /DA sets the free-text default appearance (font + size + colour).
            entries.push(`/DA (/Helv ${fmtNum(sz)} Tf ${col} rg)`);
            break;
        }
    }

    return `<< ${entries.filter(Boolean).join(' ')} >>`;
}
