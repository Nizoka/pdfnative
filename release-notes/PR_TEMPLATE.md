# Release pull-request template

The body of the release pull request. Copy it into `RELEASE_PR_v{{version}}.md`
at the repository root (git-ignored — the per-version scratch file is never
committed; this template is), replace `{{version}}`, `{{date}}` and
`{{headline}}`, and fill every section from the facts of the branch. The
Verification section is a record of what actually ran, not a promise:
paste the numbers the gate printed, and mark anything not yet run as PENDING.

---

# release: v{{version}} — {{headline}}

## Summary

<!-- One paragraph: what the release is about, the compatibility statement
     (zero runtime dependencies, breaking changes or none, exports added /
     removed), and where existing output changed — every intentional
     rebaseline is listed in the release note's Upgrade section. -->

## What's in it

| Area | Change |
|---|---|
| <!-- e.g. Typography --> | <!-- the public surface, one row per workstream --> |
| Issues | <!-- #NN closed, with the one-line fix --> |
| Docs & samples | <!-- guides, playgrounds, samples added or rebaselined --> |

## Deferred

<!-- What was scoped out and why, so the next release starts from a decision
     rather than a rediscovery. Delete the section if nothing was deferred. -->

- ...

## Docs, samples & recipes

- Release note `release-notes/v{{version}}.md` and the `CHANGELOG.md` entry `## [{{version}}] – {{date}}`.
- Manifest `docs/assets/ecosystem.json`: version {{version}}, `verifiedOn` {{date}}, counts updated (tests, testFiles, samplePdfs, pdfaSamples, guides, playgrounds, recipes).
- CDN pins on the site move to `pdfnative@{{version}}`, so they resolve once the release is published.
- <!-- new or updated guides, playgrounds, recipes; sample count before → after -->

## Verification

The release gate is `npm run gate -- --publish` (PowerShell: `npx tsx scripts/gate.ts --publish`). Each line names the individual gate and what it reported on the release commit:

- [ ] `npm run typecheck:all` — clean (src + tests + scripts).
- [ ] `npm run lint` — clean.
- [ ] `npm run test:coverage` — N tests across M files; statements / branches / functions / lines against the thresholds in vitest.config.ts.
- [ ] `npm run build` — ESM, CJS, declarations.
- [ ] `npm run verify:bundle` — every probe within budget.
- [ ] `npm run verify:unicode` — the USE table matches its generator.
- [ ] `npm run verify:fonts` — every font module reproduces from its source.
- [ ] `npm run test:generate` + `npm run verify:samples` — N samples tracked; every rebaseline pre-declared in the release note.
- [ ] `npm run validate:pdfa` — N/N PDF/A-claiming samples compliant (veraPDF, locally on the full corpus; also blocking in CI).
- [ ] `npm run docs:all && npm run verify:docs` — all rules passed.

## Merge checklist

- [ ] CI green on Node 22 and Node 24 (`ci (22)`, `ci (24)`: typecheck, lint, unicode, coverage, build, bundle).
- [ ] `verapdf` workflow green.
- [ ] `sample-regression` workflow green.
- [ ] `release-notes/v{{version}}.md` reviewed; release date adjusted if publication is not {{date}}.
- [ ] Squash-merge to `main` with the title `release: v{{version}} — {{headline}}`.
- [ ] Tag `v{{version}}` on the merge commit; publish the GitHub Release (title `v{{version}} — {{headline}}`, body = the release note) → `publish.yml` → npm with provenance.
- [ ] After publication: the CDN pins on the site (`pdfnative@{{version}}`) resolve, and `npm view pdfnative version` prints {{version}}.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
