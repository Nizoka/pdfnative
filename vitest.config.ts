import { defineConfig } from 'vitest/config';

export default defineConfig({
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
                'src/fonts/index.ts',
                'src/shaping/index.ts',
                'src/worker/index.ts',
                'src/types/pdf-types.ts',
                'src/parser/index.ts',
                'src/types/pdf-document-types.ts',
            ],
            thresholds: {
                statements: 90,
                branches: 80,
                functions: 85,
                lines: 90,
            },
        },
    },
});
