/**
 * Alphabet / character coverage samples (per-script verification).
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams, FontEntry } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';
import { ALPHABET_SAMPLES } from '../data/alphabet-data.js';

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

        const bytes = buildPDFBytes(params);
        const filename = `${sample.filename || `alphabet-${sample.lang}`}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, filename), filename, bytes);
    }
}
