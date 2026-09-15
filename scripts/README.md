# scripts/ – Sample PDF Generation and the Quality Gate

Generates 292 sample PDFs (49 generators) for visual inspection across all supported languages, features, and edge cases, and hosts `gate.ts`, the one definition of what "green" means for this repository.

Font tooling lives here too: `download-fonts.ts` (`npm run fonts:download`) fetches every source TTF at the commit, release tag and SHA-256 pinned in `fonts/SOURCES.json` and derives the five Latin subsets from `NotoSans-VF.ttf` with the library's own `subsetTTF()` (`build-latin-subsets.ts`, `lib/latin-subsets.ts`, code-point lists in `fonts/subsets/`); `verify-fonts.ts` (`npm run verify:fonts`) re-derives them and rebuilds every `fonts/*-data.js` from its source, byte for byte. Nothing under `fonts/ttf/` is committed.

Every sample that declares PDF/A conformance (`pdfaid:part` in XMP) is
automatically validated by `npm run validate:pdfa` (veraPDF) — no
registration needed. When adding or removing a PDF/A-claiming sample, bump
`declared.pdfaSamples` in `docs/assets/ecosystem.json`; a coverage canary
fails the validation run on any drift.

## Quick Start

```bash
npm run test:generate
```

Output: `test-output/*.pdf` (git-ignored).

## Quality gate — `gate.ts`

`scripts/gate.ts` runs the project's checks in order and prints one line per
step, so a full passing run fits in under twenty lines. CI, CONTRIBUTING.md
and the agent instructions all defer to this table rather than listing the
commands themselves.

```bash
npm run gate            # --ci: everything except validate:pdfa and verify:fonts
npm run gate:fast       # typecheck:all, lint, test, verify:docs
npx tsx scripts/gate.ts --publish        # everything; the two optional steps SKIP with a reason when their tool is absent
npx tsx scripts/gate.ts --only lint      # one step, whatever the profile
npx tsx scripts/gate.ts --from build     # a profile, starting at a step
npx tsx scripts/gate.ts --ci --json      # { ok, profile, steps: [{ id, status, seconds, note }] }
```

Steps, in order: `typecheck:all`, `lint`, `verify:unicode`, `test` (fast) /
`test:coverage` (ci, publish), `build`, `dist-check` (the six files
`npm run build` must leave in `dist/`), `verify:bundle`, `verify:docs`,
`test:generate`, `verify:samples`, `validate:pdfa`, `verify:fonts`.

Each step's complete output is captured to `test-output/.gate/<id>.log`; on
the first failure the gate prints the last twelve lines of that log and
stops with exit 1. The `test` steps run vitest with `GATE=1`, which adds a
JSON reporter writing `test-output/.gate/vitest.json` — where the test count
next to `PASS` comes from; the coverage percentage is read from
`coverage/coverage-summary.json`. Unknown flags exit 2.

PowerShell swallows a bare `--`, so pass flags by calling the script
directly (`npx tsx scripts/gate.ts --fast`) or use `npm run gate:fast`.

### Output modes of the sample scripts

`generate-samples.ts` and `validate-pdfa.ts` accept `--quiet`, `--verbose`
and `--json` (anything else exits 2). Quiet is implied when stdout is not a
terminal — CI, the gate, an agent capturing output — unless `--verbose`
asks for the full table; at a terminal nothing changes.

| Script                | Quiet output                                                     | `--json`                                                  |
|-----------------------|------------------------------------------------------------------|-----------------------------------------------------------|
| `generate-samples.ts` | `271 PDFs, 41.2 MB, 12.4 s → …/test-output/` plus skipped files | `{ generated, bytes, seconds, outputDir, skipped, files }` |
| `validate-pdfa.ts`    | one line per FAIL, then `21/21 PDF/A-claiming samples compliant` | `{ claimed, compliant, failures: [{ file, profile, rules }], veraPdf }` |

## Architecture

```
scripts/
├── gate.ts                  # Quality gate — the STEPS table, profiles, per-step logs (see above)
├── generate-samples.ts      # Orchestrator — registers fonts, inits compression, calls generators
├── validate-pdfa.ts         # veraPDF runner for every PDF/A-claiming sample (+ coverage canary)
├── helpers/
│   ├── io.ts                # I/O: createContext(), writeSafe(), printSummary(), parseOutputMode(), OUTPUT_DIR
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
