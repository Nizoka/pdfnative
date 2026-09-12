/**
 * pdfnative — Layout Inspection (development / tooling aid)
 * ========================================================
 * `inspectDocumentLayout()` reports, without rendering a PDF, how the document
 * builder will paginate a set of blocks and where each block lands.
 *
 * Since v1.8.0 it does not merely reuse the builder's measurement primitives —
 * it runs the builder's own planner (`pdf-pagination.ts`). Before that it
 * re-implemented pagination, and the two drifted: the inspector measured
 * heights without the heading list, so a `toc` block came out as 0 pt, and it
 * ran a single pass where the builder runs up to three. A document with a
 * table of contents therefore under-reported its page count (issue #75).
 * Sharing the planner makes that class of bug unrepresentable.
 *
 * This is read-only and deterministic — ideal for debugging layout issues,
 * writing layout assertions in tests, or driving higher-level tooling.
 *
 * @since 1.5.0
 */

import type { PdfLayoutOptions, FontEntry, LayoutInspection, InspectedBlock, InspectedPage } from '../types/pdf-types.js';
import type { DocumentParams } from '../types/pdf-document-types.js';
import { createEncodingContext, applyDocumentFeatures, applyDocumentKerning } from './encoding-context.js';
import { resolvePdfAConfig } from './pdf-tags.js';
import { paginateDocument } from './pdf-pagination.js';
import { prepareBlocks } from './pdf-typography.js';
import { PG_W, PG_H, DEFAULT_MARGINS, HEADER_H } from './pdf-layout.js';

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
    const encBase = createEncodingContext(fontEntries, tagged, layout?.normalize ?? false, layout?.typography?.metrics);
    const encFeat = applyDocumentFeatures(encBase, layout?.typography?.fontFeatures);
    const enc = applyDocumentKerning(encFeat, layout?.typography?.kerning);

    const headerH = layout?.headerTemplate ? HEADER_H : 0;

    const { planned } = paginateDocument({
        blocks: prepareBlocks(params.blocks, layout?.typography),
        title: params.title,
        enc,
        pgH,
        mg,
        cw,
        headerH,
        typography: layout?.typography,
    });

    const inspectedPages: InspectedPage[] = planned.map((items, index) => ({
        index,
        blocks: items.map((p): InspectedBlock => ({
            type: p.type,
            page: p.page,
            x: mg.l,
            top: p.top,
            width: p.width,
            height: p.height,
        })),
    }));

    return {
        pageWidth: pgW,
        pageHeight: pgH,
        margins: { t: mg.t, r: mg.r, b: mg.b, l: mg.l },
        totalPages: Math.max(1, planned.length),
        pages: inspectedPages,
    };
}
