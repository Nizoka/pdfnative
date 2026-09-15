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

## Diagnostics and build-time errors (v1.8.0)

Geometry is one thing to debug; the other is a build that warns or refuses.
Every engine diagnostic code and every build-time message a downstream tool
must classify is listed in [`docs/data/errors.json`](../data/errors.json)
(`diagnostics` and `buildErrors`) — read that file first when a message is
unfamiliar.

**`TYPOGRAPHY_FEATURE_INEFFECTIVE`** — a `typography.fontFeatures` tag
changed nothing: no registered font declares it, or the font declares it but
no glyph in the document was substituted. The classic case is `tnum` or
`lnum` with the bundled Noto Sans, whose figures are tabular and lining by
default, so there is nothing to substitute (`pnum` and `onum` do change
glyphs there). It is a warning — `console.warn` once per build by default,
every occurrence through `layout.onDiagnostic`, a thrown error under
`layout.strict` — because the same document may be built with different
fonts. Drop the tag, or register a font whose GSUB declares it; the effective
tags are the keys of the font module's `features` table.

```ts
buildDocumentPDFBytes(params, {
  typography: { fontFeatures: ['tnum'] },
  onDiagnostic: (d) => console.error(d.code, d.message), // TYPOGRAPHY_FEATURE_INEFFECTIVE
});
```

**PDF/X coherence errors** — `pdfx: 'pdfx4'` is checked before any byte is
written, and an incoherent layout throws one of seven messages (each with
its remedy):

| Message | Remedy |
|---|---|
| `layout.pdfx: unknown target '${target}' — use one of ${PDF_X_CONFORMANCE_TARGETS}` | Use `'pdfx4'`. |
| `layout.pdfx and layout.tagged cannot be combined — pdfnative writes one conformance claim per file; drop one of them` | Build the print file and the archival file as two documents. |
| `PDF/X forbids encryption (ISO 15930-7) — drop layout.encryption or layout.pdfx` | Drop one of the two. |
| `PDF/X-4 requires layout.outputIntent: the ICC profile of the printing condition, e.g. ISO Coated v2 or GRACoL from your printer. pdfnative ships no press profile` | Pass the output ICC profile your printer names. |
| `PDF/X-4 requires an output (printer) profile as layout.outputIntent — the supplied profile's class is '${deviceClass}'` | Use a press profile (device class `prtr`), not a monitor profile such as sRGB. |
| `PDF/X requires the trapping state to be known — set metadata.trapped to 'True' or 'False', or omit it for 'False'` | State `'True'` or `'False'`; pdfnative never traps, so `'False'` is accurate for its output. |
| `PDF/X pages carry a TrimBox or an ArtBox, not both — drop print.artBox, or print.trimBox and print.bleed` | Keep one of the two boxes. |

The messages start with `PDF/X` or `layout.pdfx`; a CLI or server that maps
`print.`, `chart:` and `outputIntent.` prefixes to an input-error code should
add those two.

**`setDeflateImpl()` throws on raw DEFLATE** — since v1.8.0 the injected
compressor is validated, and a function that returns a raw RFC 1951 payload
(fflate's `deflateSync`, `CompressionStream`'s `'deflate-raw'`) fails at
build time instead of producing pages that render blank
([#78](https://github.com/Nizoka/pdfnative/issues/78)). Pass a
zlib-wrapping function to `setDeflateImpl()` — fflate's `zlibSync`, pako's
`deflate`, `node:zlib` `deflateSync` — or hand the raw one to
`setDeflateRawImpl()` and let pdfnative add the envelope. An asynchronous
compressor cannot be adapted at all; PDF assembly is synchronous.

**`punctuationSpacing: 'fr'` looks like `'fr-CA'`** — the `'fr'` preset
sets a narrow no-break space (U+202F) before `;` `!` `?`. WinAnsi has no
such character, so on the base-14 (non-embedded) path it degrades to an
ordinary space and the two presets become indistinguishable. Register a
Latin font that carries the glyph — Noto Sans does — and pass it in
`fontEntries`; the narrow space is then rendered and extracts as U+202F.

## Sample

[layout-debug-overlay.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/layout-debug-overlay.ts)
renders the same document twice — once clean, once with the overlay — and prints
the `inspectDocumentLayout()` report.
