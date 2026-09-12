#!/usr/bin/env tsx
/**
 * pdfnative — Font-module reproducibility gate (v1.8.0)
 * =======================================================
 * Every bundled `fonts/*-data.js` carries the header "DO NOT EDIT —
 * Regenerate with: node scripts/build-font-data.cjs …". This proves that
 * sentence true: each module is rebuilt from the source font it declares and
 * compared byte for byte with what the repository ships.
 *
 * Why it exists: the modules had silently drifted from the generator. Eleven
 * predated the ligature extraction and carried no `ligatures` table at all,
 * and three (Polish, Turkish, Vietnamese) advertised roughly 2 650 code
 * points their subsetted font could not draw. A contributor who followed the
 * header and regenerated would have produced a different file with no way to
 * know which one was right.
 *
 * Usage:
 *   npm run fonts:download     # populate fonts/ttf/ (git-ignored)
 *   npm run verify:fonts
 *   npx tsx scripts/verify-fonts.ts --json
 *
 * Exit codes:
 *   0 — every module matches its generator output, or the source fonts are
 *       absent (skip, like validate:pdfa without veraPDF)
 *   1 — a module differs from what the generator produces
 *   2 — bad usage
 *
 * The two emoji modules are excluded: they are produced by
 * `scripts/build-color-emoji-data.ts`, which adds the COLR/CPAL colour
 * glyphs and the sequence table the generic CLI knows nothing about.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FONTS_DIR = join(REPO_ROOT, 'fonts');
const TTF_DIR = join(FONTS_DIR, 'ttf');
const GENERATOR = join(REPO_ROOT, 'tools', 'build-font-data.cjs');

/** Built by a different generator; see the module header. */
const EXCLUDED = new Set(['noto-emoji-data.js', 'noto-color-emoji-data.js']);

interface Divergence {
    readonly module: string;
    readonly reason: string;
}

function sourceOf(moduleText: string): string | null {
    return /\* Source: (\S+\.ttf)/.exec(moduleText)?.[1] ?? null;
}

/** Name the first export whose payload differs, for an actionable message. */
function firstDifferingExport(a: string, b: string): string | null {
    const names = (s: string): Map<string, string> => {
        const m = new Map<string, string>();
        for (const line of s.split('\n')) {
            const hit = /^export const (\w+) = ([\s\S]*)$/.exec(line);
            if (hit) m.set(hit[1], hit[2]);
        }
        return m;
    };
    const A = names(a); const B = names(b);
    for (const k of new Set([...A.keys(), ...B.keys()])) {
        if (!A.has(k)) return `missing export: ${k}`;
        if (!B.has(k)) return `unexpected export: ${k}`;
        if (A.get(k) !== B.get(k)) return `export differs: ${k}`;
    }
    return null;
}

function printMissingFontsHelp(): void {
    process.stderr.write([
        'Source fonts not found in fonts/ttf/.',
        '',
        '  The TTFs are git-ignored (tens of megabytes), so this check needs',
        '  them fetched first:',
        '',
        '    npm run fonts:download',
        '    npm run verify:fonts',
        '',
        '  Skipping (exit 0) — this never blocks local development.',
        '',
    ].join('\n'));
}

function main(): number {
    const args = process.argv.slice(2);
    const jsonMode = args.includes('--json');
    for (const a of args) {
        if (a !== '--json') {
            process.stderr.write(`Unknown argument "${a}". Expected --json.\n`);
            return 2;
        }
    }

    if (!existsSync(TTF_DIR) || readdirSync(TTF_DIR).filter(f => f.endsWith('.ttf')).length === 0) {
        printMissingFontsHelp();
        return 0;
    }

    const modules = readdirSync(FONTS_DIR)
        .filter(f => f.endsWith('-data.js') && !EXCLUDED.has(f))
        .sort();

    const work = mkdtempSync(join(tmpdir(), 'pdfnative-fonts-'));
    const diverged: Divergence[] = [];
    let checked = 0;
    let skipped = 0;

    try {
        for (const mod of modules) {
            const committed = readFileSync(join(FONTS_DIR, mod), 'utf8');
            const src = sourceOf(committed);
            if (!src) { diverged.push({ module: mod, reason: 'no "Source:" header' }); continue; }

            const ttf = join(TTF_DIR, src);
            if (!existsSync(ttf)) { skipped++; continue; }

            const out = join(work, mod);
            execFileSync('node', [GENERATOR, ttf, out], { stdio: 'pipe' });
            const fresh = readFileSync(out, 'utf8');
            checked++;

            if (fresh !== committed) {
                diverged.push({
                    module: mod,
                    reason: firstDifferingExport(committed, fresh)
                        ?? `content differs (${committed.length} vs ${fresh.length} bytes)`,
                });
            }
        }
    } finally {
        rmSync(work, { recursive: true, force: true });
    }

    if (jsonMode) {
        process.stdout.write(`${JSON.stringify({ checked, skipped, diverged }, null, 2)}\n`);
    } else {
        for (const d of diverged) process.stderr.write(`✗ ${d.module}: ${d.reason}\n`);
    }

    if (diverged.length > 0) {
        if (!jsonMode) {
            process.stderr.write([
                '',
                `${diverged.length} font module(s) do not match the generator.`,
                '',
                'Regenerate them, and say why the bytes changed in the release notes:',
                '  node tools/build-font-data.cjs fonts/ttf/<Source>.ttf fonts/<module>.js',
                '',
                'Then confirm nothing rendered differently:',
                '  npm run test:generate && npm run verify:samples',
                '',
            ].join('\n'));
        }
        return 1;
    }

    if (!jsonMode) {
        const note = skipped > 0 ? `; ${skipped} skipped (source font absent)` : '';
        process.stdout.write(
            `✓ ${checked} font module(s) reproduce exactly from ${relative(REPO_ROOT, TTF_DIR)}${note}.\n`,
        );
    }
    return 0;
}

process.exit(main());
