#!/usr/bin/env tsx
/**
 * pdfnative — Sample regression gate (v1.8.0)
 * =============================================
 * Fingerprints every generated sample and compares the result to the
 * committed baseline, so a change anywhere in the engine that alters
 * existing output is caught before it ships.
 *
 * The baseline is a CHAIN, not a snapshot of the current tree. Each entry
 * records the release whose output its hash is (`since`) and keeps it across
 * every later rebaseline that leaves the sample alone, so 1.8.0 is still held
 * to the bytes v1.7.0 emitted, 1.9.0 will be held to 1.8.0's, and so on. An
 * entry whose hash is deliberately re-anchored moves to the release doing the
 * re-anchoring, which is what makes it visible in review. A sample introduced by
 * the release under development has no earlier reference, so it is reported
 * but does not fail — pass `--strict` to require it to be baselined in the
 * same pull request.
 *
 * Usage:
 *   npm run test:generate                  # populate test-output/
 *   npm run verify:samples                 # compare against the baseline
 *   npx tsx scripts/verify-samples.ts --update   # rewrite the baseline
 *   npx tsx scripts/verify-samples.ts --strict   # also fail on new samples
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
    fingerprintAll, loadBaseline, compareToBaseline, currentVersion, chainSince, unexpectedDuplicates,
    type Fingerprint, type Baseline,
} from './lib/sample-fingerprint.js';
import { SAMPLE_CREATION_DATE } from './helpers/io.js';

/**
 * Write the manifest, carrying each sample's `since` forward.
 *
 * `since` names the release whose output the stored hash actually is. An
 * unchanged sample keeps it however many times the manifest is rewritten, so
 * an entry reading `1.7.0` really is still being held to the bytes v1.7.0
 * emitted. A sample whose hash changed is being re-anchored, and its `since`
 * moves to the version under development: the reference is no longer the
 * older release's, and saying otherwise would hide the re-anchoring in a
 * one-line diff instead of surfacing it for review. Samples appearing for the
 * first time are stamped the same way, having no earlier reference at all.
 */
/** Provenance written only when no manifest exists yet. */
const INITIAL_PROVENANCE =
    'Initial baseline: every entry is anchored to the release that created it. Replace this note '
    + 'with the account of how the entries were verified; later rebaselines carry it forward.';

function saveBaseline(entries: Record<string, Fingerprint>, previous: Baseline | null): void {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    const version = currentVersion();
    const sorted = chainSince(entries, previous, version);
    const payload: Baseline = {
        $comment:
            'Fingerprints of every sample in test-output/. Regenerate deliberately with '
            + '`npx tsx scripts/verify-samples.ts --update`, and say why in the release notes: a '
            + 'changed hash means existing output changed. Mode `bytes` is a SHA-256 of the file; '
            + 'mode `semantic` is a SHA-256 of a canonical projection of the decrypted document, '
            + 'used for encrypted samples whose bytes are CSPRNG-derived and can never repeat. '
            + 'Each entry\'s `since` names the release whose output the hash is: it is carried '
            + 'forward untouched while the sample is unchanged, and moves to the release doing '
            + 'the rebaseline when the hash changes, so the chain 1.7.0 -> 1.8.0 -> 1.9.0 stays '
            + 'auditable and every re-anchoring is visible in the diff.',
        baselineVersion: version,
        // The provenance note is the maintainer's account of why each group of
        // entries is anchored where it is. It is carried forward verbatim: an
        // --update must never silently replace it (one did, and the note
        // described a 242-sample snapshot for two rebaselines). Edit it by
        // hand in the same commit as the rebaseline it explains.
        provenance: previous?.provenance ?? INITIAL_PROVENANCE,
        creationDate: SAMPLE_CREATION_DATE.toISOString(),
        timezone: 'UTC',
        entries: sorted,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main(): number {
    const args = process.argv.slice(2);
    for (const a of args) {
        if (a !== '--update' && a !== '--json' && a !== '--strict') {
            console.error(`Unknown argument "${a}". Expected --update, --json and/or --strict.`);
            return 2;
        }
    }
    const update = args.includes('--update');
    const jsonMode = args.includes('--json');
    const strict = args.includes('--strict');

    const { entries, unreadable, missingEncrypted } = fingerprintAll();
    const total = Object.keys(entries).length;
    if (total === 0 && unreadable.length === 0) {
        console.error('test-output/ holds no PDFs — run `npm run test:generate` first.');
        return 2;
    }
    // Two samples meant to show a difference must not be the same file.
    const duplicates = unexpectedDuplicates(entries);

    if (update) {
        if (unreadable.length > 0 || missingEncrypted.length > 0 || duplicates.length > 0) {
            for (const u of unreadable) console.error(`✗ ${u.path}: ${u.error}`);
            for (const m of missingEncrypted) console.error(`✗ ${m}: listed in ENCRYPTED_SAMPLES but not generated`);
            for (const g of duplicates) console.error(`✗ ${g.join(' == ')}: identical bytes (list the pair in IDENTICAL_SAMPLE_GROUPS if that is intended)`);
            console.error('\nRefusing to write a baseline while samples are unreadable, missing or unexpectedly identical.');
            return 1;
        }
        const previous = loadBaseline();
        saveBaseline(entries, previous);
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
        console.log(JSON.stringify({
            baselineVersion: baseline.baselineVersion,
            currentVersion: currentVersion(),
            total, changed, added, removed, unreadable, missingEncrypted, duplicates,
        }, null, 2));
    } else {
        for (const u of unreadable) console.error(`✗ unreadable  ${u.path}: ${u.error}`);
        for (const m of missingEncrypted) console.error(`✗ missing     ${m} (listed in ENCRYPTED_SAMPLES)`);
        for (const g of duplicates) console.error(`✗ identical   ${g.join(' == ')} (a pair meant to differ emits the same bytes)`);
        for (const p of changed) {
            const b = baseline.entries[p];
            const c = entries[p];
            const sizeNote = b.size === c.size ? `${c.size} B` : `${b.size} B → ${c.size} B`;
            console.error(`✗ changed     ${p}  [${c.mode}]  ${sizeNote}`);
        }
        for (const p of removed) console.error(`✗ disappeared ${p} (in the baseline, not generated)`);
        // A sample introduced by the release under development has no earlier
        // reference to be held to, so it informs rather than blocks. Pass
        // --strict to require the manifest to be rebaselined in the same PR.
        for (const p of added) {
            const line = `${strict ? '✗' : '•'} new         ${p} (no prior reference — rebaseline to start tracking it)`;
            if (strict) console.error(line); else console.log(line);
        }
    }

    const failures = changed.length + removed.length + unreadable.length + missingEncrypted.length
        + duplicates.length + (strict ? added.length : 0);
    if (failures === 0) {
        if (!jsonMode) {
            const semantic = Object.values(entries).filter(e => e.mode === 'semantic').length;
            const tracked = total - added.length;
            console.log(
                `✓ ${tracked} tracked samples match the baseline `
                + `(${tracked - semantic} byte-exact, ${semantic} semantic)`
                + `${added.length > 0 ? `; ${added.length} new, untracked` : ''}.`,
            );
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
