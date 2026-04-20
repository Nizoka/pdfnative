/**
 * Diverse use-case samples (non-financial).
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams, FontEntry } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';
import { DIVERSE_SAMPLES } from '../data/diverse-data.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    for (const sample of DIVERSE_SAMPLES) {
        const isLatin = sample.lang === 'latin';
        let fontEntries: FontEntry[] | undefined;
        if (!isLatin) {
            fontEntries = await loadFontEntries(sample.lang);
        }

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
        const filename = `${sample.filename || `sample-${sample.lang}`}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'diverse', filename), `diverse/${filename}`, bytes);
    }
}
