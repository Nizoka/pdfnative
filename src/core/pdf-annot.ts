/**
 * pdfnative — PDF Link Annotations
 * ==================================
 * Build PDF link annotation objects for external URLs and internal page links.
 * Annotations are separate indirect objects referenced by page `/Annots` arrays.
 *
 * ISO 32000-1 §12.5.6.5: Link annotations
 * ISO 32000-1 §12.6.4.7: URI actions
 * ISO 32000-1 §12.6.4.2: GoTo actions
 */

import { fmtNum } from './pdf-text.js';

// ── Types ────────────────────────────────────────────────────────────

/** External link annotation (URI action). */
export interface LinkAnnotation {
    readonly url: string;
    readonly rect: readonly [number, number, number, number]; // [x1, y1, x2, y2]
}

/** Internal link annotation (GoTo action — page destination). */
export interface InternalLink {
    readonly pageIndex: number;           // Target page (0-based)
    readonly rect: readonly [number, number, number, number];
}

/** Union of all annotation types. */
export type Annotation = LinkAnnotation | InternalLink;

// ── URL Validation ───────────────────────────────────────────────────

/** Allowed URL schemes for link annotations. */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

/** Control character pattern: C0 (0x00–0x1F), DEL (0x7F), C1 (0x80–0x9F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

/**
 * Validate a URL for use in PDF link annotations.
 * Only `http:`, `https:`, and `mailto:` schemes are allowed.
 * Blocks `javascript:`, `file:`, `data:`, and other dangerous schemes.
 * Rejects URLs containing control characters (newlines, null bytes, etc.)
 * to prevent injection attacks in PDF literal strings.
 *
 * @param url - URL string to validate
 * @returns true if the URL is safe for embedding
 */
export function validateURL(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    if (CONTROL_CHARS.test(url)) return false;
    const lower = url.toLowerCase().trim();
    return ALLOWED_SCHEMES.some(scheme => lower.startsWith(scheme));
}

// ── Annotation Builders ──────────────────────────────────────────────

/**
 * Escape a URL string for embedding in a PDF literal string.
 * Strips control characters, then escapes parentheses and backslashes
 * per ISO 32000-1 §7.3.4.2.
 */
function escapeUrlForPdf(url: string): string {
    return url
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

/**
 * Build a PDF link annotation object for an external URI.
 *
 * @param annot - Link annotation with URL and click rectangle
 * @param objNum - PDF object number for this annotation
 * @returns PDF indirect object content string
 * @throws Error if URL scheme is not allowed
 */
export function buildLinkAnnotation(annot: LinkAnnotation, objNum: number): string {
    if (!validateURL(annot.url)) {
        throw new Error(`Blocked URL scheme: only http:, https:, mailto: allowed — got "${annot.url}"`);
    }
    const [x1, y1, x2, y2] = annot.rect;
    const escapedUrl = escapeUrlForPdf(annot.url);
    return `${objNum} 0 obj\n` +
        `<< /Type /Annot /Subtype /Link ` +
        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
        `/Border [0 0 0] ` +
        `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>\n` +
        `endobj`;
}

/**
 * Build a PDF link annotation object for an internal page link (GoTo action).
 *
 * @param annot - Internal link with target page index and click rectangle
 * @param pageObjNum - PDF object number of the target page
 * @param objNum - PDF object number for this annotation
 * @returns PDF indirect object content string
 */
export function buildInternalLinkAnnotation(annot: InternalLink, pageObjNum: number, objNum: number): string {
    const [x1, y1, x2, y2] = annot.rect;
    return `${objNum} 0 obj\n` +
        `<< /Type /Annot /Subtype /Link ` +
        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
        `/Border [0 0 0] ` +
        `/A << /Type /Action /S /GoTo /D [${pageObjNum} 0 R /Fit] >> >>\n` +
        `endobj`;
}

/**
 * Check if an annotation is an external link (has `url` property).
 */
export function isLinkAnnotation(annot: Annotation): annot is LinkAnnotation {
    return 'url' in annot;
}
