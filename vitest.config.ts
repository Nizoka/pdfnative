import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The executable-documentation recipes in `recipes/` import from 'pdfnative'
 * exactly as a consumer would; these aliases point that specifier (and the
 * `pdfnative/fonts/*` data-module subpaths) at the in-repo sources so the
 * recipe suite always exercises the current tree. The fonts alias must be
 * listed first — a bare 'pdfnative' entry would otherwise prefix-match the
 * subpath imports.
 */
const rootUrl = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Reporters are chosen for token-cheap output: `dot` prints one character
 * per test instead of one line per file, and `github-actions` adds inline
 * annotations on CI only. When `scripts/gate.ts` drives the run (GATE=1) a
 * JSON report is written as well, which is where the gate reads the test
 * count from; nothing else needs the file, so it is not produced otherwise.
 */
const reporters: Array<'dot' | 'github-actions' | ['json', { outputFile: string }]> = ['dot'];
if (process.env.GITHUB_ACTIONS) reporters.push('github-actions');
if (process.env.GATE === '1') reporters.push(['json', { outputFile: 'test-output/.gate/vitest.json' }]);

export default defineConfig({
    resolve: {
        alias: [
            { find: /^pdfnative\/fonts\/(.*)$/, replacement: `${rootUrl('./fonts')}/$1` },
            { find: /^pdfnative$/, replacement: rootUrl('./src/index.ts') },
        ],
    },
    test: {
        include: ['tests/**/*.test.ts'],
        environment: 'node',
        globals: false,
        reporters,
        // PDF dates carry the local UTC offset, so any test that formats one
        // would otherwise pass in Paris and fail on a UTC runner (or the
        // reverse). Pinning the zone here makes the suite machine-independent;
        // scripts/helpers/tz.ts does the same for the sample generator.
        env: { TZ: 'UTC' },
        // Process isolation: a test that leaks a global, a timer or a
        // registered font cannot influence the next file's outcome.
        pool: 'forks',
        // Determinism: the same ordering on every machine, so a failure seen
        // in CI reproduces locally without a seed.
        sequence: { shuffle: false },
        // Under coverage instrumentation the signature suites (RSA key
        // generation, CMS building) and the 10K-row layout tests legitimately
        // exceed vitest's 5 s default; 15 s is the ceiling, not a target.
        testTimeout: 15_000,
        hookTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/worker/pdf-worker.ts',
                'src/index.ts',
                'src/core/index.ts',
                'src/crypto/index.ts',
                'src/fonts/index.ts',
                'src/shaping/index.ts',
                'src/worker/index.ts',
                'src/types/pdf-types.ts',
                'src/parser/index.ts',
                'src/types/pdf-document-types.ts',
                'src/tools/index.ts',
            ],
            // `text-summary` is four lines instead of one per source file;
            // `json-summary` is what scripts/gate.ts reads the percentage
            // from; `html` stays for local drill-down.
            reporter: ['text-summary', 'json-summary', 'html'],
            thresholds: {
                statements: 88,
                branches: 80,
                functions: 85,
                lines: 90,
            },
        },
    },
});
