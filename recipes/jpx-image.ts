/**
 * Embed a JPEG 2000 image. The file's bytes travel untouched as a
 * `/JPXDecode` stream; colour space and bit depth are left to the codestream
 * when the JP2 header declares them (ISO 32000-1 §7.4.9), an opacity channel
 * becomes `/SMaskInData 1`, and the header is raised to PDF 1.5. The image
 * below is an 8 × 8 JP2 file with a `colr` box and an alpha channel, inlined
 * so the recipe has no file dependency; in a real job read the `.jp2` or
 * `.j2k` from disk.
 *
 * @task Embed a JPEG 2000 image as a JPXDecode pass-through
 * @surface library
 * @since 1.9.0
 * @expect pages === 1
 * @expect pdf contains '/JPXDecode'
 * @expect pdf contains '/SMaskInData 1'
 * @expect header === '%PDF-1.5'
 */
import { buildDocumentPDFBytes, openPdf, parseImage } from 'pdfnative';
import type { JpxInfo } from 'pdfnative';

const JP2_BASE64 = 'AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAABJanAyaAAAABZpaGRyAAAACAAAAAgAAwcHAAAAAAAPY29scgEAAAAAABAAAAAcY2RlZgADAAAAAAABAAEAAAACAAIAAQAAAAAAYmpwMmP/T/9RAC8AAAAAAAgAAAAIAAAAAAAAAAAAAAAIAAAACAAAAAAAAAAAAAMHAQEHAQEHAQH/UgAMAAAAAQEABAQAAf9cAARAQP+QAAoAAAAAABEAAf+TAAAA/9k=';

function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function run(): Promise<{ bytes: Uint8Array; pages: number; header: string; jpx: JpxInfo | undefined }> {
    const image = fromBase64(JP2_BASE64);
    const parsed = parseImage(image); // what the XObject will say: 3 colour channels + alpha, colour declared
    const bytes = buildDocumentPDFBytes(
        {
            title: 'JPEG 2000',
            blocks: [
                { type: 'heading', text: 'A JPEG 2000 image, passed through', level: 1 },
                { type: 'image', data: image, width: 160, height: 160, alt: 'An 8 by 8 JPEG 2000 test image with an opacity channel' },
                { type: 'paragraph', text: 'The codestream is embedded as written; viewers with JPX support decode it.' },
            ],
        },
        { creationDate: new Date('2026-10-23T00:00:00Z') },
    );
    const header = String.fromCharCode(...bytes.subarray(0, 8));
    return { bytes, pages: openPdf(bytes).pageCount, header, jpx: parsed.jpx };
}
