import { describe, it, expect } from 'vitest';
import { planTable } from '../../src/core/pdf-renderers.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { TableBlock } from '../../src/types/pdf-document-types.js';

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
