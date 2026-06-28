# Outlines & page labels

> **New in v1.4.0.** Give long documents a navigable **bookmark tree**
> (`/Outlines`) and **logical page numbering** (`/PageLabels`) — roman-numbered
> front matter, prefixed appendices, custom starting numbers. Both are opt-in
> `DocumentParams` fields and add zero overhead when unused.

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';

const bytes = buildDocumentPDFBytes({
  title: 'Annual Report',
  outline: 'auto',                       // bookmarks derived from headings
  pageLabels: [
    { startPage: 1, style: 'roman' },    // i, ii, iii … (front matter)
    { startPage: 4, style: 'decimal' },  // 1, 2, 3 … (body)
  ],
  blocks: [
    { type: 'heading', level: 1, text: 'Overview' },
    { type: 'paragraph', text: '…' },
    { type: 'heading', level: 2, text: 'Highlights' },
    { type: 'paragraph', text: '…' },
  ],
});
```

## Document outline (bookmarks)

The outline appears in the viewer's sidebar / bookmarks panel and lets readers
jump straight to a section. Set `DocumentParams.outline` to either `'auto'` or
an explicit nested tree.

### Automatic outline from headings

```ts
outline: 'auto'
```

pdfnative walks your `HeadingBlock`s and builds a nested tree by heading level
(`level: 1` → top level, `level: 2` → child, …), each bookmark linking to the
page the heading lands on. This is the zero-effort option for structured
reports.

### Explicit outline

For full control over titles, nesting, ordering, styling, and destinations,
pass an array of `OutlineItem`:

```ts
import type { OutlineItem } from 'pdfnative';

const outline: OutlineItem[] = [
  {
    title: 'Part I — Introduction',
    page: 0,            // 0-based page index
    bold: true,
    children: [
      { title: 'Background', page: 0 },
      { title: 'Scope',      page: 1 },
    ],
  },
  {
    title: 'Part II — Results',
    page: 2,
    color: [0.1, 0.3, 0.9], // RGB 0–1; also accepts '#1a4fd6'
    children: [
      { title: 'Findings', page: 2, italic: true },
    ],
  },
];
```

| `OutlineItem` field | Type | Description |
|---|---|---|
| `title` | `string` | Bookmark label (encoded as PDF text, UTF-16BE when needed) |
| `page` | `number` | 0-based page index to jump to |
| `y` | `number?` | Optional vertical destination (PDF user units from the bottom); defaults to the top of the page |
| `bold` | `boolean?` | Render the label bold (`/F` flag 2) |
| `italic` | `boolean?` | Render the label italic (`/F` flag 1) |
| `color` | `PdfColor?` | Label colour (`/C`) — `[r,g,b]` 0–1 or a hex string |
| `children` | `OutlineItem[]?` | Nested bookmarks |

Destinations use `/XYZ` with the page's top-left as the default anchor, so the
viewer scrolls the target page into view at 100 % zoom.

## Page labels

By default a viewer numbers pages `1, 2, 3 …`. `/PageLabels` overrides that with
*logical* numbering — front matter in lowercase roman, the body in decimal,
appendices with an `A-` prefix, and so on. The labels show in the viewer's page
thumbnail / "go to page" box and in printed page references.

```ts
import type { PageLabelRange } from 'pdfnative';

const pageLabels: PageLabelRange[] = [
  { startPage: 0, style: 'roman' },                 // i, ii, iii
  { startPage: 3, style: 'decimal' },               // 1, 2, 3
  { startPage: 20, style: 'decimal', prefix: 'A-', start: 1 }, // A-1, A-2
];
```

| `PageLabelRange` field | Type | Description |
|---|---|---|
| `startPage` | `number` | 0-based page index where this range begins |
| `style` | `PageLabelStyle?` | `'decimal'` · `'roman'` (i, ii) · `'Roman'` (I, II) · `'alpha'` (a, b) · `'Alpha'` (A, B) · `'none'` (label is the prefix only) |
| `prefix` | `string?` | Text prepended to each label (e.g. `'A-'`) |
| `start` | `number?` | First number in the range (default `1`) |

Ranges must be ordered by `startPage` and stay within the document's page
count — both are validated at the boundary with a descriptive error.

## How it works

- **Outline** — `buildOutlineObjects()`
  ([`src/core/pdf-outline.ts`](https://github.com/Nizoka/pdfnative/blob/main/src/core/pdf-outline.ts))
  emits the `/Outlines` dictionary plus one indirect object per bookmark, wired
  with `/First /Last /Next /Prev /Parent /Count`. The objects are appended as
  trailing indirect objects and the catalog gains `/Outlines N 0 R`.
- **Page labels** — `buildPageLabelsDict()`
  ([`src/core/pdf-page-labels.ts`](https://github.com/Nizoka/pdfnative/blob/main/src/core/pdf-page-labels.ts))
  emits an inline `/PageLabels << /Nums [...] >>` number tree in the catalog, so
  it adds no indirect objects.

Both features are fully additive: a document with neither field is **byte-identical**
to the pre-v1.4.0 output.

## See also

- [Quick start](quickstart.html)
- [PDF manipulation](pdf-manipulation.html) — merge/split/extract
- [Accessibility](accessibility.html) — tagged structure & TOC
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
