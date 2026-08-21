/**
 * pdfnative — Conformance Diagnostics (v1.7.0)
 * =============================================
 * The single channel through which the builders surface conformance
 * problems that do not (yet) fail the build: configurations that produce a
 * PDF/A conformance claim veraPDF would reject, silent quality traps, etc.
 *
 * Default sink: `console.warn`, deduplicated per code per build — this is
 * the ONLY module in the library allowed to call `console.warn` (see
 * AGENTS.md). Callers silence or redirect it with `onDiagnostic`, or
 * escalate every diagnostic to a thrown `Error` with `strict: true`.
 *
 * The diagnostic TYPES (codes, payload, handler) live in
 * `src/types/pdf-types.ts` so option interfaces can reference them without
 * a types→core dependency.
 *
 * @module core/pdf-diagnostics
 */

import type { PdfDiagnostic, PdfDiagnosticCode, PdfDiagnosticHandler } from '../types/pdf-types.js';

/**
 * Create the per-build diagnostic emitter.
 *
 * - `strict: true` → the first diagnostic throws an `Error` with the
 *   diagnostic message (before any output bytes are produced).
 * - `handler` → receives every diagnostic (no deduplication — the caller
 *   owns delivery).
 * - default → `console.warn`, once per code per build.
 */
export function createDiagnosticEmitter(
    strict: boolean | undefined,
    handler: PdfDiagnosticHandler | undefined,
): (diagnostic: PdfDiagnostic) => void {
    const warned = new Set<PdfDiagnosticCode>();
    return (diagnostic: PdfDiagnostic): void => {
        if (strict) {
            throw new Error(`pdfnative: ${diagnostic.message}`);
        }
        if (handler) {
            handler(diagnostic);
            return;
        }
        if (!warned.has(diagnostic.code)) {
            warned.add(diagnostic.code);
            // Sanctioned sole console sink for conformance diagnostics
            // (AGENTS.md — `console.warn` allowed only in this module).
            console.warn(`pdfnative: ${diagnostic.message}`);
        }
    };
}

/** Diagnostic payload for a PDF/A claim without embedded fonts (#69). */
export function pdfaNoFontEntriesDiagnostic(level: string): PdfDiagnostic {
    return {
        code: 'PDFA_NO_FONT_ENTRIES',
        severity: 'warning',
        message: `tagged: '${level}' with no fontEntries claims PDF/A conformance while rendering `
            + 'through unembedded standard-14 Helvetica (ISO 19005 §6.2.11.4.1 requires every font '
            + 'embedded; veraPDF rejects the file). Register an embedded Latin font (e.g. Noto Sans) '
            + 'or drop the PDF/A level. See docs/guides/pdfa.md.',
    };
}

/** Diagnostic payload for AcroForm fields under a PDF/A claim. */
export function pdfaUnembeddedFormFontDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFA_UNEMBEDDED_FORM_FONT',
        severity: 'warning',
        message: 'AcroForm field appearances render through an unembedded base-14 /Helv font, '
            + 'which breaks the requested PDF/A conformance level (ISO 19005 §6.2.11.4.1; '
            + 'veraPDF rejects the file). Drop the PDF/A level for form documents, or flatten '
            + 'the form before claiming conformance.',
    };
}

/** Diagnostic payload for a DeviceCMYK image under a PDF/A claim. */
export function pdfaDeviceCmykDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFA_DEVICE_CMYK_IMAGE',
        severity: 'warning',
        message: 'a DeviceCMYK image was embedded under a PDF/A conformance claim with an sRGB '
            + 'OutputIntent (ISO 19005-2 §6.2.4.3 requires device colour to match the output '
            + 'intent; veraPDF rejects the file). Convert the image to RGB or drop the PDF/A level.',
    };
}
