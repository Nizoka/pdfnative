/**
 * Signature-placeholder workflow showcase (v1.2.0, issue #45).
 *
 * Demonstrates the ergonomic two-step "build → placeholder" pipeline
 * introduced in v1.2 via {@link addSignaturePlaceholder}. The resulting
 * PDF carries an AcroForm signature widget and a /Sig dictionary whose
 * /Contents + /ByteRange are pre-allocated. Downstream tooling (or a
 * later call to signPdfBytes) can fill them in without touching the
 * surrounding object/xref layout.
 *
 * A full RSA/ECDSA signing demo lives in `digital-signature.ts`.
 */

import { resolve } from 'path';
import { addSignaturePlaceholder, buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function buildShowcaseDoc(): DocumentParams {
    return {
        title: 'Signature Placeholder Showcase',
        blocks: [
            { type: 'heading', text: 'pdfnative v1.2 — addSignaturePlaceholder()', level: 1 },
            {
                type: 'paragraph',
                text:
                    'NOTE: opening this PDF in Adobe Reader will display "Signature non valable" / '
                    + '"Signature invalid". That is the expected, by-spec behaviour of an unsigned '
                    + 'placeholder — the /Contents slot is reserved (zero-padded hex) and the /ByteRange '
                    + 'is left at its default until a subsequent signPdfBytes() call computes the digest '
                    + 'and writes the CMS SignedData. The companion digital-signature.* PDFs show the '
                    + 'same workflow with the signature actually applied.',
            },
            {
                type: 'paragraph',
                text:
                    'This PDF was assembled in two steps: 1) buildDocumentPDFBytes() produced the body, '
                    + '2) addSignaturePlaceholder() appended an AcroForm signature widget plus a /Sig dictionary '
                    + 'via an incremental update (ISO 32000-1 §7.5.6). A subsequent call to signPdfBytes() '
                    + 'would patch the /ByteRange and embed a CMS SignedData blob into /Contents without '
                    + 'touching the surrounding objects.',
            },
            { type: 'heading', text: 'Why this matters (issue #45)', level: 2 },
            {
                type: 'paragraph',
                text:
                    'Before v1.2, downstream tooling had to duplicate the exact byte layout dictated by '
                    + 'signPdfBytes(). addSignaturePlaceholder() now ships the canonical implementation in '
                    + 'the library itself, so external signing pipelines (HSMs, smartcards, cloud KMS) can '
                    + 'plug into a stable, well-tested placeholder.',
            },
            { type: 'heading', text: 'Idempotency contract', level: 2 },
            {
                type: 'paragraph',
                text:
                    'Calling addSignaturePlaceholder() on a PDF that already carries an /FT /Sig widget '
                    + 'returns the input unchanged. The companion "-idempotent" file in this directory '
                    + 'was produced by piping the placeholder PDF through the function a second time — '
                    + 'its bytes match the first output exactly.',
            },
            { type: 'heading', text: 'Options', level: 2 },
            {
                type: 'paragraph',
                text:
                    'Configurable: fieldName (defaults to "Signature1"), placeholderBytes (defaults to '
                    + '16 384 bytes — enough for a typical RSA-2048 CMS SignedData with a single signer '
                    + 'certificate and timestamp).',
            },
        ],
    };
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const unsigned = buildDocumentPDFBytes(buildShowcaseDoc());

    const placeheld = addSignaturePlaceholder(unsigned, {
        fieldName: 'AuthorSignature',
        placeholderBytes: 16384,
    });
    ctx.writeSafe(
        resolve(ctx.outputDir, 'signature', 'signature-placeholder-unsigned.pdf'),
        'signature/signature-placeholder-unsigned.pdf',
        placeheld,
    );

    // Idempotency check — second call must return identical bytes.
    const placeheldAgain = addSignaturePlaceholder(placeheld, {
        fieldName: 'AuthorSignature',
        placeholderBytes: 16384,
    });
    ctx.writeSafe(
        resolve(ctx.outputDir, 'signature', 'signature-placeholder-idempotent.pdf'),
        'signature/signature-placeholder-idempotent.pdf',
        placeheldAgain,
    );
}
