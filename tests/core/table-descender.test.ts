import { describe, it, expect } from 'vitest';
import { planTable } from '../../src/core/pdf-renderers.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { TableBlock } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import * as notoMyanmar from '../../fonts/noto-myanmar-data.js';

// #59 — multi-line table cells previously reserved `CELL_PAD_BOTTOM + 2` of
// bottom space regardless of the configured `cellPadding`, clipping descenders
// when cellPadding > 3. The fix uses `pad + 2`. Byte-identical at the default
// padding (3), correct for larger paddings.

const enc = createEncodingContext([], false, false);

function tableWithWrap(pad?: number): TableBlock {
    return {
        type: 'table',
        headers: ['Description'],
        rows: [
            { cells: ['This is a very long descriptive cell value that must wrap onto multiple lines inside a narrow column to exercise the multi-line height path.'], type: '', pointed: false },
            { cells: ['short'], type: '', pointed: false },
        ],
        wrap: 'always',
        cellPadding: pad,
    };
}

describe('table descender clipping fix (#59)', () => {
    it('is byte-stable at the default cellPadding (3)', () => {
        const a = planTable(tableWithWrap(), enc, 36, 160);
        const b = planTable(tableWithWrap(3), enc, 36, 160);
        expect(b.rowHeights).toEqual(a.rowHeights);
    });

    it('threads the configured cellPadding into the plan', () => {
        expect(planTable(tableWithWrap(3), enc, 36, 160).pad).toBe(3);
        expect(planTable(tableWithWrap(10), enc, 36, 160).pad).toBe(10);
    });

    it('wrapping row is taller than a single-line row', () => {
        const plan = planTable(tableWithWrap(6), enc, 36, 160);
        expect(plan.rowHeights[0]).toBeGreaterThan(plan.rowHeights[1]);
    });
});

// #80 (1.9.0) — Myanmar subjoined consonants (and other deep-descender
// scripts) descend further than the 3 pt bottom padding the row keeps under
// a single-line cell: the clip rectangle and the bottom border cut them. The
// plan now reserves the deepest descender of the fonts a row uses and the
// renderer lifts the baseline by the same amount; Latin rows reserve nothing.

describe('deep-descender rows (#80)', () => {
    const fontEntries: FontEntry[] = [
        { fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' },
        { fontData: notoMyanmar as unknown as FontData, fontRef: '/F9', lang: 'my' },
    ];
    const uni = createEncodingContext(fontEntries, false, false);
    const stacked = 'ဒ္ဘ'; // DA + subjoined DHA
    const table = (cell: string): TableBlock => ({
        type: 'table',
        headers: ['Col 1'],
        rows: [{ cells: [cell], type: '', pointed: false }],
    });

    it('reserves the Myanmar descender below a single-line cell', () => {
        const plan = planTable(table(stacked), uni, 36, 300);
        const descentPt = Math.abs(notoMyanmar.metrics.descent) / notoMyanmar.metrics.unitsPerEm * plan.fontSize.td;
        expect(descentPt).toBeGreaterThan(3);
        expect(plan.rowDescentExtra[0]).toBeCloseTo(Math.round((descentPt - 3) * 100) / 100, 6);
        expect(plan.rowHeights[0]).toBeCloseTo(12 + plan.rowDescentExtra[0], 6);
    });

    it('reserves nothing for Latin text in the same context, so those rows keep their height', () => {
        const plan = planTable(table('gjpqy'), uni, 36, 300);
        expect(plan.rowDescentExtra[0]).toBe(0);
        expect(plan.rowHeights[0]).toBe(12);
        expect(plan.headerDescentExtra).toBe(0);
    });

    it('lifts the baseline so the deepest glyph clears the cell clip rectangle', () => {
        const pdf = buildDocumentPDFBytes({ blocks: [table(stacked)], fontEntries });
        const reader = openPdf(pdf);
        const page = reader.getPage(0);
        const content = new TextDecoder('latin1').decode(reader.decodeStream(reader.resolveValue(page.get('Contents') ?? null) as never));
        // The data cell: `q x y w h re W n` then `BT /F9 7.5 Tf x baseline Td`.
        const cells = [...content.matchAll(/q [\d.]+ ([\d.]+) [\d.]+ ([\d.]+) re W n\nBT \/F9 7\.5 Tf [\d.]+ ([\d.]+) Td/g)];
        expect(cells.length).toBeGreaterThanOrEqual(1);
        const [, floor, , baseline] = cells[cells.length - 1].map(Number);
        const descentPt = Math.abs(notoMyanmar.metrics.descent) / notoMyanmar.metrics.unitsPerEm * 7.5;
        expect(baseline - descentPt).toBeGreaterThanOrEqual(floor - 0.011);
    });
});
