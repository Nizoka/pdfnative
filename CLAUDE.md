@AGENTS.md

# Claude Code addendum

Everything in AGENTS.md applies. This file adds only what is specific to Claude Code sessions in this repository.

## Token discipline

- Run tests through `npm run gate -- --fast` or `npx vitest run <file>` (the dot reporter is configured); never paste a full test run into context.
- Never Read `fonts/*.js`, `fonts/ttf/**`, `scripts/data/*.txt`, `docs/llms-full.txt`, `docs/llms-recipes.txt`, `coverage/`, `dist/`, `test-output/`, `package-lock.json`, `node_modules/`.
  They are denied in `.claude/settings.json`; Grep them if you must.
- Find an export's module by grepping `docs/assets/api.json` (each export lists its `module`); find internal symbols with Grep `^export function <name>` in `src/`.
- Read README.md and ROADMAP.md by section: `grep -n "^## "` first, then a line range. CHANGELOG.md: only the top entry.
- `.github/instructions/*.md` are the per-area rules: open the ONE matching the area you touch (table in AGENTS.md §Where is what), not all of them.
- In plan mode, summarise gate output; do not paste logs.
- Sample regeneration: `npm run test:generate` then `npx tsx scripts/verify-samples.ts`. Any `--update` (rebaseline) must be justified in the release note.
- Never push, never open PRs/issues/releases (HITL policy, hook-enforced). No `Co-Authored-By` trailers (`attribution.commit` is `""`).

## Gate

- `npm run gate -- --fast` — typecheck:all, lint, test, verify:docs. Run before proposing a commit.
- `npm run gate` — the CI profile (default).
- `npm run gate -- --publish` — everything, incl. test:generate, verify:samples, validate:pdfa, verify:fonts, verify:bundle. Release branches only.
- `--only <step>` for one step, `--json` for machine output; logs in `test-output/.gate/<step>.log` — open only the failing step's log.

## Where to look first

1. `docs/assets/api.json` — the public surface and the module of every export (`npm run docs:api` regenerates it).
2. AGENTS.md §Where is what — the path → purpose → instruction-file table.
3. `docs/assets/ecosystem.json` — every count and version; `npm run verify:docs` enforces it.

## Hooks and permissions in force

- `.claude/hooks/guard.mjs` (PreToolUse on Bash) denies `npm publish`, `gh pr create`, `gh issue create`, `gh release`, `git push --force` / `-f` and `git add --renormalize`,
  as a whole command or inside any `&&` / `;` / `|` segment (so even an `echo` containing one is refused — keep such strings out of commands).
  Those are submitted by the maintainer (.github/AGENT_RULES.md §5); plain `git push` is also theirs — prepare, then stop.
- `permissions.deny` in `.claude/settings.json` blocks Read on the generated/vendored bulk files listed above and the same GitHub write commands.
  `permissions.allow` pre-approves `npm run`, `npx vitest`, `npx tsx scripts/*`, `npx tsc`, `npx eslint`, `node -e` and read-only git.

## Plan mode

Plans name the files, the commands and the expected gate outcome; keep gate output to its ≤ 20-line summary. `.claude/rules/` and skills are deferred to a later release — do not create them.

## Release

Follow CONTRIBUTING.md §Release and `scripts/release-prepare.ts`: prepare everything (version, changelog, release note, manifest, `npm run gate -- --publish`) and stop before pushing.
