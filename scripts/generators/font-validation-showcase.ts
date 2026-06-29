/**
 * Font-data validator showcase (v1.4.0).
 *
 * Demonstrates `validateFontData()` — the opt-in, read-only structural check
 * for custom font-data modules. Validates a bundled (good) font and a couple
 * of deliberately broken payloads, then renders the {valid, errors, warnings}
 * verdicts into a report PDF.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, loadFontData, validateFontData } from '../../src/index.js';
import type { DocumentParams, FontValidationResult } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function verdict(r: FontValidationResult): string {
    const e = r.errors.length ? r.errors.join('; ') : '—';
    const w = r.warnings.length ? r.warnings.join('; ') : '—';
    return `${r.valid ? 'VALID' : 'INVALID'} | errors: ${e} | warnings: ${w}`;
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const good = await loadFontData('thai');
    const goodRes = good ? validateFontData(good) : { valid: false, errors: ['font not loaded'], warnings: [] };

    const emptyCmapRes = validateFontData({
        fontName: 'Broken', unitsPerEm: 1000, bbox: [0, 0, 1000, 1000], numGlyphs: 1,
        cmap: {}, widths: {}, pdfWidthArray: '[]', ttfBase64: 'AAEAAA==',
    });
    const badMagicRes = validateFontData({
        fontName: 'NotSFNT', unitsPerEm: 1000, bbox: [0, 0, 1000, 1000], numGlyphs: 1,
        cmap: { 65: 1 }, widths: { 65: 500 }, pdfWidthArray: '[500]', ttfBase64: 'ZGVhZGJlZWY=',
    });

    const params: DocumentParams = {
        title: 'Font-data validator report (v1.4.0)',
        blocks: [
            { type: 'heading', text: 'validateFontData() report', level: 1 },
            { type: 'paragraph', text: 'Opt-in structural sanity check for custom font-data modules. Returns { valid, errors, warnings } without throwing.' },
            {
                type: 'table',
                headers: ['Sample', 'Result'],
                rows: [
                    { cells: ['Bundled Noto Thai', verdict(goodRes)], type: 'credit', pointed: false },
                    { cells: ['Empty cmap', verdict(emptyCmapRes)], type: 'debit', pointed: false },
                    { cells: ['Non-SFNT magic', verdict(badMagicRes)], type: 'debit', pointed: false },
                ],
                wrap: 'auto',
                columns: [{ f: 0.25, a: 'l', mx: 24, mxH: 24 }, { f: 0.75, a: 'l', mx: 120, mxH: 120 }],
            },
        ],
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'fonts', 'font-validation-report.pdf'),
        'fonts/font-validation-report.pdf',
        buildDocumentPDFBytes(params),
    );
}
