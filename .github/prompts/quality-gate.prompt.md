---
description: "Run the full quality gate: typecheck, lint, tests, coverage analysis, and build verification."
agent: "agent"
---
# Quality Gate

Run the full pdfnative quality gate and report results.

## Steps

1. `npm run typecheck:all` — verify zero TypeScript errors across src/, tests/, and scripts/
2. `npm run lint` — verify zero ESLint warnings/errors
3. `npm run test` — run all unit tests (1513+ expected)
4. `npm run test:coverage` — verify coverage thresholds (>90% core, >85% overall)
5. `npm run build` — verify clean build (ESM + CJS + .d.ts)
6. Verify `dist/` output contains: `index.js`, `index.cjs`, `index.d.ts`, `worker/index.js`
7. Report summary with pass/fail for each step

## Quality Thresholds
- Zero TypeScript errors
- Zero ESLint errors (warnings acceptable but should be noted)
- All tests passing
- Core modules: >95% line coverage
- Font modules: >90% line coverage
- Overall: >90% line coverage
- Clean build with no warnings
