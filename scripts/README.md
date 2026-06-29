# scripts/ – Sample PDF Generation

Generates 201 sample PDFs (36 generators) for visual inspection across all supported languages, features, and edge cases.

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
│   ├── financial-data.ts    # 14 language financial statement samples + multi-lang + pagination
│   ├── diverse-data.ts      # 12 non-financial use-case samples (transcript, recipe, inventory…)
│   ├── alphabet-data.ts     # 22 per-script character coverage verification samples (incl. Telugu/Sinhala/Tibetan/Khmer/Myanmar/Ethiopic, v1.3.0)
│   └── doc-samples-data.ts  # 11 document builder samples (headings, lists, links, tables, images, SVG, forms…)
└── generators/
    ├── financial-statements.ts  # 14 PDFs – financial tables in 14 languages + multi + pagination
    ├── diverse-use-cases.ts     # 12 PDFs – non-financial domain tables
    ├── alphabet-coverage.ts     # 22 PDFs – per-script glyph verification (incl. Telugu/Sinhala/Tibetan/Khmer/Myanmar/Ethiopic, v1.3.0)
    ├── pdfa-variants.ts         #  5 PDFs – PDF/A-1b, PDF/A-2b (default + explicit), PDF/A-2u, PDF/A-3b
    ├── pdfa-latin-embedding.ts  #  4 PDFs – PDF/A Latin VF font with curly quotes, em-dash (v1.1.0, #28)
    ├── emoji-showcase.ts        #  3 PDFs – monochrome emoji, multi-script mix, table (v1.1.0)
    ├── color-emoji-showcase.ts  #  3 PDFs – COLRv1 colour emoji: basic, mixed, real-world status report (v1.3.0)
    ├── currency-symbols.ts      #  3 PDFs – base-14 €£¥¢ + extended ₹₩₪₫₺₽₿฿ (latin font) + multi price table (v1.3.0)
    ├── encryption.ts            #  6 PDFs – AES-128/256, passwords, permissions
    ├── document-builder.ts      # 20 PDFs – DOC_SAMPLES loop + Unicode docs (JA, AR, HE, ZH, TH, BN, TA, TE…)
    ├── compression.ts           #  9 PDFs – FlateDecode size comparisons + compressed non-Latin
    ├── barcode-showcase.ts      #  3 PDFs – 5 barcode formats, alignment/sizing, tagged PDF/A
    ├── watermarks.ts            #  6 PDFs – text + image watermarks, opacity, rotation, bg/fg
    ├── headers-footers.ts       #  4 PDFs – PageTemplate zones, placeholders, multi-page
    ├── page-sizes.ts            #  6 PDFs – A4, Letter, Legal, A3, Tabloid, A3 landscape
    ├── toc-showcase.ts          #  3 PDFs – multi-level TOC, dot leaders, GoTo links, tagged
    ├── svg-showcase.ts          #  3 PDFs – SVG path/shape rendering, viewBox scaling, tagged
    ├── form-showcase.ts         #  3 PDFs – AcroForm field types, appearance streams, tagged
    ├── digital-signature.ts     #  2 PDFs – RSA + ECDSA digital signatures
    ├── signature-placeholder.ts #  2 PDFs – addSignaturePlaceholder() workflow + idempotency proof (#45)
    ├── streaming-showcase.ts    #  2 PDFs – AsyncGenerator streaming output
    ├── parser-showcase.ts       #  2 PDFs – PDF reader/modifier round-trip
    ├── text-shaping-deep.ts     #  4 PDFs – multi-script shaping, GSUB/GPOS, fallback
    ├── bidi-algorithm.ts        #  2 PDFs – BiDi resolution, mixed LTR/RTL, bracket pairing
    ├── bidi-embeddings-showcase.ts # 1 PDF  – UAX #9 LRE/RLE/LRO/RLO/PDF normalisation
    ├── use-lite-showcase.ts     #  1 PDF  – USE-lite cluster classification
    ├── document-table-parity.ts #  1 PDF  – document vs legacy table rendering parity
    ├── crypto-showcase.ts       #  2 PDFs – RSA + ECDSA round-trip, CMS structure
    ├── font-subsetting-deep.ts  #  2 PDFs – TTF subsetting, CIDFont glyph mapping
    ├── parser-deep.ts           #  2 PDFs – tokenizer, xref parsing, incremental save
    └── stress-edge.ts           # 13 PDFs – 10K rows, BiDi, heavy text, images, annotations, edge cases
    └── extreme-shaping.ts       #  4 PDFs – BiDi 3-script mix, Tamil conjuncts, Bengali+Devanagari ligatures, Arabic harakat
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
