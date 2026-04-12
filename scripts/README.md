# scripts/ – Sample PDF Generation

Generates 114+ sample PDFs for visual inspection across all supported languages, features, and edge cases.

## Quick Start

```bash
npm run test:generate
```

Output: `test-output/*.pdf` (git-ignored).

## Architecture

```
scripts/
├── generate-samples.ts      # Orchestrator — registers fonts, inits compression, calls generators
├── helpers/
│   ├── io.ts                # I/O: createContext(), writeSafe(), printSummary(), OUTPUT_DIR
│   ├── fonts.ts             # Font registration: registerAllFonts(), loadFontEntries(), loadMultiFontEntries()
│   ├── images.ts            # Synthetic images: makeMinimalJPEG(), makeLargeJPEG(), makeSyntheticPNG()
│   └── types.ts             # Shared interfaces: LangSample, PdfASample, EncryptSample, DocSample
├── data/
│   ├── financial-data.ts    # 12 language financial statement samples + multi-lang + pagination
│   ├── diverse-data.ts      # 12 non-financial use-case samples (transcript, recipe, inventory…)
│   ├── alphabet-data.ts     # 11 per-script character coverage verification samples
│   └── doc-samples-data.ts  # 9 document builder samples (headings, lists, links, tables, images…)
└── generators/
    ├── financial-statements.ts  # 14 PDFs – financial tables in 12 languages + multi + pagination
    ├── diverse-use-cases.ts     # 12 PDFs – non-financial domain tables
    ├── alphabet-coverage.ts     # 11 PDFs – per-script glyph verification
    ├── pdfa-variants.ts         #  5 PDFs – PDF/A-1b, PDF/A-2b (default + explicit), PDF/A-2u, PDF/A-3b
    ├── encryption.ts            #  6 PDFs – AES-128/256, passwords, permissions
    ├── document-builder.ts      # 19 PDFs – DOC_SAMPLES loop + Unicode docs (JA, AR, HE, ZH, TH…)
    ├── compression.ts           #  9 PDFs – FlateDecode size comparisons + compressed non-Latin
    ├── barcode-showcase.ts      #  3 PDFs – 5 barcode formats, alignment/sizing, tagged PDF/A
    ├── watermarks.ts            #  6 PDFs – text + image watermarks, opacity, rotation, bg/fg
    ├── headers-footers.ts       #  4 PDFs – PageTemplate zones, placeholders, multi-page
    ├── page-sizes.ts            #  6 PDFs – A4, Letter, Legal, A3, Tabloid, A3 landscape
    ├── toc-showcase.ts          #  3 PDFs – multi-level TOC, dot leaders, GoTo links, tagged
    └── stress-edge.ts           # 13 PDFs – 10K rows, BiDi, heavy text, images, annotations, edge cases
```

## How It Works

1. **`generate-samples.ts`** (orchestrator) calls `registerAllFonts()` and `initNodeCompression()`
2. Creates a `GenerateContext` with `writeSafe()` (handles EBUSY, counts pages)
3. Calls each generator's `generate(ctx)` sequentially
4. Prints a summary table with file names, page counts, and sizes

Each generator is a self-contained async function that receives the shared context.

## Type Checking

Scripts have their own TypeScript configuration:

```bash
npm run typecheck:scripts    # tsc --project tsconfig.scripts.json --noEmit
npm run typecheck:all        # includes src/ + tests/ + scripts/
```

`tsconfig.scripts.json` includes `@types/node` for `fs`, `path`, `process` access.

## Adding a New Sample Category

1. Create `scripts/generators/my-feature.ts`:
   ```ts
   import { resolve } from 'path';
   import type { GenerateContext } from '../helpers/io.js';

   export async function generate(ctx: GenerateContext): Promise<void> {
       // Build PDF bytes…
       ctx.writeSafe(resolve(ctx.outputDir, 'my-sample.pdf'), 'my-sample.pdf', bytes);
   }
   ```
2. Import and call it in `generate-samples.ts`:
   ```ts
   import { generate as generateMyFeature } from './generators/my-feature.js';
   // Inside generateAll():
   await generateMyFeature(ctx);
   ```
3. Run `npm run typecheck:scripts` to verify types

## Adding a New Language Sample

1. Add the `LangSample` entry to the appropriate data file in `scripts/data/`
2. Register the font in `scripts/helpers/fonts.ts` → `registerAllFonts()`
3. The generator loops automatically pick up new entries
