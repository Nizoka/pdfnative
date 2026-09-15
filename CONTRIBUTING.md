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

- Node.js 22 — the line in `.nvmrc` and `.node-version` (`nvm use` / `fnm use` / `volta` pick it up; CI also runs the suite on 24, and `engines.node` allows `>=22`).
- npm — the version pinned by `packageManager` in `package.json` (Corepack honours it). The repository's `.npmrc` sets `ignore-scripts=true` (no dependency runs an install script here — esbuild resolves its platform binary from an optional dependency), `fund=false` and `audit-level=high`; `npm run <script>` still runs the script you name, but lifecycle hooks such as `prepublishOnly` do not fire, which is why the publish workflow builds explicitly before it packs.
- Dev dependencies use caret ranges on purpose: `package-lock.json` plus `npm ci` is what makes an install reproducible, not narrow ranges. Let npm manage the lockfile.
- Source fonts: `npm run fonts:download` fetches every TTF at the google/fonts commit pinned in [fonts/SOURCES.json](fonts/SOURCES.json) and refuses a file whose SHA-256 differs from the manifest; the four hinted static instances (Arabic, Armenian, Georgian, Hebrew) come from the notofonts release archives the manifest names (`origin: "release"`: repository, tag, asset, entry path), extracted and hash-checked by the same script; the five Latin subsets (Cyrillic, Greek, Polish, Turkish, Vietnamese) are cut by the same script from the pinned `NotoSans-VF.ttf` with the library's own `subsetTTF()`, from the code-point lists in `fonts/subsets/` (`derived[]`: tool, command, SHA-256). Nothing under `fonts/ttf/` is committed.

### First pull request in ten minutes

```bash
npm ci                     # reproducible install from the lockfile
npm run hooks:install      # optional: pre-commit lint + CRLF check, pre-push fast gate (core.hooksPath → .githooks)
npm run gate -- --fast     # typecheck, lint, tests, docs checks — the loop while you work
git switch -c fix/<what>   # feat/, fix/, docs/, chore/ (see Branch Strategy)
```

Edit, add a test beside the code you touched (`tests/` mirrors `src/`), run the fast gate, commit with a [Conventional Commits](#commit-messages) message, push your branch and open the pull request — its template is the [checklist below](#pull-request-checklist). `npm run gate` (the CI profile) before you ask for review; `npm run hooks:uninstall` removes the hooks.

Sign your commits if you can: with an SSH key already registered on GitHub, `git config gpg.format ssh`, `git config user.signingkey ~/.ssh/id_ed25519.pub`, `git config commit.gpgsign true` and `git config tag.gpgSign true` make every commit and tag verifiable; the rulesets do not require signatures yet, so an unsigned contribution is still welcome.

Every file the project writes uses LF line endings (`.gitattributes` says `* text=auto eol=lf`); on Windows, Git converts on checkout and the pre-commit hook refuses a staged CRLF file. Do not run `git add --renormalize` in a feature branch — the maintainer does that in one dedicated commit.

## Build

```bash
npm run build          # tsup → dist/ (ESM + CJS + .d.ts)
npm run dev            # tsup --watch
```

## Docs local preview

The documentation site (`docs/`) is a static HTML/CSS/JS site with no build step.
Opening `docs/index.html` directly as a `file://` URL works for most pages, but
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
- `http://localhost:5000/playgrounds/scale.html` — scale playground (1k-100k pages)
- `http://localhost:5000/guides/` — guides index

## Test

```bash
npm run test           # vitest run (the count is `declared.tests` in docs/assets/ecosystem.json)
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest with v8 coverage (CI enforces the thresholds below)
npm run test:generate  # Generate the sample PDFs → test-output/ (`derived.samplePdfs` in the manifest)
npm run verify:samples # Fingerprint the samples against the committed baseline chain
npm run validate:pdfa  # veraPDF validation of every PDF/A-claiming sample (see below)
npm run verify:bundle  # Tree-shaking probes over dist/ (run `npm run build` first)
npm run verify:docs    # offline rules over docs/, playgrounds, README, llms files
npm run gate           # Everything a pull request is held to, in one command (see below)
npm run bench          # Performance benchmarks (vitest bench)
```

All new code must include tests. Coverage thresholds (vitest.config.ts): statements 88%, branches 80%, functions 85%, lines 90%.

The counts (tests, test files, sample PDFs, PDF/A-claiming samples, guides, playgrounds, recipes, scripts) live in one place, `docs/assets/ecosystem.json`, and `npm run verify:docs` reports every document that disagrees with it — update the manifest, not the prose. Its rules, each named in the failure line: `derived-counts` (the manifest against the file tree), `count-tokens` ("N tests", "N scripts" / "N Unicode scripts", "N playgrounds" — word numerals included — in every document), `version-token` (every version quoted in prose, tables and badges against the manifest), `error-parity` (every diagnostic code named in the docs exists in `docs/data/errors.json` and in `src/`, and vice versa), `playgrounds-manifest` (`docs/data/playgrounds.json` against the playground pages and their engine pins), `guide-render-sync` (every `docs/guides/*.md` has an up-to-date `.html` from `npm run docs:guides`), `llms-sync` (the llms files, the release-note link included, regenerated from their sources), `sitemap-parity`, `switcher-parity`, `bench-parity`, `claude-md-budget` (`AGENTS.md` and `CLAUDE.md` ≤ 120 lines, the Copilot file ≤ 16 KiB, no line over 240 characters), `prose-language` (English only, see Code Style), and since the 1.8.0 hardening pass `agent-config-parity` (`.claude/settings.json`, the guard hook and `CLAUDE.md` agree), `claude-rules-sync` / `claude-rules-budget` (`.claude/rules/*.md` regenerate from `.github/instructions/` by `npm run agents:rules` and stay within budget), `skills-shape`, `pr-template-parity` (the pull-request template mirrors the checklist below word for word) and `eol-lf` (tracked text files stored with CRLF — a warning until the renormalisation commit, then a failure).

## PDF/A validation (veraPDF)

pdfnative's PDF/A claims are backed by the official reference validator,
[veraPDF](https://verapdf.org). `npm run validate:pdfa` scans `test-output/`
(run `npm run test:generate` first), **auto-detects** every PDF that declares
`pdfaid:part` in its XMP — currently the 21 PDF/A-claiming samples — and
validates each against its declared profile (1b/2b/2u/3b). Detection is
automatic: a new sample that claims PDF/A is validated without registering
anything, and a coverage canary fails the run if the detected count drifts
from `declared.pdfaSamples` in `docs/assets/ecosystem.json` (bump it when
adding or removing a claiming sample).

Without veraPDF installed the script skips with exit 0 and prints install
hints — local development never blocks. **CI is blocking**: the same script
runs with a pinned veraPDF (1.30.2) on every PR touching the engine
(`.github/workflows/verapdf.yml`) and again before every npm publish
(`.github/workflows/publish.yml`).

Installing veraPDF locally (any OS, Java 8+ required):

```bash
# macOS
brew install --cask verapdf

# Linux / Windows (headless, no GUI — same mechanism as CI)
curl -fsSL -o installer.zip https://software.verapdf.org/rel/1.30/verapdf-greenfield-1.30.2-installer.zip
unzip installer.zip && cd verapdf-greenfield-*
cat > auto-install.xml <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>/opt/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select"><pack index="0" name="veraPDF GUI" selected="true"/><pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/><pack index="2" name="veraPDF Documentation" selected="false"/><pack index="3" name="veraPDF Sample Plugins" selected="false"/></com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
XML
java -jar verapdf-izpack-installer-*.jar auto-install.xml
```

Then expose it: add the install dir to `PATH`, or set `VERAPDF_HOME` to it
(`verapdf`/`verapdf.bat` is picked up from the dir root or its `bin/`).
Windows note: the `.bat` launcher is fully supported since v1.7.0.

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

- **English everywhere** — code, comments, messages, tests, sample prose, recipes, docs and release notes. Other languages are only ever *demonstrated content*: sample data records and script-coverage tables carry a `lang` label and are demonstration content by nature; any other sentence in another language is framed in English and marked `demo-language: <tag> (reason)` on or above the line. `npm run verify:docs` and the regression suite detect French, Spanish, Italian, Portuguese and German prose (and mojibake); other languages rely on the marker and on review.
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
├── core/         # PDF assembly, document builder, shared assembler, encoding context, text rendering, binary stream, layout, tagged PDF, images, annotations, encryption, barcodes, SVG, forms, form fill & flatten (pdf-form-fill.ts), native vector charts (pdf-chart.ts), signatures, streaming
├── crypto/       # Zero-dependency cryptographic primitives (SHA, AES, RSA, ECDSA, X.509, CMS)
├── parser/       # PDF reading & incremental modification (tokenizer, object parser, xref, reader, modifier, decode filters (pdf-decode-filters.ts), decryption (pdf-decrypt.ts), page-tree merge/split/extract (pdf-pagetree.ts), text extraction (pdf-text-extract.ts))
├── fonts/        # WinAnsi + CIDFont pure encoding, font loader, TTF subsetter (buffer guards), CMap
├── shaping/      # Script registry, Thai/Devanagari/Bengali/Tamil GSUB+GPOS, Arabic positional shaping, BiDi resolution, script detection, multi-font splitting
├── types/        # All public TypeScript type definitions (pdf-types.ts, pdf-document-types.ts)
└── worker/       # Web Worker dispatch + self-contained worker entry
fonts/            # 31 pre-built font-data modules (27 scripts + Latin + math + monochrome and colour emoji)
tools/            # CLI tool for converting TTF → importable data modules
scripts/          # Modular sample PDF generation (49 generators, 292 PDFs) and the verification scripts
tests/            # 160 test files (unit + integration + fuzz + parser + regression + docs + tools), mirrors src/ structure
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

- [ ] `npm run gate` passes — the CI profile in one command (`npm run gate -- --fast` for a quick loop while iterating; PowerShell swallows a bare `--`, so call `npx tsx scripts/gate.ts --fast` there)
- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added
- [ ] If samples or PDF/A behaviour changed: `npm run test:generate && npm run verify:samples && npm run validate:pdfa` passes locally (veraPDF installed — see [PDF/A validation](#pdfa-validation-verapdf); new PDF/A-claiming samples bump `declared.pdfaSamples`; an intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and explained in the commit)
- [ ] If docs/, playgrounds, README or llms files changed: `npm run verify:docs` passes
- [ ] CHANGELOG.md updated if user-facing changes
- [ ] For releases: follow [Release](#release) — `release-notes/vX.Y.Z.md` written, and `npm run gate -- --publish` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `verify:unicode`, `test:coverage`, `build`, `verify:bundle`, `test:generate`, `verify:samples`, `verify:fonts`, `validate:pdfa` (all PDF/A-claiming samples compliant), `verify:docs`

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Arabic script detection
fix: correct xref byte offset for multi-page PDFs
test: add integration tests for pagination
docs: update README with font registration example
```

## Release

The version bump is scripted; the judgement goes into the release note.

1. Branch from `main`: `feat/release-vX.Y.Z` (the form used so far) or `release/X.Y.Z`.
2. `npx tsx scripts/release-prepare.ts --version X.Y.Z` — run it with `--dry-run` first to see the list. It bumps `package.json` and the lockfile; `docs/assets/ecosystem.json` (`packages.pdfnative.version`, `verifiedOn`) and the Verified-on stamps the verifier holds to that date; `CITATION.cff`; the SECURITY.md support table; every CDN pin (`pdfnative@<previous>` → `pdfnative@X.Y.Z`); the homepage JSON-LD; the architecture SVG; the sitemap `lastmod` of every page whose source changed since the previous tag; and scaffolds `release-notes/vX.Y.Z.md` from [release-notes/TEMPLATE.md](release-notes/TEMPLATE.md). The date defaults to today (UTC) and the previous tag to `git describe`; `--date` and `--previous` override them.
3. `git diff --stat` — the diff must read as the bump and nothing else. Update the counts in the manifest (`derived`, `declared`) by hand; `verify:docs` reports the documents that disagree.
4. Write the release note and the matching `CHANGELOG.md` entry (`## [X.Y.Z] – YYYY-MM-DD`). Every intentional sample rebaseline must be declared in the note's Upgrade section, with why the previous bytes were wrong — the `sample-regression` check holds the release to the previous release's output otherwise.
5. `npm run docs:all && npm run verify:docs`, then run the three-agent final review before the publish gate — in Claude Code it is the `release-audit` skill (`/release-audit release-notes/vX.Y.Z.md vPREV`, defined in `.claude/skills/release-audit/`): two independent auditors read the release (code, samples, docs, release note) and file findings in a shared ledger; one adversarial verifier re-checks every finding against the sources of truth (`docs/assets/api.json`, `src/types/`, `docs/data/*.json`, the sample manifest) and stamps each `CONFIRMED`, `DOWNGRADED`, `REJECTED` or `DUPLICATE`; a docs/autonomy pass and its own verification follow; the ledger ends in GO / NO-GO. Fix what survives, in batches by owner. The 1.8.0 review found six unexported option types, a README compression recipe that produced unreadable files, a false architecture block and, on the second pass, the mispositioned Indic vowel signs this way — none of which the gate detects.
6. `npm run gate -- --publish` (PowerShell: `npx tsx scripts/gate.ts --publish`): the full gate, veraPDF and the sample, font, Unicode and bundle checks included. `--require-all` (what `publish.yml` passes) turns a skipped step — veraPDF or the source fonts missing — into a failure.
7. Draft the pull-request body from [release-notes/PR_TEMPLATE.md](release-notes/PR_TEMPLATE.md) into `RELEASE_PR_vX.Y.Z.md` at the repository root (git-ignored scratch file); paste the numbers the gate printed into its Verification section.
8. Squash-merge with the title `release: vX.Y.Z — <headline>`, where the headline is the release note's GitHub Release title.
9. Tag `vX.Y.Z` on the merge commit and publish the GitHub Release (title `vX.Y.Z — <headline>`, body = the release note). `publish.yml` fires on the published release: it waits for the `npm-publish` environment's reviewer, installs a checksummed veraPDF and the pinned source fonts, runs `gate --publish --require-all`, publishes to npm with provenance through an exact npm 11, then a second job attaches the CycloneDX SBOM, the tarball and their build-provenance attestations to the release. The tag ruleset ([.github/rulesets/tags.json](.github/rulesets/tags.json)) forbids deleting or moving a `v*` tag.
10. After publication: `npm view pdfnative version`, then open a playground — the site's CDN pins (`pdfnative@X.Y.Z`) only resolve once the package exists on the registry.

### Branch protection

The rules for `main` are versioned in [.github/rulesets/main.json](.github/rulesets/main.json), GitHub's ruleset format: no deletion, no force-push, pull request required (single maintainer, so zero approvals — but every review thread resolved, stale reviews dismissed on push, squash merges only), and the status checks `ci (22)`, `ci (24)` and `sample-regression` required and up to date with `main`. `verapdf`, the Docs workflow and the other path-filtered workflows are deliberately not required: a required check that never reports leaves a pull request stuck on "Expected — waiting for status to be reported". For the same reason the repository Admin role may bypass the ruleset through a pull request only — `ci.yml` ignores documentation-only changes, so such a pull request has no `ci` run to wait for — never by pushing to `main` directly.

Import the file after editing it: Settings → Rules → Rulesets → New ruleset → Import a ruleset, or from the shell:

```bash
gh api repos/Nizoka/pdfnative/rulesets --method POST --input .github/rulesets/main.json
```

To update the ruleset already in place, `gh api repos/Nizoka/pdfnative/rulesets` lists the ids and `--method PUT` on `rulesets/<id>` replaces it.

## Adding a New Language / Script

0. Decide whether it is a new **script** or a new **language on a script already bundled**. Hausa, Yoruba, Igbo and Swahili (v1.8.0) needed no module, no `lang` key and no shaper: the bundled `latin` module (Noto Sans) carries their letters and anchors, `detectCharLang()` routes Latin Extended-B, IPA and the combining-mark blocks to it, and the `latin-marks` shaper composes the tone marks. For such a language, add a `LangSample` plate to `scripts/data/alphabet-data.ts`, a `LanguageDoc` to `scripts/data/language-docs-data.ts` (one page, edge-case table — `tests/regression/language-docs.test.ts` enforces one page and no missing glyph), an alias in `scripts/helpers/fonts.ts`, and the README rows; stop there. The steps below are for a new script.
1. Obtain a Noto Sans TTF for the target script — download the raw `.ttf` directly from [github.com/notofonts](https://github.com/notofonts) (click the file → **Download raw file**, no zip needed) and save to `fonts/ttf/` (git-ignored), then add its entry to `fonts/SOURCES.json` (google/fonts `dir` + `remote`, or a notofonts release `repo`/`tag`/`asset`/`path`) and record its hash and copyright statement with `npx tsx scripts/download-fonts.ts --update-manifest --commit <google/fonts sha>`; `THIRD-PARTY-NOTICES.md` and `fonts/LICENSE` gain the family (a test holds them to the manifest)
2. Run `node tools/build-font-data.cjs fonts/ttf/NotoSans-<Script>.ttf fonts/noto-<script>-data.js`
3. Add script ranges to `src/shaping/script-registry.ts` (centralized constants) and detection in `src/shaping/script-detect.ts`
4. If the script needs OpenType shaping (GSUB/GPOS): an Indic script (Gujarati, Gurmukhi, Kannada, Malayalam, Odia) is an `IndicScriptConfig` for `src/shaping/indic-engine.ts` plus a one-line wrapper (see `telugu-shaper.ts`); a script the Universal Shaping Engine covers needs nothing beyond registration; anything else is a shaper in `src/shaping/` registered in `shaper-registry.ts`
5. Register the font in your test setup
6. Add tests for the new script detection and encoding
7. Run `npm run verify:fonts` — every bundled module must regenerate byte
   for byte from the source font it declares

## Regenerating Font Data

Each `fonts/*-data.js` carries a `DO NOT EDIT — Regenerate with: …` header,
and that sentence is enforced:

```bash
npm run fonts:download   # populate fonts/ttf/ (git-ignored): download the pinned sources, derive the Latin subsets
npm run verify:fonts     # every module must reproduce exactly
```

The check skips with instructions when the TTFs are absent, so it never blocks
local work. It also runs on a schedule and whenever `fonts/` or either
generator changes.

**Derived subsets.** The Cyrillic, Greek, Polish, Turkish and Vietnamese
source fonts are not downloaded: `fonts:download` cuts them from the pinned
`NotoSans-VF.ttf` with the library's own `subsetTTF()`, from the code-point
list each `derived[]` entry of `fonts/SOURCES.json` names under
`fonts/subsets/` (`npx tsx scripts/build-latin-subsets.ts` does the same on
its own; `--check` reports drift). Their recorded hash depends on the
subsetter and on the list by design, so a change to either makes
`verify:fonts` fail until `npx tsx scripts/build-latin-subsets.ts
--update-manifest`, the five module rebuilds and the sample rebaseline are
committed together, with the release note saying why.

If you change a generator, expect module bytes to move. Regenerate, then prove
nothing rendered differently:

```bash
node tools/build-font-data.cjs fonts/ttf/<Source>.ttf fonts/<module>-data.js
npm run test:generate && npm run verify:samples
```

Two rules that are easy to get wrong:

- **Two generators, one output.** `tools/build-font-data.cjs` (the
  `pdfnative-build-font` CLI) and `src/tools/font-compiler.ts` (the in-browser
  API) must emit byte-identical modules. Change both, or neither.
- **The emoji modules are different.** `noto-emoji-data.js` and
  `noto-color-emoji-data.js` come from `scripts/build-color-emoji-data.ts`,
  which adds COLR/CPAL colour glyphs and the sequence table. The generic CLI
  would strip them, so `verify:fonts` excludes both.

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
