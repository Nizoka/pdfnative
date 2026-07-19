/**
 * Text-extraction showcase (v1.6.0).
 *
 * Demonstrates extractText():
 *   - Build a rich source document, extract its text, and render an
 *     "extraction report" PDF listing the recovered per-page text plus
 *     positioned runs.
 *   - Extract from an AES-256 encrypted build (password-protected round
 *     trip: generate -> encrypt -> extract).
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, extractText } from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function sourceDoc(): Uint8Array {
    const params: DocumentParams = {
        title: 'Quarterly report - extraction source',
        blocks: [
            { type: 'heading', level: 1, text: 'Q3 Quarterly Report' },
            { type: 'paragraph', text: 'Revenue grew 14% quarter-over-quarter, driven by the EMEA region. Operating margin held at 23%.' },
            { type: 'heading', level: 2, text: 'Highlights' },
            { type: 'list', style: 'bullet', items: [
                'EMEA revenue up 21% - strongest quarter on record',
                'Churn down to 2.1% (from 2.8%)',
                'Unit economics: CAC payback now 11 months',
            ] },
            { type: 'table',
              headers: ['Region', 'Revenue', 'Growth'],
              rows: [
                { cells: ['EMEA', '€4.2M', '+21%'], type: '', pointed: false },
                { cells: ['Americas', '€3.1M', '+9%'], type: '', pointed: false },
                { cells: ['APAC', '€1.4M', '+12%'], type: '', pointed: false },
              ],
            },
            { type: 'paragraph', text: 'Full commentary — including café-level unit detail — follows in the appendix.' },
        ],
        footerText: 'pdfnative - text-extraction source document',
    };
    return buildDocumentPDFBytes(params);
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const source = sourceDoc();
    ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'text-extract-source.pdf'), 'parser/text-extract-source.pdf', source);

    // Extract with positioned runs and render the report.
    const [page] = extractText(source, { includeRuns: true });
    const reportBlocks: DocumentBlock[] = [
        { type: 'heading', level: 1, text: 'extractText() report' },
        { type: 'paragraph', text: `Source: text-extract-source.pdf - page ${page.pageIndex + 1}, ${page.runs?.length ?? 0} runs, ${page.text.length} characters.` },
        { type: 'heading', level: 2, text: 'Reading-order text' },
        ...page.text.split('\n').map((line): DocumentBlock => ({ type: 'paragraph', text: line.length > 0 ? line : ' ' })),
        { type: 'heading', level: 2, text: 'First positioned runs' },
        { type: 'table',
          headers: ['x', 'y', 'size', 'font', 'text'],
          rows: (page.runs ?? []).slice(0, 12).map(r => ({
            cells: [r.x.toFixed(1), r.y.toFixed(1), r.fontSize.toFixed(1), r.fontName, r.text.length > 40 ? `${r.text.slice(0, 40)}…` : r.text],
            type: '', pointed: false,
          })),
        },
    ];
    const report = buildDocumentPDFBytes({ title: 'extractText report', blocks: reportBlocks, footerText: 'pdfnative - extraction report' });
    ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'text-extract-report.pdf'), 'parser/text-extract-report.pdf', report);

    // Encrypted round trip: the same source, AES-256, extracted with password.
    const encrypted = buildDocumentPDFBytes(
        { title: 'Encrypted extraction source', blocks: [{ type: 'paragraph', text: 'Confidential: extraction works on encrypted documents too.' }] },
        { encryption: { ownerPassword: 'pdfnative', userPassword: 'reader', algorithm: 'aes256' } },
    );
    const [encPage] = extractText(encrypted, { password: 'reader' });
    const encReport = buildDocumentPDFBytes({
        title: 'Encrypted extraction report',
        blocks: [
            { type: 'heading', level: 1, text: 'Encrypted source, extracted' },
            { type: 'paragraph', text: 'extractText(bytes, { password }) opened an AES-256 document and recovered:' },
            { type: 'paragraph', text: encPage.text },
        ],
        footerText: 'pdfnative - encrypted extraction round trip',
    });
    ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'text-extract-encrypted-report.pdf'), 'parser/text-extract-encrypted-report.pdf', encReport);
}
