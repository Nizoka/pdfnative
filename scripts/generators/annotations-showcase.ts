/**
 * Annotations showcase (v1.5.0).
 *
 * Builds an annotation object for each supported markup type, reads the
 * annotations back out of an existing PDF via `openPdf().getAnnotations()`, and
 * injects a highlight into an existing document with a non-destructive
 * incremental update via `createModifier().addAnnotation()`.
 */

import { resolve } from 'path';
import {
    buildDocumentPDFBytes,
    buildAnnotation,
    buildAnnotationBody,
    openPdf,
    createModifier,
} from '../../src/index.js';
import type { DocumentParams, MarkupAnnotation } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

const samples: MarkupAnnotation[] = [
    { type: 'text', rect: [72, 700, 96, 724], contents: 'Sticky note', title: 'Reviewer', icon: 'Comment' },
    { type: 'highlight', rect: [72, 660, 300, 676], color: '#ffe14d', contents: 'Highlighted' },
    { type: 'underline', rect: [72, 630, 300, 646], color: '#2f6fed' },
    { type: 'strikeout', rect: [72, 600, 300, 616], color: '#d33' },
    { type: 'squiggly', rect: [72, 570, 300, 586], color: '#2a8' },
    { type: 'square', rect: [72, 520, 220, 560], color: '#333', interiorColor: '#eef' },
    { type: 'circle', rect: [240, 520, 360, 560], color: '#333' },
    { type: 'line', rect: [72, 480, 300, 500], start: [72, 490], end: [300, 490], color: '#333' },
    { type: 'freetext', rect: [72, 430, 320, 470], contents: 'Typewriter text', fontSize: 12 },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. Show every annotation type described in a report ───────
    const listing: DocumentParams = {
        title: 'Markup annotation types (v1.5.0)',
        blocks: [
            { type: 'heading', text: 'Markup annotation model', level: 1 },
            { type: 'paragraph', text: 'buildAnnotation() / buildAnnotationBody() cover nine annotation types.' },
            {
                type: 'table',
                headers: ['type', '/Subtype (object length)'],
                rows: samples.map((a, i) => ({
                    cells: [a.type, `${buildAnnotation(a, 100 + i).length} bytes`],
                    type: '',
                    pointed: false,
                })),
                columns: [{ f: 0.4, a: 'l', mx: 24, mxH: 24 }, { f: 0.6, a: 'l', mx: 40, mxH: 40 }],
            },
        ],
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'annotations', 'annotation-types.pdf'),
        'annotations/annotation-types.pdf',
        buildDocumentPDFBytes(listing),
    );

    // ── 2. Inject a highlight into an existing PDF, then read back ─
    const base = buildDocumentPDFBytes({
        title: 'Contract',
        blocks: [
            { type: 'heading', text: 'Service Agreement', level: 1 },
            { type: 'paragraph', text: 'The parties agree to the following terms and conditions.' },
        ],
    });

    const modifier = createModifier(openPdf(base));
    modifier.addAnnotation(0, buildAnnotationBody({
        type: 'highlight',
        rect: [72, 690, 320, 706],
        color: '#ffe14d',
        contents: 'Key clause',
    }));
    const annotated = modifier.save();
    ctx.writeSafe(
        resolve(ctx.outputDir, 'annotations', 'annotated-contract.pdf'),
        'annotations/annotated-contract.pdf',
        annotated,
    );

    // Read the annotations back out (round-trip proof).
    const reader = openPdf(annotated);
    const read = reader.getAnnotations(0);
    const roundTrip: DocumentParams = {
        title: 'Round-trip: getAnnotations()',
        blocks: [
            { type: 'heading', text: 'Annotations read back', level: 1 },
            {
                type: 'table',
                headers: ['Subtype', 'Contents', 'Rect'],
                rows: read.map((a) => ({
                    cells: [a.subtype, a.contents ?? '—', a.rect ? a.rect.map((n) => Math.round(n)).join(' ') : '—'],
                    type: '',
                    pointed: false,
                })),
                columns: [
                    { f: 0.25, a: 'l', mx: 16, mxH: 16 },
                    { f: 0.45, a: 'l', mx: 40, mxH: 40 },
                    { f: 0.3, a: 'l', mx: 24, mxH: 24 },
                ],
            },
        ],
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'annotations', 'annotations-readback.pdf'),
        'annotations/annotations-readback.pdf',
        buildDocumentPDFBytes(roundTrip),
    );

    // ── Annotate an ENCRYPTED document (v1.6.0) ──────────────────────
    // The appended annotation objects are encrypted under the document's
    // existing AES-128 scheme. Open with user password "pdfnative".
    const encBase = buildDocumentPDFBytes({
        title: 'Confidential contract',
        blocks: [
            { type: 'heading', text: 'Confidential Service Agreement', level: 1 },
            { type: 'paragraph', text: 'This encrypted document was annotated after encryption.' },
        ],
    }, { encryption: { ownerPassword: 'pdfnative-owner', userPassword: 'pdfnative', algorithm: 'aes128' } });

    const encModifier = createModifier(openPdf(encBase, { password: 'pdfnative' }));
    encModifier.addAnnotation(0, buildAnnotationBody({
        type: 'text',
        rect: [500, 690, 520, 710],
        contents: 'Reviewed under NDA - annotation stored encrypted.',
    }));
    ctx.writeSafe(
        resolve(ctx.outputDir, 'annotations', 'annotated-encrypted.pdf'),
        'annotations/annotated-encrypted.pdf',
        encModifier.save(),
    );
}
