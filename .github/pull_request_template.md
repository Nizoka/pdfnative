## Description

<!-- What does this PR change and why? -->

## Related Issues

<!-- Link related issues: Fixes #123, Relates to #456 -->

## Checklist

- [ ] Tests pass (`npm run test`)
- [ ] Type check passes (`npm run typecheck:all`)
- [ ] Lint passes (`npm run lint`)
- [ ] New code has tests (coverage thresholds must not regress)
- [ ] If samples or PDF/A behaviour changed: `npm run test:generate && npm run validate:pdfa` passes (new PDF/A-claiming samples bump `declared.pdfaSamples` in `docs/assets/ecosystem.json`)
- [ ] If docs/, playgrounds, README or llms files changed: `npm run verify:docs` passes
- [ ] CHANGELOG.md updated (if user-facing change)
- [ ] No breaking changes (or documented in description)
