# Charts (native vector)

> **New in v1.6.0.** Render bar, horizontal-bar, line, pie, and donut charts as
> **pure PDF path operators** — rectangles, line segments, and cubic-Bézier
> arcs. Zero dependencies, no rasterisation, no image embedding. Charts are
> crisp at any zoom, searchable (labels are real text), and PDF/A-safe.

## TL;DR

```ts
import { buildDocumentPDFBytes } from 'pdfnative';

const pdf = buildDocumentPDFBytes({
  title: 'Report',
  blocks: [
    {
      type: 'chart',
      chartType: 'bar',
      title: 'Quarterly revenue vs cost',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { label: 'Revenue', values: [120, 150, 170, 140] },
        { label: 'Cost',    values: [80, 90, 100, 95] },
      ],
    },
  ],
});
```

Add a `chart` block anywhere in a document's `blocks` array, like a heading,
paragraph, or table.

## Chart types

| `chartType` | Shape | Series |
|-------------|-------|--------|
| `'bar'`     | Vertical grouped bars | 1+ |
| `'barH'`    | Horizontal grouped bars | 1+ |
| `'line'`    | Multi-series line, optional markers | 1+ |
| `'pie'`     | Pie | exactly 1 |
| `'donut'`   | Donut (pie with a hole) | exactly 1 |

## The `ChartBlock`

```ts
interface ChartBlock {
  type: 'chart';
  chartType: 'bar' | 'barH' | 'line' | 'pie' | 'donut';
  series: { label: string; values: number[]; color?: PdfColor }[];
  categories?: string[];        // x-axis / slice labels; defaults to 1-based indices
  width?: number;               // plot width in pt (clamped to content width). Default 460
  height?: number;              // plot-area height in pt. Default 240
  title?: string;
  legend?: 'bottom' | 'none';   // default: shown for multi-series / pie
  axis?: { yMin?: number; yMax?: number; ticks?: number; grid?: boolean };
  markers?: boolean;            // line only. Default false
  colors?: PdfColor[];          // palette override (per series / per slice)
  align?: 'left' | 'center' | 'right';
  altText?: string;             // tagged-PDF /Figure /Alt (auto-generated if omitted)
}
```

Colours accept the same forms as the rest of pdfnative — `'#4e79a7'`,
`[78, 121, 167]`, or a PDF RGB string — and are validated (injection-safe). When
omitted, a built-in 8-colour categorical palette is used deterministically.

## Examples

### Multi-series line with markers

```ts
{
  type: 'chart', chartType: 'line', markers: true,
  categories: ['Jan', 'Feb', 'Mar', 'Apr'],
  series: [
    { label: 'Free', values: [10, 25, 22, 40] },
    { label: 'Paid', values: [3, 8, 12, 18] },
  ],
}
```

### Donut with a custom palette

```ts
{
  type: 'chart', chartType: 'donut', title: 'Traffic sources',
  categories: ['Organic', 'Referral', 'Direct', 'Social'],
  colors: ['#59a14f', '#4e79a7', '#f28e2b', '#e15759'],
  series: [{ label: 'Share', values: [55, 20, 15, 10] }],
}
```

### Negative values

Bar and line charts anchor at a zero baseline, so negative values render below
the axis automatically:

```ts
{ type: 'chart', chartType: 'bar', categories: ['Jan', 'Feb', 'Mar'],
  series: [{ label: 'Net flow', values: [30, -15, 20] }] }
```

## Accessibility (tagged PDF)

In tagged mode (`{ tagged: true }` or a PDF/A profile), each chart is emitted as
a `/Figure` structure element with an `/Alt` description. Provide `altText` for a
meaningful summary; otherwise a deterministic one is generated
(`"bar chart: 2 series, 4 categories"`). Charts use solid fills only — no
transparency — so they are **PDF/A-safe**.

## Internationalised labels

All chart text (title, axis ticks, category labels, legend, slice percentages)
flows through pdfnative's standard text pipeline, so CJK, Arabic/RTL, and emoji
labels shape correctly when the matching font is registered — no extra work.

## Limits & scope (v1.6.0)

- **In:** bar, horizontal bar, multi-series line (straight segments + optional
  markers), pie, donut; linear value axis with "nice" ticks; category axis;
  gridlines; legend; negative values.
- **Out (planned):** stacked bars, area, scatter, secondary/log/time axes,
  rotated axis labels (long labels are middle-truncated with `…`), per-point
  data labels.
- A hard guard rejects charts with more than **10,000** total data points.

## See also

- [Tables](tables.html) — tabular data blocks
- [SVG rendering](../guides/architecture.html) — arbitrary vector paths
- [Accessibility](accessibility.html) — tagged PDF / PDF-UA
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
