# Annotations (read & write)

> **New in v1.5.0.** pdfnative now has a typed **markup-annotation** model plus
> round-trip **read** and **write** support. Build annotations for a new
> document, read the annotations out of an existing PDF, or inject new ones into
> an existing PDF via incremental update — all zero-dependency, all
> ISO 32000-1 §12.5.

## Supported annotation types

| `type` | PDF `/Subtype` | Use |
|---|---|---|
| `text` | `/Text` | Sticky-note comment with an icon |
| `highlight` | `/Highlight` | Highlight a text region |
| `underline` | `/Underline` | Underline a text region |
| `strikeout` | `/StrikeOut` | Strike through a text region |
| `squiggly` | `/Squiggly` | Squiggly (spellcheck-style) underline |
| `square` | `/Square` | Rectangle |
| `circle` | `/Circle` | Ellipse |
| `line` | `/Line` | Straight line |
| `freetext` | `/FreeText` | Typewriter / callout text |

Every type shares `AnnotationBase`: `rect`, and optional `contents`, `color`,
`opacity`, `title`, `modified`, `flags`.

## Building annotations

```ts
import { buildAnnotation } from 'pdfnative';
import type { MarkupAnnotation } from 'pdfnative';

const note: MarkupAnnotation = {
  type: 'text',
  rect: [72, 700, 96, 724],
  contents: 'Please double-check this figure.',
  title: 'Reviewer',
  icon: 'Comment',
};

// Full indirect object, ready to concatenate into a PDF you assemble yourself:
const obj = buildAnnotation(note, /* objNum */ 42);
```

- `buildAnnotation(annot, objNum)` returns a complete `N 0 obj … endobj` string.
- `buildAnnotationBody(annot)` returns just the dictionary body — used by the
  modifier when injecting into an existing file.

`/Contents` and `/T` are safely encoded (UTF-16BE when needed), `/C` / `/IC`
run through `parseColor`, `/QuadPoints` are auto-derived from `rect` for the
text-markup types, and `/F` defaults to `4` (Print).

## Reading annotations from an existing PDF

```ts
import { openPdf } from 'pdfnative';

const reader = openPdf(existingBytes);
const annots = reader.getAnnotations(0); // page index 0

for (const a of annots) {
  console.log(a.subtype, a.rect, a.contents, a.url);
}
```

`getAnnotations(pageIndex)` returns `ParsedAnnotation[]` with `subtype`, `rect`,
and optional `contents` (UTF-16BE decoded), `title`, `color`, `quadPoints`, and
`url` (for URI-action links). `getPageRef(pageIndex)` returns the page's
indirect reference when you need it.

## Writing annotations into an existing PDF

Add a new annotation to an existing document with a non-destructive incremental
update:

```ts
import { openPdf, createModifier, buildAnnotationBody } from 'pdfnative';

const reader = openPdf(existingBytes);
const modifier = createModifier(reader);

const body = buildAnnotationBody({
  type: 'highlight',
  rect: [72, 640, 300, 656],
  color: '#ffe14d',
  contents: 'Key clause',
});

modifier.addAnnotation(0, body); // inject on page 0
const updated = modifier.save();  // appended incremental section, original preserved
```

`addAnnotation()` appends the annotation object and rewrites the page's
`/Annots` array in an incremental update section — the original bytes are never
mutated, so any existing signature's byte range upstream of the appended section
stays intact.

## Sample

[annotations-showcase.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/annotations-showcase.ts)
builds a document with every annotation type, reads them back out, and injects a
highlight into an existing PDF.
