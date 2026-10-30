#!/usr/bin/env tsx
/**
 * pdfnative — verify:unicode
 * ===========================
 * Every TypeScript data module generated from the vendored Unicode Character
 * Database files under `scripts/data/` must be exactly what its generator
 * yields today: a hand edit, a stale regeneration or a UCD file replaced
 * without re-running the generator fails here (and therefore in CI — this is
 * the `verify:unicode` step of `npm run gate`).
 *
 * One driver, four checks, so adding a generator means one line below:
 *   - scripts/generate-use-data.ts        → src/shaping/use-data.ts
 *   - scripts/generate-bidi-mirroring.ts  → src/shaping/bidi-mirroring-data.ts
 *   - scripts/generate-bidi-brackets.ts   → src/shaping/bidi-brackets-data.ts
 *   - scripts/generate-bidi-class.ts      → src/shaping/bidi-class-data.ts
 *
 * Exit code: 0 when every module is current, 1 otherwise.
 *
 * @since 1.9.0 (the use-data check alone was `verify:unicode` before)
 */

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GENERATORS: readonly string[] = [
    'scripts/generate-use-data.ts',
    'scripts/generate-bidi-mirroring.ts',
    'scripts/generate-bidi-brackets.ts',
    'scripts/generate-bidi-class.ts',
];

let failed = 0;
for (const generator of GENERATORS) {
    const run = spawnSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, generator), '--check'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    if (run.status === 0) {
        process.stdout.write(`  ok   ${generator}${out ? ` — ${out.split(/\r?\n/).pop()}` : ''}\n`);
    } else {
        failed++;
        process.stderr.write(`  FAIL ${generator}\n${out.split(/\r?\n/).map(l => `       ${l}`).join('\n')}\n`);
    }
}
if (failed > 0) {
    process.stderr.write(`verify-unicode: ${failed} generated module(s) out of date — re-run the generator(s) named above.\n`);
    process.exit(1);
}
process.stdout.write('verify-unicode: every generated Unicode data module is current.\n');
