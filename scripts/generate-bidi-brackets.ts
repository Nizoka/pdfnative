/**
 * pdfnative – Bidi Paired Bracket Data Generator
 * ==============================================
 * Regenerates `src/shaping/bidi-brackets-data.ts` from the checked-in
 * Unicode Character Database file `scripts/data/BidiBrackets.txt`
 * (Bidi_Paired_Bracket and Bidi_Paired_Bracket_Type, UAX #9 rules BD14–BD16
 * and N0).
 *
 * Dev-time only — never runs at build or runtime.
 *
 * Run:     npx tsx scripts/generate-bidi-brackets.ts
 * Check:   npx tsx scripts/generate-bidi-brackets.ts --check
 *          (exit 1 when the committed module is not what the data yields —
 *          what `npm run verify:unicode` runs)
 *
 * To upgrade the Unicode version, replace scripts/data/BidiBrackets.txt with
 * the new UCD release (keep its copyright header) and re-run.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'scripts/data/BidiBrackets.txt');
const outPath = resolve(root, 'src/shaping/bidi-brackets-data.ts');
const check = process.argv.includes('--check');

const source = readFileSync(sourcePath, 'utf8');

/** Unicode version, e.g. "17.0.0", parsed from the file header. */
const versionMatch = source.match(/^# BidiBrackets-(\d+\.\d+\.\d+)\.txt/);
if (!versionMatch) {
    throw new Error('BidiBrackets.txt: missing version header line');
}
const unicodeVersion = versionMatch[1];

interface Pair { readonly open: number; readonly close: number; readonly comment: string }

const pairs: Pair[] = [];
const closers = new Map<number, number>();
for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([0-9A-F]{4,6});\s*([0-9A-F]{4,6});\s*([oc])\s*(?:#\s*(.*))?$/);
    if (!match) throw new Error(`BidiBrackets.txt: unparseable line: ${line}`);
    const cp = parseInt(match[1], 16);
    const paired = parseInt(match[2], 16);
    if (match[3] === 'o') pairs.push({ open: cp, close: paired, comment: (match[4] ?? '').trim() });
    else closers.set(cp, paired);
}
if (pairs.length === 0) throw new Error('BidiBrackets.txt: no opening brackets parsed');
// Every opener's closer must be listed as a closer pointing back at it.
for (const p of pairs) {
    if (closers.get(p.close) !== p.open) throw new Error(`BidiBrackets.txt: ${p.open.toString(16)} / ${p.close.toString(16)} are not a mutual pair`);
}
pairs.sort((a, b) => a.open - b.open);

const hex = (cp: number): string => '0x' + cp.toString(16).toUpperCase().padStart(4, '0');

const pairLines = pairs
    .map(p => `    ${hex(p.open)}, ${hex(p.close)},${p.comment ? ` // ${p.comment}` : ''}`)
    .join('\n');

const moduleSource = `/**
 * pdfnative — Bidi Paired Bracket data (UAX #9 rules BD14–BD16, N0)
 * ====================================================================
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  npx tsx scripts/generate-bidi-brackets.ts
 *
 * Source: Unicode Character Database BidiBrackets.txt, Unicode ${unicodeVersion}.
 * © Unicode®, Inc. — https://www.unicode.org/terms_of_use.html
 *
 * Flat [open, close, open, close, ...] pairs, one entry per opening bracket
 * (Bidi_Paired_Bracket_Type = Open) with its Bidi_Paired_Bracket. The two
 * canonical equivalences BD16 names (U+2329/U+232A ≡ U+3008/U+3009) are
 * applied by the resolver, not stored here.
 */
/*! @license Unicode-3.0 — © 1991-2026 Unicode, Inc. — https://www.unicode.org/license.txt — full text in THIRD-PARTY-NOTICES.md of the pdfnative package. */

/** Number of bracket pairs (${unicodeVersion}). */
export const BIDI_BRACKET_PAIR_COUNT = ${pairs.length};

/** Flat [open, close] code point pairs from BidiBrackets.txt. */
export const BIDI_BRACKET_PAIRS: readonly number[] = [
${pairLines}
];
`;

if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== moduleSource) {
        process.stderr.write(`bidi-brackets-data.ts is stale — regenerate with: npx tsx scripts/generate-bidi-brackets.ts` + '\n');
        process.exit(1);
    }
    process.stdout.write(`bidi-brackets-data.ts: up to date (${pairs.length} pairs, Unicode ${unicodeVersion})` + '\n');
} else {
    writeFileSync(outPath, moduleSource, 'utf8');
    process.stdout.write(`bidi-brackets-data.ts: ${pairs.length} pairs (Unicode ${unicodeVersion}) → ${outPath}` + '\n');
}
