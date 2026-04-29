/**
 * Download Noto Sans + Noto Emoji TTF fonts for pdfnative development.
 *
 * Fetches 13 Noto Sans variable-font TTFs and Noto Emoji from the
 * google/fonts repository and saves them to fonts/ttf/ with the local
 * filenames used by build-font-data.
 *
 * Usage:
 *   npx tsx scripts/download-fonts.ts           # skip existing files
 *   npx tsx scripts/download-fonts.ts --force    # re-download all
 *
 * The 5 Latin-subset fonts (Cyrillic, Greek, Polish, Turkish, Vietnamese) are
 * derived from NotoSans and must be subsetted separately — see CONTRIBUTING.md.
 * This script downloads the full NotoSans VF as a development placeholder for
 * each. NotoSans-VF.ttf also doubles as the source for `noto-sans-data.js`
 * (the v1.1.0 Latin fallback for PDF/A documents).
 *
 * NotoEmoji-Regular.ttf is the source for `noto-emoji-data.js` (v1.1.0
 * monochrome emoji — OFL-1.1, no COLRv1).
 *
 * License: All Noto fonts are distributed under the SIL Open Font License 1.1.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TTF_DIR = join(__dirname, '..', 'fonts', 'ttf');

// ── Font manifest ────────────────────────────────────────────────────

const BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl';

interface FontEntry {
    /** Local filename saved to fonts/ttf/ */
    local: string;
    /** Remote filename in google/fonts repo (URL-encoded) */
    remote: string;
    /** google/fonts ofl subdirectory */
    dir: string;
}

/**
 * 13 Noto Sans font families + Noto Emoji.
 * CJK fonts use [wght] axis only; others use [wdth,wght].
 */
const FONTS: FontEntry[] = [
    // ── Base Latin / Greek / Cyrillic ────────────────────────────────
    { local: 'NotoSans-VF.ttf', dir: 'notosans', remote: 'NotoSans%5Bwdth%2Cwght%5D.ttf' },
    // ── Script-specific ──────────────────────────────────────────────
    { local: 'NotoSansArabic-Regular.ttf', dir: 'notosansarabic', remote: 'NotoSansArabic%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansArmenian-Regular.ttf', dir: 'notosansarmenian', remote: 'NotoSansArmenian%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansBengali-Regular.ttf', dir: 'notosansbengali', remote: 'NotoSansBengali%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansDevanagari-Regular.ttf', dir: 'notosansdevanagari', remote: 'NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansGeorgian-Regular.ttf', dir: 'notosansgeorgian', remote: 'NotoSansGeorgian%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansHebrew-Regular.ttf', dir: 'notosanshebrew', remote: 'NotoSansHebrew%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansTamil-Regular.ttf', dir: 'notosanstamil', remote: 'NotoSansTamil%5Bwdth%2Cwght%5D.ttf' },
    { local: 'NotoSansThai-Regular.ttf', dir: 'notosansthai', remote: 'NotoSansThai%5Bwdth%2Cwght%5D.ttf' },
    // ── CJK (wght-only axis) ─────────────────────────────────────────
    { local: 'NotoSansJP-Regular.ttf', dir: 'notosansjp', remote: 'NotoSansJP%5Bwght%5D.ttf' },
    { local: 'NotoSansKR-Regular.ttf', dir: 'notosanskr', remote: 'NotoSansKR%5Bwght%5D.ttf' },
    { local: 'NotoSansSC-Regular.ttf', dir: 'notosanssc', remote: 'NotoSansSC%5Bwght%5D.ttf' },
    // ── Emoji (monochrome, wght-only axis) ───────────────────────────
    { local: 'NotoEmoji-Regular.ttf', dir: 'notoemoji', remote: 'NotoEmoji%5Bwght%5D.ttf' },
];

/**
 * Latin-subset fonts derived from NotoSans-VF.ttf.
 * The download script copies the base VF as a placeholder; for production
 * data modules, subset with pyftsubset or fonttools to keep modules small.
 */
const LATIN_SUBSETS = [
    'NotoSans-Cyrillic.ttf',
    'NotoSans-Greek.ttf',
    'NotoSans-Polish.ttf',
    'NotoSans-Turkish.ttf',
    'NotoSans-Vietnamese.ttf',
];

// ── Download logic ───────────────────────────────────────────────────

async function download(url: string, dest: string, label: string): Promise<boolean> {
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`  FAIL ${label} — HTTP ${res.status}`);
        return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    const kb = Math.round(buf.length / 1024);
    console.log(`  OK   ${label} (${kb} KB)`);
    return true;
}

async function main(): Promise<void> {
    const force = process.argv.includes('--force');

    mkdirSync(TTF_DIR, { recursive: true });

    console.log(`Downloading Noto Sans fonts to fonts/ttf/ …\n`);

    let ok = 0;
    let skipped = 0;
    let failed = 0;

    // ── 1. Download 12 distinct font families ────────────────────────
    for (const font of FONTS) {
        const dest = join(TTF_DIR, font.local);
        if (!force && existsSync(dest)) {
            console.log(`  SKIP ${font.local} (exists)`);
            skipped++;
            continue;
        }
        const url = `${BASE}/${font.dir}/${font.remote}`;
        if (await download(url, dest, font.local)) {
            ok++;
        } else {
            failed++;
        }
    }

    // ── 2. Copy NotoSans VF as placeholder for Latin subsets ─────────
    const vfPath = join(TTF_DIR, 'NotoSans-VF.ttf');
    if (existsSync(vfPath)) {
        console.log('');
        for (const subset of LATIN_SUBSETS) {
            const dest = join(TTF_DIR, subset);
            if (!force && existsSync(dest)) {
                console.log(`  SKIP ${subset} (exists)`);
                skipped++;
                continue;
            }
            const { copyFileSync } = await import('node:fs');
            copyFileSync(vfPath, dest);
            console.log(`  COPY ${subset} (from NotoSans-VF.ttf)`);
            ok++;
        }
    } else {
        console.log(`\n  WARN Cannot create Latin subsets — NotoSans-VF.ttf not available`);
        failed += LATIN_SUBSETS.length;
    }

    // ── Summary ──────────────────────────────────────────────────────
    console.log(`\nDone: ${ok} downloaded, ${skipped} skipped, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

main();
