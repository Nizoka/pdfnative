# Contributing to pdfnative

Thank you for considering contributing to pdfnative! This document explains how to get started.

## Development Setup

```bash
git clone https://github.com/Nizoka/pdfnative.git
cd pdfnative
npm install
npm run fonts:download   # fetch Noto Sans TTFs → fonts/ttf/
```

### Requirements

- Node.js >= 22
- npm >= 9

## Build

```bash
npm run build          # tsup → dist/ (ESM + CJS + .d.ts)
npm run dev            # tsup --watch
```

## Docs local preview

The documentation site (`docs/`) is a static HTML/CSS/JS site with no build step.
Openin `docs/index.html` directly as a `file://` URL works for most pages, but
the **interactive playgrounds** require an HTTP origin because they load pdfnative
from a CDN inside a Web Worker and `file:` origins block cross-origin Worker imports.

Serve the site locally with the included npm script:

```bash
npm run docs:serve
# → http://localhost:5000
```

Or use any static file server:

```bash
npx serve docs/ --listen 5000      # same as npm run docs:serve
npx http-server docs/ -p 5000      # alternative
python -m http.server 5000 --directory docs/   # Python stdlib, no install
```

Then open:
- `http://localhost:5000/` — landing page
- `http://localhost:5000/playgrounds/extreme-scripts.html` — extreme-scripts playground
- `http://localhost:5000/playgrounds/medical-800.html` — medical 800-page playground
- `http://localhost:5000/guides/` — guides index

## Test

```bash
npm run test           # vitest run (1606+ tests)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage (95%+ stmts)
npm run test:generate  # Generate 140+ sample PDFs → test-output/
npm run bench          # Performance benchmarks (vitest bench)
```

All new code must include tests. Coverage thresholds: statements 90%, branches 80%, functions 85%, lines 90%.

## Lint & Type Check

```bash
npm run lint              # eslint src/
npm run typecheck         # tsc --noEmit (src/)
npm run typecheck:tests   # tsc --project tsconfig.test.json
npm run typecheck:scripts # tsc --project tsconfig.scripts.json
npm run typecheck:all     # all three above
```

All must pass before opening a PR.

## Code Style

- **TypeScript strict mode** — `strict: true`
- **Pure functions only** — no classes. State passed explicitly as arguments
- **ESM-first** — all internal imports use `.js` extension
- **`const` over `let`** — never use `var`
- **No `any`** — use `unknown` with type narrowing
- **Template literals** over concatenation for PDF stream assembly
- **`readonly`** on interface props where mutation is unnecessary
- **En-dash separator** — use `–` (U+2013) with spaces (`" – "`) as title/footer separator, not em-dash `—` (U+2014); en-dash is 44% narrower, WinAnsi-encodable, and follows ISO/international typography standards

## Project Structure

```
src/
├── core/         # PDF assembly, document builder, shared assembler, encoding context, text rendering, binary stream, layout, tagged PDF, images, annotations, encryption, barcodes, SVG, forms, signatures, streaming
├── crypto/       # Zero-dependency cryptographic primitives (SHA, AES, RSA, ECDSA, X.509, CMS)
├── parser/       # PDF reading & incremental modification (tokenizer, object parser, xref, reader, modifier)
├── fonts/        # WinAnsi + CIDFont pure encoding, font loader, TTF subsetter (buffer guards), CMap
├── shaping/      # Script registry, Thai/Devanagari/Bengali/Tamil GSUB+GPOS, Arabic positional shaping, BiDi resolution, script detection, multi-font splitting
├── types/        # All public TypeScript type definitions (pdf-types.ts, pdf-document-types.ts)
└── worker/       # Web Worker dispatch + self-contained worker entry
fonts/            # Pre-built font data modules (16 scripts)
tools/            # CLI tool for converting TTF → importable data modules
scripts/          # Modular sample PDF generation (24 generators, 140+ PDFs)
tests/            # 1606+ tests (41 files: unit + integration + fuzz + parser), mirrors src/ structure
bench/            # Performance benchmarks (vitest bench)
```

## Branch Strategy

| Branch    | Purpose                                          |
| --------- | ------------------------------------------------ |
| `main`    | Stable release branch                            |
| `dev`     | Integration branch                               |
| `feat/*`  | New features                                     |
| `fix/*`   | Bug fixes                                        |
| `docs/*`  | Documentation improvements                       |
| `chore/*` | Release tasks, metadata, governance, maintenance |

## Pull Request Checklist

- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added
- [ ] CHANGELOG.md updated if user-facing changes
- [ ] For releases: `release-notes/vX.Y.Z.md` created from [release-notes/TEMPLATE.md](release-notes/TEMPLATE.md)

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Arabic script detection
fix: correct xref byte offset for multi-page PDFs
test: add integration tests for pagination
docs: update README with font registration example
```

## Adding a New Language / Script

1. Obtain a Noto Sans TTF for the target script — download the raw `.ttf` directly from [github.com/notofonts](https://github.com/notofonts) (click the file → **Download raw file**, no zip needed) and save to `fonts/ttf/`
2. Run `node tools/build-font-data.cjs fonts/ttf/NotoSans-<Script>.ttf`
3. Add script ranges to `src/shaping/script-registry.ts` (centralized constants) and detection in `src/shaping/script-detect.ts`
4. If the script needs OpenType shaping (GSUB/GPOS), create a shaper in `src/shaping/` (see `bengali-shaper.ts` or `tamil-shaper.ts` as examples)
5. Register the font in your test setup
6. Add tests for the new script detection and encoding

## Security

- No `eval()`, `Function()`, or dynamic code execution
- No `console.log` in library code (only in tools/ and scripts/)
- All user input is validated at public API boundaries (`buildPDF()` entry point)
- Input validation: null/undefined checks, type checks, 100K row limit
- PDF string escaping prevents injection via `pdfString()`
- URL validation: blocks `javascript:`, `file:`, `data:` schemes + control characters
- TTF subsetter: buffer bounds checking + compound glyph iteration limits
- RGBA PNG rejection: unsupported color types rejected at parse boundary

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
