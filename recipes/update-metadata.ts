/**
 * Incremental metadata update: open an existing document, re-issue its
 * /Info dictionary with a new title and a pinned modification date, and
 * save. The original revision is preserved byte for byte; the reopened
 * document reports the new title.
 *
 * @task Retitle an existing PDF via a non-destructive incremental update
 * @surface library
 * @since 1.7.0
 * @expect title === 'Quarterly report (revised)'
 */
import { buildDocumentPDFBytes, openPdf, createModifier } from 'pdfnative';

/** /Info strings may be UTF-16BE with a BOM; plain literals pass through. */
function decodePdfText(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    if (raw.length >= 2 && raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < raw.length; i += 2) {
            out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
        }
        return out;
    }
    return raw;
}

export async function run(): Promise<{ bytes: Uint8Array; title: string }> {
    const original = buildDocumentPDFBytes(
        {
            title: 'Quarterly report',
            blocks: [{ type: 'paragraph', text: 'Figures under review.' }],
            footerText: 'Quarterly report',
        },
        { creationDate: new Date('2026-08-25T00:00:00Z') },
    );

    const modifier = createModifier(openPdf(original));
    modifier.updateMetadata({
        title: 'Quarterly report (revised)',
        modDate: new Date('2026-08-25T00:00:00Z'),
    });
    const bytes = modifier.save();

    const info = openPdf(bytes).getInfo();
    const title = decodePdfText(info?.get('Title'));
    return { bytes, title };
}
