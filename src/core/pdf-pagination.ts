/**
 * pdfnative — Shared pagination planner (v1.8.0)
 * ================================================
 * The single implementation of "which block lands on which page, and where".
 *
 * Until v1.8.0 this logic existed twice: once as a closure inside the
 * document builder, once re-implemented in `inspectDocumentLayout()`. The two
 * shared only their measurement primitives, and were kept in step by hand —
 * which they were not: the inspector called `estimateBlockHeight()` without
 * the heading list and never ran the builder's multi-pass loop, so a document
 * containing a table of contents measured that block as 0 pt and reported
 * fewer pages than the built PDF (issue #75).
 *
 * One planner now serves both. The builder consumes {@link PaginationResult.pages};
 * the inspector consumes {@link PaginationResult.planned}, the same placements
 * with their geometry attached. Neither can drift from the other again.
 *
 * @module core/pdf-pagination
 */

import type { DocumentBlock, TableBlock, ParagraphBlock } from '../types/pdf-document-types.js';
import type { EncodingContext, TypographyOptions } from '../types/pdf-types.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import type { TableSlice, ParagraphSlice, HeadingDestination } from './pdf-renderers.js';
import { estimateBlockHeight, planTable, planParagraph } from './pdf-renderers.js';
import { FT_H } from './pdf-layout.js';

/**
 * Synthetic block produced when a table is sliced across pages. Carries the
 * original {@link TableBlock} plus the pre-computed slice the renderer
 * consumes. Internal only — never appears in the public `DocumentBlock` union.
 */
export interface TableSliceItem {
    readonly type: '__tableSlice';
    readonly block: TableBlock;
    readonly slice: TableSlice;
}

/**
 * Synthetic block produced when a paragraph breaks across pages. The
 * counterpart of {@link TableSliceItem}, and only ever produced when
 * `typography.splitParagraphs` is on.
 *
 * @since 1.8.0
 */
export interface ParagraphSliceItem {
    readonly type: '__paraSlice';
    readonly block: ParagraphBlock;
    readonly slice: ParagraphSlice;
}

/** Any item the paginator can place on a page. */
export type PaginatedItem = DocumentBlock | TableSliceItem | ParagraphSliceItem;

/** A placement plus the geometry the inspector reports. */
export interface PlannedItem {
    /** What the renderer consumes. */
    readonly item: PaginatedItem;
    /** The originating block's type — `'table'` for a slice. */
    readonly type: string;
    /** 0-based page index. */
    readonly page: number;
    /** Y of the item's top edge, in points (y increases upward). */
    readonly top: number;
    /** Content width available to the item, in points. */
    readonly width: number;
    /** Height the planner reserved for the item, in points. */
    readonly height: number;
}

/** Geometry and context a pagination pass needs. */
export interface PaginationInput {
    readonly blocks: readonly DocumentBlock[];
    /** Document title — reserves the first page's title band when present. */
    readonly title?: string;
    readonly enc: EncodingContext;
    /** Page height in points. */
    readonly pgH: number;
    /** Resolved margins. */
    readonly mg: { readonly t: number; readonly r: number; readonly b: number; readonly l: number };
    /** Content width in points. */
    readonly cw: number;
    /** Reserved header height (0 when no header template). */
    readonly headerH: number;
    /** Opt-in typographic controls. Omitted, every block stays atomic. */
    readonly typography?: TypographyOptions;
}

/** Resolved typography settings, with the documented defaults applied. */
interface Typography {
    readonly splitParagraphs: boolean;
    readonly orphans: number;
    readonly widows: number;
    readonly keepHeadingsWithNext: boolean;
}

function resolveTypography(opts: TypographyOptions | undefined): Typography {
    return {
        splitParagraphs: opts?.splitParagraphs === true,
        orphans: Math.max(1, Math.floor(opts?.orphans ?? 2)),
        widows: Math.max(1, Math.floor(opts?.widows ?? 2)),
        keepHeadingsWithNext: opts?.keepHeadingsWithNext === true,
    };
}

export interface PaginationResult {
    /** Page-by-page items, as the renderer wants them. */
    readonly pages: PaginatedItem[][];
    /** The same placements with geometry, as the inspector wants them. */
    readonly planned: PlannedItem[][];
    /** Heading destinations collected during the pass, in document order. */
    readonly headings: HeadingDestination[];
}

/** Title line height plus its underline spacing, reserved on page 0. */
const TITLE_BAND_H = 22 + 12;

/**
 * Run one pagination pass.
 *
 * @param input     Geometry and content to lay out.
 * @param headingsIn Heading destinations from a previous pass. A `toc` block
 *   measures as 0 pt without them, which is why the multi-pass loop in
 *   {@link paginateDocument} exists — call that rather than this directly
 *   unless you specifically want a single pass.
 */
export function paginatePass(
    input: PaginationInput,
    headingsIn?: readonly HeadingDestination[],
): PaginationResult {
    const { blocks, enc, pgH, mg, cw, headerH } = input;
    const typo = resolveTypography(input.typography);
    const availableH = pgH - mg.t - mg.b - FT_H - headerH;
    // Guards against a line being pushed to the next page by floating-point
    // noise when it fits exactly.
    const EPS = 1e-9;

    const pages: PaginatedItem[][] = [[]];
    const planned: PlannedItem[][] = [[]];
    const headings: HeadingDestination[] = [];
    let remainH = availableH;
    let headingIdx = 0;
    // Y of the next item's top edge on the current page.
    let curY = pgH - mg.t - headerH;

    const newPage = (): void => {
        pages.push([]);
        planned.push([]);
        remainH = availableH;
        curY = pgH - mg.t - headerH;
    };

    const place = (item: PaginatedItem, type: string, height: number): void => {
        pages[pages.length - 1].push(item);
        planned[planned.length - 1].push({
            item,
            type,
            page: pages.length - 1,
            top: curY,
            width: cw,
            height,
        });
        remainH -= height;
        curY -= height;
    };

    if (input.title) {
        remainH -= TITLE_BAND_H;
        curY -= TITLE_BAND_H;
    }

    /** Whether a paragraph may break across pages. */
    const isSplittable = (b: ParagraphBlock): boolean => b.splittable ?? typo.splitParagraphs;

    /** Whether a block must not be stranded as the last item on its page. */
    const keepsWithNext = (b: DocumentBlock): boolean => {
        if (b.type === 'heading') return b.keepWithNext ?? typo.keepHeadingsWithNext;
        if (b.type === 'paragraph') return b.keepWithNext === true;
        return false;
    };

    /**
     * Height of the smallest piece of a block that the splitters below would
     * actually agree to place at the foot of a page: the first `orphans`
     * lines of a splittable paragraph (when enough lines remain for the
     * widow rule, else the whole paragraph), a table's caption plus header
     * plus first row plus trailer, otherwise the whole block. Used by
     * keep-with-next so a heading is only pushed over when its successor
     * genuinely cannot follow — and never held back when it cannot.
     *
     * The figure must match the splitters exactly: reserving less than they
     * demand lets the heading stay while the paragraph walks to the next
     * page, which is the stranding the rule exists to prevent.
     */
    const leadHeight = (b: DocumentBlock): number => {
        if (b.type === 'paragraph' && isSplittable(b)) {
            const plan = planParagraph(b, enc, cw);
            const total = plan.lines.length;
            if (total === 0) return plan.trailerSpacing;
            const canSplit = total - typo.orphans >= typo.widows;
            return canSplit
                ? typo.orphans * plan.lineH
                : total * plan.lineH + plan.trailerSpacing;
        }
        if (b.type === 'table') {
            const plan = planTable(b, enc, mg.l, cw);
            const firstRow = b.rows.length > 0 ? plan.rowHeights[0] : 0;
            return plan.captionHeight + plan.headerHeight + firstRow + plan.trailerSpacing;
        }
        return estimateBlockHeight(b, enc, cw, headingsIn);
    };

    for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        if (block.type === 'pageBreak') {
            newPage();
            continue;
        }

        // Tables slice row-by-row across pages, with optional header repetition
        // and one shared `/Table` struct accumulator threaded through every
        // slice so a split table stays a single structure element.
        if (block.type === 'table') {
            const plan = planTable(block, enc, mg.l, cw);
            const repeatHeader = block.repeatHeader !== false; // default true
            const sharedAccum: (StructElement | MCRef)[] = [];
            const totalRows = block.rows.length;
            let rowIdx = 0;
            let isFirstSlice = true;

            // Empty-rows table: still emit caption + header + trailer on one slice.
            if (totalRows === 0) {
                const totalH = plan.captionHeight + plan.headerHeight + plan.trailerSpacing;
                if (totalH > remainH && pages[pages.length - 1].length > 0) newPage();
                place({
                    type: '__tableSlice',
                    block,
                    slice: {
                        plan,
                        fromRow: 0,
                        toRow: 0,
                        drawCaption: true,
                        drawHeader: true,
                        isFinalSlice: true,
                        tableStructAccum: sharedAccum,
                    },
                }, 'table', totalH);
                continue;
            }

            while (rowIdx < totalRows) {
                const drawCaption = isFirstSlice;
                const drawHeader = isFirstSlice || repeatHeader;
                const tCapH = drawCaption ? plan.captionHeight : 0;
                const tHdrH = drawHeader ? plan.headerHeight : 0;
                const availableForRows = remainH - tCapH - tHdrH - plan.trailerSpacing;

                let usedH = 0;
                let count = 0;
                while (
                    rowIdx + count < totalRows
                    && usedH + plan.rowHeights[rowIdx + count] <= availableForRows
                ) {
                    usedH += plan.rowHeights[rowIdx + count];
                    count++;
                }

                // No rows fit AND the page has prior content → move to a new page.
                if (count === 0 && pages[pages.length - 1].length > 0) {
                    newPage();
                    continue;
                }
                // No rows fit even on a fresh page (a single row taller than the
                // page): force one row through; clipCells clips the overflow.
                if (count === 0) count = 1;

                const fromRow = rowIdx;
                const toRow = rowIdx + count;
                rowIdx = toRow;
                const isFinalSlice = rowIdx >= totalRows;
                const sliceH = tCapH + tHdrH + usedH + (isFinalSlice ? plan.trailerSpacing : 0);

                place({
                    type: '__tableSlice',
                    block,
                    slice: {
                        plan,
                        fromRow,
                        toRow,
                        drawCaption,
                        drawHeader,
                        isFinalSlice,
                        tableStructAccum: sharedAccum,
                    },
                }, 'table', sliceH);

                isFirstSlice = false;
                if (!isFinalSlice) newPage();
            }
            continue;
        }

        // Paragraphs break at line boundaries when asked to, the way tables
        // have always broken at row boundaries. Off by default, so the
        // historical atomic path below stays byte-identical.
        if (block.type === 'paragraph' && isSplittable(block)) {
            const plan = planParagraph(block, enc, cw);
            const total = plan.lines.length;
            if (total === 0) {
                place(block, 'paragraph', plan.trailerSpacing);
                continue;
            }

            const accum: MCRef[] = [];
            let lineIdx = 0;
            while (lineIdx < total) {
                const remaining = total - lineIdx;
                const hasPrior = pages[pages.length - 1].length > 0;
                let fit = Math.max(0, Math.floor((remainH + EPS) / plan.lineH));

                if (fit >= remaining) {
                    // The rest of the paragraph fits — if its trailer does too.
                    if (remainH + EPS >= remaining * plan.lineH + plan.trailerSpacing) {
                        place({
                            type: '__paraSlice',
                            block,
                            slice: { plan, fromLine: lineIdx, toLine: total, isFinalSlice: true, paraStructAccum: accum },
                        }, 'paragraph', remaining * plan.lineH + plan.trailerSpacing);
                        lineIdx = total;
                        break;
                    }
                    fit = remaining - 1; // carry the last line over so the trailer fits
                }

                if (fit > 0) {
                    // Widows: never leave fewer than N lines for the next page.
                    if (remaining - fit < typo.widows) fit = remaining - typo.widows;
                    // Orphans: never strand fewer than N lines at the foot.
                    if (fit < typo.orphans) fit = 0;
                }

                if (fit <= 0) {
                    // Move the whole paragraph over; on a fresh page force one
                    // line through rather than loop forever.
                    if (hasPrior) { newPage(); continue; }
                    fit = 1;
                }

                place({
                    type: '__paraSlice',
                    block,
                    slice: { plan, fromLine: lineIdx, toLine: lineIdx + fit, isFinalSlice: false, paraStructAccum: accum },
                }, 'paragraph', fit * plan.lineH);
                lineIdx += fit;
                newPage();
            }
            continue;
        }

        const blockH = estimateBlockHeight(block, enc, cw, headingsIn);

        // Keep-with-next: a block that would be stranded as the last item on
        // its page moves over together with the block it introduces.
        let required = blockH;
        if (keepsWithNext(block)) {
            const next = bi + 1 < blocks.length ? blocks[bi + 1] : undefined;
            // An explicit page break after it makes the pairing meaningless.
            if (next && next.type !== 'pageBreak') required += leadHeight(next);
        }

        if (required > remainH && pages[pages.length - 1].length > 0) newPage();

        // A heading's destination is its top edge, recorded before the pen moves.
        if (block.type === 'heading') {
            headings.push({
                destName: `toc_h_${headingIdx++}`,
                text: block.text,
                level: block.level,
                pageIndex: pages.length - 1,
                y: curY,
            });
        }

        place(block, block.type, blockH);
    }

    return { pages, planned, headings };
}

/**
 * Paginate a document, converging the table of contents.
 *
 * A `toc` block's height depends on the headings it lists, and those headings'
 * page numbers depend on the space the table of contents takes — so a single
 * pass cannot be right. Pass 1 collects the headings with the block measured
 * at zero; pass 2 re-paginates with its real height; a third pass runs only if
 * that moved a heading to a different page. Documents without a `toc` block
 * take a single pass and are unaffected.
 */
export function paginateDocument(input: PaginationInput): PaginationResult {
    const hasToc = input.blocks.some(b => b.type === 'toc');
    if (!hasToc) return paginatePass(input);

    const pass1 = paginatePass(input);
    const pass2 = paginatePass(input, pass1.headings);

    const pagesChanged = pass2.headings.some((h, i) =>
        i < pass1.headings.length && h.pageIndex !== pass1.headings[i].pageIndex,
    );
    if (!pagesChanged) return pass2;

    return paginatePass(input, pass2.headings);
}
