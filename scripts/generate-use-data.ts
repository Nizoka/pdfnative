#!/usr/bin/env tsx
/**
 * pdfnative — Universal Shaping Engine data generator
 * =====================================================
 * Regenerates `src/shaping/use-data.ts` from the checked-in Unicode
 * Character Database files under `scripts/data/`, plus Microsoft's two
 * override tables for the properties the UCD does not carry.
 *
 * Dev-time only — never runs at build or runtime.
 *
 * Run:   npx tsx scripts/generate-use-data.ts
 *        npx tsx scripts/generate-use-data.ts --check   # CI: no write, diff only
 *
 * Why generated rather than hand-written: the engine it feeds classifies
 * every code point of every complex script into one of 30-odd USE cluster
 * categories. pdfnative's previous classification was a hand-maintained
 * cascade of ranges with thirteen categories, written per script, which is
 * where the Khmer robat, the Myanmar kinzi and the deep Sinhala stacks were
 * being lost. A table derived from the UCD is auditable, complete, and
 * upgrades by swapping a file.
 *
 * Derivation: the rules below are the ones published in the USE
 * specification and implemented by HarfBuzz's `gen-use-table.py`. They are
 * reproduced, not invented — the point of a shaping engine is to agree with
 * every other shaping engine.
 *
 *   https://learn.microsoft.com/typography/script-development/use
 *
 * Sources (see scripts/data/README.md for provenance and licences):
 *   IndicSyllabicCategory.txt          UCD 17.0.0
 *   IndicPositionalCategory.txt        UCD 17.0.0
 *   ArabicShaping.txt                  UCD 17.0.0
 *   DerivedCoreProperties.txt          UCD 17.0.0   (Default_Ignorable only)
 *   extracted/DerivedGeneralCategory.txt  UCD 17.0.0
 *   Scripts.txt                        UCD 17.0.0
 *   IndicSyllabicCategory-Additional.txt   Microsoft, via HarfBuzz
 *   IndicPositionalCategory-Additional.txt Microsoft, via HarfBuzz
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'scripts/data');
const OUT = resolve(ROOT, 'src/shaping/use-data.ts');

/**
 * Scripts excluded from the Universal Shaping Engine because a dedicated
 * shaper owns them. pdfnative shapes Arabic and Thai itself, and Lao reuses
 * the Thai mechanism; Samaritan and Syriac follow the Arabic joining model.
 * This is the same exclusion list the reference implementation uses.
 */
const DISABLED_SCRIPTS = new Set(['Arabic', 'Lao', 'Samaritan', 'Syriac', 'Thai']);

// ── UCD file parsing ─────────────────────────────────────────────────

interface RangeRow { readonly start: number; readonly end: number; readonly value: string }

/** Parse a `start[..end] ; Value` UCD file, taking field `field` as the value. */
function parseUcd(file: string, field = 1): RangeRow[] {
    const text = readFileSync(resolve(DATA, file), 'utf8');
    const rows: RangeRow[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.split('#')[0].trim();
        if (!line) continue;
        const fields = line.split(';').map(f => f.trim());
        if (fields.length <= field) continue;
        const [a, b] = fields[0].split('..');
        const start = Number.parseInt(a, 16);
        if (Number.isNaN(start)) continue;
        rows.push({
            start,
            end: b === undefined ? start : Number.parseInt(b, 16),
            value: fields[field],
        });
    }
    if (rows.length === 0) throw new Error(`${file}: no rows parsed`);
    return rows;
}

/** The Unicode version each UCD file declares in its first line. */
function ucdVersion(file: string): string {
    const first = readFileSync(resolve(DATA, file), 'utf8').split('\n', 1)[0];
    const m = /-(\d+\.\d+\.\d+)\.txt/.exec(first);
    if (!m) throw new Error(`${file}: no version in header line "${first}"`);
    return m[1];
}

function toMap(rows: readonly RangeRow[], into = new Map<number, string>()): Map<number, string> {
    for (const r of rows) {
        for (let cp = r.start; cp <= r.end; cp++) into.set(cp, r.value);
    }
    return into;
}

// ── Property tables ──────────────────────────────────────────────────

const UNICODE_VERSION = ucdVersion('IndicSyllabicCategory.txt');
for (const f of ['IndicPositionalCategory.txt', 'ArabicShaping.txt', 'Scripts.txt']) {
    const v = ucdVersion(f);
    if (v !== UNICODE_VERSION) {
        throw new Error(`${f} is Unicode ${v} but IndicSyllabicCategory.txt is ${UNICODE_VERSION}`);
    }
}

const gc = toMap(parseUcd('DerivedGeneralCategory.txt'));
const script = toMap(parseUcd('Scripts.txt'));
const isc = toMap(parseUcd('IndicSyllabicCategory.txt'));
const ipc = toMap(parseUcd('IndicPositionalCategory.txt'));

/**
 * Apply Microsoft's overrides, dropping rows for code points the vendored
 * UCD has not assigned. The override files track a newer Unicode than the
 * UCD snapshot, and a row for an unassigned code point would otherwise
 * enter the table as a phantom entry. Dropped rows are reported rather than
 * swallowed.
 */
function applyOverrides(base: Map<number, string>, file: string, label: string): void {
    let applied = 0;
    let skipped = 0;
    for (const row of parseUcd(file)) {
        for (let cp = row.start; cp <= row.end; cp++) {
            if ((gc.get(cp) ?? 'Cn') === 'Cn') { skipped++; continue; }
            // The reference implementation folds this value away pending a
            // spec fix; see MicrosoftDocs/typography-issues#336.
            base.set(cp, row.value === 'Consonant_Final_Modifier' ? 'Syllable_Modifier' : row.value);
            applied++;
        }
    }
    process.stdout.write(
        `  ${label}: ${applied} overrides applied`
        + (skipped > 0 ? `, ${skipped} skipped (code point unassigned in Unicode ${UNICODE_VERSION})` : '')
        + '\n',
    );
}

process.stdout.write(`generate-use-data: Unicode ${UNICODE_VERSION}\n`);
applyOverrides(isc, 'IndicSyllabicCategory-Additional.txt', 'syllabic');
applyOverrides(ipc, 'IndicPositionalCategory-Additional.txt', 'positional');

/** Joining_Type, from field 2 of ArabicShaping.txt. */
const joining = toMap(parseUcd('ArabicShaping.txt', 2));

/** Default_Ignorable_Code_Point, the only property needed from DerivedCoreProperties. */
const defaultIgnorable = new Set<number>();
for (const row of parseUcd('DerivedCoreProperties.txt')) {
    if (row.value !== 'Default_Ignorable_Code_Point') continue;
    for (let cp = row.start; cp <= row.end; cp++) defaultIgnorable.add(cp);
}

// ── USE category derivation ──────────────────────────────────────────

/**
 * The USE cluster categories, in the spec's own notation. Positional
 * suffixes (`Abv`, `Blw`, `Pre`, `Pst`) are appended to the categories that
 * take one, so `VPre` is a pre-base vowel and `MBlw` a below-base medial.
 */
export type UseCategory = string;

interface Props {
    readonly cp: number;
    readonly isc: string;
    readonly ipc: string;
    readonly gc: string;
    readonly jt: string;
    readonly di: boolean;
}

const isBase = (p: Props): boolean =>
    ['Number', 'Consonant', 'Consonant_Head_Letter', 'Tone_Letter', 'Vowel_Independent'].includes(p.isc)
    || (['C', 'D', 'L', 'R'].includes(p.jt) && p.isc !== 'Joiner')
    || (p.gc === 'Lo' && ['Avagraha', 'Bindu', 'Consonant_Final', 'Consonant_Medial',
        'Consonant_Subjoined', 'Vowel', 'Vowel_Dependent'].includes(p.isc));

const isCgj = (p: Props): boolean =>
    p.isc === 'Joiner' || (p.di && ['Mc', 'Me', 'Mn'].includes(p.gc));

const isSymMod = (p: Props): boolean => p.isc === 'Symbol_Modifier';

const isBaseOther = (p: Props): boolean =>
    p.isc === 'Consonant_Placeholder'
    || [0x2015, 0x2022, 0x25FB, 0x25FC, 0x25FD, 0x25FE].includes(p.cp);

const isWordJoiner = (p: Props): boolean =>
    (p.di
        && ![0x115F, 0x1160, 0x3164, 0xFFA0, 0x1BCA0, 0x1BCA1, 0x1BCA2, 0x1BCA3].includes(p.cp)
        && p.isc === 'Other'
        && !isCgj(p))
    || p.gc === 'Cn';

/**
 * Every category test, in the order the reference implementation declares
 * them. Exactly one must match each code point; the generator asserts it.
 */
const CATEGORY_TESTS: ReadonlyArray<readonly [string, (p: Props) => boolean]> = [
    ['B', isBase],
    ['N', p => p.isc === 'Brahmi_Joining_Number'],
    ['GB', isBaseOther],
    ['CGJ', isCgj],
    ['F', p => (p.isc === 'Consonant_Final' && p.gc !== 'Lo') || p.isc === 'Consonant_Succeeding_Repha'],
    ['FM', p => p.isc === 'Syllable_Modifier'],
    ['M', p => (p.isc === 'Consonant_Medial' && p.gc !== 'Lo') || p.isc === 'Consonant_Initial_Postfixed'],
    ['CM', p => ['Nukta', 'Gemination_Mark', 'Consonant_Killer'].includes(p.isc)],
    ['SUB', p => p.isc === 'Consonant_Subjoined' && p.gc !== 'Lo'],
    ['CS', p => p.isc === 'Consonant_With_Stacker'],
    ['H', p => p.isc === 'Virama' && p.cp !== 0x0DCA],
    ['HVM', p => p.cp === 0x0DCA],
    ['HN', p => p.isc === 'Number_Joiner'],
    ['IS', p => p.isc === 'Invisible_Stacker' && p.cp !== 0x1A60],
    ['G', p => p.isc === 'Hieroglyph'],
    ['HM', p => p.isc === 'Hieroglyph_Modifier'],
    ['HR', p => p.isc === 'Hieroglyph_Mirror'],
    ['J', p => p.isc === 'Hieroglyph_Joiner'],
    ['SB', p => ['Hieroglyph_Mark_Begin', 'Hieroglyph_Segment_Begin'].includes(p.isc)],
    ['SE', p => ['Hieroglyph_Mark_End', 'Hieroglyph_Segment_End'].includes(p.isc)],
    ['ZWNJ', p => p.isc === 'Non_Joiner'],
    ['O', p => (p.gc === 'Po' || ['Consonant_Dead', 'Joiner', 'Modifying_Letter', 'Other'].includes(p.isc))
        && !isBase(p) && !isBaseOther(p) && !isCgj(p) && !isSymMod(p) && !isWordJoiner(p)],
    ['RK', p => p.isc === 'Reordering_Killer'],
    ['R', p => ['Consonant_Preceding_Repha', 'Consonant_Prefixed'].includes(p.isc)],
    ['Sk', p => p.cp === 0x1A60],
    ['SM', isSymMod],
    ['V', p => p.isc === 'Pure_Killer' || (p.gc !== 'Lo' && ['Vowel', 'Vowel_Dependent'].includes(p.isc))],
    ['VM', p => ['Tone_Mark', 'Cantillation_Mark', 'Register_Shifter', 'Visarga'].includes(p.isc)
        || (p.gc !== 'Lo' && p.isc === 'Bindu')],
    ['WJ', isWordJoiner],
];

/** Positional suffixes, per category, keyed by Indic_Positional_Category. */
const POSITIONS: Record<string, Record<string, readonly string[]>> = {
    F: { Abv: ['Top'], Blw: ['Bottom'], Pst: ['Right'] },
    M: {
        Abv: ['Top'],
        Blw: ['Bottom', 'Bottom_And_Left', 'Bottom_And_Right'],
        Pst: ['Right'],
        Pre: ['Left', 'Top_And_Bottom_And_Left'],
    },
    CM: { Abv: ['Top'], Blw: ['Bottom', 'Overstruck'] },
    V: {
        Abv: ['Top', 'Top_And_Bottom', 'Top_And_Bottom_And_Right', 'Top_And_Right'],
        Blw: ['Bottom', 'Overstruck', 'Bottom_And_Right'],
        Pst: ['Right'],
        Pre: ['Left', 'Top_And_Left', 'Top_And_Left_And_Right', 'Left_And_Right'],
    },
    VM: { Abv: ['Top'], Blw: ['Bottom', 'Overstruck'], Pst: ['Right'], Pre: ['Left'] },
    SM: { Abv: ['Top'], Blw: ['Bottom'] },
    FM: { Abv: ['Top'], Blw: ['Bottom'], Pst: ['Not_Applicable'] },
};

/** Code points the UCD leaves unclassified but the spec expects to behave. */
function patchSyllabic(cp: number, value: string): string {
    if (cp >= 0x1CE2 && cp <= 0x1CE8) return 'Cantillation_Mark';
    if ((cp >= 0x0F18 && cp <= 0x0F19) || (cp >= 0x0F3E && cp <= 0x0F3F)) return 'Vowel_Dependent';
    if (cp === 0x1CED) return 'Tone_Mark';
    return value;
}

function patchPositional(cp: number, value: string): string {
    return [0x11302, 0x11303, 0x114C1].includes(cp) ? 'Top' : value;
}

/** Every code point any of the four driving properties has an opinion about. */
const candidates = new Set<number>([
    ...isc.keys(), ...ipc.keys(), ...joining.keys(), ...defaultIgnorable,
]);

const categoryOf = new Map<number, string>();
for (const cp of [...candidates].sort((a, b) => a - b)) {
    if (DISABLED_SCRIPTS.has(script.get(cp) ?? 'Unknown')) continue;

    const p: Props = {
        cp,
        isc: patchSyllabic(cp, isc.get(cp) ?? 'Other'),
        ipc: patchPositional(cp, ipc.get(cp) ?? 'Not_Applicable'),
        gc: gc.get(cp) ?? 'Cn',
        jt: joining.get(cp) ?? 'U',
        di: defaultIgnorable.has(cp),
    };

    const matched = CATEGORY_TESTS.filter(([, test]) => test(p)).map(([name]) => name);
    if (matched.length !== 1) {
        throw new Error(
            `U+${cp.toString(16).toUpperCase()} matched ${matched.length} categories `
            + `[${matched.join(', ')}] (isc=${p.isc} ipc=${p.ipc} gc=${p.gc} jt=${p.jt} di=${p.di})`,
        );
    }

    let category = matched[0];
    const posMap = POSITIONS[category];
    if (posMap) {
        const suffixes = Object.entries(posMap)
            .filter(([, values]) => values.includes(p.ipc))
            .map(([suffix]) => suffix);
        if (suffixes.length !== 1) {
            throw new Error(
                `U+${cp.toString(16).toUpperCase()} category ${category} has `
                + `${suffixes.length} positions for ipc=${p.ipc}`,
            );
        }
        category += suffixes[0];
    }

    // `O` is the engine's default; storing it would double the table.
    if (category !== 'O') categoryOf.set(cp, category);
}

// ── Range packing ────────────────────────────────────────────────────

interface Packed { readonly start: number; readonly end: number; readonly category: string }

const packed: Packed[] = [];
for (const cp of [...categoryOf.keys()].sort((a, b) => a - b)) {
    const category = categoryOf.get(cp)!;
    const last = packed[packed.length - 1];
    if (last && last.end === cp - 1 && last.category === category) {
        packed[packed.length - 1] = { start: last.start, end: cp, category };
    } else {
        packed.push({ start: cp, end: cp, category });
    }
}

const categories = [...new Set(packed.map(r => r.category))].sort();
const index = new Map(categories.map((c, i) => [c, i]));

const hex = (cp: number): string => `0x${cp.toString(16).toUpperCase().padStart(4, '0')}`;

const rangeLines: string[] = [];
for (let i = 0; i < packed.length; i += 4) {
    rangeLines.push(`    ${packed.slice(i, i + 4)
        .map(r => `${hex(r.start)},${hex(r.end)},${index.get(r.category)},`)
        .join(' ')}`);
}

const moduleSource = `/**
 * pdfnative — Universal Shaping Engine character data
 * =====================================================
 * GENERATED FILE — do not edit by hand.
 * Regenerate with:  npx tsx scripts/generate-use-data.ts
 *
 * Source: Unicode Character Database ${UNICODE_VERSION}, plus Microsoft's
 * Indic_Syllabic_Category and Indic_Positional_Category override tables.
 * © Unicode®, Inc. — https://www.unicode.org/terms_of_use.html
 *
 * ${packed.length} ranges covering ${categoryOf.size} code points in
 * ${categories.length} USE cluster categories. Code points not listed are
 * category \`O\` (other), the engine's default, which is why the table does
 * not carry them.
 *
 * Scripts with a dedicated shaper are excluded: ${[...DISABLED_SCRIPTS].sort().join(', ')}.
 *
 * @module shaping/use-data
 * @since 1.8.0
 */

/** The Unicode release this table was derived from. */
export const USE_UNICODE_VERSION = '${UNICODE_VERSION}';

/**
 * USE cluster category names, indexed by the third element of each
 * {@link USE_RANGES} triple.
 */
export const USE_CATEGORIES: readonly string[] = [
${categories.map(c => `    '${c}',`).join('\n')}
];

/**
 * Flat \`[start, end, categoryIndex, ...]\` triples, sorted by \`start\` and
 * non-overlapping, so a lookup is a binary search.
 */
export const USE_RANGES: readonly number[] = [
${rangeLines.join('\n')}
];
`;

const check = process.argv.includes('--check');
if (check) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== moduleSource) {
        process.stderr.write(
            'use-data.ts does not match its generator.\n'
            + 'Regenerate it:  npx tsx scripts/generate-use-data.ts\n',
        );
        process.exit(1);
    }
    process.stdout.write(`✓ use-data.ts matches the generator (${packed.length} ranges).\n`);
} else {
    writeFileSync(OUT, moduleSource, 'utf8');
    process.stdout.write(
        `generate-use-data: wrote ${OUT}\n`
        + `  ${categoryOf.size} code points, ${packed.length} ranges, ${categories.length} categories\n`,
    );
}
