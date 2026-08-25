/**
 * True streaming output for a large document: `buildDocumentPDFStreamTrue`
 * yields the PDF in chunks whose concatenation is byte-identical to the
 * buffered builder's output for the same input (creation date pinned so
 * both builds share it).
 *
 * @task Stream a 300-block document and match the buffered output byte for byte
 * @surface library
 * @since 1.3.0
 * @expect identical === true
 * @expect pages === 8
 */
import { buildDocumentPDFBytes, buildDocumentPDFStreamTrue, concatChunks, openPdf } from 'pdfnative';
import type { DocumentParams, DocumentBlock } from 'pdfnative';

const blocks: DocumentBlock[] = Array.from({ length: 300 }, (_, i) => ({
    type: 'paragraph' as const,
    text: `Row ${i + 1}: measurement recorded and archived.`,
}));

const params: DocumentParams = {
    title: 'Measurement log',
    blocks,
    footerText: 'Measurement log',
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number; identical: boolean }> {
    const created = new Date('2026-08-25T00:00:00Z');

    const chunks: Uint8Array[] = [];
    for await (const chunk of buildDocumentPDFStreamTrue(params, { creationDate: created }, { chunkSize: 16 * 1024 })) {
        chunks.push(chunk);
    }
    const bytes = concatChunks(chunks);

    const buffered = buildDocumentPDFBytes(params, { creationDate: created });
    const identical = bytes.length === buffered.length && bytes.every((b, i) => b === buffered[i]);

    return { bytes, pages: openPdf(bytes).pageCount, identical };
}
