# Accessibility

pdfnative produces **tagged, accessible PDFs** out of the box. This guide covers PDF/UA, PDF/A, the structure tree, and best practices for screen-reader-friendly output.

## Why tagged PDF matters

A tagged PDF carries a parallel **structure tree** alongside the visual content. Assistive technologies (screen readers, refreshable braille displays, reflow tools) walk the structure tree to present the document in reading order — without it, they fall back to heuristic guessing of what's a heading, a paragraph, or a table cell.

pdfnative's tagged mode targets two related standards:

- **PDF/UA** (ISO 14289-1) — accessibility conformance, structure tree required.
- **PDF/A** (ISO 19005) — long-term archival, with PDF/A-2u additionally requiring Unicode mapping for every glyph.

## Enabling tagged mode

```typescript
const pdf = buildDocumentPDFBytes(params, { tagged: true });
```

`tagged: true` is shorthand for `tagged: 'pdfa2b'` — the modern default.

| Option | PDF version | Standard | Use case |
|--------|-------------|----------|----------|
| `tagged: false` (default) | 1.4 | ISO 32000-1 | Simple PDFs, no accessibility guarantees |
| `tagged: true` | 1.7 | PDF/A-2b | **Recommended** — accessible + archival |
| `tagged: 'pdfa1b'` | 1.4 | PDF/A-1b | Legacy archives requiring PDF 1.4 |
| `tagged: 'pdfa2u'` | 1.7 | PDF/A-2u | Archive with mandatory text extraction |
| `tagged: 'pdfa3b'` | 1.7 | PDF/A-3b | PDF/A-2b + embedded files (e.g. ZUGFeRD invoices) |

## What pdfnative emits

When `tagged` is enabled, the document gets:

- **Structure tree** (`/StructTreeRoot`) with semantic roles:
  - `/Document` (root)
  - `/H1`, `/H2`, `/H3` for headings
  - `/P` for paragraphs
  - `/L` → `/LI` for lists
  - `/Table` → `/TR` → `/TH` / `/TD` for tables
  - `/Figure` for images, barcodes, SVG (with `/Alt` text)
  - `/Link` for hyperlinks (with `/Contents` description)
  - `/Form` for AcroForm fields
  - `/TOC` → `/TOCI` for tables of contents
- **Marked content** (`/Span << /MCID n /ActualText <hex> >> BDC`) wrapping every text run, so screen readers receive the original Unicode even when the visible glyph is a shaped Arabic ligature or Devanagari conjunct.
- **Per-page parent trees** (`/StructParents` + `/ParentTree`) — required by ISO 14289-1 §7.10.3.
- **Document metadata** in XMP (PDF/A-required).
- **sRGB ICC OutputIntent** so colors remain stable across viewers.

## Block-level accessibility hints

### Images, barcodes, SVG → require `alt`

```typescript
{ type: 'image',  data: pngBytes, width: 300, alt: 'Q1 revenue chart, $1.2M peak in March' }
{ type: 'svg',    data: logoSvg, width: 200, alt: 'Company logo' }   // note: property is `data`
{ type: 'barcode', format: 'qr', data: 'https://example.com', alt: 'QR code linking to product page' }
```

Every `/Figure` in the structure tree gets an `/Alt` entry from the `alt` property. **Always provide alt text** for non-decorative images — empty strings are treated as decorative and may be skipped by screen readers.

### Links → meaningful link text

```typescript
{ type: 'link', text: 'Read the API reference', url: 'https://github.com/Nizoka/pdfnative#api' }
```

Avoid `text: 'click here'` — screen reader users who navigate by link list lose context.

### Tables → header rows are detected automatically

When you pass a `headers` array, those cells are tagged `/TH` and the data rows are tagged `/TD`. For complex tables with span-cells or merged headers, pdfnative currently emits flat `/Table → /TR → /TH|TD` — explicit cell scopes (`/Scope = Row|Column`) are not yet exposed.

### Forms → label every field

```typescript
{ type: 'formField', fieldType: 'text', name: 'email', label: 'Email address', width: 400 }
```

The `label` becomes the field's `/TU` (tooltip / accessible name) and is consumed by screen readers when focus enters the field.

## Verifying conformance

### veraPDF (PDF/A)

```bash
npm install -g verapdf
verapdf --format text my-document.pdf
```

veraPDF is the reference PDF/A validator. The pdfnative test suite generates ~140 sample PDFs and the PDF/A samples are validated against veraPDF on every release.

### PAC 2024 (PDF/UA)

[PAC](https://pac.pdf-accessibility.org/) (PDF Accessibility Checker) is a free Windows tool that walks the structure tree and reports PDF/UA issues. Run it on samples in `test-output/tagged/`.

### Screen reader spot-check

For a real-world test, open your PDF with **NVDA** (Windows, free), **VoiceOver** (macOS, built in), or **TalkBack** (Android). Listen to the reading order — it should match the visual order.

## Limitations and known caveats

| Area | Status |
|------|--------|
| Heading roles `/H1`–`/H3` | Supported |
| `/H4`–`/H6` | Mapped to `/H3` (PDF/UA permits this) |
| Cell scope `/Scope` | Not yet exposed — flat table tags |
| Reading order overrides | Implicit (block insertion order) — no explicit `/Order` array |
| Language tags per text run | Document-level only (`/Lang` in catalog) |
| Artifact tagging (decorative content) | Not yet exposed — header/footer/watermark are tagged as content |

Contributions to address these are welcome — see the [Roadmap](https://github.com/Nizoka/pdfnative/blob/main/ROADMAP.md).

## Testing your PDFs are accessible

A pragmatic checklist for solo developers:

- [ ] `tagged: true` is set on every user-facing PDF.
- [ ] Every `image` / `svg` / `barcode` block has a meaningful `alt`.
- [ ] Every `link` has descriptive text (no "click here").
- [ ] Every `formField` has a `label`.
- [ ] Sample passes veraPDF for the chosen PDF/A variant.
- [ ] Sample reads in the correct order in NVDA/VoiceOver.
- [ ] If the document is multi-language, the dominant language is set in the document title.

## Further reading

- [ISO 14289-1 (PDF/UA-1)](https://www.iso.org/standard/64599.html) — full PDF/UA specification.
- [Matterhorn Protocol 1.1](https://www.pdfa.org/resource/the-matterhorn-protocol/) — ~136 verifiable PDF/UA failure conditions.
- [veraPDF documentation](https://docs.verapdf.org/) — running validation in CI.
- [WebAIM PDF accessibility](https://webaim.org/techniques/acrobat/) — accessibility primer.
