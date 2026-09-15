/**
 * pdfnative — Reproducible-build support (v1.8.0)
 * ================================================
 * A process-wide default for the instant a document is stamped with, for
 * callers that want byte-reproducible output without threading
 * `layout.creationDate` through every build call.
 *
 * Unencrypted pdfnative output is a pure function of its inputs plus that one
 * instant: the trailer `/ID` is an MD5 of title + creation date + object count
 * (see `pdf-assembler.ts`), so pinning the date pins the whole file. This
 * module exists so a sample suite, a content-addressable store or a CI
 * reproducibility gate can pin it once rather than at every call site.
 *
 * Precedence, highest first:
 *   1. `layout.creationDate` — the per-call option (unchanged, since 1.3.0)
 *   2. the value set here
 *   3. `new Date()` — the historical behaviour
 *
 * The default is unset, so behaviour and output bytes are unchanged for every
 * caller that never touches this module.
 *
 * This does NOT cover values that are cryptographically random by design
 * (encryption keys and IVs) or that carry independent legal meaning
 * (`PdfSignOptions.signingTime`, `PdfModifier` modification dates) — those
 * keep their own explicit options.
 *
 * @module core/pdf-reproducible
 */

let _defaultCreationDate: Date | null = null;

/**
 * Pin the default creation instant for every subsequent build.
 *
 * @param date - Instant to stamp documents with, or `null` to restore the
 *   default wall-clock behaviour.
 *
 * @example
 * ```typescript
 * import { setDefaultCreationDate, buildDocumentPDFBytes } from 'pdfnative';
 *
 * setDefaultCreationDate(new Date('2026-01-01T00:00:00Z'));
 * const a = buildDocumentPDFBytes(params);
 * const b = buildDocumentPDFBytes(params);
 * // a and b are byte-identical.
 * ```
 *
 * @since 1.8.0
 */
export function setDefaultCreationDate(date: Date | null): void {
    if (date !== null && (!(date instanceof Date) || Number.isNaN(date.getTime()))) {
        throw new Error('setDefaultCreationDate expects a valid Date or null');
    }
    _defaultCreationDate = date;
}

/**
 * The currently pinned default creation instant, or `null` when unset.
 *
 * @since 1.8.0
 */
export function getDefaultCreationDate(): Date | null {
    return _defaultCreationDate;
}

/**
 * Resolve the instant a build should stamp, applying the documented
 * precedence. Internal to the builders.
 *
 * @param explicit - The per-call `layout.creationDate`, when supplied.
 *
 * @internal
 */
export function resolveCreationDate(explicit: Date | undefined): Date {
    return explicit ?? _defaultCreationDate ?? new Date();
}
