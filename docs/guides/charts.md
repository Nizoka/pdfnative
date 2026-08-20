# Charts (native vector)

> **New in v1.6.0, extended in v1.7.0.** Render bar, horizontal-bar, stacked-bar,
> line, area, scatter, pie, and donut charts as **pure PDF path operators** —
> rectangles, line segments, and cubic-Bézier arcs. Zero dependencies, no
> rasterisation, no image embedding. Charts are crisp at any zoom, searchable
> (labels are real text), and PDF/A-safe.

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
| `'stackedBar'` (v1.7.0) | Vertical stacked bars (positive and negative running totals stack separately) | 1+ |
| `'stackedBarH'` (v1.7.0) | Horizontal stacked bars | 1+ |
| `'area'` (v1.7.0) | Line closed to the zero baseline, opaque tinted fill | 1+ |
| `'scatter'` (v1.7.0) | X/Y point markers positioned by `xValues` | 1+ |

## The `ChartBlock`

```ts
interface ChartBlock {
  type: 'chart';
  chartType: 'bar' | 'barH' | 'line' | 'pie' | 'donut'
    | 'stackedBar' | 'stackedBarH' | 'area' | 'scatter';    // last four: v1.7.0
  series: {
    label: string;
    values: number[];
    color?: PdfColor;
    xValues?: (number | string)[]; // x positions for scatter / linear / time x-axes (v1.7.0)
    yAxis?: 'left' | 'right';      // bind the series to the secondary right axis (v1.7.0)
  }[];
  categories?: string[];        // x-axis / slice labels; defaults to 1-based indices
  width?: number;               // plot width in pt (clamped to content width). Default 460
  height?: number;              // plot-area height in pt. Default 240
  title?: string;
  legend?: 'bottom' | 'none';   // default: shown for multi-series / pie
  axis?: { yMin?: number; yMax?: number; ticks?: number; grid?: boolean;
           scale?: 'linear' | 'log' };                      // scale: v1.7.0
  axis2?: { yMin?: number; yMax?: number; ticks?: number;
            scale?: 'linear' | 'log' };                     // right value axis (v1.7.0)
  xAxis?: { type?: 'category' | 'linear' | 'time';          // v1.7.0
            min?: number | string; max?: number | string;
            ticks?: number; grid?: boolean };
  dataLabels?: boolean                                      // v1.7.0
    | { decimals?: number; prefix?: string; suffix?: string };
  labelStride?: number;         // draw every Nth category label. Default: auto (v1.7.0)
  labelRotation?: number;       // rotate category labels 0–90 degrees (v1.7.0)
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

### Stacked bars (v1.7.0)

Positive and negative values stack in separate running totals per category, so
mixed-sign data reads correctly:

```ts
{
  type: 'chart', chartType: 'stackedBar',
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { label: 'EMEA', values: [40, 55, 60, 52] },
    { label: 'APAC', values: [25, 30, 35, 41] },
    { label: 'AMER', values: [50, 48, 62, 70] },
  ],
}
```

### Area with data labels (v1.7.0)

The area fill is the series colour mixed 35 % toward white — an **opaque
tint**, not transparency, so area charts remain PDF/A-safe (PDF/A-1b forbids
`/ExtGState` alpha):

```ts
{
  type: 'chart', chartType: 'area',
  categories: ['Jan', 'Feb', 'Mar', 'Apr'],
  dataLabels: { suffix: ' k€', decimals: 1 },
  series: [{ label: 'ARR', values: [10.4, 12.1, 13.8, 16.2] }],
}
```

`dataLabels: true` reuses the axis tick formatter; the object form controls
`decimals` and adds a `prefix`/`suffix`.

### Scatter on a time axis (v1.7.0)

`scatter` positions each point by `xValues` (required). On `xAxis.type: 'time'`,
`xValues` accepts ISO-8601 strings or epoch milliseconds; tick positions and
labels are computed with **UTC getters only** — never `Intl` or the host time
zone — so output bytes are identical on every machine:

```ts
{
  type: 'chart', chartType: 'scatter',
  xAxis: { type: 'time', grid: true },
  series: [{
    label: 'Deploys',
    xValues: ['2026-01-05', '2026-02-14', '2026-03-02', '2026-04-20'],
    values: [3, 7, 5, 11],
  }],
}
```

`line` and `area` charts may also opt into a `'linear'` or `'time'` x-axis;
`bar` variants stay categorical.

### Dual value axes & log scale (v1.7.0)

Bind a series to a secondary right axis with `yAxis: 'right'` and configure its
range with `axis2`. The right axis (and its gutter) appears only when at least
one series binds to it. Either axis can switch to `scale: 'log'` (decade
ticks); log scales require strictly positive values and cannot be combined
with stacked charts:

```ts
{
  type: 'chart', chartType: 'line', markers: true,
  categories: ['2023', '2024', '2025', '2026'],
  axis2: { scale: 'log' },
  series: [
    { label: 'Revenue (k€)', values: [120, 150, 170, 140] },
    { label: 'Requests/day', values: [900, 8000, 65000, 400000], yAxis: 'right' },
  ],
}
```

### Crowded category labels (v1.7.0)

Long or numerous x-labels no longer collide (issue #67). By default the engine
measures every label and draws every *N*th one — the smallest stride at which
labels no longer overlap (`1` when everything fits, so existing charts are
unchanged). Override with `labelStride` (`1` forces every label), or rotate
instead:

```ts
{
  type: 'chart', chartType: 'bar',
  categories: ['January', 'February', 'March', 'April', 'May', 'June'],
  labelRotation: 45,   // 0–90° counter-clockwise, right-aligned to the tick
  series: [{ label: 'Signups', values: [12, 18, 14, 22, 19, 27] }],
}
```

Rotated labels read upward toward their tick; setting `labelRotation` disables
the automatic stride (rotation defeats horizontal overlap on its own) unless
`labelStride` is also set. Both options apply to category axes only —
`scatter` charts reject them.

## Accessibility (tagged PDF)

In tagged mode (`{ tagged: true }` or a PDF/A profile), each chart is emitted as
a `/Figure` structure element with an `/Alt` description. Provide `altText` for a
meaningful summary; otherwise a deterministic one is generated
(`"bar chart: 2 series, 4 categories"`). Charts use solid fills only — no
transparency — so they are **PDF/A-safe**. That includes area charts: the fill
is an opaque tint (series colour mixed toward white), never `/ExtGState` alpha.

## Internationalised labels

All chart text (title, axis ticks, category labels, legend, slice percentages)
flows through pdfnative's standard text pipeline, so CJK, Arabic/RTL, and emoji
labels shape correctly when the matching font is registered — no extra work.

## Limits & scope (v1.7.0)

- **In:** bar, horizontal bar, stacked bar (both orientations), multi-series
  line (straight segments + optional markers), area, scatter, pie, donut;
  linear and log value axes with "nice"/decade ticks; secondary right value
  axis; category, linear, and time (UTC-deterministic) x-axes; gridlines;
  legend; negative values; per-point data labels; automatic label stride and
  0–90° label rotation.
- **Out (planned):** curved (spline) line interpolation, error bars, bubble
  sizing, combined chart types in one plot.
- A hard guard rejects charts with more than **10,000** total data points.
- Validation is strict and throws before any bytes are produced: log scales
  reject non-positive values (and stacked charts), `scatter` requires
  `xValues` on every series, `xValues` lengths must match `values`,
  `'linear'`/`'time'` x-axes apply only to line/area/scatter, date strings in
  `xValues` require `xAxis.type: 'time'`, `yAxis: 'right'` is cartesian-only,
  and `labelStride`/`labelRotation` apply to category axes only.

## See also

- [Tables](tables.html) — tabular data blocks
- [SVG rendering](../guides/architecture.html) — arbitrary vector paths
- [Accessibility](accessibility.html) — tagged PDF / PDF-UA
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
