<!--
Thank you for contributing to pdfnative. Describe the change, then walk the
checklist. The items mirror CONTRIBUTING.md §Pull Request Checklist word for
word; keep the two in step when you change either.
-->

## What and why

<!-- One paragraph: what changes, why, and which issue it closes (`Closes #…`). -->

## Checklist

- [ ] `npm run gate` passes — the CI profile in one command (`npm run gate -- --fast` for a quick loop while iterating; PowerShell swallows a bare `--`, so call `npx tsx scripts/gate.ts --fast` there)
- [ ] All tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests
- [ ] No `any` types introduced
- [ ] No new runtime dependencies added
- [ ] If samples or PDF/A behaviour changed: `npm run test:generate && npm run verify:samples && npm run validate:pdfa` passes locally (veraPDF installed — see [PDF/A validation](../CONTRIBUTING.md#pdfa-validation-verapdf); new PDF/A-claiming samples bump `declared.pdfaSamples`; an intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and explained in the commit)
- [ ] If docs/, playgrounds, README or llms files changed: `npm run verify:docs` passes
- [ ] CHANGELOG.md updated if user-facing changes
- [ ] For releases: follow [Release](../CONTRIBUTING.md#release) — `release-notes/vX.Y.Z.md` written, and `npm run gate -- --publish` passes locally, which runs every individual gate: `typecheck:all`, `lint`, `verify:unicode`, `test:coverage`, `build`, `verify:bundle`, `test:generate`, `verify:samples`, `verify:fonts`, `validate:pdfa` (all PDF/A-claiming samples compliant), `verify:docs`

<!--
Runtime changes also need a ROADMAP.md entry and a line in the next
release-notes/vX.Y.Z.md; a public-API addition, removal or behaviour shift is
described there under "Downstream integration notes" (AGENTS.md §Releasing).
-->
