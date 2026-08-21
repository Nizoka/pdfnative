/**
 * pdfnative – Bidi Mirroring Data Generator
 * =========================================
 * Regenerates `src/shaping/bidi-mirroring-data.ts` from the checked-in
 * Unicode Character Database file `scripts/data/BidiMirroring.txt`
 * (Bidi_Mirroring_Glyph property, UAX #9 rule L4).
 *
 * Dev-time only — never runs at build or runtime.
 *
 * Run:   npx tsx scripts/generate-bidi-mirroring.ts
 *
 * To upgrade the Unicode version, replace scripts/data/BidiMirroring.txt
 * with the new UCD release (keep its copyright header) and re-run.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'scripts/data/BidiMirroring.txt');
const outPath = resolve(root, 'src/shaping/bidi-mirroring-data.ts');

const source = readFileSync(sourcePath, 'utf8');

/** Unicode version, e.g. "17.0.0", parsed from the file header. */
const versionMatch = source.match(/^# BidiMirroring-(\d+\.\d+\.\d+)\.txt/);
if (!versionMatch) {
    throw new Error('BidiMirroring.txt: missing version header line');
}
const unicodeVersion = versionMatch[1];

interface Mapping { readonly from: number; readonly to: number; readonly comment: string }

const mappings: Mapping[] = [];
for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([0-9A-F]{4,6});\s*([0-9A-F]{4,6})\s*(?:#\s*(.*))?$/);
    if (!match) throw new Error(`BidiMirroring.txt: unparseable line: ${line}`);
    mappings.push({
        from: parseInt(match[1], 16),
        to: parseInt(match[2], 16),
        comment: (match[3] ?? '').trim(),
    });
}
if (mappings.length === 0) throw new Error('BidiMirroring.txt: no mappings parsed');

// Stable output: the UCD file is already ordered by code point; sort anyway
// so regeneration is byte-stable regardless of upstream formatting shifts.
mappings.sort((a, b) => a.from - b.from);

const hex = (cp: number): string => '0x' + cp.toString(16).toUpperCase().padStart(4, '0');

const pairLines = mappings
    .map(m => `    ${hex(m.from)}, ${hex(m.to)},${m.comment ? ` // ${m.comment}` : ''}`)
    .join('\n');

const moduleSource = `/**
 * pdfnative — Bidi Mirroring Glyph data (UAX #9 rule L4)
 * ======================================================
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  npx tsx scripts/generate-bidi-mirroring.ts
 *
 * Source: Unicode Character Database BidiMirroring.txt, Unicode ${unicodeVersion}.
 * © Unicode®, Inc. — https://www.unicode.org/terms_of_use.html
 *
 * Flat [from, to, from, to, ...] pairs, one entry per UCD mapping line,
 * both directions stored verbatim from the file (the UCD lists each
 * direction explicitly, including asymmetric "BEST FIT" mappings).
 */

/** Number of Bidi_Mirroring_Glyph mappings (${unicodeVersion}). */
export const BIDI_MIRRORING_COUNT = ${mappings.length};

/** Flat [from, to] code point pairs from BidiMirroring.txt. */
export const BIDI_MIRRORING_PAIRS: readonly number[] = [
${pairLines}
];
`;

writeFileSync(outPath, moduleSource, 'utf8');
console.log(`bidi-mirroring-data.ts: ${mappings.length} mappings (Unicode ${unicodeVersion}) → ${outPath}`);
