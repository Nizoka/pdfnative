/**
 * Financial statement samples (12 languages + multi-language + pagination).
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams, FontEntry } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries, loadSelectedFontEntries } from '../helpers/fonts.js';
import { SAMPLES, MULTI_LANG_SAMPLE, PAGINATION_SAMPLE } from '../data/financial-data.js';

/**
 * The fonts the multi-language statement's eleven rows actually use — the
 * Latin face first so the English cells and the digits embed under PDF/A.
 * Registering the whole inventory embedded twenty-two unused programs (12 MB
 * before 1.9.0's C18 stub) for a one-page table.
 */
const MULTI_LANG_FONTS = ['latin', 'th', 'ja', 'zh', 'ko', 'el', 'hi', 'vi', 'ar', 'he'];

export async function generate(ctx: GenerateContext): Promise<void> {
    const allSamples = [...SAMPLES, MULTI_LANG_SAMPLE, PAGINATION_SAMPLE];

    for (const sample of allSamples) {
        const isLatin = sample.lang === 'latin' || sample.lang === 'pagination';
        const isMulti = sample.lang === 'multi';

        let fontEntries: FontEntry[] | undefined;

        if (isMulti) {
            fontEntries = await loadSelectedFontEntries(MULTI_LANG_FONTS);
        } else if (!isLatin) {
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

        // The multi-language table is tagged (PDF/A-2b): /Table /TR /TH /TD
        // with /Scope, and every cell carries its text as /ActualText, so a
        // reader extracts the Arabic, Hebrew and Hindi cells column by column
        // in logical order instead of one geometric sweep of the row (1.9.0).
        const bytes = isMulti ? buildPDFBytes(params, { tagged: true }) : buildPDFBytes(params);
        const filename = `${sample.filename || `sample-${sample.lang}`}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'financial', filename), `financial/${filename}`, bytes);
    }
}
