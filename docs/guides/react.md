# pdfnative-react — Declarative JSX Renderer Guide

> **Tracks the latest published `pdfnative-react`** (v1.4.0, requires pdfnative ≥ 1.9.0 — pins `^1.9.0`), with **React 19** and `pdfnative` `^1.9.0` as peer dependencies. Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html). Full history: [pdfnative-react releases](https://github.com/Nizoka/pdfnative-react/releases).

[`pdfnative-react`](https://github.com/Nizoka/pdfnative-react) turns declarative **JSX** into real, on-device PDFs powered by the zero-dependency [`pdfnative`](https://github.com/Nizoka/pdfnative) engine — no DOM, no headless browser, no SaaS round-trips. Your documents never leave the process.

> **Why a React renderer?** Front-end teams already think in components. `pdfnative-react` lets you author a PDF the same way you author a UI — with familiar `@react-pdf/renderer`-style ergonomics (`Document`, `Page`, `Text`, `usePdf`, `PDFViewer`) — while the actual bytes are produced locally by pdfnative. It is the **frontend gateway** to the pdfnative ecosystem.

```tsx
import { Document, Heading, Text, Table, renderToBytes } from 'pdfnative-react';

const bytes = renderToBytes(
  <Document title="Invoice #1024" footerText="Acme Inc">
    <Heading level={1}>Invoice #1024</Heading>
    <Text>Thank you for your business.</Text>
    <Table
      headers={['Item', 'Qty', 'Total']}
      rows={[{ cells: ['Pro plan', '1', '$49.00'], type: 'default', pointed: false }]}
      zebra
    />
  </Document>,
); // → Uint8Array, a valid PDF (%PDF-… …%%EOF)
```

---

## How it works

A custom **React reconciler** compiles your component tree — synchronously, with no DOM — into the `pdfnative` `DocumentParams` model, which the engine then renders to bytes. There is **no CSS/flexbox engine** and no `<View>`: it is an honest, declarative **block flow** where every component maps 1:1 onto a pdfnative block.

```
[your JSX tree]
      │ custom react-reconciler (synchronous, no DOM)
┌──────────────────────────┐
│   pdfnative-react (npm)  │  ← components compile to pdfnative blocks
└──────────────────────────┘
      │ import { buildDocumentPDFBytes, … } from 'pdfnative'
┌──────────────────────────┐
│      pdfnative (npm)     │  ← zero-dependency PDF engine
└──────────────────────────┘
```

> **Zero-dependency invariant preserved.** React 19 is a **peer dependency of `pdfnative-react` only**. The core `pdfnative` library remains zero-dependency — adding the React renderer to your app never adds a dependency to the engine itself.

---

## Installation

```bash
npm install pdfnative-react pdfnative react
```

**Requirements:** **React 19** and **pdfnative `^1.9.0`** (both peer dependencies) · **Node.js ≥ 22**. The package adds one runtime dependency of its own, `react-reconciler`. Works in Node, browsers and SSR frameworks.

> **Next.js and other React Server Component setups.** The root barrel is deliberately *not* marked `'use client'`, and importing it from a Server Component or a `'use server'` file **fails** — the reconciler needs `createContext`, which is unavailable under React's `react-server` condition. Render from a **Route Handler** instead (see [Server rendering](#server-rendering) below). The hooks and viewer components carry the directive and are published separately at `pdfnative-react/client`; import them from there in an app that mixes server and client components, because the directive does not survive bundling in the root barrel.

The package ships **NPM provenance** — verify the published artifact with `npm audit signatures` or on [npmjs.com](https://www.npmjs.com/package/pdfnative-react).

---

## When to use the React renderer

| Use **pdfnative-react** when… | Use the **library** / **CLI** when… |
|---|---|
| You already build UIs in React and want PDFs the same way | You write a non-React Node service → use `pdfnative` directly |
| You want a live `<iframe>` preview in the browser (`usePdf` / `PDFViewer`) | You operate from shell scripts or CI → use [`pdfnative-cli`](cli.html) |
| You are migrating from `@react-pdf/renderer` | You drive PDFs from an AI assistant → use [`pdfnative-mcp`](mcp.html) |
| You want AI agents to author with the token-frugal `DocSpec` | You need Web Worker offloading or 100 % programmatic control |

The packages are **complementary** and all sit on the same engine, so a PDF authored in any of them is byte-compatible with the others.

---

## Components

Every component maps 1:1 onto a pdfnative block (`Section` being the one intentional composite).

| Component | Renders |
|---|---|
| `Document` | The required root (`title`, `footerText`, `metadata`, `fontEntries`, `layout`, `tagged`, `print` — v1.2.0 — _(v1.3.0)_ `typography`, `pdfx`, `outputIntent`, `creationDate` (a `Date` or an ISO 8601 string), and _(v1.4.0)_ `direction` (`'auto'` / `'ltr'` / `'rtl'`, sugar over `layout.direction`)). |
| `Page` | An explicit page boundary (content auto-paginates otherwise). |
| `Heading` | A section heading (`level` 1–3, `keepWithNext` _(v1.3.0)_); feeds the auto `TableOfContents`. |
| `Paragraph` / `Text` | A wrapping paragraph (`fontSize`, `lineHeight`, `align` — `"justify"` via `ParagraphAlign` _(v1.3.0)_ — `indent`, `color`, _(v1.3.0)_ `keepWithNext`, `splittable`, and _(v1.4.0)_ `direction`, overriding the document's base direction for this block only). |
| `List` / `Item` | A bullet or numbered (`ordered`) list. |
| `Table` / `Row` / `Cell` | A data table (data-driven `headers`/`rows`, or JSX `<Row>`/`<Cell>`). |
| `Image` | An embedded JPEG, PNG or — _(v1.4.0)_ — JPEG 2000 image (`data: Uint8Array`; a JP2 file or a raw J2K codestream, detected from the magic bytes). |
| `Link` | A clickable hyperlink (`url`/`href`). |
| `Spacer` | Vertical whitespace (`height`). |
| `PageBreak` | A hard page break. |
| `TableOfContents` / `Toc` | An auto-generated TOC built from headings. |
| `Barcode` | QR, Code 128, EAN-13, PDF417, Data Matrix (`format`, `data`). |
| `Svg` | Inline vector graphics (path data or markup). |
| `FormField` | Interactive AcroForm widgets (`fieldType`, `name`). |
| `Chart` | A native vector chart (`chartType`, `series`, `categories`, `altText`, …) — see [Charts](#charts). |
| `Section` | *Composite* (the one exception to the 1:1 mapping): expands to an optional `PageBreak` + a `Heading` + its children before the reconciler runs. Props: `title`, `level` (default `2`), `color`, `break`. |

Since v1.3.0 every colour prop — `color` on headings, paragraphs, sections and links, chart palettes and series colours, table borders and zebra stripes, watermarks, headers and footers — accepts **CMYK** beside hex and RGB: a `[c, m, y, k]` tuple in percent (`[0, 60, 100, 0]`) or a `'c m y k'` operator string (0–1), emitted as DeviceCMYK. Since v1.4.0 the same positions take the two **spot-colour** forms, `{ spot, tint? }` (a `/Separation` over an ink declared in `print.spotColours`) and `{ inks }` (a `/DeviceN` mix). The one exception is `outline[].color`: a bookmark colour is process RGB by the PDF specification, so the schema types it `$defs.processColor` (hex, RGB, or CMYK approximated) and the engine refuses a spot or ink-mix value there (`E_INPUT`). `layout.colors` — the engine's `PdfColors` palette — is accepted and forwarded but never read by the block-flow renderer this package drives, so it is not a colour position. `print.marks.colourBars` draws colour control bars in the bleed strip (process inks only). See [Typography, print & reproducible output](#typography-print--reproducible-output-v130) and [Right-to-left, spot colours, the dual claim & JPEG 2000](#right-to-left-spot-colours-the-dual-claim--jpeg-2000-v140).

---

## Server rendering

`renderToResponse` returns a web-standard `Response`, so the same call works in a
Next.js Route Handler, a Remix loader, Deno, Bun, Cloudflare Workers and any
other runtime with the Fetch API. This is the supported way to render from a
server framework.

```tsx
// app/invoice/route.tsx — Next.js Route Handler
import { renderToResponse } from 'pdfnative-react';

export async function GET() {
  return renderToResponse(<Invoice />, {
    fileName: 'invoice.pdf',
  });
}
```

`renderSpecToResponse` does the same from a `DocSpec` object rather than JSX,
which is the shape an AI agent is most likely to produce.

## Charts

`<Chart>` compiles to the engine's native `chart` block — vector path operators,
no rasterisation, and `/Figure` tagging with alt text.

```tsx
<Chart
  chartType="bar"            // bar | barH | line | pie | donut | stackedBar | stackedBarH | area | scatter
  title="Quarterly revenue"
  categories={['Q1', 'Q2', 'Q3', 'Q4']}
  series={[{ label: 'Revenue', values: [50, 62, 70, 81] }]}
  altText="Bar chart of quarterly revenue, rising each quarter"
/>
```

**Charts v2 (v1.2.0)** widens the surface to the engine's nine chart types and
adds five props: `axis2` (a secondary Y axis — put a series on it with
`yAxis: 'right'`), `xAxis` (`category` | `linear` | `time` positional axes; a
log scale is available on the *value* axes via `axis` / `axis2`
`scale: 'log'`), `dataLabels`, `labelStride` and `labelRotation`. The
exported `ChartPropsCoversChartBlock` compile-time lock guarantees `<Chart>`
covers every engine `ChartBlock` field.

Since v1.4.0 `ChartSeries.colors` paints one colour per value on the four bar
kinds (`bar`, `barH`, `stackedBar`, `stackedBarH`); the other kinds ignore it,
and the legend swatch keeps the series `color`. Its length must equal
`values` — `L_CHART_SERIES_COLORS` is the engine's length-mismatch throw one
tier earlier. `ChartSeries.label` is optional: an unnamed series is listed as
`Series N` in the legend and in every lint message (the schema's series
`required` list is `['values']`).

```tsx
<Chart
  chartType="bar"
  categories={['Brand Blue', 'Warm Grey', 'Varnish']}
  series={[{
    values: [38, 22, 61],                                                   // no label → "Series 1" in the legend
    colors: [{ spot: 'Brand Blue' }, { spot: 'Warm Grey' }, { spot: 'Varnish' }], // one ink per bar (declared in print.spotColours)
  }]}
  dataLabels={{ suffix: ' %' }}
  altText="Ink coverage per plate: Brand Blue 38 %, Warm Grey 22 %, Varnish 61 %."
/>
```

<!-- verify-docs:allow version-token (historical: the peer floors of v1.2.0 and v1.3.0) -->
The charts-v2 fields are why the `pdfnative` peer floor first moved to
`^1.7.0`, and v1.3.0 raised it to `^1.8.0` for the same reason; v1.4.0 raises
it to **`^1.9.0`**: `layout.direction`, `print.spotColours` and the spot
colour forms, the PDF/A-2 + PDF/X-4 dual claim, `ChartSeries.colors`, JPEG
2000 images and the bidi resolver do not exist before engine 1.9.0, so an
older engine would throw mid-render or silently write a left-to-right,
process-colour file. `doctor()` (`REQUIRED_ENGINE` is `1.9.0`) probes
newest-first — `resolveBidiLevels`, which first ships in 1.9.0, before the
older capabilities — and grades a 1.8.x engine down with an error that names
the peer to upgrade (`1.8.x — this release needs >= 1.9.0; upgrade the
pdfnative peer`); 1.7.x, 1.6.x and "missing or older than 1.6.0" are told
apart the same way.

## Print production & conformance diagnostics _(v1.2.0)_

`<Document print={…}>` is document-level sugar over `layout.print` — the typed
`PrintOptions` covers `bleed` (a shorthand that derives `TrimBox` and
`BleedBox`), explicit `trimBox` / `bleedBox` / `artBox` / `cropBox` page boxes,
vector printer's marks, and `/UserUnit`. The companion types ship from the root
barrel: `PrintOptions`, `PrinterMarksOptions`, `PageBox`, `CustomOutputIntent`,
and `PdfColors`. Viewer preferences (`duplex`, `pickTrayByPDFSize`,
`printPageRange`, `numCopies`) and a custom RGB ICC `outputIntent` pass through
`layout` untouched (since v1.3.0 `outputIntent` is also a `<Document>` prop and
accepts CMYK and Gray profiles — see the next section).

```tsx
const bytes = renderToBytes(
  <Document title="Poster" print={{ bleed: 8.5, marks: { crop: true } }}>
    <Heading level={1}>Print-ready</Heading>
  </Document>,
);
```

The engine's conformance channel is exposed the same way: `layout.strict`
escalates PDF/A diagnostics (`PdfDiagnosticCode` — e.g.
`PDFA_UNEMBEDDED_FORM_FONT`) into a hard failure before any bytes are produced,
while `layout.onDiagnostic` (a `PdfDiagnosticHandler` receiving each
`PdfDiagnostic`) lets you collect them without failing. In a DocSpec only
`strict: true` is expressible — `onDiagnostic` is function-valued and therefore
not JSON-representable.

## Typography, print & reproducible output _(v1.3.0)_

<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
v1.3.0 tracks the pdfnative 1.8.0 engine and brings its authoring surface to
JSX and `DocSpec` alike. Everything below is opt-in: a document that uses none
of it compiles to the same `DocumentParams` and renders to the same bytes as
before.

### Typography

`<Document typography={…}>` is sugar over `layout.typography` (an explicit
`layout` wins and replaces the object whole — no deep merge). It covers all
twelve engine keys — `splitParagraphs`, `orphans`, `widows`,
`keepHeadingsWithNext`, `unitBinding`, `bindShortWords`, `punctuationSpacing`
(`'fr'`, `'fr-CA'` or explicit rules), `opticalMargins`, `metrics`,
`fontFeatures`, `kerning`, `hyphenationLanguage` — under the compile-time lock
`TypographyPropsCoverTypographyOptions`, so the next engine key is a build
error in the renderer rather than a silent gap. Unset, the output is
byte-identical to earlier releases.

```tsx
<Document
  fontEntries={fontEntries}                                   // kerning, features and 'fr' need a registered font
  typography={{
    splitParagraphs: true, orphans: 2, widows: 2,
    keepHeadingsWithNext: { minLines: 3 },
    unitBinding: true, bindShortWords: true,
    opticalMargins: true, kerning: true, fontFeatures: ['smcp', 'onum'],
  }}
>
  <Heading level={2} keepWithNext>Results</Heading>
  <Paragraph align="justify" splittable>…</Paragraph>
</Document>
```

Three per-block overrides ride on the same engine release: `align="justify"`
on paragraphs (`ParagraphAlign = Align | 'justify'` — `Align` itself stays
three-valued for images, barcodes, SVG and charts), `keepWithNext` on headings
and paragraphs, and `splittable` on paragraphs; each overrides the document
setting for that block only, and unset means "follow the document". The limits
are the engine's: `kerning`, `fontFeatures` and the `'fr'` narrow no-break
space need a registered font (the base-14 faces carry no OpenType data and no
U+202F, so `'fr'` degrades to `'fr-CA'`); `tnum` / `lnum` change nothing on the
bundled Noto Sans; `metrics: 'exact'` acts on base-14 text only. **No
hyphenation dictionary ships** — soft hyphens (U+00AD) are honoured as break
opportunities, and `setHyphenationProvider` / `getHyphenationProvider` are
re-exported from the engine so you can plug in your own (the provider is
process-wide; `hyphenationLanguage` is the BCP 47 tag it receives with every
word):

```ts
import { setHyphenationProvider } from 'pdfnative-react';

setHyphenationProvider((word, lang) => myDictionary.hyphenate(word, lang)); // returns the break offsets for a word
setHyphenationProvider(null);                                                 // removes it
```

### CMYK colour and colour bars

The `Color` type widens to admit a four-element tuple: `[c, m, y, k]` in
percent (`PdfCmykTuple`) or a `'c m y k'` operator string in 0–1
(`PdfCmykString`), emitted as DeviceCMYK — the engine reads the colour space
from the component count, so three values stay DeviceRGB. Every colour position
takes it, and `validateSpec` and the JSON Schema (`$defs.color`) accept both
forms. `print.marks.colourBars` (`true`, or a `ColourBarOptions` object
`{ tints, size }`) draws the four process colours in the bottom bleed strip: a
5 mm bleed (14.17 pt) fits a densitometer aperture, and under 4 pt the engine
skips the bars silently — the lint rule `L_PRINT_COLOUR_BARS` warns in both
cases. Under a `tagged` claim the bars are `/Artifact` content.

```tsx
<Document print={{ bleed: 14.17, marks: { crop: true, registration: true, colourBars: true } }}>
  <Heading level={1} color={[0, 0, 0, 100]}>Press sheet</Heading>
  <Paragraph color="0 1 1 0">Set in DeviceCMYK.</Paragraph>
</Document>
```

### PDF/X-4 and output intents

`<Document pdfx="pdfx4">` (sugar over `layout.pdfx`; `DocSpec.pdfx`) writes the
PDF/X-4 identification (ISO 15930-7), a `/GTS_PDFX` output intent, a TrimBox
on every page and `/Trapped`; `'pdfx4'` is the only target the engine knows
(`PdfXConformanceTarget`). `outputIntent` becomes a `<Document>` prop (sugar
over `layout.outputIntent`; `DocSpec.outputIntent` carries the profile as
bytes) and accepts RGB, CMYK and Gray profiles — honoured under `tagged`,
required under `pdfx`. The coherence rules are the engine's, and each is an
`L_PDFX_*` lint rule before it is a throw: `pdfx` is **exclusive with
`layout.encryption`** (`L_PDFX_ENCRYPTED`) and, since v1.4.0, **combines with
`tagged: 'pdfa2b' | 'pdfa2u'`** into one file carrying both claims —
`L_PDFX_TAGGED_CONFLICT` narrows to the two levels the engine still refuses,
PDF/A-1 (`'pdfa1b'`: PDF 1.4 has no PDF/X-4) and PDF/A-3 (`'pdfa3b'`:
embedded files, which PDF/X forbids), with the engine's two per-level
messages (see [One file, both claims](#one-file-both-claims--pdfa-2--pdfx-4));
the `outputIntent` must carry a real **press profile** (ICC device class `prtr`,
not a monitor profile such as sRGB — none is bundled, and a hand-made ICC stub
is rejected at build time); `metadata.trapped` is `'True'` or `'False'`,
never `'Unknown'` (omitted, the engine writes `'False'`); every font must be embedded through `fontEntries`; and each
page carries a TrimBox *or* an ArtBox, not both. The engine performs **no
RGB→CMYK conversion**: RGB content under a CMYK or Gray intent is remapped
through `/DefaultRGB`, and a CMYK colour under a non-CMYK intent is reported
(`L_CMYK_INTENT_MISMATCH` says so first).

```tsx
<Document
  pdfx="pdfx4"
  fontEntries={fontEntries}
  metadata={{ trapped: 'False' }}
  outputIntent={{ iccProfile: pressProfile, outputConditionIdentifier: 'FOGRA39' }} // a prtr profile — none is bundled
  print={{ bleed: 14.17, marks: { crop: true, colourBars: true } }}
>
```

`validatePdfX` is deliberately **not** re-exported — `pdfnative-react` is an
authoring surface, and checking the finished bytes is one engine import away,
exactly as the package's `docs/RECIPES.md` shows:

```ts
import { validatePdfX } from 'pdfnative';

const { valid, errors, warnings } = validatePdfX(renderToBytes(<PressSheet />));
if (!valid) throw new Error(errors.join('\n'));
```

A `valid` result means the structural prerequisites hold — not that a certified
preflight passed; veraPDF does not cover PDF/X.

### Reproducible output

`<Document creationDate>` — a `Date`, or an ISO 8601 string (the JSON form
`DocSpec.creationDate` uses) — pins the creation instant; it is sugar over
`layout.creationDate`. Since engine 1.8.0 every date is written in UTC
(`+00'00'`), and the `{date}` header/footer placeholder and the trailer `/ID`
follow the pin, so a pinned document renders to the same bytes on every host
and in every time zone. An unparseable string is an `E_INPUT` error at compile
time, never a silent fallback to the clock. `setDefaultCreationDate(date)` and
`getDefaultCreationDate()` (re-exported from the engine) pin every document in
the process that has no pin of its own; `setDefaultCreationDate(null)` restores
the clock. **The library reads no environment variable** — a pipeline that
exports `SOURCE_DATE_EPOCH` applies it in one line of its own. Encrypted output
is not reproducible by design (fresh keys, salts and IVs on every build), and
`renderToResponse({ etag: true })` is a stable validator across hosts only when
the document is pinned.

```tsx
<Document creationDate={new Date('2026-01-01T00:00:00Z')} header={{ right: 'Built {date}' }}>   // this document
setDefaultCreationDate(new Date('2026-01-01T00:00:00Z'));                                     // every document in this process

const epoch = process.env.SOURCE_DATE_EPOCH;                        // your pipeline's decision, not the library's
if (epoch) setDefaultCreationDate(new Date(Number(epoch) * 1000));
```

## Right-to-left, spot colours, the dual claim & JPEG 2000 _(v1.4.0)_

v1.4.0 tracks the pdfnative 1.9.0 engine and brings its authoring surface to
JSX and `DocSpec` alike, through the single registry. Everything below is
opt-in: a document that embeds no font and sets no right-to-left text compiles
to the same `DocumentParams` and renders to the same bytes as before (a
font-embedding document moves once with the engine's leaner subsets — see
[Release history](#release-history)).

### Right-to-left documents

`<Document direction="auto">` (`'auto' | 'ltr' | 'rtl'`, the engine's
`TextDirection`) is sugar over `layout.direction` — an explicit `layout` wins
— and resolves every paragraph's base direction from its first strong
character (UAX #9 P2–P3): an Arabic or Hebrew paragraph is set from the right
margin, its neutral punctuation follows the paragraph, its lines wrap on the
right. `<Paragraph direction>` overrides it per block; the DocSpec twin is the
top-level `direction` field (the 19th, after `creationDate`) and the paragraph
opt of the same name, both described in the schema with the engine enum.
Omitted, the layout stays left-to-right as before and the engine still reorders
right-to-left runs inside a line; the bytes still move with pdfnative 1.9.0
(compact subsets, plus `/ActualText` on right-to-left and reordered runs
unless `layout.actualText: false`).

Every right-to-left run carries its logical text as an untagged
`/Span /ActualText`, so extraction and copy-paste return the source string;
`layout.actualText: false` opts out — a compatibility switch, deliberately
`layout`-only (no `<Document>` prop, no DocSpec field).

<!-- demo-language: ar, he (right-to-left sample text) -->
```tsx
import { Document, Heading, Paragraph, renderToFile, resolveFonts } from 'pdfnative-react';

const fontEntries = await resolveFonts({
  latin: () => import('pdfnative/fonts/noto-sans-data.js'),
  ar: () => import('pdfnative/fonts/noto-arabic-data.js'),
  he: () => import('pdfnative/fonts/noto-hebrew-data.js'),
});

// demo-language: ar, he (right-to-left sample text)
await renderToFile(
  <Document title="Right-to-left" fontEntries={fontEntries} direction="auto">
    <Heading level={1}>Right-to-left paragraphs</Heading>
    <Paragraph>السلام عليكم ورحمة الله وبركاته.</Paragraph>
    <Paragraph>שלום וברכה.</Paragraph>
    <Paragraph direction="ltr">Forced left-to-right, whatever the document says.</Paragraph>
  </Document>,
  'rtl-direction.pdf',
);
```

### Spot colours

`print.spotColours` declares named inks, each with a process *alternate* —
what a CMYK or RGB device shows in its place — and the `Color` type widens to
paint through them: `{ spot: name, tint? }` is a `/Separation` colour space
(a tint of 0–1, default solid), `{ inks: { name: tint, … } }` a `/DeviceN`
mix whose inks must share an alternate space (all CMYK or all RGB). Both
forms are accepted at every colour position of the components table —
headings, paragraphs, table zebra and borders, chart palettes and
`ChartSeries.colors` — and in the schema's `$defs.color`. Three limits, each a
lint finding before it is an engine throw: an undeclared ink is
`L_SPOT_UNDECLARED`, an invalid mix or tint is `L_SPOT_INK_MIX`, an invalid
declaration (empty or duplicate name, an alternate out of range) is
`L_PRINT_BOXES`. The colour bars paint process inks only, and an outline
bookmark colour stays process RGB (`$defs.processColor`; the engine throws on
a spot value there).

```tsx
// PrintOptions is re-exported by pdfnative-react; fontEntries, rows and
// pressProfile (the ICC profile bytes) are your own objects.
const print: PrintOptions = {
  bleed: 14.17,
  marks: { crop: true, registration: true, colourBars: true },
  spotColours: [
    { name: 'Brand Blue', alternate: [100, 44, 0, 0] },   // a CMYK alternate, in percent
    { name: 'Varnish', alternate: [0, 0, 0, 8] },
  ],
};

<Document pdfx="pdfx4" fontEntries={fontEntries} metadata={{ trapped: 'False' }} outputIntent={{ iccProfile: pressProfile, outputConditionIdentifier: 'FOGRA39' }} print={print}>
  <Heading level={1} color={{ spot: 'Brand Blue' }}>Brand blue, as a plate of its own</Heading>
  <Paragraph color={{ spot: 'Brand Blue', tint: 0.5 }}>A 50 % tint of the same ink — one /Separation space, one plate.</Paragraph>
  <Paragraph color={{ inks: { 'Brand Blue': 1, Varnish: 0.6 } }}>An ink mix through a /DeviceN space over the two inks.</Paragraph>
  <Table headers={['Plate', 'Use']} rows={rows} zebra={{ spot: 'Brand Blue', tint: 0.15 }} cellBorders={{ all: true, color: { spot: 'Brand Blue' } }} />
</Document>
```

A nuance of the lint tier: `tagged: true` is the engine's default claim,
PDF/A-2b, byte-identical to `'pdfa2b'`, but the three PDF/A lint rules
(`L_TAGGED_NO_FONTS`, `L_TAGGED_FORM_FONTS`, `L_PDFA_JPX_IMAGE`) evaluate the
string levels only — name the level to get the pre-flight. The schema and
`validateSpec` accept the forms; `lintDocument` / `lintSpec` check the
declarations; the engine throws last, and `toErrorEnvelope` reports its colour
throws as `E_INPUT`.

### One file, both claims — PDF/A-2 + PDF/X-4

`tagged="pdfa2b"` (or `"pdfa2u"`) now combines with `pdfx="pdfx4"`: the XMP
carries both identifications, the structure tree and the TrimBox coexist, and
the output intent serves both standards. Everything PDF/X-4 needs still
applies — embedded fonts, a `prtr` output profile, a known trapping state, a
TrimBox — and encryption stays excluded by both claims. `L_PDFX_TAGGED_CONFLICT`
keeps its code and narrows to the two levels the engine still refuses, PDF/A-1
(`'pdfa1b'`: PDF 1.4, no PDF/X-4) and PDF/A-3 (`'pdfa3b'`: embedded files,
which PDF/X forbids), with the engine's two per-level messages one tier
before the throw.

```tsx
const doc = (
  <Document
    title="Archived press sheet"
    tagged="pdfa2b"
    pdfx="pdfx4"
    fontEntries={fontEntries}
    metadata={{ trapped: 'False' }}
    outputIntent={{ iccProfile: pressProfile, outputConditionIdentifier: 'FOGRA39' }} // a prtr profile serves both claims
    print={{ bleed: 9, marks: true }}
  >
    <Heading level={1} color={[0, 0, 0, 100]}>Archived press sheet</Heading>
    <Paragraph>Tagged for archival (PDF/A-2b), trimmed and intent-bound for the press (PDF/X-4).</Paragraph>
  </Document>
);

const report = lintDocument(doc);               // clean: no L_PDFX_TAGGED_CONFLICT for pdfa2b
const bytes = renderToBytes(doc);
const { valid } = validatePdfX(bytes);          // from 'pdfnative' — one set of bytes, both validators
```

### JPEG 2000 images

`<Image data>`, `['img', { data }]` and `watermark.image` accept a JP2 file or
a raw J2K codestream, detected from the magic bytes and passed through as
`/JPXDecode` under a `%PDF-1.5` header — never decoded, exactly as the DCT
data of a JPEG is embedded. Under PDF/A the claim's rules apply, and
`L_PDFA_JPX_IMAGE` says so before the engine's `PDFA1_JPX_IMAGE` (any JPEG
2000 under PDF/A-1) and `PDFA_JPX_IMAGE` (channels not 1, 3 or 4, or an
opacity channel, under PDF/A-2 and later) diagnostics do; both throw under
`layout.strict`. One honest note on the other raster format: a PNG with an
alpha channel (colour types 4 and 6) is refused by the engine (`parsePNG: …`,
`E_INPUT` through `toErrorEnvelope`) — flatten the transparency first; the
engine's `parsePNG` refuses interlaced and palette-based PNGs the same way.

```tsx
<Document title="JPEG 2000" watermark={{ image: { data: jp2Bytes, width: 240, opacity: 0.1 } }}>
  <Image data={jp2Bytes} width={96} height={96} alt="An sRGB JP2 file" />
  <Image data={j2kBytes} width={96} height={96} align="center" alt="A raw J2K codestream" />
</Document>
```

### 32 scripts and thirteen diagnostic codes

Gujarati (`gu`), Gurmukhi (`pa`), Kannada (`kn`), Malayalam (`ml`) and Odia
(`or`) join through `resolveFonts` on the engine's Indic shaping engine — 32
scripts in all, through the same `fontEntries` door as before (see
[Fonts & environment](#fonts--environment)). The diagnostics channel grows to
thirteen codes: `TEXT_GLYPH_NOT_COVERED` — a character no registered font
covers used to render as a box or a `?` in silence; it now reaches
`layout.onDiagnostic` as a warning and throws under `layout.strict`, and has
**deliberately no lint tier** (deciding which font covers a character is the
engine's routing, decided after the model is compiled) — `PDFA1_JPX_IMAGE`
and `PDFA_JPX_IMAGE` (mirrored by `L_PDFA_JPX_IMAGE`) and
`PDFA_GLYPH_WITHOUT_UNICODE` (the engine's PDF/A-2u ToUnicode self-check, no
authoring trigger).

### Deliberately not re-exported

`pdfnative-react` is an authoring surface, and the engine's 1.9.0
post-processing stays one engine import away, exactly as `validatePdfX` does:
`extractText({ onStreamError })`, `PdfStreamLimitError`, `decodePdfTextString`
(parser); `composeLtvData`, `ocspResponseMatchesCertificate` and the ECDSA
primitives (signing / LTV); `{ type: 'link' }` markup annotations;
`parseJPX` and the bidi helpers (imported inside the bridge as the `doctor()`
probe and the `L_PDFA_JPX_IMAGE` delegate, never re-exported); the per-script
shaping helpers and their lower-level types; `validatePdfX` / `validatePdfUA`.
Nor is there an `Rtl` component, an `actualText` DocSpec field, a
`TEXT_GLYPH_NOT_COVERED` lint rule, a spot-colour palette helper, a JPEG 2000
codec or a hyphenation dictionary.

## Linting

`lintDocument` runs 41 deterministic rules (26 errors, 14 warnings, 1 info)
over a compiled tree — no I/O, so it is safe in a test or a CI step. It catches
the classes of mistake a type system cannot, including `L_TAGGED_NO_FONTS`:
declaring PDF/A without embedding a font, which produces a file that claims
conformance it does not have. Twenty-three of the rules pre-empt an engine
throw with a named, actionable finding, and six mirror an engine diagnostic (a
throw under `layout.strict`). For a `DocSpec` lint gate wired into CI, see
[React use cases](use-cases-react.html).

v1.4.0 adds four rules — the engine's 1.9.0 throws and diagnostics one tier
earlier: `L_CHART_SERIES_COLORS` (error: a series `colors` array whose length
differs from its `values`), `L_SPOT_UNDECLARED` (error: a `{ spot }` or
`{ inks }` colour names an ink that `print.spotColours` does not declare),
`L_SPOT_INK_MIX` (error: an ink mix or tint the engine rejects — a mix without
inks, a tint outside 0–1, or inks whose alternates sit in different spaces,
CMYK beside RGB) and `L_PDFA_JPX_IMAGE` (warning: a JPEG 2000 image under a
PDF/A claim — PDF/A-1 has no `JPXDecode` filter, PDF/A-2 and later need 1, 3
or 4 colour channels and no opacity channel; the channel facts come from the
engine's own `parseJPX`, as `L_PRINT_BOXES` delegates to
`validatePrintOptions`). Two rules widen: `L_PRINT_BOXES` also reports an
invalid `print.spotColours` declaration (an empty or duplicate ink name, an
alternate out of range), and `L_CMYK_INTENT_MISMATCH` also fires for a spot
colour whose alternate is CMYK under a non-CMYK intent. One rule narrows:
`L_PDFX_TAGGED_CONFLICT` no longer fires for `tagged: 'pdfa2b'`, `'pdfa2u'`
or `true` beside `pdfx="pdfx4"`, which engine 1.9.0 writes as one file
carrying both claims; it keeps its code for `'pdfa1b'` and `'pdfa3b'`. A
document written for v1.3.0 trips none of the four — each needs a 1.4.0 input
(`ChartSeries.colors`, a `{ spot }` or `{ inks }` colour, a JPEG 2000 image) —
and lint messages name an unlabelled series `Series N`.

v1.3.0 added twelve rules: `L_TYPOGRAPHY_INEFFECTIVE` (warning: a typography
option that can have no effect as written — `orphans` / `widows` without
`splitParagraphs`, an unknown `fontFeatures` tag, `kerning`, `fontFeatures` or
the `'fr'` preset without a registered font, a line quota below 1),
`L_PRINT_COLOUR_BARS` (warning: `colourBars` in a bleed strip too thin to carry
them — under 4 pt the engine skips them silently, under 5 mm the patches fall
below a densitometer aperture), `L_CMYK_INTENT_MISMATCH` (warning: a CMYK
colour under a PDF/A or PDF/X claim whose output intent is not CMYK),
`L_OUTPUT_INTENT_PROFILE` (error: `outputIntent.iccProfile` is not a usable ICC
profile — header, `acsp` signature, size field, colour space — read from the
bytes without the engine), the six PDF/X coherence rules `L_PDFX_TARGET` (only
`'pdfx4'` exists), `L_PDFX_TAGGED_CONFLICT` (`pdfx` and `tagged` both set —
narrowed to `'pdfa1b'` / `'pdfa3b'` in v1.4.0, above),
`L_PDFX_ENCRYPTED` (PDF/X forbids encryption), `L_PDFX_OUTPUT_INTENT` (no
`prtr` output profile, or a monitor profile such as sRGB),
`L_PDFX_TRAPPED_UNKNOWN` (`metadata.trapped` is `'Unknown'`) and `L_PDFX_BOXES`
(`print.artBox` set together with `print.trimBox` or `print.bleed`) — all
errors, in the engine's order and with the engine's wording — and the
diagnostic twins `L_PDFX_NO_FONTS` (error: `pdfx` without `fontEntries`, the
engine's `PDFX_NO_FONT_ENTRIES`) and `L_PDFX_ANNOTATIONS` (warning: a link or a
form field in a PDF/X-4 document, `PDFX_ANNOTATIONS`). A document written for
v1.2.0 trips none of the twelve — each needs an input that did not exist
before — so its `report.ok` is unchanged; and `L_OUTPUT_INTENT_IGNORED` no
longer fires under `pdfx`, where the intent is mandatory rather than ignored.

v1.2.0 added seven rules for its new surface: `L_CHART_LOG_SCALE`,
`L_CHART_X_AXIS` and `L_CHART_LABELS` (charts v2 misconfigurations),
`L_PRINT_BOXES` (print geometry — it delegates to the engine's
`validatePrintOptions` and reports its message verbatim, so the rule can never
drift from what the engine enforces), `L_VIEWER_PRINT_RANGE`,
`L_OUTPUT_INTENT_IGNORED` (warning: an `outputIntent` without `tagged` is a
silent no-op), and `L_TAGGED_FORM_FONTS` (warning: PDF/A plus form fields needs
embedded form fonts).

```ts
import { lintDocument, LINT_RULES } from 'pdfnative-react';

const report = lintDocument(<Invoice />);
if (!report.ok) {
  const first = report.findings.find((f) => f.severity === 'error');
  throw new Error(first?.message ?? 'lint failed');
}
```

## Agent surface

`capabilityManifest()` and `doctor()` return plain JSON describing what the
package can do and whether the environment supports it — the discovery pair an
autonomous agent should call before planning work. `validateSpec`, `schema(subject?)`
and `SCHEMA_SUBJECTS` cover DocSpec validation; `aiGovernancePolicy()`,
`agentRulesText()` and `validateIssueDraft()` expose the human-in-the-loop contract.

Since v1.3.0 the package's registry holds `DOC_SPEC_FIELDS` — now the 19
top-level `DocSpec` fields (the 14 of v1.2.0, the four of v1.3.0 — `pdfx`,
`outputIntent`, `typography`, `creationDate` — and, _(v1.4.0)_, `direction`,
appended after `creationDate`), compile-time locked to `keyof DocSpec` — and
both `validateSpec` and `capabilityManifest().specFields` derive from it;
`SCHEMA_SUBJECTS` is unchanged at seven, and every subject's `$id` is
`https://pdfnative.dev/schema/react/<version>/<subject>.schema.json`, so an
agent detects contract drift by comparing `$id`s alone.
`capabilityManifest().contract` states `engine: '^1.9.0'` (v1.4.0), `react:
'^19.0.0'`, `node: '>=22'`, `layoutModel: 'block-flow'`, `authoringOnly: true`,
`network: 'none'` and `reactServerCondition: 'unsupported'` — the manifest says
up front that the root barrel cannot be imported under React's `react-server`
condition. `toErrorEnvelope` turns *any* thrown value into the standard
`{ ok: false, error: { code, message } }` envelope and is **total** since
v1.4.0: a thrown value with no primitive conversion (`Object.create(null)`, a
hostile `{ toString: 1 }`) is described by its object tag instead of making
the envelope itself throw. It classifies the engine's build-time input errors
— PDF/X coherence, print geometry, output intent, chart data — as `E_INPUT`
rather than `E_RUNTIME`, by the exported `ENGINE_INPUT_ERROR_PREFIXES` table
(most of those throws are also pre-empted by a lint rule, which is the better
place to catch them). v1.4.0 grows the table from 8 to 19 prefixes: the
engine's colour input (`Spot colour`, `Ink mix`, `Invalid ink mix`, `Invalid
tint`, `Invalid spot colour`, `An outline colour`), the image decoders
(`parseImage:`, `parsePNG:`, `parseJPEG:`, `parseJPX:` — malformed bytes, an
interlaced or alpha-channel PNG) and `Watermark transparency` (a translucent
watermark under PDF/A-1b); the image parsers, the outline colour and the
watermark transparency are classified here only, with no lint tier. A
`layout.strict` escalation of a diagnostic (`pdfnative: …`) stays `E_RUNTIME`
— the message names the diagnostic code and the remedy.

## Rendering

```ts
import {
  renderToBytes,   // (node, options?) => Uint8Array
  renderToBlob,    // (node, options?) => Blob (application/pdf)
  renderToStream,  // (node, options?) => AsyncGenerator<Uint8Array>
  renderToFile,    // (node, path, options?) => Promise<void> (Node only)
  renderToResponse,// (node, options?) => Promise<Response> (web standard)
  renderToFileStream, // (node, path, options?) => Promise<StreamToFileResult> — { bytesWritten, path } (Node only)
  inspectDocument, // (node) => layout diagnostics, no render
  compileDocument, // (node) => DocumentParams (inspect the model, no render)
} from 'pdfnative-react';
```

`options` is `{ layout?: Partial<PdfLayoutOptions>; fontEntries?: FontEntry[]; fonts?: FontsMap }` and merges on top of anything set on `<Document>` — page size, margins, PDF/A mode, encryption, text direction, and non-Latin fonts. Note that `fonts` is only honored by the **async** entry points (`renderToFile`, `renderToFileStream`, `renderToResponse`, `usePdf`, `usePdfStream`) — font loading is asynchronous, so the synchronous entries (`renderToBytes`, `renderToBlob`, `renderToStream`) ignore it; resolve manually first (`fontEntries: await resolveFonts(fonts)`).

> ### `resolveFonts` fixed in v1.2.0 — re-render affected documents
>
> Before v1.2.0, `resolveFonts` (and the `fonts` option, which calls it) set each
> entry's `fontRef` to the bare language code instead of a slash-prefixed PDF
> name, yielding invalid syntax like `latin 12 Tf` — Acrobat refuses such a file
> ("an error occurred while reading this document (14)") and Chrome draws raw
> glyph indices. **v1.2.0 fixes this**: `resolveFonts` now prefixes the slash,
> emitting valid PDF names like `/latin` and `/th`. If you shipped PDFs through
> `resolveFonts` or the `fonts` option under v1.1.0, re-render them. Hand-built
> `fontEntries` using a correct `/F3`-style ref were never affected (`/F1` and
> `/F2` remain reserved by the engine).
>
> When building entries by hand, keep failing loudly — `loadFontData` resolves to
> `null` (it does not throw) when a code has no registered loader:
>
> ```ts
> import { registerFonts, loadFontData } from 'pdfnative';
>
> registerFonts({ latin: () => import('pdfnative/fonts/noto-sans-data.js') });
> const fontData = await loadFontData('latin');
> if (!fontData) throw new Error('font failed to load — did you call registerFonts first?');
> const bytes = renderToBytes(<Doc />, { fontEntries: [{ fontData, fontRef: '/F3', lang: 'latin' }] });
> ```
>
> Rendering is synchronous, so registering without awaiting `loadFontData` embeds
> nothing at all and every non-Latin glyph comes out blank.

Two `renderToResponse` / `renderSpecToResponse` options arrived in v1.2.0 for
HTTP caching: `cacheControl` (a verbatim `Cache-Control` header) and `etag` — a
verbatim string, or `true` to derive a strong validator from the rendered bytes
(which implies buffering the response instead of streaming it). v1.2.0 also
validates streamability **before** the first byte: a document that cannot
stream (a TOC, `{pages}` placeholders) now fails up-front instead of mid-response
with the headers already sent.

```ts
const bytes = renderToBytes(<Invoice />, {
  layout: { tagged: 'pdfa2b', compress: true },
});
```

---

## Hooks & client components

The published root bundle does **not** carry `'use client'` (a directive in an internal module does not survive single-file bundling); import hooks and viewer components from `pdfnative-react/client` in a React Server Components app, or add the directive to your own file as below.

```tsx
'use client';
import { usePdf } from 'pdfnative-react';

function Preview({ doc }: { doc: React.ReactElement }) {
  const { url, loading } = usePdf(doc);
  return loading ? <p>Rendering…</p> : <iframe title="preview" src={url} />;
}
```

- `usePdf(element, options?)` → `{ url, blob, bytes, loading, error, update }`
- `usePdfStream(element, options?)` → `{ getStream() }`
- `PDFViewer` — live `<iframe>` preview.
- `PDFDownloadLink` — one-click download (supports a render-prop child).
- `BlobProvider` — render-prop access to the raw `Blob`.

> Try it live in the [React playground](../playgrounds/react.html) — edit JSX or a `DocSpec` and see the PDF render in your browser.

---

## Agent authoring — the token-frugal `DocSpec`

`pdfnative-react` is a *library*, so the place LLM agents spend tokens is **authoring** documents. The compact `DocSpec` expresses the same document as terse, JSON-serializable tuples — and compiles to the **exact same** PDF as the JSX, because it is built on the very same components.

```ts
import { renderSpecToBytes, type DocSpec } from 'pdfnative-react';

const spec: DocSpec = {
  title: 'Invoice #1024',
  footerText: 'Acme Inc',
  blocks: [
    ['h1', 'Invoice #1024'],
    ['p', 'Thank you for your business.', { align: 'right' }],
    ['table', { h: ['Item', 'Total'], r: [['Pro plan', '$49.00']], zebra: true }],
    ['qr', 'https://acme.example/pay/1024', { align: 'right' }],
  ],
};

const bytes = renderSpecToBytes(spec);
```

The equivalent JSX is several times more tokens for a typical document, because every block carries opening/closing tags and prop names. Same bytes out, far fewer tokens in.

- `compileSpec(spec)` → `DocumentParams` · `specToElement(spec)` → `<Document>` element
- `renderSpecToBytes` / `renderSpecToBlob` / `renderSpecToStream` / `renderSpecToFile`
- `docSpecSchema()` → a Draft 2020-12 JSON Schema whose `$id` embeds the package version, so agents can self-validate a spec before rendering; `docSpecSchemaId()` returns the `$id`.

**Block tuples:** `['h1'|'h2'|'h3', text, opts?]`, `['p', text, opts?]`, `['ul'|'ol', items, opts?]`, `['table', { h?, r }]`, `['img', { data }]`, `['link', text, { url }]`, `['sp', height?]`, `['br']`, `['page', blocks]`, `['toc', opts?]`, `['qr'|'code128'|'ean13'|'pdf417'|'datamatrix', data, opts?]`, `['svg', data, opts?]`, `['chart', { chartType, series, … }]`, `['field', { fieldType, name, … }]`.

Since v1.2.0 a spec can also carry a top-level `print` field (the same
`PrintOptions` shape as `<Document print>`), and the generated JSON Schema
covers every charts-v2 field — so an agent can self-validate a print-ready,
dual-axis document before rendering it. v1.3.0 adds the top-level `typography`,
`pdfx`, `outputIntent` (the profile as bytes) and `creationDate` (an ISO 8601
string) fields, `align: 'justify'`, `keepWithNext` and `splittable` in the `p`
options, `keepWithNext` in the heading options, and the CMYK colour forms in
every colour position. v1.4.0 adds the top-level `direction` field and the
`direction` paragraph opt (`'auto' | 'ltr' | 'rtl'`), `print.spotColours`
with the `{ spot, tint? }` and `{ inks }` forms in `$defs.color` (outline
bookmarks stay on `$defs.processColor`), `colors` and an optional `label` on a
chart series, and JPEG 2000 bytes in `['img', { data }]` and
`watermark.image`; `schema('doc-spec')` describes each key with its bounds.

---

## Fonts & environment

Re-exported from the engine: `registerFonts`, `registerFont`, `loadFontData`, `validateFontData`, `downloadBlob` (browser), `initNodeCompression` (Node), and — v1.2.0 — `setDeflateImpl`, which plugs a **synchronous** deflate implementation into the engine for compressed client-side rendering (the function's output is written verbatim, so it must produce a zlib-wrapped RFC 1950 stream — e.g. fflate's `zlibSync`; the async browser `CompressionStream` cannot be plugged in). (`loadFontData` is a pure dynamic import — it works in the browser too.) Pass non-Latin fonts via the `fontEntries` render option (or on `<Document fontEntries={…}>`), unlocking all 32 scripts of the engine's bundled Unicode fonts and COLRv1 colour emoji exactly as in the core library — `resolveFonts` enumerates nothing (a language key maps to a font-data loader), so the five Indic scripts engine 1.9.0 adds (Gujarati `gu`, Gurmukhi `pa`, Kannada `kn`, Malayalam `ml`, Odia `or`), the five of the previous engine (Lao, Tai Tham, New Tai Lue, Tai Le, Cham) and the four Latin aliases (Hausa, Yoruba, Igbo, Swahili) all work through it unchanged.

v1.3.0 re-exports six more engine helpers: `setDeflateRawImpl` (a **raw** RFC 1951 compressor — the engine adds the zlib framing; since engine 1.8.0 `setDeflateImpl` rejects a raw-DEFLATE function at build time instead of writing an unreadable file), `wrapZlib` (the same framing, spelled out: `setDeflateImpl(wrapZlib(rawDeflate))`), `setDefaultCreationDate` / `getDefaultCreationDate` (the process-wide creation-date pin) and `setHyphenationProvider` / `getHyphenationProvider` (the hyphenation hook — no dictionary ships). Eleven types ship alongside from the root barrel: `ParagraphAlign`, `TypographyOptions`, `UnitBindingOptions`, `PunctuationSpacingRule`, `PunctuationSpacingPreset`, `Base14Metrics`, `HyphenationProvider`, `ColourBarOptions`, `PdfCmykTuple`, `PdfCmykString` and `PdfXConformanceTarget`; the runtime table `ENGINE_INPUT_ERROR_PREFIXES` is exported beside `toErrorEnvelope`. v1.4.0 adds no runtime helper and four types: `TextDirection` (`'auto' | 'ltr' | 'rtl'`), `PdfSpotColor` (`{ spot, tint? }`), `PdfInkMix` (`{ inks }`) and `SpotColourDef` (one entry of `print.spotColours`: `{ name, alternate }`); `Color` now admits the first two object forms beside its string and tuple forms.

```tsx
import { Document, Text, renderToBytes, registerFont, loadFontData } from 'pdfnative-react';

registerFont('th', () => import('pdfnative/fonts/noto-thai-data.js'));
const th = await loadFontData('th');
if (!th) throw new Error('Thai font failed to load');
const bytes = renderToBytes(
  <Document
    title="สวัสดี"
    fontEntries={[{ fontData: th, fontRef: '/F3', lang: 'th' }]} // /F1 and /F2 are reserved
  >
    <Text>สวัสดีชาวโลก</Text>
  </Document>,
);
```

---

## Migrating from `@react-pdf/renderer`

| `@react-pdf/renderer` | pdfnative-react |
|---|---|
| `<Document>` / `<Page>` | `<Document>` / `<Page>` |
| `<Text>` | `<Text>` (alias of `<Paragraph>`) |
| `<View>` + flexbox styles | *(none — declarative block flow; use blocks + `<Spacer>`)* |
| `StyleSheet` | per-component props (`align`, `color`, `fontSize`, …) |
| `<PDFViewer>` / `<PDFDownloadLink>` / `<BlobProvider>` | same names, same shape |
| <!-- verify-docs:allow api-exists (left column names the @react-pdf/renderer API being migrated from) --> `usePDF()` | `usePdf()` |

The biggest mental shift: there is **no flexbox layout engine**. Documents are a top-to-bottom block flow. Use `<Spacer>`, `<PageBreak>`, tables, and per-component alignment props instead of `<View>` containers.

---

## Diagnostics

`PdfStructureError` is thrown with an actionable message when a tree cannot be mapped onto the document model (for example, a `<Cell>` outside a `<Row>`, or an unsupported child of `<Document>`). Catch it to surface authoring mistakes early:

```ts
import { PdfStructureError, renderToBytes } from 'pdfnative-react';

try {
  const bytes = renderToBytes(<MyDoc />);
} catch (e) {
  if (e instanceof PdfStructureError) console.error('Invalid document tree:', e.message);
  else throw e;
}
```

---

## Release history

### What's new in v1.4.0

v1.4.0 (released 2026-11-01) tracks the pdfnative 1.9.0 engine — right-to-left text, spot colours, the PDF/A-2 + PDF/X-4 dual claim, per-value chart colours, JPEG 2000, 32 scripts — and exposes every one of its authoring capabilities through both doors, JSX and `DocSpec`, through the single registry. No public API was removed or renamed; every new behaviour is opt-in. What did not change: 19 components, the 14 block kinds of the DocSpec grammar, 6 error codes, 7 schema subjects and the defaults. The one floor that moves is the `pdfnative` peer, `^1.8.0` → `^1.9.0`.

| Area | v1.3.0 | v1.4.0 |
|---|---|---|
| Direction | left-to-right only; right-to-left runs reordered inside a line | **`<Document direction>`** / `<Paragraph direction>` / `DocSpec.direction` (`'auto' \| 'ltr' \| 'rtl'`, sugar over `layout.direction`); right-to-left runs carry `/ActualText` (`layout.actualText: false` opts out, `layout`-only) |
| Colour | hex, RGB, CMYK | + **spot colours**: `print.spotColours` declarations, `{ spot, tint? }` and `{ inks }` at every colour position; outline bookmarks stay process (`$defs.processColor`); `layout.colors` no longer listed as a colour position (never read by the block-flow renderer) |
| Conformance | `pdfx` exclusive with `tagged` | **one file, both claims** — `tagged: 'pdfa2b' \| 'pdfa2u'` + `pdfx="pdfx4"`; `L_PDFX_TAGGED_CONFLICT` narrowed to `'pdfa1b'` / `'pdfa3b'`; encryption still excluded |
| Charts | `label` required, one colour per series | `ChartSeries.colors` (one colour per value on the four bar kinds; the legend swatch keeps `color`), `label` optional (`Series N`); `L_CHART_SERIES_COLORS` |
| Images | JPEG, PNG | + **JPEG 2000** (JP2 or raw J2K) on `<Image>`, `['img']` and `watermark.image`, as `/JPXDecode` under `%PDF-1.5`; `L_PDFA_JPX_IMAGE` under a PDF/A claim |
| Scripts | 27 | **32** — Gujarati, Gurmukhi, Kannada, Malayalam, Odia on the Indic shaping engine, through `resolveFonts` unchanged |
| Diagnostics | 9 codes documented | **13** — `TEXT_GLYPH_NOT_COVERED` (deliberately no lint tier), `PDFA1_JPX_IMAGE`, `PDFA_JPX_IMAGE`, `PDFA_GLYPH_WITHOUT_UNICODE` |
| Linting | 37 rules <!-- verify-docs:allow count-tokens (migration history) --> | **41 rules** (26 errors / 14 warnings / 1 info; 23 pre-empt an engine throw, 6 mirror a diagnostic): `L_CHART_SERIES_COLORS`, `L_SPOT_UNDECLARED`, `L_SPOT_INK_MIX`, `L_PDFA_JPX_IMAGE`; `L_PRINT_BOXES` and `L_CMYK_INTENT_MISMATCH` widened; a v1.3.0 document trips none of the new ones |
| Agent surface | `DOC_SPEC_FIELDS` (18) | `DOC_SPEC_FIELDS` (**19**, + `direction`); `capabilityManifest().contract.engine` `^1.9.0`, `reactServerCondition: 'unsupported'`; schema `$id` `https://pdfnative.dev/schema/react/<version>/<subject>.schema.json`; `toErrorEnvelope` total; `ENGINE_INPUT_ERROR_PREFIXES` 8 → 19 (colour input, image decoders, watermark transparency); `doctor()` probes `resolveBidiLevels` newest-first and grades a 1.8.x engine down |
| Exports | — | + 4 types (`TextDirection`, `PdfSpotColor`, `PdfInkMix`, `SpotColourDef`); `Color` admits the two object forms; no runtime helper added |
| Quality | 811 tests / 43 files · 96.24 % | 949 tests / 50 files · 96.1 % statements · 42 samples held to a byte baseline on Linux, Windows and macOS · a 20-file conformance corpus (16 PDF/A, 5 PDF/X, one file claiming both) through veraPDF and `validatePdfX` · the v1.3.0 suite replayed against the current sources (`compat:previous`) · seven required checks on three operating systems <!-- verify-docs:allow stale-token (companion-repo figures) --> |
| Compatibility | `pdfnative ^1.8.0` peer | **`pdfnative ^1.9.0`** peer; React `^19.0.0` and Node ≥ 22 unchanged |

Full changelog: [pdfnative-react release notes v1.4.0](https://github.com/Nizoka/pdfnative-react/releases/tag/v1.4.0). Samples: `text/rtl-direction`, `layout/print-spot-colours`, `layout/print-dual-pdfa2b-pdfx4`, `media/image-jpx`, `fonts/scripts-32` (replacing `scripts-27`).

**Upgrading from v1.3.0** — no breaking API change; a drop-in replacement once the engine is at 1.9.0:

1. **Upgrade the engine.** `pdfnative` ≥ 1.9.0 is required; `doctor()` says `1.8.x — this release needs >= 1.9.0` on an older peer.
2. **Rebaseline once if you compare bytes.** Every document that embeds a font changes bytes — the subset is lean and compact and its `/BaseFont` carries a six-letter tag (`ABCDEF+NotoSans-Regular`, bare under PDF/A-1), every line is one text object, right-to-left and reordered runs carry an `/ActualText` span; a document with a translucent watermark gains a page transparency group. Documents on base-14 fonts with none of those are byte-identical.
3. **Strip the subset tag** where you match font names: `^[A-Z]{6}\+`.
4. **Expect `TEXT_GLYPH_NOT_COVERED`.** A character no registered font covers is a warning on `layout.onDiagnostic` and a throw under `layout.strict`; a strict pipeline that rendered boxes silently now stops — register a covering font or replace the character.
5. **New lint findings a document may trip:** `L_SPOT_UNDECLARED`, `L_SPOT_INK_MIX`, `L_CHART_SERIES_COLORS`, `L_PDFA_JPX_IMAGE`; and one it no longer trips: `L_PDFX_TAGGED_CONFLICT` with `pdfa2b`, `pdfa2u` or `true` (the engine's default claim is PDF/A-2b, so `true` + `pdfx4` is the joint claim).
6. **Repository tooling** (fork maintainers): the publish gate runs `compat:previous` and needs the previous tag (`git fetch --no-tags origin +refs/tags/v1.3.0:refs/tags/v1.3.0` on a shallow clone); the main ruleset requires two more checks.
7. **TypeScript consumers.** Three types widen: `Color` admits `PdfSpotColor` and `PdfInkMix`, so a narrowing such as `typeof c === 'string' ? c : c[0]` needs an object branch; `ChartSeries.label` is `string | undefined`; `LintRuleCode` and `DocSpecField` gain members, so an exhaustive `switch` needs the four rules and `direction`. Code that only *passes* these values in is unaffected.
8. **Three limits now stated, none new:** `layout.colors` never reached the block-flow renderer; a PNG with an alpha channel (colour types 4 and 6) is refused by the engine (`parsePNG: …`, `E_INPUT`) — flatten it first; a spot colour on an outline bookmark is refused (`E_INPUT`; the schema says so).

### Previously in v1.3.0

<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
v1.3.0 (released 2026-09-22) tracks the pdfnative 1.8.0 engine — typography, CMYK and PDF/X-4, reproducible output, every script of that engine — and exposes every one of its authoring capabilities through both doors, JSX and `DocSpec`. No public API was removed or renamed; every new behaviour is opt-in, and a document that uses none of it compiles to the same `DocumentParams`. The one floor that moves is the `pdfnative` peer, `^1.7.0` → `^1.8.0`.

| Area | v1.2.0 | v1.3.0 |
|---|---|---|
| Typography | — | **`<Document typography>`** / `DocSpec.typography` — the engine's twelve keys under a compile-time lock; `align="justify"` (`ParagraphAlign`), `keepWithNext`, `splittable`; `setHyphenationProvider` / `getHyphenationProvider` re-exported (no dictionary ships) |
| Colour | hex, RGB tuple, operator string | + **CMYK** on every colour position (`[c, m, y, k]` in percent or `'c m y k'`); `print.marks.colourBars` (`ColourBarOptions`) |
| PDF/X-4 | — | **`<Document pdfx="pdfx4">`** / `DocSpec.pdfx` with an `outputIntent` prop that accepts CMYK and Gray profiles; the six engine coherence throws mirrored as `L_PDFX_*` rules; `validatePdfX` stays a one-line engine import |
| Reproducible output | wall clock | **`<Document creationDate>`** / `DocSpec.creationDate`, `setDefaultCreationDate` / `getDefaultCreationDate`; every date UTC, `{date}` and the trailer `/ID` follow the pin; no environment variable is read |
| Scripts | 22 | **27** — five engine scripts (Lao, Tai Tham, New Tai Lue, Tai Le, Cham) and four Latin aliases (Hausa, Yoruba, Igbo, Swahili), through `resolveFonts` unchanged |
| Linting | 25 rules <!-- verify-docs:allow count-tokens (migration history) --> | **37 rules** (12 new; 20 pre-empt an engine throw, 5 mirror an engine diagnostic); a v1.2.0 document trips none of the new ones |
| Agent surface | `SCHEMA_SUBJECTS` (7) | + `DOC_SPEC_FIELDS` (18, compile-time locked) behind `validateSpec` and `capabilityManifest().specFields`; `toErrorEnvelope` classifies engine input errors as `E_INPUT` via the exported `ENGINE_INPUT_ERROR_PREFIXES`; `doctor()` tells a 1.7.x engine apart from a missing one |
| Exports | — | + `setDeflateRawImpl`, `wrapZlib`, `setDefaultCreationDate`, `getDefaultCreationDate`, `setHyphenationProvider`, `getHyphenationProvider` and 11 types (`ParagraphAlign`, `TypographyOptions`, `UnitBindingOptions`, `PunctuationSpacingRule`, `PunctuationSpacingPreset`, `Base14Metrics`, `HyphenationProvider`, `ColourBarOptions`, `PdfCmykTuple`, `PdfCmykString`, `PdfXConformanceTarget`) |
| Quality | 292 tests / 18 files · 95 % | 811 tests / 43 files · 96.24 % statements · 38 samples held to a byte baseline on Linux, Windows and macOS · an in-process PDF/X-4 gate beside the blocking veraPDF gate · npm Trusted Publishing with an SBOM and a provenance attestation |
| Compatibility | `pdfnative ^1.7.0` peer | **`pdfnative ^1.8.0`** peer; React `^19.0.0` and Node ≥ 22 unchanged |

Full changelog: [pdfnative-react release notes v1.3.0](https://github.com/Nizoka/pdfnative-react/releases/tag/v1.3.0). <!-- verify-docs:allow version-token (historical link) -->

**Upgrading from v1.2.0** — no breaking changes; a drop-in replacement once the engine is at 1.8.0:

1. **Rebaseline once if you compare bytes.** TrueType subsets, printer's marks and shaped scripts change bytes (each was previously wrong); base-14-only documents on a UTC host are unchanged.
2. **Dates are UTC** (`+00'00'` / `+00:00`) — the same instant, a different offset string.
3. `{date}` follows a pinned `creationDate`; unpinned documents are unchanged.
4. `setDeflateImpl` rejects raw DEFLATE — pass zlib output, or use `setDeflateRawImpl`.
5. Hand-made ICC stubs in `outputIntent` are rejected (`acsp` signature and size field are checked).
6. `PdfDiagnosticCode` gained six codes — an exhaustive `switch` with a `never` check needs them.
7. New lint rules add nothing to existing documents; `report.ok` for a v1.2.0 document is unchanged.
8. `Color` and `ParagraphAlign` widened; `Align` is unchanged. A consumer that reads a `Color` into a three-tuple variable needs a length guard.
9. For fork maintainers: `VERAPDF_REQUIRED=1` → `--require-all`; `.mjs` corpus scripts → `npx tsx scripts/<name>.ts`; `npm install` runs no lifecycle scripts; the drift-gate grep in AGENTS.md is replaced by `npm run verify:docs`.

### Previously in v1.2.0

v1.2.0 follows the pdfnative 1.7.0 engine — charts v2, print production, and the conformance channel — and is **100 % additive**: no component, hook or function was removed or changed shape. The only floor that moves is the `pdfnative` peer, `^1.6.0` → `^1.7.0`. <!-- verify-docs:allow version-token (historical: what v1.2.0 shipped with) -->

| Area | v1.1.0 | v1.2.0 |
|---|---|---|
| Charts | 5 types | **9 types** (`stackedBar`, `stackedBarH`, `area`, `scatter`) + `axis2`, `xAxis` (category / linear / time), log scale on the value axes, `dataLabels`, `labelStride`, `labelRotation` |
| Print | — | **`<Document print>`** / `DocSpec.print` — bleed shorthand, page boxes, printer's marks, `/UserUnit`; viewer preferences and a custom output intent via `layout` |
| Conformance | — | `layout.strict` / `layout.onDiagnostic` expose the engine's PDF/A diagnostics channel; new `PdfDiagnostic*` types |
| HTTP | `renderToResponse` | + `cacheControl` and `etag` options; streamability validated **before** the first byte |
| Linting | 18 rules <!-- verify-docs:allow count-tokens (migration history) --> | **25 rules** (7 new, incl. `L_PRINT_BOXES` which delegates to the engine's `validatePrintOptions`) |
| Fonts | `resolveFonts` emitted an invalid bare `fontRef` | **fixed** — slash-prefixed PDF names (`/latin`, `/th`, …); re-render anything produced through `resolveFonts` / the `fonts` option |
| Exports | — | +`setDeflateImpl` and 8 types (`PrintOptions`, `PrinterMarksOptions`, `PageBox`, `CustomOutputIntent`, `PdfDiagnostic`, `PdfDiagnosticCode`, `PdfDiagnosticHandler`, `PdfColors`) |
| Quality | — | 292 tests / 18 files · 95 % statement coverage · a veraPDF gate over an 11-file PDF/A corpus (with 2 negative canaries) blocks CI and publish |
| Compatibility | `pdfnative ^1.6.0` peer | **`pdfnative ^1.7.0`** peer; React `^19.0.0` and Node ≥ 22 unchanged |

Full changelog: [pdfnative-react release notes v1.2.0](https://github.com/Nizoka/pdfnative-react/releases/tag/v1.2.0). <!-- verify-docs:allow version-token (historical link) -->

### Previously in v1.1.0

<!-- verify-docs:allow version-token (historical release entry) -->
v1.1.0 brought the engine's 1.6 surface to the renderer — `<Chart>`, the `DocSpec` chart tuple, and the agent discovery pair (`capabilityManifest` / `doctor`) — on the `pdfnative ^1.6.0` peer.

---

## Resources

- 📦 **npm:** [pdfnative-react](https://www.npmjs.com/package/pdfnative-react)
- 🏛️ **Repo:** [Nizoka/pdfnative-react](https://github.com/Nizoka/pdfnative-react)
- 📚 **Knowledge base:** [pdfnative-react/docs/KNOWLEDGE_BASE.md](https://github.com/Nizoka/pdfnative-react/blob/main/docs/KNOWLEDGE_BASE.md) — the compile pipeline, the react-reconciler version contract, and the agent authoring contract
- 📁 **Samples:** [pdfnative-react/samples](https://github.com/Nizoka/pdfnative-react/tree/main/samples)
- 🧪 **Try it interactively:** [React playground](../playgrounds/react.html) — render JSX to PDF in your browser
- 📐 **Use cases:** [React use cases](use-cases-react.html) — a DocSpec lint gate in CI, book-style typography in JSX, one tree for PDF/A and PDF/X-4
- 🔧 **Underlying library:** [`pdfnative`](https://github.com/Nizoka/pdfnative)
- 🤖 **AI integration:** [pdfnative-mcp guide](mcp.html) · 💻 **Terminal:** [pdfnative-cli guide](cli.html)
- 🐛 **Report a bug:** [Nizoka/pdfnative-react/issues](https://github.com/Nizoka/pdfnative-react/issues)
