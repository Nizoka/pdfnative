# Smart tables

> _Backward-compatible with v1.1.0 — existing single-page tables produce byte-identical output._

pdfnative's table renderer is **planner-driven** and **multi-page-safe** by default. Long tables wrap on column overflow, slice cleanly across pages, and reprint their header on every continuation page — matching the behaviour readers expect from commercial PDF libraries.

This guide documents the six `TableBlock` fields, the planner architecture, the tagged-mode contract, and migration tips.

---

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';

const bytes = buildDocumentPDFBytes({
    blocks: [
        {
            type: 'table',
            columns: [
                { key: 'item', label: 'Item', width: 0.6, autoFit: true },
                { key: 'qty', label: 'Qty', width: 0.2, align: 'right' },
                { key: 'price', label: 'Price', width: 0.2, align: 'right' },
            ],
            rows: bigInvoiceRows, // any length
            wrap: 'auto',          // ← new (default)
            repeatHeader: true,    // ← new (default)
            zebra: true,           // ← new (opt-in)
            caption: 'Invoice line items',
            minRowHeight: 14,
            cellPadding: 5,
        },
    ],
});
```

Existing v1.1.0 code with no new fields continues to work and produces **byte-identical** output on single-page tables.

---

## `TableBlock` fields (all optional)

| Field          | Type                            | Default                     | Description                                                                  |
| -------------- | ------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `wrap`         | `'auto' \| 'always' \| 'never'` | `'auto'`                    | Per-cell wrap policy.                                                        |
| `repeatHeader` | `boolean`                       | `true`                      | Reprint the header row at the top of each continuation page.                 |
| `zebra`        | `boolean \| PdfColor`           | `false`                     | Alternating data-row fill. `true` uses `'0.969 0.973 0.984'`.                |
| `caption`      | `string`                        | `undefined`                 | Caption printed once above the first slice.                                  |
| `minRowHeight` | `number` (points)               | `12`                        | Minimum visual row height.                                                   |
| `cellPadding`  | `number` (points)               | `3`                         | Internal cell padding.                                                       |

### `wrap`

- **`'auto'`** (default) — single-line rendering when cell content fits within the column width; wraps on overflow only. This is the GAFAM-grade default — fast typical case, correct edge case.
- **`'always'`** — every cell is run through the word-wrapper. Use when row heights need to be uniform regardless of content length.
- **`'never'`** — v1.1.0 behaviour. Content is clipped at the column boundary. Use when output byte-stability against v1.1.0 is mandatory.

### `repeatHeader`

- **`true`** (default) — header row reprints at the top of every continuation page.
- **`false`** — header appears only once. Set this alongside `wrap: 'never'` to preserve the exact v1.1.0 multi-page rendering shape.

### `zebra`

- **`false`** (default) — no row fill.
- **`true`** — alternating even data rows (1-indexed, so the second row, fourth row, …) are filled with `'0.969 0.973 0.984'` (a soft cool-grey tuned for accessibility contrast).
- A [`PdfColor`](../api.md) — hex (`'#f7f8fa'`), tuple (`[0.97, 0.97, 0.98]`), or PDF-rgb string (`'0.97 0.97 0.98'`) — overrides the default.

### `caption`

- Printed once at the top of the table (above the first slice), using Helvetica 9pt.
- In tagged mode, emitted as a `/Caption` structure element child of `/Table` (ISO 14289-1 §7.10.6).
- Multi-line captions wrap to fit the table width.

### `minRowHeight` / `cellPadding`

- `minRowHeight` enforces a floor so rows look consistent even with short text.
- `cellPadding` is the internal padding around each cell's text. Header padding inherits this but the baseline offset is a fixed v1.1.0-compatible constant (preserves byte-stability for the row body).

---

## `ColumnDef.kind` field (optional)

| Field  | Type       | Default     | Description                                                                                                                                                                                                                  |
| ------ | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind` | `'amount'` | `undefined` | Semantic hint. When set to `'amount'`, data cells in this column render in Helvetica-Bold with credit/debit colouring driven by `row.type`. Replaces the pre-1.2.0 hardcoded `i === 3` heuristic in `renderTable`. |

```ts
{
  type: 'table',
  headers: ['Date', 'Description', 'Status', 'Amount'],
  columns: [
    { f: 0.20, a: 'l', mx: 12, mxH: 12 },
    { f: 0.45, a: 'l', mx: 60, mxH: 60 },
    { f: 0.20, a: 'l', mx: 20, mxH: 20 },
    { f: 0.15, a: 'r', mx: 18, mxH: 18, kind: 'amount' }, // ← opt-in bold + credit/debit colour
  ],
  rows: [
    { cells: ['2026-05-01', 'Salary', 'Cleared', '+3 000.00'], type: 'credit', pointed: false },
    { cells: ['2026-05-03', 'Rent',   'Pending', '-1 250.00'], type: 'debit',  pointed: false },
  ],
}
```

> **Behaviour change for document-builder tables without `kind`.** Previously the renderer applied Helvetica-Bold + credit/debit colour to whichever column happened to be at index 3. The current renderer removes that heuristic — opt in explicitly via `kind: 'amount'`. The legacy `buildPDF()` (financial-statement) path keeps the historical heuristic for byte-identical v1.0/v1.1 output.

---

## How multi-page tables are sliced

pdfnative uses a two-phase pipeline:

1. **Plan phase** — `planTable()` ([src/core/pdf-renderers.ts](https://github.com/Nizoka/pdfnative/blob/main/src/core/pdf-renderers.ts)) measures the entire table once: resolves columns (including `autoFit`), word-wraps each cell according to `wrap`, computes per-row heights, and produces a `TablePlan` containing every row's exact pixel height.
2. **Slice phase** — `_paginateBlocks()` in [src/core/pdf-document.ts](https://github.com/Nizoka/pdfnative/blob/main/src/core/pdf-document.ts) walks the plan greedily: it packs rows onto the current page until the next row would overflow, then emits a `TableSlice` ( `{ fromRow, toRow, drawCaption, drawHeader, isFinalSlice }`) and starts a new page. The caption is emitted once (on the first slice); the header is emitted on every slice when `repeatHeader: true`.

`renderTable()` is page-lifecycle-free — it accepts an optional `slice` parameter and renders exactly the rows the paginator asked for. There is no recursive "if I overflow, start a new page" inside the renderer; pagination decisions are deterministic and centralised.

### Edge cases handled

- **Empty `rows` array** — emits a header-only slice with caption (if any). No crash, no zero-height row.
- **Single row taller than a fresh page** — emitted as a one-row slice; `clipCells` (existing v1.1.0 behaviour) handles vertical overflow inside the cell.
- **No room on current page even after pushing the table to start** — paginator forces a new page and retries.

---

## Tagged-mode / PDF/UA

When the document is built with `tagged: true` (or any explicit PDF/A mode), the table emits the following structure tree:

```text
/Table
├── /Caption       (only when caption is present)
├── /TR  ← header
│   ├── /TH
│   ├── /TH
│   └── /TH
├── /TR  ← data row 1
│   ├── /TD
│   ├── /TD
│   └── /TD
└── /TR  ← data row N
    └── …
```

The structure is **single** even when the table spans multiple pages. `_paginateBlocks()` shares a `tableStructAccum` array across all slices of the same table; the final slice commits it as `{ type: 'Table', children: tableStructAccum }`. Each `/TR` carries the correct `/StructParents` for its page so screen readers reconstruct the logical reading order correctly (ISO 14289-1 §7.10.6).

Repeated headers in `repeatHeader: true` mode are **not** re-emitted in the structure tree — they are visual continuations only. The single `/TR` for the header sits at the top of the `/Table` element.

---

## Tagged-mode + zebra

Zebra fills are decorative — they do not appear in the structure tree. PDF/UA conformance is preserved.

> ⚠️ **PDF/A-1b note.** PDF/A-1b forbids transparency (ISO 19005-1 §6.4). Zebra fills are opaque solid rectangles, so they are safe under PDF/A-1b, but **avoid combining zebra with `pdfa1b` watermarks** that rely on `/ExtGState`. Default `tagged: true` (PDF/A-2b) has no such restriction.

---

## Migration from v1.1.0

> **One unconditional fix.** Right- and centre-aligned **bold header** cells now use Helvetica-Bold metrics for width measurement (Adobe AFM), where pre-1.2.0 they were measured with Helvetica-Regular. This corrects a 2–5pt overshoot per cell that visually clipped the trailing glyph (e.g. the `t` in `Amount`). The fix shifts header glyph positioning by 2–5pt vs v1.1.0 — a genuine correctness improvement, not a regression. There is no opt-out.

| You want…                                       | Setting                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Exact byte-identical v1.1.0 multi-page _body_ output | `wrap: 'never', repeatHeader: false` (header positioning still corrected) |
| Modern default (recommended)                    | Omit all new fields — defaults are correct.                             |
| Invoice / report parity with commercial libs    | `wrap: 'auto', repeatHeader: true, zebra: true, caption: '…'`           |
| Uniform row heights regardless of content       | `wrap: 'always', minRowHeight: 18`                                      |
| Maximum information density                     | `wrap: 'auto', cellPadding: 2, minRowHeight: 10`                        |

---

## Samples shipped

Run `npm run test:generate` to produce:

- `test-output/document/table-wrap-auto.pdf` — wrap-on-overflow demo
- `test-output/document/table-multipage-header-repeat.pdf` — 60-row table across 2+ pages with repeated header
- `test-output/document/table-zebra-caption.pdf` — zebra + caption + min row height
- `test-output/document/table-smart-autofit.pdf` — `autoFit` columns + wrap

Generator: [scripts/generators/document-table-parity.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/document-table-parity.ts).

---

## Reference

- ISO 32000-1:2008 §9 — text rendering and positioning.
- ISO 14289-1:2014 §7.10.6 — tagged-PDF table structure (`/Table`, `/TR`, `/TH`, `/TD`, `/Caption`).
- ISO 19005-2:2011 — PDF/A-2b conformance.

### Internal contracts (for contributors)

- `planTable()` and `TableSlice` live in [src/core/pdf-renderers.ts](https://github.com/Nizoka/pdfnative/blob/main/src/core/pdf-renderers.ts). They are **not** re-exported from the package root. Treat them as internal — they may change without a major bump as long as the public `TableBlock` contract is preserved.
- Single-line row rendering uses `rowTop - rowH + 3` baseline for data and `rowTop - rowH + 4` for headers. These constants (`CELL_PAD_BOTTOM`, `HEADER_PAD_BOTTOM`) preserve byte-stability with v1.1.0 single-page output.
- The default `minRowHeight` (`12`) and default header height (`15`) match v1.1.0's `ROW_H` and `TH_H` constants exactly.

---

## See also

- [Architecture](architecture.md) — overall module layout.
- [PDF/A conformance](pdfa.md) — tagged-mode rules.
- [API reference](https://github.com/Nizoka/pdfnative/blob/main/README.md#api-reference) — full `TableBlock` type.
