# Contributing to pdfnative

Thank you for considering contributing to pdfnative! This document explains how to get started.

## Development Setup

```bash
git clone https://github.com/Nizoka/pdfnative.git
cd pdfnative
npm install
```

### Requirements

- Node.js >= 18
- npm >= 9

## Build

```bash
npm run build          # tsup → dist/ (ESM + CJS + .d.ts)
npm run dev            # tsup --watch
```

## Test

```bash
npm run test           # vitest run (743 tests)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage (~99% stmts)
npm run test:generate  # Generate sample PDFs → test-output/ (all languages)
```

All new code must include tests. Coverage thresholds: statements 90%, branches 80%, functions 85%, lines 90%.

## Lint & Type Check

```bash
npm run lint           # eslint src/
npm run typecheck      # tsc --noEmit
```

Both must pass before opening a PR.

## Code Style

- **TypeScript strict mode** — `strict: true`
- **Pure functions only** — no classes. State passed explicitly as arguments
- **ESM-first** — all internal imports use `.js` extension
- **`const` over `let`** — never use `var`
- **No `any`** — use `unknown` with type narrowing
- **Template literals** over concatenation for PDF stream assembly
- **`readonly`** on interface props where mutation is unnecessary

## Project Structure

```
src/
├── core/         # PDF assembly, document builder, text rendering, binary stream, layout, tagged PDF, images, annotations, encryption
├── fonts/        # WinAnsi + CIDFont encoding, font loader, TTF subsetter, CMap
├── shaping/      # Thai GSUB+GPOS, Arabic positional shaping, BiDi resolution, script detection, multi-font splitting
├── types/        # All public TypeScript type definitions (pdf-types.ts, pdf-document-types.ts)
└── worker/       # Web Worker dispatch + self-contained worker entry
fonts/            # Pre-built font data modules (.js/.d.ts)
tools/            # CLI tool for converting TTF → importable data modules
scripts/          # generate-samples.ts — multi-language PDF visual inspection
tests/            # 789 tests (unit + integration + fuzz), mirrors src/ structure
bench/            # Performance benchmarks (vitest bench)
```

## Branch Strategy

| Branch    | Purpose                        |
| --------- | ------------------------------ |
| `main`    | Stable release branch          |
| `dev`     | Integration branch             |
| `feat/*`  | New features                   |
| `fix/*`   | Bug fixes                      |
| `docs/*`  | Documentation improvements     |

## Pull Request Checklist

- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added
- [ ] CHANGELOG.md updated if user-facing changes

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Arabic script detection
fix: correct xref byte offset for multi-page PDFs
test: add integration tests for pagination
docs: update README with font registration example
```

## Adding a New Language / Script

1. Obtain a Noto Sans TTF covering the target script
2. Run `node tools/build-font-data.cjs fonts/ttf/NotoSans-<Script>.ttf`
3. Add script ranges to `src/shaping/script-detect.ts`
4. Register the font in your test setup
5. Add tests for the new script detection and encoding

## Security

- No `eval()`, `Function()`, or dynamic code execution
- No `console.log` in library code (only in tools/ and scripts/)
- All user input is validated at public API boundaries (`buildPDF()` entry point)
- Input validation: null/undefined checks, type checks, 100K row limit
- PDF string escaping prevents injection via `pdfString()`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
