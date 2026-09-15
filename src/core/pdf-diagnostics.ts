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

import type { PdfDiagnostic, PdfDiagnosticCode, PdfDiagnosticHandler, EncodingContext, FontEntry } from '../types/pdf-types.js';

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

/**
 * Diagnostic payload for an ICC v4 OutputIntent under a PDF/A-1 claim
 * (v1.8.0). ISO 19005-1 §6.2.2 admits ICC v2 profiles only; v4 is allowed
 * from PDF/A-2 (ISO 19005-2 §6.2.4.2). A diagnostic, not a throw: the file
 * is well-formed, only its claim is wrong.
 */
export function pdfaIccProfileVersionDiagnostic(version: number): PdfDiagnostic {
    return {
        code: 'PDFA_ICC_PROFILE_VERSION',
        severity: 'warning',
        message: `the OutputIntent ICC profile is version ${version} but PDF/A-1 requires an ICC v2 `
            + 'profile (ISO 19005-1 §6.2.2; veraPDF rejects the file). Supply an ICC v2 profile, or claim '
            + "PDF/A-2b or later ('pdfa2b', 'pdfa3b'), where v4 profiles are allowed (ISO 19005-2 §6.2.4.2).",
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

/**
 * Diagnostic payload for a requested OpenType feature that changed nothing
 * (v1.8.0): `undeclared` when no registered font carries the tag at all,
 * `unused` when a font declares it but no glyph in the document was
 * substituted — typically a tag asking for what the font already does by
 * default.
 */
export function typographyFeatureIneffectiveDiagnostic(
    tags: readonly string[],
    reason: 'undeclared' | 'unused',
): PdfDiagnostic {
    const list = tags.map(t => `'${t}'`).join(', ');
    const message = reason === 'undeclared'
        ? `typography.fontFeatures ${list}: no registered font declares ${tags.length === 1 ? 'this feature' : 'these features'} `
            + '(the base-14 faces carry no OpenType tables). Register a font that does, or drop the tag.'
        : `typography.fontFeatures ${list}: the font declares ${tags.length === 1 ? 'the feature' : 'the features'} but no glyph `
            + 'in the document was substituted — the requested form is already the default (Noto Sans figures '
            + "are lining and tabular by default, so 'lnum' and 'tnum' change nothing). Drop the tag, or use "
            + "'onum' / 'pnum' / 'smcp' for a visible change.";
    return { code: 'TYPOGRAPHY_FEATURE_INEFFECTIVE', severity: 'warning', message };
}

/**
 * After a document's content is laid out, report every requested OpenType
 * feature tag that changed nothing (v1.8.0). Shared by both builders.
 */
export function reportIneffectiveFeatures(
    tags: readonly string[] | undefined,
    fontEntries: readonly FontEntry[],
    enc: EncodingContext,
    emit: (diagnostic: PdfDiagnostic) => void,
): void {
    if (!tags || tags.length === 0) return;
    const undeclared = tags.filter(t => !fontEntries.some(fe => fe.fontData.features?.[t] !== undefined));
    const usage = enc.getFeatureUsage?.();
    const unused = tags.filter(t => !undeclared.includes(t) && (usage?.get(t) ?? 0) === 0);
    if (undeclared.length > 0) emit(typographyFeatureIneffectiveDiagnostic(undeclared, 'undeclared'));
    if (unused.length > 0) emit(typographyFeatureIneffectiveDiagnostic(unused, 'unused'));
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
