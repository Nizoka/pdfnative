# pdfnative-react — Declarative JSX Renderer Guide

> **Tracks the latest published `pdfnative-react`** (v1.2.0, built on pdfnative 1.7.0), with **React 19** and `pdfnative` ^1.7.0 as peer dependencies. Live package versions — and the `pdfnative` version each one is built on — are shown at the top of the [documentation home](../index.html). Full history: [pdfnative-react releases](https://github.com/Nizoka/pdfnative-react/releases).

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

**Requirements:** **React 19** and **pdfnative ^1.7.0** (both peer dependencies) · **Node.js ≥ 22**. The package adds one runtime dependency of its own, `react-reconciler`. Works in Node, browsers and SSR frameworks.

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
| `Document` | The required root (`title`, `footerText`, `metadata`, `fontEntries`, `layout`, and — v1.2.0 — `print`). |
| `Page` | An explicit page boundary (content auto-paginates otherwise). |
| `Heading` | A section heading (`level` 1–3); feeds the auto `TableOfContents`. |
| `Paragraph` / `Text` | A wrapping paragraph (`fontSize`, `lineHeight`, `align`, `indent`, `color`). |
| `List` / `Item` | A bullet or numbered (`ordered`) list. |
| `Table` / `Row` / `Cell` | A data table (data-driven `headers`/`rows`, or JSX `<Row>`/`<Cell>`). |
| `Image` | An embedded JPEG/PNG (`data: Uint8Array`). |
| `Link` | A clickable hyperlink (`url`/`href`). |
| `Spacer` | Vertical whitespace (`height`). |
| `PageBreak` | A hard page break. |
| `TableOfContents` / `Toc` | An auto-generated TOC built from headings. |
| `Barcode` | QR, Code 128, EAN-13, PDF417, Data Matrix (`format`, `data`). |
| `Svg` | Inline vector graphics (path data or markup). |
| `FormField` | Interactive AcroForm widgets (`fieldType`, `name`). |
| `Chart` | A native vector chart (`chartType`, `series`, `categories`, `altText`, …) — see [Charts](#charts). |
| `Section` | *Composite* (the one exception to the 1:1 mapping): expands to an optional `PageBreak` + a `Heading` + its children before the reconciler runs. Props: `title`, `level` (default `2`), `color`, `break`. |

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
covers every engine `ChartBlock` field — which is exactly why the `pdfnative`
peer floor is `^1.7.0`: a 1.6 engine would throw mid-render on the v2 fields.

## Print production &amp; conformance diagnostics _(v1.2.0)_

`<Document print={…}>` is document-level sugar over `layout.print` — the typed
`PrintOptions` covers `bleed` (a shorthand that derives `TrimBox` and
`BleedBox`), explicit `trimBox` / `bleedBox` / `artBox` / `cropBox` page boxes,
vector printer's marks, and `/UserUnit`. The companion types ship from the root
barrel: `PrintOptions`, `PrinterMarksOptions`, `PageBox`, `CustomOutputIntent`,
and `PdfColors`. Viewer preferences (`duplex`, `pickTrayByPDFSize`,
`printPageRange`, `numCopies`) and a custom RGB ICC `outputIntent` pass through
`layout` untouched.

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

## Linting

`lintDocument` runs 25 deterministic rules over a compiled tree — no I/O, so it
is safe in a test or a CI step. It catches the classes of mistake a type system
cannot, including `L_TAGGED_NO_FONTS`: declaring PDF/A without embedding a font,
which produces a file that claims conformance it does not have. Thirteen of the
rules pre-empt an engine throw with a named, actionable finding.

v1.2.0 adds seven rules for the new surface: `L_CHART_LOG_SCALE`,
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

`options` is `{ layout?: Partial<PdfLayoutOptions>; fontEntries?: FontEntry[]; fonts?: FontsMap }` and merges on top of anything set on `<Document>` — page size, margins, colors, PDF/A mode, encryption, and non-Latin fonts. Note that `fonts` is only honored by the **async** entry points (`renderToFile`, `renderToFileStream`, `renderToResponse`, `usePdf`, `usePdfStream`) — font loading is asynchronous, so the synchronous entries (`renderToBytes`, `renderToBlob`, `renderToStream`) ignore it; resolve manually first (`fontEntries: await resolveFonts(fonts)`).

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
dual-axis document before rendering it.

---

## Fonts & environment

Re-exported from the engine: `registerFonts`, `registerFont`, `loadFontData`, `validateFontData`, `downloadBlob` (browser), `initNodeCompression` (Node), and — v1.2.0 — `setDeflateImpl`, which plugs a **synchronous** deflate implementation into the engine for compressed client-side rendering (the function's output is written verbatim, so it must produce a zlib-wrapped RFC 1950 stream — e.g. fflate's `zlibSync`; the async browser `CompressionStream` cannot be plugged in). (`loadFontData` is a pure dynamic import — it works in the browser too.) Pass non-Latin fonts via the `fontEntries` render option (or on `<Document fontEntries={…}>`), unlocking all 22 bundled Unicode scripts and COLRv1 colour emoji exactly as in the core library.

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

### What's new in v1.2.0

v1.2.0 follows the pdfnative 1.7.0 engine — charts v2, print production, and the conformance channel — and is **100 % additive**: no component, hook or function was removed or changed shape. The only floor that moves is the `pdfnative` peer, `^1.6.0` → `^1.7.0`.

| Area | v1.1.0 | v1.2.0 |
|---|---|---|
| Charts | 5 types | **9 types** (`stackedBar`, `stackedBarH`, `area`, `scatter`) + `axis2`, `xAxis` (category / linear / time), log scale on the value axes, `dataLabels`, `labelStride`, `labelRotation` |
| Print | — | **`<Document print>`** / `DocSpec.print` — bleed shorthand, page boxes, printer's marks, `/UserUnit`; viewer preferences and a custom output intent via `layout` |
| Conformance | — | `layout.strict` / `layout.onDiagnostic` expose the engine's PDF/A diagnostics channel; new `PdfDiagnostic*` types |
| HTTP | `renderToResponse` | + `cacheControl` and `etag` options; streamability validated **before** the first byte |
| Linting | 18 rules | **25 rules** (7 new, incl. `L_PRINT_BOXES` which delegates to the engine's `validatePrintOptions`) |
| Fonts | `resolveFonts` emitted an invalid bare `fontRef` | **fixed** — slash-prefixed PDF names (`/latin`, `/th`, …); re-render anything produced through `resolveFonts` / the `fonts` option |
| Exports | — | +`setDeflateImpl` and 8 types (`PrintOptions`, `PrinterMarksOptions`, `PageBox`, `CustomOutputIntent`, `PdfDiagnostic`, `PdfDiagnosticCode`, `PdfDiagnosticHandler`, `PdfColors`) |
| Quality | — | 292 tests / 18 files · 95 % statement coverage · a veraPDF gate over an 11-file PDF/A corpus (with 2 negative canaries) blocks CI and publish |
| Compatibility | `pdfnative ^1.6.0` peer | **`pdfnative ^1.7.0`** peer; React `^19.0.0` and Node ≥ 22 unchanged |

Full changelog: [pdfnative-react release notes v1.2.0](https://github.com/Nizoka/pdfnative-react/releases/tag/v1.2.0).

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
- 🔧 **Underlying library:** [`pdfnative`](https://github.com/Nizoka/pdfnative)
- 🤖 **AI integration:** [pdfnative-mcp guide](mcp.html) · 💻 **Terminal:** [pdfnative-cli guide](cli.html)
- 🐛 **Report a bug:** [Nizoka/pdfnative-react/issues](https://github.com/Nizoka/pdfnative-react/issues)
