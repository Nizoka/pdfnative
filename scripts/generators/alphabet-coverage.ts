/**
 * Alphabet / character coverage samples (per-script verification).
 */

import { resolve } from 'path';
import { buildPDFBytes, DEFAULT_COLORS } from '../../src/index.js';
import type { PdfParams, FontEntry, ColumnDef } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';
import { ALPHABET_SAMPLES } from '../data/alphabet-data.js';

/**
 * The table builder was written for financial statements: its default
 * columns cap cells at 12/20 characters and paint column 3 as an amount
 * (`type: 'debit'` in red, `'credit'` in green). On these plates column 3
 * is a glyph category (Ligature, Subjoined, Pre-base, Tone…) and every
 * label must be legible in a regression report, so the columns are sized
 * to the widest content across all 27 scripts and the amount colours are
 * neutralised. Red stays reserved for real test failures.
 */
const PLATE_COLUMNS: readonly ColumnDef[] = [
    { f: 0.14, a: 'l', mx: 20, mxH: 20 }, // Group
    { f: 0.38, a: 'l', mx: 48, mxH: 48 }, // Characters
    { f: 0.08, a: 'l', mx: 10, mxH: 10 }, // Count
    { f: 0.13, a: 'l', mx: 14, mxH: 14 }, // Type
    { f: 0.27, a: 'l', mx: 34, mxH: 34 }, // Notes
];
const PLATE_COLORS = { ...DEFAULT_COLORS, credit: DEFAULT_COLORS.text, debit: DEFAULT_COLORS.text };

export async function generate(ctx: GenerateContext): Promise<void> {
    for (const sample of ALPHABET_SAMPLES) {
        let fontEntries: FontEntry[] | undefined;
        fontEntries = await loadFontEntries(sample.lang);

        const params: PdfParams = {
            title: sample.title,
            infoItems: sample.infoItems,
            balanceText: sample.balanceText,
            countText: sample.countText,
            headers: sample.headers,
            rows: sample.rows,
            footerText: sample.footerText,
            fontEntries,
        };

        const bytes = buildPDFBytes(params, { columns: PLATE_COLUMNS, colors: PLATE_COLORS });
        const filename = `${sample.filename || `alphabet-${sample.lang}`}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'alphabet', filename), `alphabet/${filename}`, bytes);
    }
}
