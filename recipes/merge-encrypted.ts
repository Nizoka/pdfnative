/**
 * Merge two documents and encrypt the result in the same call.
 * `MergeOptions.encrypt` re-protects the assembled document (AES-128
 * here); the reader then opens it with the user password and reports the
 * scheme. Encryption uses random salts, so the bytes differ per run while
 * the structure stays identical.
 *
 * @task Merge two PDFs and AES-encrypt the combined document
 * @surface library
 * @since 1.6.0
 * @expect pages === 2
 * @expect encryption.algorithm === 'aes128'
 */
import { buildDocumentPDFBytes, mergePdfs, openPdf } from 'pdfnative';
import type { DocumentParams, PdfEncryptionInfo } from 'pdfnative';

function chapter(title: string, body: string): DocumentParams {
    return {
        title,
        blocks: [{ type: 'paragraph', text: body }],
        footerText: title,
    };
}

export async function run(): Promise<{ bytes: Uint8Array; pages: number; encryption: PdfEncryptionInfo | null }> {
    const created = new Date('2026-08-25T00:00:00Z');
    const first = buildDocumentPDFBytes(chapter('Part one', 'Opening chapter.'), { creationDate: created });
    const second = buildDocumentPDFBytes(chapter('Part two', 'Closing chapter.'), { creationDate: created });

    const bytes = mergePdfs([first, second], {
        encrypt: {
            ownerPassword: 'owner-secret',
            userPassword: 'reader-secret',
            algorithm: 'aes128',
            permissions: { print: true, copy: false },
        },
    });

    const reader = openPdf(bytes, { password: 'reader-secret' });
    return { bytes, pages: reader.pageCount, encryption: reader.encryption };
}
