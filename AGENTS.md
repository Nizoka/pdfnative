# AGENTS.md

Condensed, editor-agnostic guidance for AI coding agents (Cursor, Aider, Claude Code, Copilot, Continue, Zed, Cline, Windsurf, Goose, Gemini CLI, …).
Canonical detail: [.github/copilot-instructions.md](.github/copilot-instructions.md) + [.github/instructions/](.github/instructions/). Claude Code loads [CLAUDE.md](CLAUDE.md), which imports this file. Keep the three consistent.

## Mission and constraints

pdfnative is a zero-runtime-dependency TypeScript library that writes and reads ISO 32000-1 (PDF 1.7) and ISO 19005 (PDF/A) conformant PDFs. Pure native: no Cairo, no PDFKit, no node-forge, no fontkit.

- **Zero deps.** Never add a runtime dependency. Dev deps need a written justification.
- **No classes, no module-level side effects.** Pure functions; state is passed explicitly. `sideEffects: false` is probed by `npm run verify:bundle`.
- **TypeScript strict.** No `any`; ESM-first; internal imports use `.js` extensions; single entry point `src/index.ts`; domain types in `src/types/`.
- **No `console.log`** in library code. `console.warn` only inside `src/core/pdf-diagnostics.ts`, the single sanctioned diagnostics sink (`onDiagnostic` / `strict`).
- **No `eval` / `Function()` / dynamic code.** URLs validated, control characters rejected, CSPRNG-only keys, real CMS signatures, no sockets (transports are injected).
- **No rasterization.** SVG → path operators, barcodes → `re f` rectangles, fonts → CIDFont Type2 subsets.
- **Byte-identity.** Every opt-in feature leaves output byte-identical when unused; veraPDF is blocking at publish (`publish.yml`) and on the `verapdf` workflow — not a required status check of the ruleset.
- **Human-in-the-loop.** Agents draft and verify; the maintainer pushes, opens PRs/issues and publishes (see Governance).
- **English everywhere.** Everything the project writes — code, comments, messages, tests, sample prose, recipes, docs, release notes — is English.
  Other languages appear only as *demonstrated content*: sample data records and script-coverage tables carry a `lang` label and are demonstration
  content by nature (Thai, Arabic, CJK, Turkish, Vietnamese, Polish…); any other sentence in another language is framed by an English title and
  marked `demo-language: <tag> (reason)` on or above the line. The guards (`verify:docs` rule `prose-language`, the regression suite) detect
  French, Spanish, Italian, Portuguese and German prose and UTF-8-as-Latin-1 mojibake; they do not detect other languages — the marker and review do.

## The gate

`npm run gate` is THE quality gate (`scripts/gate.ts`; the step list is its `STEPS` table). Logs land in `test-output/.gate/<step>.log`; the summary is at most 20 lines.

| Profile | Command | Runs |
|---|---|---|
| Fast — before every commit | `npm run gate -- --fast` | typecheck:all, lint, test, verify:docs |
| CI — the default | `npm run gate` | the CI profile |
| Publish — release branches | `npm run gate -- --publish` | everything, incl. test:generate, verify:samples, validate:pdfa, verify:fonts, verify:diagrams, verify:bundle |

`--only <step>` runs one step, `--json` emits machine-readable output. One suite: `npx vitest run tests/<path>.test.ts` (dot reporter). Individual scripts (`npm run lint`, `npm run verify:docs`, …) still exist.

## Where is what

| Path | Purpose | Read first |
|---|---|---|
| `src/core/` | Document/table builders, text, images, tags/XMP, encryption, compression, forms, signatures/LTV, streaming, print, typography, colour, reproducible dates | `.github/instructions/pdf-core.instructions.md` |
| `src/parser/` | Tokenizer → object parser → xref → reader/modifier; decrypt, text extraction, page-tree merge/split, PDF/UA check, PDF/X-4 check (`pdf-x-validator`) | `.github/instructions/pdf-core.instructions.md` |
| `src/fonts/` | WinAnsi + CIDFont encoding, lazy font registry, TTF subsetter, CMap builder, font-data validator | `.github/instructions/font-engineering.instructions.md` |
| `src/shaping/` | GSUB/GPOS shapers (Thai, Arabic, Indic, Lao, …), USE engine, shaper registry, UAX #9 BiDi, script detection, emoji sequences | `.github/instructions/text-shaping.instructions.md` |
| `src/crypto/` | SHA, ASN.1/DER, RSA, ECDSA, X.509, CMS, RFC 3161, OCSP/CRL, injected timestamp/revocation providers | `.github/instructions/pdf-core.instructions.md` |
| `src/worker/` | Web Worker dispatch + self-contained worker entry | `.github/instructions/worker.instructions.md` |
| `src/tools/` | `pdfnative/tools` entry: `compileFontData` / `parseFontData` | `.github/instructions/font-engineering.instructions.md` |
| `src/types/` | All public types (`pdf-types.ts`, `pdf-document-types.ts`) | `.github/instructions/api-design.instructions.md` |
| `scripts/generators/` | Sample PDF generators (`npm run test:generate`); helpers in `scripts/helpers/`, shared cores in `scripts/lib/` | `.github/instructions/testing.instructions.md` |
| `tests/` | Vitest suites mirroring `src/`, plus fuzzing, visual, regression (sample byte manifest) and docs suites | `.github/instructions/testing.instructions.md` |
| `docs/` | pdfnative.dev site: guides (`.md` + generated `.html`), playgrounds, learn path, llms files, `assets/ecosystem.json` | `.github/instructions/api-design.instructions.md` |
| `recipes/` | Executable documentation (`recipes/*.ts`, indexed by `recipes/index.json`), scanned by `verify:docs` | `.github/instructions/api-design.instructions.md` |

1.8.0 modules — core: `pdf-typography` + `hyphenation`, `pdf-pagination` (the one planner for builder and `inspectDocumentLayout`), `pdf-print`, `pdf-color` (`fillOp`/`strokeOp` choke point),
`pdf-content-colour`, `pdf-reproducible`; shaping: `shaper-registry` (`SCRIPT_SHAPERS`/`findShaper`), `use-engine` + generated `use-data`, `use-shaper` (Tai Tham, Cham), `lao-shaper`; parser: `pdf-x-validator`.
Cross-cutting: public API → `api-design.instructions.md`; PDF/A metadata, XMP, OutputIntent → `pdfa-conformance.instructions.md`; hot paths → `performance.instructions.md`.

## Architecture

Strict unidirectional dependency flow:

```
types → core ← fonts ← shaping ← worker
crypto imports core/pdf-encrypt (sha256) and nothing else outside crypto/
parser depends on core: pdf-compress (inflate), pdf-encrypt, pdf-tags, pdf-page-labels, pdf-content-colour
```

One sanctioned reverse edge: incremental-update features in `core/` (`pdf-sig-placeholder`, `pdf-form-fill`, `pdf-dss`, `pdf-sig-utils`, `pdf-doc-timestamp`)
import the `parser/` reader/modifier — they operate on existing PDFs by design. Keep new reverse edges to that feature family.

## Finding a symbol

- Public export → grep `docs/assets/api.json` for `"name":"<Export>"`; every entry lists its `module`. `npm run docs:api` regenerates it.
- Internal symbol → grep `^export function <name>` (or `^export const <name>`) in `src/`.
- README.md and ROADMAP.md are long: `grep -n "^## "` first, then read a line range. CHANGELOG.md: the top entry only.

## Never touch

- `release-notes/v*.md` of already-shipped versions (read-only history) and `scripts/data/*.txt` (vendored Unicode Character Database).
- `dist/`, `coverage/`, `test-output/`, `node_modules/`, `package-lock.json` (npm owns it), and everything in the table below: regenerate, never hand-edit.
- Version pins of the downstream packages, and any figure in `docs/assets/ecosystem.json` without running `npm run verify:docs` afterwards.

## Generated files

| File | Regenerate with |
|---|---|
| `fonts/*-data.js` + `.d.ts` | `tools/build-font-data.cjs` (CONTRIBUTING.md §Regenerating Font Data); reproducibility checked by `npm run verify:fonts` |
| `fonts/ttf/*.ttf` (never committed) | `npm run fonts:download` — pinned downloads + the five Latin subsets cut from `NotoSans-VF.ttf` by `subsetTTF()` (`fonts:subsets`; lists in `fonts/subsets/`, hashes in `fonts/SOURCES.json`) |
| `src/shaping/use-data.ts` | `npx tsx scripts/generate-use-data.ts` (drift checked by `npm run verify:unicode`) |
| `docs/assets/api.json` | `npm run docs:api` |
| `docs/guides/*.html` | `npm run docs:guides` |
| `docs/llms.txt`, `docs/llms-full.txt`, `docs/llms-recipes.txt`, `docs/llms-index.json` | `npm run docs:llms` (`npm run docs:all` chains api, guides and llms) |
| `tests/regression/baselines/samples.sha256.json` | `npm run test:generate && npx tsx scripts/verify-samples.ts --update` — only with a rebaseline declared in the release note; identical pairs go in `IDENTICAL_SAMPLE_GROUPS` |
| `dist/`, `coverage/`, `test-output/` | `npm run build`, `npm run test:coverage`, `npm run test:generate` |

## Counts and versions

3836 tests across 161 files, 292 sample PDFs across 38 categories (49 generators), 21 PDF/A-claiming samples, 27 scripts.
`docs/assets/ecosystem.json` is the source of every count and version quoted in the docs; run `npm run verify:docs` after touching any of them.
Coverage: ≥ 88 % statements enforced by CI (currently 91.5 % statements; the thresholds live once in `vitest.config.ts`).

## Releasing

Follow CONTRIBUTING.md §Release and `scripts/release-prepare.ts`; Conventional Commits (`feat(scope):`, `fix(scope):`, `docs:`, `chore:`); every runtime change gets a ROADMAP.md entry and a line in the next `release-notes/vX.Y.Z.md`.
Downstream-impacting changes (new public APIs, removed APIs, behaviour shifts) must be documented in the **Downstream integration notes** section of the relevant `release-notes/vX.Y.Z.md`.

## Governance

Human-in-the-loop, enforced: agents never push, never open PRs/issues/releases, never publish, and never add `Co-Authored-By` trailers.
Protocol: [.github/AGENT_RULES.md](.github/AGENT_RULES.md); machine-readable policy: [.github/ai-governance.json](.github/ai-governance.json).
Issue drafts go to `.github/drafts/` and are validated with `npm run verify:issue` before a human submits them.

## Ecosystem

- [pdfnative-cli](https://github.com/Nizoka/pdfnative-cli) — terminal wrapper with a JSON-in/JSON-out agent contract and the full PAdES ladder; requires pdfnative ≥ 1.8.0, Node ≥ 22.
- [pdfnative-mcp](https://github.com/Nizoka/pdfnative-mcp) — Model Context Protocol server exposing the engine to conversational assistants; requires pdfnative ≥ 1.8.0.
- [pdfnative-react](https://github.com/Nizoka/pdfnative-react) — React renderer (JSX → pdfnative blocks via a custom reconciler); React 19 and pdfnative ≥ 1.8.0 are peer dependencies of that package only.

See also: [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [llms.txt](llms.txt).
