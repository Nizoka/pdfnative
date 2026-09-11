#!/usr/bin/env tsx
/**
 * pdfnative — Sample regression gate (v1.8.0)
 * =============================================
 * Fingerprints every generated sample and compares the result to the
 * committed baseline, so a change anywhere in the engine that alters
 * existing output is caught before it ships.
 *
 * Usage:
 *   npm run test:generate                  # populate test-output/
 *   npm run verify:samples                 # compare against the baseline
 *   npx tsx scripts/verify-samples.ts --update   # rewrite the baseline
 *   npx tsx scripts/verify-samples.ts --json     # machine-readable report
 *
 * (PowerShell swallows a bare `--`, so call the script directly when passing
 * flags rather than `npm run verify:samples -- --update`.)
 *
 * The fingerprinting itself lives in `scripts/lib/sample-fingerprint.ts`,
 * shared with the vitest gate at `tests/regression/samples.test.ts` so both
 * agree on what "unchanged output" means.
 *
 * Exit codes:
 *   0 — every sample matches the baseline (or --update rewrote it)
 *   1 — a fingerprint changed, a sample vanished, or a new sample is not in
 *       the baseline
 *   2 — bad usage, or test-output/ is empty (run test:generate first)
 *
 * Why not a pixel diff: pdfnative ships no rasteriser, and the glyph
 * rasteriser under tests/visual/ draws text only — no paths, XObjects,
 * shadings or colour — so charts, SVG, barcodes, watermarks, printer's marks
 * and colour emoji would all compare as blank.
 */

// Must be first: pins process.env.TZ before anything formats a PDF date.
import './helpers/tz.js';

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import {
    REPO_ROOT, BASELINE_PATH,
    fingerprintAll, loadBaseline, compareToBaseline,
    type BaselineEntry, type Baseline,
} from './lib/sample-fingerprint.js';
import { SAMPLE_CREATION_DATE } from './helpers/io.js';

function saveBaseline(entries: Record<string, BaselineEntry>): void {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    const sorted: Record<string, BaselineEntry> = {};
    for (const key of Object.keys(entries).sort()) sorted[key] = entries[key];
    const payload: Baseline = {
        $comment:
            'Fingerprints of every sample in test-output/. Regenerate deliberately with '
            + '`npx tsx scripts/verify-samples.ts --update`, and say why in the release notes: a '
            + 'changed hash means existing output changed. Mode `bytes` is a SHA-256 of the file; '
            + 'mode `semantic` is a SHA-256 of a canonical projection of the decrypted document, '
            + 'used for encrypted samples whose bytes are CSPRNG-derived and can never repeat.',
        creationDate: SAMPLE_CREATION_DATE.toISOString(),
        timezone: 'UTC',
        entries: sorted,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main(): number {
    const args = process.argv.slice(2);
    for (const a of args) {
        if (a !== '--update' && a !== '--json') {
            console.error(`Unknown argument "${a}". Expected --update and/or --json.`);
            return 2;
        }
    }
    const update = args.includes('--update');
    const jsonMode = args.includes('--json');

    const { entries, unreadable, missingEncrypted } = fingerprintAll();
    const total = Object.keys(entries).length;
    if (total === 0 && unreadable.length === 0) {
        console.error('test-output/ holds no PDFs — run `npm run test:generate` first.');
        return 2;
    }

    if (update) {
        if (unreadable.length > 0 || missingEncrypted.length > 0) {
            for (const u of unreadable) console.error(`✗ ${u.path}: ${u.error}`);
            for (const m of missingEncrypted) console.error(`✗ ${m}: listed in ENCRYPTED_SAMPLES but not generated`);
            console.error('\nRefusing to write a baseline while samples are unreadable or missing.');
            return 1;
        }
        saveBaseline(entries);
        console.log(`Baseline updated: ${total} samples → ${relative(REPO_ROOT, BASELINE_PATH)}`);
        return 0;
    }

    const baseline = loadBaseline();
    if (baseline === null) {
        console.error(
            `No baseline at ${relative(REPO_ROOT, BASELINE_PATH)}.\n`
            + 'Create it with: npx tsx scripts/verify-samples.ts --update',
        );
        return 1;
    }

    const { changed, added, removed } = compareToBaseline(entries, baseline);

    if (jsonMode) {
        console.log(JSON.stringify({ total, changed, added, removed, unreadable, missingEncrypted }, null, 2));
    } else {
        for (const u of unreadable) console.error(`✗ unreadable  ${u.path}: ${u.error}`);
        for (const m of missingEncrypted) console.error(`✗ missing     ${m} (listed in ENCRYPTED_SAMPLES)`);
        for (const p of changed) {
            const b = baseline.entries[p];
            const c = entries[p];
            const sizeNote = b.size === c.size ? `${c.size} B` : `${b.size} B → ${c.size} B`;
            console.error(`✗ changed     ${p}  [${c.mode}]  ${sizeNote}`);
        }
        for (const p of added) console.error(`✗ new         ${p} (not in the baseline)`);
        for (const p of removed) console.error(`✗ disappeared ${p} (in the baseline, not generated)`);
    }

    const failures = changed.length + added.length + removed.length + unreadable.length + missingEncrypted.length;
    if (failures === 0) {
        if (!jsonMode) {
            const semantic = Object.values(entries).filter(e => e.mode === 'semantic').length;
            console.log(`✓ ${total} samples match the baseline (${total - semantic} byte-exact, ${semantic} semantic).`);
        }
        return 0;
    }

    if (!jsonMode) {
        console.error(
            `\n${failures} sample(s) diverged from the baseline.\n`
            + 'If the change is intended, say so in the release notes and rebaseline with:\n'
            + '  npm run test:generate && npx tsx scripts/verify-samples.ts --update',
        );
    }
    return 1;
}

process.exit(main());
