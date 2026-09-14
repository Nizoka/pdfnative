#!/usr/bin/env tsx
/**
 * pdfnative — Tree-shaking gate (v1.8.0)
 * ========================================
 * Bundles a single export from the built `dist/index.js` with esbuild (a
 * transitive dev dependency of tsup, so nothing new is installed) and fails
 * when the result carries code that export does not need.
 *
 * `package.json` declares `sideEffects: false`, and every module in `src/`
 * is written without module-level side effects; this script is what makes
 * that claim testable. The 1.8.0 audit found a `parseColor`-only bundle at
 * 29.8 KB: the Universal Shaping Engine built its grammar with top-level
 * combinator calls, which a bundler must keep, so every consumer shipped it.
 *
 * Usage:
 *   npm run build && npm run verify:bundle
 *   npx tsx scripts/verify-bundle.ts --json
 *
 * Exit codes:
 *   0 — every probe is within budget and free of the markers it must not carry
 *   1 — a probe is over budget or carries a marker
 *   2 — dist/ is missing (run `npm run build` first) or esbuild is unavailable
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(REPO_ROOT, 'dist', 'index.js');

interface Probe {
    /** What the consumer imports. */
    readonly exports: readonly string[];
    /** Minified byte budget. */
    readonly maxBytes: number;
    /** Substrings that prove unrelated code was retained. */
    readonly mustNotContain: readonly [label: string, marker: string][];
}

/**
 * Markers are literals a subsystem cannot exist without: a USE cluster
 * category name that only the shaping grammar mentions, the first AES S-box
 * bytes, the first SHA-256 round constant.
 */
const MARKERS = {
    useGrammar: ['USE grammar', 'HVM'] as [string, string],
    aes: ['AES S-box', '99,124,119,123'] as [string, string],
    sha256: ['SHA-256 constants', '1116352408'] as [string, string],
    fontData: ['embedded font data', 'AAEAAAAR'] as [string, string],
};

const PROBES: readonly Probe[] = [
    // Budgets sit about 50 % above the sizes measured at 1.8.0 (2.6 KB,
    // 1.9 KB, 52 KB): loose enough for a bug fix, tight enough that a
    // dependency creeping back into a leaf export fails the gate — the
    // original 8 / 8 / 96 KB budgets would have let a 3× regression through.
    {
        exports: ['parseColor'],
        maxBytes: 4 * 1024,
        mustNotContain: [MARKERS.useGrammar, MARKERS.aes, MARKERS.sha256, MARKERS.fontData],
    },
    {
        exports: ['bindUnits', 'applyPunctuationSpacing'],
        maxBytes: 3 * 1024,
        mustNotContain: [MARKERS.useGrammar, MARKERS.aes, MARKERS.sha256, MARKERS.fontData],
    },
    {
        exports: ['validatePdfX'],
        maxBytes: 64 * 1024,
        mustNotContain: [MARKERS.useGrammar, MARKERS.fontData],
    },
];

interface ProbeResult {
    readonly exports: readonly string[];
    readonly bytes: number;
    readonly maxBytes: number;
    readonly retained: readonly string[];
    readonly ok: boolean;
}

async function loadEsbuild(): Promise<{ build: (o: Record<string, unknown>) => Promise<unknown> } | null> {
    try {
        const url = pathToFileURL(resolve(REPO_ROOT, 'node_modules', 'esbuild', 'lib', 'main.js')).href;
        return await import(url) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const json = process.argv.includes('--json');
    if (!existsSync(DIST)) {
        console.error('verify-bundle: dist/index.js is missing — run `npm run build` first.');
        process.exit(2);
    }
    const esbuild = await loadEsbuild();
    if (!esbuild) {
        console.error('verify-bundle: esbuild is not installed — run `npm ci`.');
        process.exit(2);
    }

    const work = mkdtempSync(join(tmpdir(), 'pdfnative-bundle-'));
    const results: ProbeResult[] = [];
    try {
        for (const probe of PROBES) {
            const entry = join(work, 'entry.mjs');
            const out = join(work, 'out.mjs');
            const dist = DIST.replace(/\\/g, '/');
            writeFileSync(entry, `export { ${probe.exports.join(', ')} } from '${dist}';\n`);
            await esbuild.build({
                entryPoints: [entry], bundle: true, format: 'esm', minify: true,
                outfile: out, logLevel: 'silent', platform: 'neutral', target: 'es2020',
            });
            const code = readFileSync(out, 'utf8');
            const retained = probe.mustNotContain.filter(([, marker]) => code.includes(marker)).map(([label]) => label);
            const bytes = Buffer.byteLength(code);
            results.push({
                exports: probe.exports, bytes, maxBytes: probe.maxBytes, retained,
                ok: bytes <= probe.maxBytes && retained.length === 0,
            });
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }

    const failed = results.filter(r => !r.ok);
    if (json) {
        console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
    } else {
        for (const r of results) {
            const kb = (r.bytes / 1024).toFixed(1);
            const cap = (r.maxBytes / 1024).toFixed(0);
            const tail = r.retained.length ? ` — retained: ${r.retained.join(', ')}` : '';
            console.log(`${r.ok ? '✓' : '✗'} { ${r.exports.join(', ')} } → ${kb} KB (budget ${cap} KB)${tail}`);
        }
        console.log(failed.length === 0
            ? `verify-bundle: ${results.length} probes tree-shake within budget.`
            : `verify-bundle: ${failed.length} of ${results.length} probes retain code they do not use.`);
    }
    process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
});
