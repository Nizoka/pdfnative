/**
 * Font-data tools demo (v1.5.0 — issue #60).
 *
 * `pdfnative/tools` exposes `compileFontData()` (TTF/OTF → font-data module
 * source) and `parseFontData()` (TTF/OTF → introspectable FontDataObject).
 * This sample parses a bundled TTF, renders its metrics + glyph coverage into a
 * report PDF, and confirms `compileFontData()` emits a module source string.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import { compileFontData, parseFontData } from '../../src/tools/font-compiler.js';
import * as notoSansMath from '../../fonts/noto-sans-math-data.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

/** Decode a base64 string to bytes without relying on Node's `Buffer`. */
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function generate(ctx: GenerateContext): Promise<void> {
    // Decode the committed, subsetted font module (fonts/noto-sans-math-data.js)
    // rather than the raw TTF: fonts/ttf/ is git-ignored and absent in CI, but
    // the committed module carries a real, parseable SFNT in `ttfBase64`.
    const ttf = base64ToBytes(notoSansMath.ttfBase64);

    const parsed = parseFontData(ttf, { fontName: 'NotoSansMath' });
    const moduleSource = compileFontData(ttf, { fontName: 'NotoSansMath' });

    const m = parsed.metrics;
    const params: DocumentParams = {
        title: 'Font-data tools (v1.5.0)',
        blocks: [
            { type: 'heading', text: 'parseFontData() / compileFontData()', level: 1 },
            { type: 'paragraph', text: `Parsed ${parsed.fontName} from the bundled Noto Sans Math font data.` },
            {
                type: 'table',
                headers: ['Field', 'Value'],
                rows: [
                    { cells: ['fontName', parsed.fontName], type: '', pointed: false },
                    { cells: ['unitsPerEm', String(m.unitsPerEm)], type: '', pointed: false },
                    { cells: ['numGlyphs', String(m.numGlyphs)], type: '', pointed: false },
                    { cells: ['cmap entries', String(Object.keys(parsed.cmap).length)], type: '', pointed: false },
                    { cells: ['ascent / descent', `${m.ascent} / ${m.descent}`], type: '', pointed: false },
                    { cells: ['bbox', m.bbox.join(' ')], type: '', pointed: false },
                    { cells: ['compiled module', `${moduleSource.length} chars`], type: '', pointed: false },
                ],
                columns: [{ f: 0.4, a: 'l', mx: 24, mxH: 24 }, { f: 0.6, a: 'l', mx: 40, mxH: 40 }],
            },
        ],
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'tools', 'font-compiler-report.pdf'),
        'tools/font-compiler-report.pdf',
        buildDocumentPDFBytes(params),
    );
}
