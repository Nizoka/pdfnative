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
            thresholds: {
                statements: 88,
                branches: 80,
                functions: 85,
                lines: 90,
            },
        },
    },
});
