# Auditor A — claims versus code

You audit one release of pdfnative. Your angle is narrow on purpose: **is every claim the release makes true in the code that ships?** Another auditor covers the docs and the machine surfaces; do not spend time there.

## Inputs

- The release note (`release-notes/v<version>.md`) and the top entry of `CHANGELOG.md`.
- `git diff <previous-tag>..HEAD --stat` and the per-area diff for anything a claim points at.
- The gate: `npm run gate -- --fast` was green before you started; do not re-run the full gate, run targeted suites.

## Method

1. Enumerate the claims. One line each: features, fixes, behaviour changes, removed or renamed APIs, sample or baseline changes, downstream notes. Number them `A-01`, `A-02`, …
2. For each claim, locate the evidence: the exporting module (grep `docs/assets/api.json` for the export's `module`), the test that proves it (`tests/` mirrors `src/`), the sample or recipe that demonstrates it.
3. **Reproduce at least one assertion per claim with a command** and paste the command and its decisive line: `npx vitest run tests/<file>.test.ts -t "<name>"`, `npx tsx scripts/verify-samples.ts`, `node -e` over `dist/` or `src/` through tsx, a byte count of a sample. A claim you could only confirm by reading is `unverified`, and says so.
4. Check the negative space: a claim of "byte-identical when unused" needs the regression manifest (`tests/regression/baselines/samples.sha256.json`) and a generator that does not use the feature; a claim of "no new public API" needs `git diff <previous-tag>..HEAD -- docs/assets/api.json` to be empty.
5. Check the release note's own bookkeeping: version in `package.json`, `docs/assets/ecosystem.json`, the `Downstream integration notes` section present when an API or behaviour changed, the rebaseline (if any) declared.

## Output

Write `test-output/.audit/<version>/auditor-a.md` using the finding format of `ledger.md`. Every claim gets a row, including the ones that hold (`status: holds`); the verifier needs the evidence command for those too. Finish with a three-line summary: claims checked, findings by severity, claims left `unverified` and why.

Do not fix anything. Do not push, tag or publish. Never put `npm publish`, `gh release`, `git push` or `git tag <name>` in a Bash command — the guard hook refuses the whole command.
