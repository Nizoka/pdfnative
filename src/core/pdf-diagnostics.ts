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

/**
 * Diagnostic payload for AcroForm fields under a PDF/A claim with no font
 * available to embed in the form's default resources (#74).
 *
 * Since v1.8.0 the `/DR` font is embedded automatically whenever a suitable
 * Latin font is registered, so this now fires only when none is — the one
 * remaining case where the claim really is unsatisfiable.
 */
export function pdfaUnembeddedFormFontDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFA_UNEMBEDDED_FORM_FONT',
        severity: 'warning',
        message: 'AcroForm field appearances fall back to an unembedded base-14 /Helv font '
            + 'because no registered font covers basic Latin, which breaks the requested PDF/A '
            + 'conformance level (ISO 19005 §6.2.11.4.1; veraPDF rejects the file). Register a '
            + 'Latin font (e.g. registerFont(\'latin\', …) with Noto Sans) and pdfnative embeds '
            + 'it into the form\'s /DR automatically. See docs/guides/pdfa.md.',
    };
}

/** Diagnostic payload for a DeviceCMYK image under a PDF/A claim. */
export function pdfaDeviceCmykDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFA_DEVICE_CMYK_IMAGE',
        severity: 'warning',
        message: 'a DeviceCMYK image was embedded under a PDF/A conformance claim whose OutputIntent '
            + 'is not CMYK (ISO 19005-2 §6.2.4.3 requires device colour to match the output '
            + 'intent; veraPDF rejects the file). Supply a CMYK layout.outputIntent, convert the image '
            + 'to RGB, or drop the PDF/A level.',
    };
}

/**
 * Diagnostic payload for a CMYK content colour under a PDF/A claim whose
 * OutputIntent is not CMYK (v1.8.0). RGB content under a CMYK intent is
 * handled by a calibrated `/DefaultRGB`; the reverse has no inline
 * equivalent, because a calibrated CMYK space needs an ICC profile.
 */
export function pdfaDeviceCmykContentDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFA_DEVICE_CMYK_CONTENT',
        severity: 'warning',
        message: 'a CMYK colour was painted under a PDF/A conformance claim whose OutputIntent is '
            + 'not CMYK (ISO 19005-2 §6.2.4.3 requires device colour to match the output intent; '
            + 'veraPDF rejects the file). Supply a CMYK layout.outputIntent, use RGB colours, or drop '
            + 'the PDF/A level.',
    };
}

/** Diagnostic payload for a PDF/X-4 claim without embedded fonts (v1.8.0). */
export function pdfxNoFontEntriesDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFX_NO_FONT_ENTRIES',
        severity: 'warning',
        message: "pdfx: 'pdfx4' with no fontEntries claims PDF/X-4 conformance while rendering through "
            + 'unembedded standard-14 Helvetica (ISO 15930-7 requires every font embedded). Register an '
            + 'embedded Latin font (e.g. Noto Sans) or drop layout.pdfx.',
    };
}

/** Diagnostic payload for CMYK colour under a PDF/X-4 claim with a non-CMYK intent (v1.8.0). */
export function pdfxDeviceCmykDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFX_DEVICE_CMYK',
        severity: 'warning',
        message: 'a CMYK colour or image was painted under a PDF/X-4 claim whose OutputIntent is not '
            + 'CMYK (ISO 15930-7 requires device colour to match the output intent). Supply a CMYK '
            + 'layout.outputIntent, use RGB colours and images, or drop layout.pdfx.',
    };
}

/** Diagnostic payload for annotations or form fields under a PDF/X-4 claim (v1.8.0). */
export function pdfxAnnotationsDiagnostic(): PdfDiagnostic {
    return {
        code: 'PDFX_ANNOTATIONS',
        severity: 'warning',
        message: 'link annotations or form fields sit on a page under a PDF/X-4 claim; PDF/X does not '
            + 'allow annotations inside the BleedBox or interactive forms (ISO 15930-7). Remove the '
            + 'links, table of contents links and form fields from the print version, or drop layout.pdfx.',
    };
}
