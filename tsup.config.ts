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
    // Programmatic tools sub-path export (font compilation API) → dist/tools
    {
        entry: { 'tools/index': 'src/tools/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2020',
        outDir: 'dist',
    },
    // Colour-emoji generator CLI (self-contained ESM bin → dist/tools)
    {
        entry: { 'tools/build-emoji-font': 'scripts/build-emoji-font.ts' },
        format: ['esm'],
        dts: false,
        sourcemap: false,
        splitting: false,
        treeshake: true,
        minify: false,
        target: 'es2020',
        outDir: 'dist',
        banner: { js: '#!/usr/bin/env node' },
        noExternal: [/.*/], // Bundle the build core + src deps into the bin
    },
]);
