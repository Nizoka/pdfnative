/**
 * pdfnative — Layout Inspection (development / tooling aid)
 * ========================================================
 * `inspectDocumentLayout()` reports, without rendering a PDF, how the document
 * builder is expected to paginate a set of blocks and where each block lands.
 * It reuses the exact same measurement primitives as the builder
 * (`estimateBlockHeight`, `planTable`, the layout constants), so the reported
 * geometry is a faithful estimate of the real output.
 *
 * This is read-only and deterministic — ideal for debugging layout issues,
 * writing layout assertions in tests, or driving higher-level tooling.
 *
 * @since 1.5.0
 */

import type { PdfLayoutOptions, FontEntry, LayoutInspection, InspectedBlock, InspectedPage } from '../types/pdf-types.js';
import type { DocumentParams } from '../types/pdf-document-types.js';
import { createEncodingContext } from './encoding-context.js';
import { estimateBlockHeight, planTable } from './pdf-renderers.js';
import { resolvePdfAConfig } from './pdf-tags.js';
import { PG_W, PG_H, DEFAULT_MARGINS, FT_H, HEADER_H } from './pdf-layout.js';

/** Title band height on the first page (title line + underline spacing). */
const TITLE_BAND_H = 22 + 12;

/**
 * Inspect how {@link DocumentParams.blocks} will paginate and where each block
 * is placed, without building a PDF.
 *
 * @param params        The same document params passed to `buildDocumentPDF`.
 * @param layoutOptions Optional layout overrides (page size, margins, tagged
 *                      mode, header template…). `params.layout` is used when
 *                      omitted, matching the builder.
 * @returns A deterministic {@link LayoutInspection}.
 */
export function inspectDocumentLayout(
    params: DocumentParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
): LayoutInspection {
    if (!params || typeof params !== 'object' || !Array.isArray(params.blocks)) {
        throw new Error('inspectDocumentLayout: params.blocks must be an array');
    }

    const layout = layoutOptions ?? params.layout;
    const pgW = layout?.pageWidth ?? PG_W;
    const pgH = layout?.pageHeight ?? PG_H;
    const mg = layout?.margins ?? { ...DEFAULT_MARGINS };
    const cw = pgW - mg.l - mg.r;

    const fontEntries: FontEntry[] = params.fontEntries ? [...params.fontEntries] : [];
    const tagged = resolvePdfAConfig(layout?.tagged).enabled;
    const enc = createEncodingContext(fontEntries, tagged, layout?.normalize ?? false);

    const headerH = layout?.headerTemplate ? HEADER_H : 0;
    const availableH = pgH - mg.t - mg.b - FT_H - headerH;

    const pages: InspectedBlock[][] = [[]];
    let remainH = availableH;
    let curY = pgH - mg.t - headerH;

    if (params.title) {
        remainH -= TITLE_BAND_H;
        curY -= TITLE_BAND_H;
    }

    const newPage = (): void => {
        pages.push([]);
        remainH = availableH;
        curY = pgH - mg.t - headerH;
    };

    for (const block of params.blocks) {
        if (block.type === 'pageBreak') {
            newPage();
            continue;
        }

        // Tables slice row-by-row across pages, mirroring the builder.
        if (block.type === 'table') {
            const plan = planTable(block, enc, mg.l, cw);
            const repeatHeader = block.repeatHeader !== false;
            const totalRows = block.rows.length;

            if (totalRows === 0) {
                const totalH = plan.captionHeight + plan.headerHeight + plan.trailerSpacing;
                if (totalH > remainH && pages[pages.length - 1].length > 0) newPage();
                pages[pages.length - 1].push({ type: 'table', page: pages.length - 1, x: mg.l, top: curY, width: cw, height: totalH });
                remainH -= totalH;
                curY -= totalH;
                continue;
            }

            let rowIdx = 0;
            let isFirstSlice = true;
            while (rowIdx < totalRows) {
                const drawCaption = isFirstSlice;
                const drawHeader = isFirstSlice || repeatHeader;
                const tCapH = drawCaption ? plan.captionHeight : 0;
                const tHdrH = drawHeader ? plan.headerHeight : 0;
                const availableForRows = remainH - tCapH - tHdrH - plan.trailerSpacing;

                let usedH = 0;
                let count = 0;
                while (rowIdx + count < totalRows && usedH + plan.rowHeights[rowIdx + count] <= availableForRows) {
                    usedH += plan.rowHeights[rowIdx + count];
                    count++;
                }

                if (count === 0 && pages[pages.length - 1].length > 0) {
                    newPage();
                    continue;
                }
                if (count === 0) count = 1;

                rowIdx += count;
                const isFinalSlice = rowIdx >= totalRows;
                const sliceH = tCapH + tHdrH + usedH + (isFinalSlice ? plan.trailerSpacing : 0);

                pages[pages.length - 1].push({ type: 'table', page: pages.length - 1, x: mg.l, top: curY, width: cw, height: sliceH });
                remainH -= sliceH;
                curY -= sliceH;
                isFirstSlice = false;

                if (!isFinalSlice) newPage();
            }
            continue;
        }

        const blockH = estimateBlockHeight(block, enc, cw);
        if (blockH > remainH && pages[pages.length - 1].length > 0) newPage();

        pages[pages.length - 1].push({ type: block.type, page: pages.length - 1, x: mg.l, top: curY, width: cw, height: blockH });
        remainH -= blockH;
        curY -= blockH;
    }

    const inspectedPages: InspectedPage[] = pages.map((blocks, index) => ({ index, blocks }));

    return {
        pageWidth: pgW,
        pageHeight: pgH,
        margins: { t: mg.t, r: mg.r, b: mg.b, l: mg.l },
        totalPages: Math.max(1, pages.length),
        pages: inspectedPages,
    };
}
