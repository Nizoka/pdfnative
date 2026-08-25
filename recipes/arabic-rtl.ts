/**
 * Arabic text with positional shaping and right-to-left layout. The Noto
 * Naskh Arabic data module is registered as a lazy loader, resolved with
 * `loadFontData`, and passed through `fontEntries`; the engine embeds a
 * subsetted CIDFont (Identity-H) and shapes the letterforms.
 *
 * @task Render shaped right-to-left Arabic text with an embedded Noto font
 * @surface library
 * @since 1.3.0
 * @expect pages === 1
 * @expect pdf contains '/FontFile2'
 * @expect pdf contains '/Identity-H'
 */
import { buildDocumentPDFBytes, openPdf, registerFont, loadFontData } from 'pdfnative';
import type { DocumentParams, FontEntry, FontLoader } from 'pdfnative';

// The generated data modules predate the full FontData declaration, hence
// the loader cast — the runtime shape is complete.
registerFont('ar', (() => import('pdfnative/fonts/noto-arabic-data.js')) as unknown as FontLoader);

export async function run(): Promise<{ bytes: Uint8Array; pages: number }> {
    const arabic = await loadFontData('ar');
    if (!arabic) throw new Error('Arabic font data failed to load');

    const fontEntries: FontEntry[] = [{ fontData: arabic, fontRef: '/F3', lang: 'ar' }];
    const params: DocumentParams = {
        title: 'Arabic shaping',
        blocks: [
            { type: 'heading', text: 'Positional forms and ligatures', level: 1 },
            { type: 'paragraph', text: 'السلام عليكم ورحمة الله وبركاته.' },
            { type: 'paragraph', text: 'النص العربي يُعرض من اليمين إلى اليسار.' },
        ],
        footerText: 'Arabic recipe',
        fontEntries,
    };

    const bytes = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });
    return { bytes, pages: openPdf(bytes).pageCount };
}
