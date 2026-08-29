---
description: "Run the full quality gate: typecheck, lint, tests, coverage analysis, and build verification."
agent: "agent"
---
# Quality Gate

Run the full pdfnative quality gate and report results.

## Steps

1. `npm run typecheck:all` — verify zero TypeScript errors across src/, tests/, and scripts/
2. `npm run lint` — verify zero ESLint warnings/errors
3. `npm run test` — run all unit tests (2691+ expected)
4. `npm run test:coverage` — verify coverage thresholds (88% statements / 80% branches / 85% functions / 90% lines)
5. `npm run build` — verify clean build (ESM + CJS + .d.ts)
6. Verify `dist/` output contains: `index.js`, `index.cjs`, `index.d.ts`, `worker/index.js`, `tools/index.js`, `tools/build-emoji-font.js` (the last two are required by package.json `exports`/`bin`)
7. Report summary with pass/fail for each step

## Quality Thresholds
- Zero TypeScript errors
- Zero ESLint errors (warnings acceptable but should be noted)
- All tests passing
- Coverage thresholds (vitest.config.ts, single source of truth): 88% statements, 80% branches, 85% functions, 90% lines
- Clean build with no warnings
