/**
 * Incremental metadata update showcase (v1.7.0).
 *
 * Demonstrates {@link PdfModifier.updateMetadata}: an existing PDF is opened
 * with openPdf(), its /Info dictionary is re-issued via an incremental update
 * (ISO 32000-1 §7.5.6) with new /Title, /Author and a /ModDate, and — when the
 * document carries an XMP packet — xmp:ModifyDate / xmp:MetadataDate are
 * resynchronised to the same instant while xmp:CreateDate and the pdfaid
 * claim are preserved. The original revision stays byte-for-byte intact.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, openPdf, createModifier } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

function buildBaseDoc(): DocumentParams {
    return {
        title: 'Incremental Metadata — Original',
        blocks: [
            { type: 'heading', text: 'pdfnative v1.7 — updateMetadata()', level: 1 },
            {
                type: 'paragraph',
                text:
                    'This document was produced in two files. The "-original" PDF is the plain '
                    + 'build. The "-updated" PDF is the SAME file with one incremental revision '
                    + 'appended: the /Info dictionary was re-issued with a new /Title, /Author '
                    + 'and /ModDate, and the XMP packet was resynchronised so that '
                    + 'xmp:ModifyDate and xmp:MetadataDate mirror the /Info /ModDate instant.',
            },
            { type: 'heading', text: 'What stays intact', level: 2 },
            {
                type: 'paragraph',
                text:
                    'The original revision is preserved byte-for-byte (open the updated file in '
                    + 'a hex editor: the first bytes are identical to the original file). The '
                    + 'trailer /ID keeps its first element byte-exact — it permanently identifies '
                    + 'the document and feeds encryption key derivation — while the second '
                    + 'element is regenerated to mark the new revision, as ISO 32000-1 §14.4 '
                    + 'prescribes. xmp:CreateDate and the pdfaid:part/conformance claim survive '
                    + 'the update unchanged.',
            },
        ],
    };
}

export async function generate(ctx: GenerateContext): Promise<void> {
    // PDF/A-2b requires embedded fonts (ISO 19005-2 §6.2.11.4.1) — base-14
    // Helvetica alone would make the claim non-conformant.
    const fontEntries = await loadSelectedFontEntries(['latin']);
    if (fontEntries.length !== 1) return;
    const original = buildDocumentPDFBytes({ ...buildBaseDoc(), fontEntries }, { tagged: 'pdfa2b' });
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'incremental-metadata-original.pdf'),
        'manipulation/incremental-metadata-original.pdf',
        original,
    );

    const modifier = createModifier(openPdf(original));
    modifier.updateMetadata({
        title: 'Incremental Metadata — Updated',
        author: 'pdfnative sample generator',
        subject: 'updateMetadata() incremental /Info + XMP resync',
        keywords: 'incremental update, metadata, XMP, ModDate',
        modDate: new Date(),
    });
    const updated = modifier.save();
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'incremental-metadata-updated.pdf'),
        'manipulation/incremental-metadata-updated.pdf',
        updated,
    );
}
