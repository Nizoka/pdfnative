# pdfnative-react — Declarative JSX Renderer Guide

> **Tracks `pdfnative-react` v0.2.0** (first implemented release), built on `pdfnative` 1.3.0 and **React 19**. Full release notes: [pdfnative-react releases](https://github.com/Nizoka/pdfnative-react/releases). The live version is shown at the top of the [documentation home](../index.html).

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

**Requirements:** **React 19** (peer dependency) · **Node.js ≥ 20**. Works in Node, browsers, and SSR frameworks (Next.js, Remix). Client modules carry `'use client'`.

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

Every component maps 1:1 onto a pdfnative block.

| Component | Renders |
|---|---|
| `Document` | The required root (`title`, `footerText`, `metadata`, `fontEntries`, `layout`). |
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

---

## Rendering

```ts
import {
  renderToBytes,   // (node, options?) => Uint8Array
  renderToBlob,    // (node, options?) => Blob (application/pdf)
  renderToStream,  // (node, options?) => AsyncGenerator<Uint8Array> (constant memory)
  renderToFile,    // (node, path, options?) => Promise<void> (Node only)
  compileDocument, // (node) => DocumentParams (inspect the model, no render)
} from 'pdfnative-react';
```

`options` is `{ layout?: Partial<PdfLayoutOptions>; fontEntries?: FontEntry[] }` and merges on top of anything set on `<Document>` — page size, margins, colors, PDF/A mode, encryption, and non-Latin fonts.

```ts
const bytes = renderToBytes(<Invoice />, {
  layout: { tagged: 'pdfa2b', compress: true },
});
```

---

## Hooks & client components

Client modules carry `'use client'`.

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

**Block tuples:** `['h1'|'h2'|'h3', text, opts?]`, `['p', text, opts?]`, `['ul'|'ol', items, opts?]`, `['table', { h?, r }]`, `['img', { data }]`, `['link', text, { url }]`, `['sp', height?]`, `['br']`, `['page', blocks]`, `['toc', opts?]`, `['qr'|'code128'|'ean13'|'pdf417'|'datamatrix', data, opts?]`, `['svg', data, opts?]`, `['field', { fieldType, name, … }]`.

---

## Fonts & environment

Re-exported from the engine: `registerFonts`, `registerFont`, `loadFontData` (Node), `downloadBlob` (browser), `initNodeCompression` (Node). Pass non-Latin fonts via the `fontEntries` render option (or on `<Document fontEntries={…}>`), unlocking all 22 bundled Unicode scripts and COLRv1 colour emoji exactly as in the core library.

```tsx
import { Document, Text, renderToBytes, loadFontData } from 'pdfnative-react';

const thai = await loadFontData('th');
const bytes = renderToBytes(
  <Document title="สวัสดี" fontEntries={[thai]}>
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
| `usePDF()` | `usePdf()` |

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

## Resources

- 📦 **npm:** [pdfnative-react](https://www.npmjs.com/package/pdfnative-react)
- 🏛️ **Repo:** [Nizoka/pdfnative-react](https://github.com/Nizoka/pdfnative-react)
- 📚 **Knowledge base:** [pdfnative-react/docs/KNOWLEDGE_BASE.md](https://github.com/Nizoka/pdfnative-react/blob/main/docs/KNOWLEDGE_BASE.md) — the compile pipeline, the react-reconciler version contract, and the agent authoring contract
- 📁 **Samples:** [pdfnative-react/samples](https://github.com/Nizoka/pdfnative-react/tree/main/samples)
- 🧪 **Try it interactively:** [React playground](../playgrounds/react.html) — render JSX to PDF in your browser
- 🔧 **Underlying library:** [`pdfnative`](https://github.com/Nizoka/pdfnative)
- 🤖 **AI integration:** [pdfnative-mcp guide](mcp.html) · 💻 **Terminal:** [pdfnative-cli guide](cli.html)
- 🐛 **Report a bug:** [Nizoka/pdfnative-react/issues](https://github.com/Nizoka/pdfnative-react/issues)
