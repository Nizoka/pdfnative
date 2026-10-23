/**
 * Image showcase (v1.9.0) — the three raster formats pdfnative embeds as they
 * are: JPEG (`/DCTDecode`), PNG (`/FlateDecode`, re-wrapped IDAT) and, since
 * 1.9.0, JPEG 2000 (`/JPXDecode`) — a JP2 file whose colour specification the
 * codestream carries, and a raw J2K codestream whose device space the XObject
 * states. The JPEG 2000 fixtures are the minimal valid codestreams the sample
 * helpers build (every packet empty: a flat mid-grey tone), so nothing is
 * decoded on the way in; a real job passes the bytes of a .jp2 file.
 *
 * Output: test-output/images/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';
import { makeMinimalJPEG, makeSyntheticPNG, makeMinimalJ2K, makeMinimalJP2 } from '../helpers/images.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. JPEG 2000 in a JP2 wrapper: RGB and greyscale ────────────
    const jp2: DocumentParams = {
        title: 'Images — JPEG 2000 (JP2)',
        blocks: [
            { type: 'heading', text: 'JPEG 2000 pass-through', level: 1 },
            { type: 'paragraph', text: 'Two JP2 files embedded with the JPXDecode filter. Their colr boxes name sRGB and greyscale, so the Image XObjects state no /ColorSpace of their own: the codestream is the authority, as ISO 32000-1 §8.9.5.1 provides. The header is raised to PDF 1.5, which introduced the filter.' },
            { type: 'image', data: makeMinimalJP2(3, { size: 16 }), width: 160, height: 160, alt: 'A 16 by 16 pixel sRGB JPEG 2000 image, flat mid grey' },
            { type: 'paragraph', text: 'sRGB, three components (above). Greyscale, one component (below).' },
            { type: 'image', data: makeMinimalJP2(1, { size: 16 }), width: 160, height: 160, alt: 'A 16 by 16 pixel greyscale JPEG 2000 image, flat mid grey' },
        ],
        footerText: 'pdfnative - images (JPEG 2000)',
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'images', 'image-jpx-jp2.pdf'), 'images/image-jpx-jp2.pdf', buildDocumentPDFBytes(jp2));

    // ── 2. A raw J2K codestream: the XObject declares the device space ─
    const raw: DocumentParams = {
        title: 'Images — JPEG 2000 (raw codestream)',
        blocks: [
            { type: 'heading', text: 'Raw J2K codestream', level: 1 },
            { type: 'paragraph', text: 'A bare codestream (SOC, SIZ, COD, QCD, one tile) carries no colour specification, so the XObject states /ColorSpace /DeviceGray and /BitsPerComponent 8 from the SIZ marker.' },
            { type: 'image', data: makeMinimalJ2K(1, 16), width: 160, height: 160, alt: 'A 16 by 16 pixel greyscale JPEG 2000 codestream, flat mid grey' },
        ],
        footerText: 'pdfnative - images (J2K)',
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'images', 'image-jpx-raw.pdf'), 'images/image-jpx-raw.pdf', buildDocumentPDFBytes(raw));

    // ── 3. All three formats on one tagged PDF/A-2b page ────────────
    const fontEntries = await loadSelectedFontEntries(['latin']);
    if (fontEntries.length === 1) {
        const all: DocumentParams = {
            title: 'Images — JPEG, PNG and JPEG 2000 under PDF/A-2b',
            blocks: [
                { type: 'heading', text: 'Three raster formats, one archival claim', level: 1 },
                { type: 'paragraph', text: 'JPEG (DCTDecode), PNG (FlateDecode) and JPEG 2000 (JPXDecode) side by side in a tagged PDF/A-2b document. PDF/A-2 admits JPEG 2000 with 1, 3 or 4 colour channels and no opacity channel (ISO 19005-2 §6.2.8.3); PDF/A-1 admits none, and the builder says so.' },
                { type: 'image', data: makeMinimalJPEG(), width: 96, height: 96, alt: 'A two by two pixel JPEG' },
                { type: 'image', data: makeSyntheticPNG(), width: 96, height: 96, alt: 'A synthetic PNG' },
                { type: 'image', data: makeMinimalJP2(3, { size: 16 }), width: 96, height: 96, alt: 'A JPEG 2000 image in a JP2 wrapper' },
            ],
            footerText: 'pdfnative - images (PDF/A-2b)',
            fontEntries,
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'images', 'image-formats-pdfa2b.pdf'), 'images/image-formats-pdfa2b.pdf', buildDocumentPDFBytes(all, { tagged: 'pdfa2b' }));
    }
}
