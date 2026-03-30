import { defineConfig } from 'tsup';

export default defineConfig([
    // Main library entry
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2020',
        outDir: 'dist',
    },
    // Worker entry (self-contained bundle)
    {
        entry: { 'worker/index': 'src/worker/pdf-worker.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2020',
        outDir: 'dist',
        noExternal: [/.*/], // Bundle everything into worker
    },
]);
