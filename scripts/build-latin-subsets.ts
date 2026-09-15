#!/usr/bin/env tsx
/**
 * pdfnative — Latin subsets built by the library itself (v1.8.0)
 * ================================================================
 * Regenerates the five Latin source fonts the Cyrillic, Greek, Polish,
 * Turkish and Vietnamese modules are compiled from — `derived[]` in
 * fonts/SOURCES.json — from the pinned `NotoSans-VF.ttf`, with the
 * library's own `subsetTTF()` and the code-point list each entry names
 * under fonts/subsets/. Nothing under fonts/ttf/ is committed: the list,
 * this command and the recorded SHA-256 are the contract.
 *
 * Usage:
 *   npm run fonts:subsets                                  # derive into fonts/ttf/, report drift
 *   npx tsx scripts/build-latin-subsets.ts --check         # exit 1 on drift, write nothing
 *   npx tsx scripts/build-latin-subsets.ts --update-manifest
 *       derive, write, and record the new hashes in fonts/SOURCES.json — then
 *       rebuild the five modules (tools/build-font-data.cjs) and rebaseline the
 *       samples; the release note must say why the bytes moved.
 *   npx tsx scripts/build-latin-subsets.ts --from-modules
 *       (maintenance) write each entry's code-point list from the cmap of the
 *       module it feeds, so coverage is exactly what ships today.
 *   npx tsx scripts/build-latin-subsets.ts --dir <path>
 *
 * Exit codes: 0 — every derived file matches the manifest (or was recorded);
 *             1 — drift, a missing upstream font, an unmapped code point;
 *             2 — bad usage.
 *
 * License: Noto Sans is distributed under the SIL Open Font License 1.1; the
 * subsets are Modified Versions under the same licence.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_TTF_DIR, MANIFEST_PATH, REPO_ROOT, readManifest } from './lib/font-sources.js';
import type { DerivedFont } from './lib/font-sources.js';
import { buildAllLatinSubsets, codepointsPath, formatCodepointList, withDerivedHashes } from './lib/latin-subsets.js';

const out = (line: string): void => { process.stdout.write(`${line}\n`); };
const err = (line: string): void => { process.stderr.write(`${line}\n`); };
const kb = (n: number): string => `${Math.round(n / 1024)} KB`;
const rel = (p: string): string => relative(REPO_ROOT, p).replace(/\\/g, '/');

interface Options { check: boolean; updateManifest: boolean; fromModules: boolean; dir: string }

function parseArgs(argv: readonly string[]): Options | { error: string } {
    const opts: Options = { check: false, updateManifest: false, fromModules: false, dir: DEFAULT_TTF_DIR };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--check') opts.check = true;
        else if (a === '--update-manifest') opts.updateManifest = true;
        else if (a === '--from-modules') opts.fromModules = true;
        else if (a === '--dir') {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) return { error: '--dir needs a value' };
            opts.dir = resolve(REPO_ROOT, v);
            i++;
        } else return { error: `unknown argument "${a}"` };
    }
    if ((opts.check ? 1 : 0) + (opts.updateManifest ? 1 : 0) + (opts.fromModules ? 1 : 0) > 1) {
        return { error: '--check, --update-manifest and --from-modules are exclusive' };
    }
    return opts;
}

/** The bundled module whose `Source:` header names this derived font. */
function moduleFor(entry: DerivedFont): string | null {
    const fontsDir = join(REPO_ROOT, 'fonts');
    for (const f of readdirSync(fontsDir)) {
        if (!f.endsWith('-data.js')) continue;
        const head = readFileSync(join(fontsDir, f), 'utf8').slice(0, 2000);
        if (/\* Source: (\S+\.ttf)/.exec(head)?.[1] === entry.local) return join(fontsDir, f);
    }
    return null;
}

async function writeListsFromModules(entries: readonly DerivedFont[]): Promise<number> {
    mkdirSync(join(REPO_ROOT, 'fonts', 'subsets'), { recursive: true });
    for (const entry of entries) {
        const mod = moduleFor(entry);
        if (!mod) { err(`  FAIL ${entry.local}: no fonts/*-data.js names it as Source`); return 1; }
        const m = await import(pathToFileURL(mod).href) as { cmap: Record<string, number> };
        const cps = Object.keys(m.cmap).map(Number);
        const text = formatCodepointList(cps, [
            `${entry.local} — code points kept from ${entry.from} (fonts/SOURCES.json derived[])`,
            'One inclusive range per line: U+XXXX or U+XXXX-U+YYYY. Lines starting with # are comments.',
            `Seeded from the cmap of ${rel(mod)} at 1.8.0, so coverage is unchanged; edit deliberately,`,
            'then: npx tsx scripts/build-latin-subsets.ts --update-manifest, rebuild the module, rebaseline.',
        ]);
        writeFileSync(codepointsPath(entry), text);
        out(`  LIST ${rel(codepointsPath(entry))}  ${cps.length} code points`);
    }
    return 0;
}

async function main(): Promise<number> {
    const parsed = parseArgs(process.argv.slice(2));
    if ('error' in parsed) {
        err(`build-latin-subsets: ${parsed.error}`);
        err('Usage: npx tsx scripts/build-latin-subsets.ts [--check | --update-manifest | --from-modules] [--dir <path>]');
        return 2;
    }
    const manifest = readManifest();
    if (parsed.fromModules) return writeListsFromModules(manifest.derived);

    out(`Latin subsets ← ${manifest.derived[0]?.from ?? 'NotoSans-VF.ttf'} (subsetTTF, ${rel(parsed.dir)}/)\n`);
    let results;
    try {
        results = buildAllLatinSubsets(manifest, parsed.dir);
    } catch (e) {
        err(`  FAIL ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }

    let drift = 0;
    for (const r of results) {
        const matches = r.sha256 === r.entry.sha256 && r.bytes.length === r.entry.bytes;
        const dest = join(parsed.dir, r.entry.local);
        if (!parsed.check) {
            const same = existsSync(dest) && Buffer.from(readFileSync(dest)).equals(Buffer.from(r.bytes));
            if (!same) { mkdirSync(parsed.dir, { recursive: true }); writeFileSync(dest, r.bytes); }
        }
        const state = matches ? 'matches fonts/SOURCES.json' : `DRIFT — manifest ${r.entry.sha256.slice(0, 12)}…/${r.entry.bytes} B`;
        out(`  ${parsed.check ? 'CHK ' : 'GEN '} ${r.entry.local}  ${kb(r.bytes.length)}  ${r.glyphs} glyphs${r.entry.layout ? ' + layout' : ''}  ${r.sha256.slice(0, 12)}…  ${state}`);
        if (!matches) drift++;
    }

    if (parsed.updateManifest) {
        const next = withDerivedHashes(manifest, results);
        writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
        out(`\nfonts/SOURCES.json: ${results.length} derived entries recorded.`);
        out('Now rebuild the modules and rebaseline the samples:');
        for (const r of results) {
            const mod = moduleFor(r.entry);
            out(`  node tools/build-font-data.cjs fonts/ttf/${r.entry.local} ${mod ? rel(mod) : 'fonts/<module>-data.js'}`);
        }
        out('  npm run verify:fonts && npm run test:generate && npx tsx scripts/verify-samples.ts');
        return 0;
    }

    if (drift > 0) {
        err(`\n${drift} derived subset(s) no longer reproduce the recorded hash: the subsetter or a code-point list changed.`);
        err('If that is intended: npx tsx scripts/build-latin-subsets.ts --update-manifest, rebuild the five modules,');
        err('rebaseline the samples, and say why in the release note.');
        return 1;
    }
    out(`\n${results.length} derived subset(s) reproduce fonts/SOURCES.json exactly.`);
    return 0;
}

main().then(code => process.exit(code), e => { err(String(e)); process.exit(1); });
