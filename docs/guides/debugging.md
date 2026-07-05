# Layout debugging & inspection

> **New in v1.5.0.** Two complementary tools help you understand *where*
> pdfnative places every block on the page: an **opt-in visual overlay**
> (`layout: { debug: true }`) that draws margin / content / cell boxes straight
> onto the PDF, and a **programmatic inspection** API
> (`inspectDocumentLayout()`) that returns the per-page block geometry as plain
> data. Both are byte-neutral: when debug is off, output is **byte-identical**
> to previous releases.

## TL;DR

```ts
import { buildDocumentPDFBytes, inspectDocumentLayout } from 'pdfnative';

const params = {
  title: 'Invoice',
  blocks: [
    { type: 'heading', level: 1, text: 'Invoice #42' },
    { type: 'paragraph', text: 'Thanks for your business.' },
  ],
};

// 1. Visual overlay — margin / content / cell boxes drawn on the PDF
const pdf = buildDocumentPDFBytes(params, { debug: true });

// 2. Programmatic geometry — no rendering, just data
const layout = inspectDocumentLayout(params);
for (const page of layout.pages) {
  for (const block of page.blocks) {
    console.log(page.index, block.type, block.x, block.top, block.width, block.height);
  }
}
```

## Visual overlay

Pass `debug: true` (or a granular object) in the layout options:

```ts
buildDocumentPDFBytes(params, { debug: true });

// or select exactly what you want to see:
buildDocumentPDFBytes(params, {
  debug: { showMargins: true, showContentBounds: true, showCells: false },
});
```

| Option | Colour | Draws |
|---|---|---|
| `showMargins` | blue | the page margin box (content area boundary) |
| `showContentBounds` | red | a rectangle around every rendered block |
| `showCells` | green | per-cell rectangles for tables |

`debug: true` is shorthand for enabling all three. The overlay is drawn **last**,
on top of the content, each shape wrapped in its own graphics state (`q … Q`) so
it never leaks colour or line-width into your document. Turn it off (or omit it)
and the bytes are exactly what you'd get without the option.

## Programmatic inspection

`inspectDocumentLayout(params, layout?)` runs the **same pagination engine** as
the builder but produces data instead of PDF bytes — no rendering, no font
embedding:

```ts
import { inspectDocumentLayout } from 'pdfnative';
import type { LayoutInspection } from 'pdfnative';

const report: LayoutInspection = inspectDocumentLayout(params);

report.pages.forEach((page) => {
  console.log(`Page ${page.index + 1}: ${page.blocks.length} blocks`);
  page.blocks.forEach((b) => {
    console.log(`  ${b.type} @ (${b.x}, ${b.top}) ${b.width}×${b.height}`);
  });
});
```

### Shape

| Type | Fields |
|---|---|
| `LayoutInspection` | `{ pageWidth, pageHeight, margins, totalPages, pages: InspectedPage[] }` |
| `InspectedPage` | `{ index, blocks: InspectedBlock[] }` |
| `InspectedBlock` | `{ type, page, x, top, width, height }` (PDF user-space points, origin bottom-left; `top` is the block's upper edge, `height` extends downward) |

Because it shares the builder's `estimateBlockHeight` / `planTable` logic and
constants, the reported geometry matches where the real renderer places each
block — including table slicing across page breaks.

## When to use which

- **Overlay** — eyeball a single document: "why is this paragraph clipped?",
  "is my table overflowing the margin?" Open the PDF and *see* the boxes.
- **Inspection** — automate it: assert block positions in a test, drive a
  layout linter, or feed geometry to another tool.

## Sample

[layout-debug-overlay.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/layout-debug-overlay.ts)
renders the same document twice — once clean, once with the overlay — and prints
the `inspectDocumentLayout()` report.
