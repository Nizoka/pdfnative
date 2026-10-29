/**
 * pdfnative – Bidi_Class Data Generator
 * =====================================
 * Regenerates `src/shaping/bidi-class-data.ts` from the checked-in Unicode
 * Character Database file `scripts/data/DerivedBidiClass.txt` (the
 * Bidi_Class property every UAX #9 rule starts from).
 *
 * Dev-time only — never runs at build or runtime.
 *
 * Run:     npx tsx scripts/generate-bidi-class.ts
 * Check:   npx tsx scripts/generate-bidi-class.ts --check
 *          (exit 1 when the committed module is not what the data yields —
 *          what `npm run verify:unicode` runs)
 *
 * The file's `@missing` lines give the default class of unassigned code
 * points per block (R, AL and ET blocks default to their script's class,
 * everything else to L); they are applied before the explicit lines, exactly
 * as the UCD defines the property. Only non-L ranges are stored: the resolver
 * returns L for any code point the table does not cover.
 *
 * To upgrade the Unicode version, replace scripts/data/DerivedBidiClass.txt
 * with the new UCD release (`extracted/` directory, keep its header) and
 * re-run.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'scripts/data/DerivedBidiClass.txt');
const outPath = resolve(root, 'src/shaping/bidi-class-data.ts');
const check = process.argv.includes('--check');

const source = readFileSync(sourcePath, 'utf8');

const versionMatch = source.match(/^# DerivedBidiClass-(\d+\.\d+\.\d+)\.txt/);
if (!versionMatch) throw new Error('DerivedBidiClass.txt: missing version header line');
const unicodeVersion = versionMatch[1];

/** Bidi_Class short names in the order the generated table indexes them. */
const CLASSES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'] as const;
const LONG_NAMES: Record<string, string> = {
    Left_To_Right: 'L', Right_To_Left: 'R', Arabic_Letter: 'AL', European_Number: 'EN', European_Separator: 'ES',
    European_Terminator: 'ET', Arabic_Number: 'AN', Common_Separator: 'CS', Nonspacing_Mark: 'NSM', Boundary_Neutral: 'BN',
    Paragraph_Separator: 'B', Segment_Separator: 'S', White_Space: 'WS', Other_Neutral: 'ON', Left_To_Right_Embedding: 'LRE',
    Left_To_Right_Override: 'LRO', Right_To_Left_Embedding: 'RLE', Right_To_Left_Override: 'RLO', Pop_Directional_Format: 'PDF',
    Left_To_Right_Isolate: 'LRI', Right_To_Left_Isolate: 'RLI', First_Strong_Isolate: 'FSI', Pop_Directional_Isolate: 'PDI',
};
const classIndex = (name: string): number => {
    const short = LONG_NAMES[name] ?? name;
    const idx = (CLASSES as readonly string[]).indexOf(short);
    if (idx < 0) throw new Error(`DerivedBidiClass.txt: unknown Bidi_Class "${name}"`);
    return idx;
};
const parseRange = (field: string): [number, number] => {
    const [a, b] = field.trim().split('..');
    const start = parseInt(a, 16);
    const end = b === undefined ? start : parseInt(b, 16);
    if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`DerivedBidiClass.txt: bad range "${field}"`);
    return [start, end];
};

const table = new Uint8Array(0x110000); // default: L (index 0)
let missingLines = 0;
let dataLines = 0;
for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const missing = line.match(/^#\s*@missing:\s*([0-9A-F.]+)\s*;\s*(\w+)/);
    if (missing) {
        const [start, end] = parseRange(missing[1]);
        table.fill(classIndex(missing[2]), start, end + 1);
        missingLines++;
        continue;
    }
    const data = line.split('#')[0].trim();
    if (!data) continue;
    const fields = data.split(';').map(f => f.trim());
    if (fields.length < 2) throw new Error(`DerivedBidiClass.txt: unparseable line: ${line}`);
    const [start, end] = parseRange(fields[0]);
    table.fill(classIndex(fields[1]), start, end + 1);
    dataLines++;
}
if (dataLines === 0) throw new Error('DerivedBidiClass.txt: no data lines parsed');

// Pack into maximal ranges of one class, dropping the L ranges (the default).
const ranges: [number, number, number][] = [];
for (let cp = 0; cp < table.length;) {
    const cls = table[cp];
    let end = cp;
    while (end + 1 < table.length && table[end + 1] === cls) end++;
    if (cls !== 0) ranges.push([cp, end, cls]);
    cp = end + 1;
}

const hex = (cp: number): string => '0x' + cp.toString(16).toUpperCase().padStart(4, '0');
const rangeLines = ranges.map(([s, e, c]) => `    ${hex(s)}, ${hex(e)}, ${c}, // ${CLASSES[c]}`).join('\n');

const moduleSource = `/**
 * pdfnative — Bidi_Class data (UAX #9, the input of every rule)
 * ==============================================================
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  npx tsx scripts/generate-bidi-class.ts
 *
 * Source: Unicode Character Database DerivedBidiClass.txt, Unicode ${unicodeVersion}
 * (explicit assignments and the per-block @missing defaults).
 * © Unicode®, Inc. — https://www.unicode.org/terms_of_use.html
 *
 * Flat [start, end, class, start, end, class, ...] triples sorted by start,
 * one per maximal range of code points sharing a class, L ranges omitted:
 * a code point no triple covers is L. \`class\` indexes BIDI_CLASS_NAMES.
 */
/*! @license Unicode-3.0 — © 1991-2026 Unicode, Inc. — https://www.unicode.org/license.txt — full text in THIRD-PARTY-NOTICES.md of the pdfnative package. */

/** Unicode version of the Bidi_Class table. */
export const BIDI_CLASS_UNICODE_VERSION = '${unicodeVersion}';

/** Bidi_Class short names, indexed by the class values of BIDI_CLASS_RANGES. */
export const BIDI_CLASS_NAMES = [${CLASSES.map(c => `'${c}'`).join(', ')}] as const;

/** Number of non-L ranges. */
export const BIDI_CLASS_RANGE_COUNT = ${ranges.length};

/** Flat [start, end, class] triples (see header). */
export const BIDI_CLASS_RANGES: readonly number[] = [
${rangeLines}
];
`;

if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== moduleSource) {
        process.stderr.write('bidi-class-data.ts is stale — regenerate with: npx tsx scripts/generate-bidi-class.ts' + '\n');
        process.exit(1);
    }
    process.stdout.write(`bidi-class-data.ts: up to date (${ranges.length} ranges, Unicode ${unicodeVersion})` + '\n');
} else {
    writeFileSync(outPath, moduleSource, 'utf8');
    process.stdout.write(`bidi-class-data.ts: ${ranges.length} ranges from ${dataLines} lines + ${missingLines} defaults (Unicode ${unicodeVersion}) → ${outPath}` + '\n');
}
