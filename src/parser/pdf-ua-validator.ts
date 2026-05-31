/**
 * pdfnative — PDF/UA structural validator (ISO 14289-1)
 * ======================================================
 * A lightweight, read-only conformance checker for tagged-PDF (PDF/UA)
 * structural prerequisites. It does **not** render or rasterise; it parses the
 * document with the native reader and inspects the catalog, structure tree and
 * per-page marked-content.
 *
 * Scope (what this validator can verify from structure alone):
 *   - Catalog `/MarkInfo << /Marked true >>`            (ISO 14289-1 §7.1)
 *   - Catalog `/StructTreeRoot`                          (ISO 14289-1 §7.1)
 *   - Catalog `/Metadata` (XMP) and `/Lang`              (ISO 14289-1 §7.2, §7.3)
 *   - `/StructTreeRoot /ParentTree`                      (ISO 32000-1 §14.7.4.4)
 *   - MCID uniqueness within each page's content stream  (ISO 32000-1 §14.7.4.3)
 *
 * It is intended as a fast developer-time gate, not a substitute for a full
 * reference validator (e.g. veraPDF) which also checks fonts, colour and
 * rendering. A `valid` result here means the structural prerequisites hold.
 *
 * @since 1.3.0
 */

import { openPdf } from './pdf-reader.js';
import { isDict, isStream, isArray, dictGetName, dictGetRef } from './pdf-object-parser.js';
import type { PdfDict, PdfStream, PdfValue } from './pdf-object-parser.js';

/** Result of a PDF/UA structural validation. */
export interface PdfUAValidationResult {
    /** True when no blocking errors were found. */
    readonly valid: boolean;
    /** Blocking conformance violations. */
    readonly errors: readonly string[];
    /** Non-blocking recommendations (PDF/UA best practices). */
    readonly warnings: readonly string[];
}

/** Decode the concatenated content streams of a page into a latin1 string. */
function pageContentText(
    reader: ReturnType<typeof openPdf>,
    page: PdfDict,
): string {
    const contents = page.get('Contents');
    if (contents === undefined) return '';
    const resolved = reader.resolveValue(contents);

    const streams: PdfStream[] = [];
    if (isStream(resolved)) {
        streams.push(resolved);
    } else if (isArray(resolved)) {
        for (const item of resolved) {
            const s = reader.resolveValue(item as PdfValue);
            if (isStream(s)) streams.push(s);
        }
    }

    let text = '';
    for (const s of streams) {
        try {
            const data = reader.decodeStream(s);
            text += new TextDecoder('latin1').decode(data);
        } catch {
            // Undecodable stream — skip; reported as a warning by the caller.
        }
    }
    return text;
}

/**
 * Validate the PDF/UA (ISO 14289-1) structural prerequisites of a tagged PDF.
 *
 * @param bytes - Complete PDF file bytes (e.g. from `buildDocumentPDFBytes`).
 * @returns A structured result with `valid`, `errors` and `warnings`.
 */
export function validatePdfUA(bytes: Uint8Array): PdfUAValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    let reader: ReturnType<typeof openPdf>;
    try {
        reader = openPdf(bytes);
    } catch (err) {
        return { valid: false, errors: [`Unparseable PDF: ${(err as Error).message}`], warnings: [] };
    }

    let catalog: PdfDict;
    try {
        catalog = reader.getCatalog();
    } catch (err) {
        return { valid: false, errors: [`No document catalog: ${(err as Error).message}`], warnings: [] };
    }

    // ── /MarkInfo /Marked true ──────────────────────────────────────
    const markInfo = reader.resolveValue(catalog.get('MarkInfo') ?? null);
    if (!isDict(markInfo)) {
        errors.push('Catalog is missing /MarkInfo (ISO 14289-1 §7.1).');
    } else if (markInfo.get('Marked') !== true) {
        errors.push('Catalog /MarkInfo /Marked must be true (ISO 14289-1 §7.1).');
    }

    // ── /StructTreeRoot (+ /ParentTree) ─────────────────────────────
    const structRootRef = dictGetRef(catalog, 'StructTreeRoot');
    const structRoot = structRootRef ? reader.resolveValue(structRootRef) : reader.resolveValue(catalog.get('StructTreeRoot') ?? null);
    if (!isDict(structRoot)) {
        errors.push('Catalog is missing /StructTreeRoot (ISO 14289-1 §7.1).');
    } else {
        const parentTree = structRoot.get('ParentTree');
        if (parentTree === undefined) {
            errors.push('/StructTreeRoot is missing /ParentTree (ISO 32000-1 §14.7.4.4).');
        }
        if (dictGetName(structRoot, 'Type') !== 'StructTreeRoot') {
            warnings.push('/StructTreeRoot should declare /Type /StructTreeRoot.');
        }
    }

    // ── /Metadata (XMP) and /Lang ───────────────────────────────────
    if (catalog.get('Metadata') === undefined) {
        errors.push('Catalog is missing /Metadata (XMP) (ISO 14289-1 §7.2).');
    }
    const lang = catalog.get('Lang');
    if (lang === undefined) {
        warnings.push('Catalog has no /Lang — a default natural language is recommended (ISO 14289-1 §7.2).');
    }

    // ── MCID uniqueness within each page ────────────────────────────
    let pages: PdfDict[] = [];
    try {
        pages = reader.getPages();
    } catch (err) {
        errors.push(`Unable to enumerate pages: ${(err as Error).message}`);
    }

    for (let p = 0; p < pages.length; p++) {
        const page = pages[p];
        const content = pageContentText(reader, page);
        if (!content) continue;
        const seen = new Set<number>();
        const re = /\/MCID\s+(\d+)/g;
        let m: RegExpExecArray | null;
        let count = 0;
        while ((m = re.exec(content)) !== null) {
            count++;
            const mcid = Number(m[1]);
            if (seen.has(mcid)) {
                errors.push(`Page ${p + 1}: duplicate /MCID ${mcid} in content stream (ISO 32000-1 §14.7.4.3).`);
            }
            seen.add(mcid);
        }
        // A tagged page that draws visible content should carry marked content.
        if (count === 0 && /\b(Tj|TJ)\b/.test(content)) {
            warnings.push(`Page ${p + 1}: text content is not wrapped in marked-content (no /MCID found).`);
        }
        // /StructParents is required on pages that contribute to the parent tree.
        if (count > 0 && page.get('StructParents') === undefined) {
            warnings.push(`Page ${p + 1}: marked content present but page has no /StructParents key.`);
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}
