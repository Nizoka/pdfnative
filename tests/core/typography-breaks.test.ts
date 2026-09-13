import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, inspectDocumentLayout } from '../../src/index.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { paginateDocument } from '../../src/core/pdf-pagination.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { planParagraph } from '../../src/core/pdf-renderers.js';
import { PG_H, DEFAULT_MARGINS, FT_H } from '../../src/core/pdf-layout.js';
import type { DocumentParams, DocumentBlock } from '../../src/types/pdf-document-types.js';
import type { TypographyOptions } from '../../src/types/pdf-types.js';

// v1.8.0 — paragraph breaking, widows/orphans and keep-with-next.
//
// All opt-in: with `layout.typography` omitted a paragraph stays atomic and
// the output is byte-identical to 1.7.0.

const PINNED = new Date('2026-01-01T00:00:00Z');
const enc = createEncodingContext([], false, false);

const input = (blocks: DocumentBlock[], typography?: TypographyOptions, title?: string) => ({
    blocks, title, enc, pgH: PG_H, mg: { ...DEFAULT_MARGINS }, cw: 495, headerH: 0, typography,
});

/** A paragraph long enough to span several pages on its own. */
function longPara(repeats = 300): DocumentBlock {
    return { type: 'paragraph', text: 'lorem ipsum dolor sit amet consectetur '.repeat(repeats) };
}

/** Count how many slices of `block` the planner produced. */
function sliceCount(res: ReturnType<typeof paginateDocument>): number {
    return res.pages.flat().filter(i => i.type === '__paraSlice').length;
}

describe('splitParagraphs', () => {
    it('is off by default: a paragraph stays atomic', () => {
        const res = paginateDocument(input([longPara()]));
        expect(sliceCount(res)).toBe(0);
        expect(res.pages.flat().filter(i => i.type === 'paragraph').length).toBe(1);
    });

    it('produces byte-identical output when the option is absent or false', () => {
        const params: DocumentParams = { title: 'Doc', blocks: [longPara(120)] };
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: {} });
        const c = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { splitParagraphs: false } });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
        expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
    });

    it('breaks a long paragraph across pages when enabled', () => {
        const res = paginateDocument(input([longPara()], { splitParagraphs: true }));
        expect(sliceCount(res)).toBeGreaterThan(1);
        expect(res.pages.length).toBeGreaterThan(1);
    });

    it('marks exactly one slice as final', () => {
        const res = paginateDocument(input([longPara()], { splitParagraphs: true }));
        const finals = res.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .filter(i => (i as { slice: { isFinalSlice: boolean } }).slice.isFinalSlice);
        expect(finals.length).toBe(1);
    });

    it('covers every line exactly once, in order', () => {
        const res = paginateDocument(input([longPara()], { splitParagraphs: true }));
        const slices = res.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .map(i => (i as { slice: { fromLine: number; toLine: number; plan: { lines: readonly string[] } } }).slice);
        expect(slices[0].fromLine).toBe(0);
        for (let i = 1; i < slices.length; i++) {
            expect(slices[i].fromLine).toBe(slices[i - 1].toLine);
        }
        expect(slices[slices.length - 1].toLine).toBe(slices[0].plan.lines.length);
    });

    it('stops a paragraph taller than a page from overflowing off it', () => {
        // Atomically, a paragraph that does not fit is placed whole and simply
        // runs off the bottom of the page — the overflowing lines are drawn
        // outside the content area and are lost. Splitting is what makes that
        // content reachable.
        const blocks = [longPara(200), longPara(200), longPara(200)];
        const availableH = PG_H - DEFAULT_MARGINS.t - DEFAULT_MARGINS.b - FT_H;

        const atomic = paginateDocument(input(blocks));
        const tallest = Math.max(...atomic.planned.flat().map(p => p.height));
        expect(tallest).toBeGreaterThan(availableH);

        const split = paginateDocument(input(blocks, { splitParagraphs: true }));
        for (const item of split.planned.flat()) {
            expect(item.height).toBeLessThanOrEqual(availableH + 1e-6);
        }
        // And nothing is dropped: every line is still accounted for.
        const placed = split.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .reduce((n, i) => {
                const s = (i as { slice: { fromLine: number; toLine: number } }).slice;
                return n + (s.toLine - s.fromLine);
            }, 0);
        const expected = blocks.reduce((n, b) => n + planParagraph(b as never, enc, 495).lines.length, 0);
        expect(placed).toBe(expected);
    });

    it('honours a per-block splittable override in both directions', () => {
        const on = paginateDocument(input(
            [{ ...longPara(), splittable: true } as DocumentBlock],
        ));
        expect(sliceCount(on)).toBeGreaterThan(1);

        const off = paginateDocument(input(
            [{ ...longPara(), splittable: false } as DocumentBlock],
            { splitParagraphs: true },
        ));
        expect(sliceCount(off)).toBe(0);
    });
});

describe('orphans and widows', () => {
    /** Lines of the paragraph left on each page, page by page. */
    function linesPerPage(typography: TypographyOptions, para: DocumentBlock, filler: DocumentBlock[]): number[] {
        const res = paginateDocument(input([...filler, para], typography));
        return res.pages.map(page => page
            .filter(i => i.type === '__paraSlice')
            .reduce((n, i) => n + ((i as { slice: { fromLine: number; toLine: number } }).slice.toLine
                - (i as { slice: { fromLine: number; toLine: number } }).slice.fromLine), 0));
    }

    // Filler pushes the paragraph's start close to the foot of page 1, so the
    // orphan rule has something to act on.
    const filler = Array.from({ length: 14 }, (): DocumentBlock => ({
        type: 'paragraph', text: 'filler line that occupies vertical space. '.repeat(4),
    }));

    it('never strands fewer than `orphans` lines at the foot of a page', () => {
        const counts = linesPerPage({ splitParagraphs: true, orphans: 3, widows: 1 }, longPara(300), filler);
        for (const n of counts) {
            if (n > 0) expect(n).toBeGreaterThanOrEqual(1);
        }
        // The first page carrying part of the paragraph must carry >= 3 lines,
        // or none at all.
        const firstWith = counts.findIndex(n => n > 0);
        if (firstWith >= 0 && counts[firstWith] < counts.reduce((a, b) => a + b, 0)) {
            expect(counts[firstWith]).toBeGreaterThanOrEqual(3);
        }
    });

    it('never carries fewer than `widows` lines to the next page', () => {
        const para = longPara(300);
        const res = paginateDocument(input([...filler, para], { splitParagraphs: true, orphans: 1, widows: 3 }));
        const slices = res.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .map(i => (i as { slice: { fromLine: number; toLine: number; isFinalSlice: boolean } }).slice);
        const last = slices[slices.length - 1];
        expect(last.toLine - last.fromLine).toBeGreaterThanOrEqual(3);
    });

    it('clamps nonsensical values rather than looping', () => {
        const res = paginateDocument(input([longPara(300)], { splitParagraphs: true, orphans: 0, widows: -5 }));
        expect(sliceCount(res)).toBeGreaterThan(0);
        expect(res.pages.length).toBeLessThan(50);
    });

    it('forces a line through rather than looping on a paragraph taller than a page', () => {
        const res = paginateDocument(input(
            [longPara(1500)],
            { splitParagraphs: true, orphans: 99, widows: 99 },
        ));
        expect(sliceCount(res)).toBeGreaterThan(0);
        const total = res.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .reduce((n, i) => {
                const s = (i as { slice: { fromLine: number; toLine: number } }).slice;
                return n + (s.toLine - s.fromLine);
            }, 0);
        const plan = res.pages.flat()
            .filter(i => i.type === '__paraSlice')
            .map(i => (i as { slice: { plan: { lines: readonly string[] } } }).slice.plan)[0];
        expect(total).toBe(plan.lines.length);
    });
});

describe('keep-with-next', () => {
    /** Blocks that nearly fill page 1, then a heading, then a long body. */
    function doc(typography?: TypographyOptions, headingKeep?: boolean): DocumentParams {
        const filler = Array.from({ length: 17 }, (): DocumentBlock => ({
            type: 'paragraph', text: 'filler paragraph occupying vertical space. '.repeat(4),
        }));
        return {
            title: 'Keep',
            blocks: [
                ...filler,
                { type: 'heading', level: 2, text: 'Stranded heading', keepWithNext: headingKeep },
                { type: 'paragraph', text: 'Body that belongs with the heading above. '.repeat(30) },
            ],
            layout: typography ? { typography } : undefined,
        };
    }

    /** Page index the heading landed on. */
    function headingPage(params: DocumentParams, typography?: TypographyOptions): number {
        const res = paginateDocument(input(params.blocks as DocumentBlock[], typography, params.title));
        return res.headings[0].pageIndex;
    }

    it('is off by default', () => {
        const params = doc();
        const res = paginateDocument(input(params.blocks as DocumentBlock[], undefined, params.title));
        const page = res.headings[0].pageIndex;
        const bodyPage = res.planned.flat().filter(p => p.type === 'paragraph').pop()!.page;
        // Without the rule the heading may well sit alone at the foot.
        expect(bodyPage).toBeGreaterThanOrEqual(page);
    });

    it('moves a heading forward rather than stranding it', () => {
        const params = doc();
        const without = headingPage(params);
        const withKeep = headingPage(params, { keepHeadingsWithNext: true });
        expect(withKeep).toBeGreaterThanOrEqual(without);

        // The heading and the block after it must share a page.
        const res = paginateDocument(input(
            params.blocks as DocumentBlock[], { keepHeadingsWithNext: true }, params.title,
        ));
        const flat = res.planned.flat();
        const hIdx = flat.findIndex(p => p.type === 'heading');
        expect(flat[hIdx + 1].page).toBe(flat[hIdx].page);
    });

    it('lets a block opt out of the document-level rule', () => {
        const params = doc({ keepHeadingsWithNext: true }, false);
        const res = paginateDocument(input(
            params.blocks as DocumentBlock[], { keepHeadingsWithNext: true }, params.title,
        ));
        const flat = res.planned.flat();
        const hIdx = flat.findIndex(p => p.type === 'heading');
        // Opted out, so the pairing is not enforced; the assertion is simply
        // that planning still succeeds and the heading is placed.
        expect(hIdx).toBeGreaterThanOrEqual(0);
        expect(res.pages.length).toBeGreaterThan(1);
    });

    it('ignores the rule when an explicit page break follows', () => {
        const blocks: DocumentBlock[] = [
            { type: 'heading', level: 1, text: 'Last on page', keepWithNext: true },
            { type: 'pageBreak' },
            { type: 'paragraph', text: 'Next page.' },
        ];
        const res = paginateDocument(input(blocks, { keepHeadingsWithNext: true }));
        expect(res.headings[0].pageIndex).toBe(0);
        expect(res.pages.length).toBe(2);
    });

    it('leaves output byte-identical when unused', () => {
        const params = doc();
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { keepHeadingsWithNext: false } });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});

/**
 * keep-with-next and paragraph splitting have to agree on how much of the
 * next paragraph must follow the heading. The 1.8.0 audit found the rule
 * reserved one line while the splitter refused to place fewer than
 * `orphans`, so with both options on — the documented configuration — the
 * paragraph moved over and the heading stayed behind, stranded.
 */
describe('keep-with-next combined with splitParagraphs', () => {
    /** Pages whose last placed item is a heading. */
    function strandedPages(res: ReturnType<typeof paginateDocument>): number[] {
        const out: number[] = [];
        res.planned.forEach((page, i) => {
            const last = page[page.length - 1];
            if (last && last.type === 'heading') out.push(i);
        });
        return out;
    }

    /** Many short sections, so headings land at every position on the page. */
    function sections(count: number, bodyRepeats: number): DocumentBlock[] {
        const out: DocumentBlock[] = [];
        for (let i = 1; i <= count; i++) {
            out.push({ type: 'heading', level: 2, text: `Section ${i}` });
            out.push({ type: 'paragraph', text: 'Body text that belongs with its heading and runs on for a while. '.repeat(bodyRepeats) });
        }
        return out;
    }

    for (const orphans of [1, 2, 3]) {
        for (const widows of [1, 2, 3]) {
            it(`never ends a page with a heading (orphans ${orphans}, widows ${widows})`, () => {
                for (const repeats of [2, 5, 9, 14]) {
                    const res = paginateDocument(input(
                        sections(24, repeats),
                        { splitParagraphs: true, keepHeadingsWithNext: true, orphans, widows },
                        'Keep',
                    ));
                    expect(res.pages.length).toBeGreaterThan(1);
                    expect(strandedPages(res)).toEqual([]);
                }
            });
        }
    }

    it('still splits the paragraph after the heading when it cannot fit whole', () => {
        const res = paginateDocument(input(
            sections(24, 9),
            { splitParagraphs: true, keepHeadingsWithNext: true },
            'Keep',
        ));
        expect(res.pages.flat().filter(i => i.type === '__paraSlice'
            && !(i as { slice: { isFinalSlice: boolean } }).slice.isFinalSlice).length).toBeGreaterThan(0);
    });

    it('reserves at least `orphans` lines of a paragraph that can split', () => {
        const filler = Array.from({ length: 17 }, (): DocumentBlock => ({
            type: 'paragraph', text: 'filler paragraph occupying vertical space. '.repeat(4),
        }));
        for (const orphans of [1, 2, 3, 4]) {
            const body = longPara(60);
            const res = paginateDocument(input(
                [...filler, { type: 'heading', level: 2, text: 'H' }, body],
                { splitParagraphs: true, keepHeadingsWithNext: true, orphans, widows: 1 },
                'Keep',
            ));
            const flat = res.planned.flat();
            const hIdx = flat.findIndex(p => p.type === 'heading');
            const next = flat[hIdx + 1];
            expect(next.page).toBe(flat[hIdx].page);
            const slice = (res.pages.flat().find(i => i.type === '__paraSlice'
                && (i as { block: DocumentBlock }).block === body) as { slice: { fromLine: number; toLine: number } }).slice;
            expect(slice.toLine - slice.fromLine).toBeGreaterThanOrEqual(orphans);
        }
    });

    it('keeps a heading with the table that follows it, trailer included', () => {
        const table: DocumentBlock = {
            type: 'table',
            headers: ['A', 'B'],
            rows: Array.from({ length: 40 }, (_, i) => ({ cells: [`r${i}`, `v${i}`], type: '', pointed: false })),
        };
        // Slide the heading down the page one filler at a time so every
        // remaining height between "table fits whole" and "nothing fits" is hit.
        for (let n = 10; n <= 26; n++) {
            const filler = Array.from({ length: n }, (): DocumentBlock => ({
                type: 'paragraph', text: 'filler line. '.repeat(3),
            }));
            const res = paginateDocument(input(
                [...filler, { type: 'heading', level: 2, text: 'Table heading' }, table],
                { keepHeadingsWithNext: true },
                'Keep',
            ));
            expect(strandedPages(res)).toEqual([]);
        }
    });

    it('shows the fix in a built document', () => {
        const params: DocumentParams = {
            title: 'Keep With Next',
            blocks: sections(12, 2),
        };
        const typography: TypographyOptions = { splitParagraphs: true, keepHeadingsWithNext: true };
        const layout = inspectDocumentLayout(params, { typography });
        for (const page of layout.pages) {
            const last = page.blocks[page.blocks.length - 1];
            expect(last?.type).not.toBe('heading');
        }
    });
});

describe('split paragraphs in built documents', () => {
    const params: DocumentParams = { title: 'Split', blocks: [longPara(600)] };
    const typography: TypographyOptions = { splitParagraphs: true };

    it('produces a readable multi-page PDF', () => {
        const bytes = buildDocumentPDFBytes(params, { creationDate: PINNED, typography });
        const reader = openPdf(bytes);
        expect(reader.pageCount).toBeGreaterThan(1);
    });

    it('keeps a split paragraph as a single /P structure element when tagged', () => {
        const bytes = buildDocumentPDFBytes(
            { ...params, blocks: [longPara(600)] },
            { creationDate: PINNED, typography, tagged: 'pdfa2b', onDiagnostic: () => {} },
        );
        const text = new TextDecoder('latin1').decode(bytes);

        // Page furniture (the footer) is tagged /P too, one per page, so count
        // only the multi-child /P elements: the split paragraph must be the
        // single one, and its marked content must span more than one page.
        const multiChild = text.match(/\/Type \/StructElem \/S \/P [^\n]*\/K \[[^\]]*\]/g) ?? [];
        expect(multiChild.length).toBe(1);

        const paragraphElem = multiChild[0] ?? '';
        const pages = new Set(Array.from(paragraphElem.matchAll(/\/Pg (\d+) 0 R/g), mm => mm[1]));
        expect(pages.size).toBeGreaterThan(1);
    });

    it('is reported identically by the inspector', () => {
        const bytes = buildDocumentPDFBytes(params, { creationDate: PINNED, typography });
        const built = openPdf(bytes).pageCount;
        expect(inspectDocumentLayout(params, { typography }).totalPages).toBe(built);
    });

    it('is deterministic', () => {
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED, typography });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED, typography });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});
