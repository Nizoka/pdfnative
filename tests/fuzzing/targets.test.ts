import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as pdfnative from '../../src/index.js';
import { parseFontData } from '../../src/tools/index.js';
import { FUZZ_TARGETS, fuzzSeeds, type FuzzTarget } from './_fuzz-seeds.js';

/**
 * The ClusterFuzzLite targets, run here on a seeded corpus (v1.9.0).
 *
 * The container is the only place Jazzer's coverage guidance exists, so a
 * target committed without a local proof is a claim rather than a check.
 * What this suite establishes is the half that can be established anywhere:
 * the modules load, the exported `fuzz` is callable, it survives every
 * truncation and mutation the seeded corpus produces, and — the part that
 * matters — it **rethrows** an engine error (`TypeError`, `RangeError`, …).
 * A target that swallowed every exception would run for a week in the
 * container and find nothing, and no coverage report would say so.
 *
 * The targets resolve `pdfnative` and `pdfnative/tools` by the package's own
 * name; vitest's aliases point those at `src/`, the container's
 * self-reference points them at `dist/`. Same file, two engines. The seeds
 * are the ones the container zips (`tests/fuzzing/_fuzz-seeds.ts`), so a seed
 * that stopped parsing fails here before it starts a fuzzer outside the
 * grammar.
 */

type Target = { readonly fuzz: (data: Uint8Array) => void };

const TARGETS = readdirSync('fuzz').filter((f) => f.endsWith('.js')).sort();

/** A small deterministic generator (xorshift32), so a failure reproduces without a seed flag. */
function prng(seed: number): { int: (n: number) => number } {
    let s = seed >>> 0 || 1;
    return {
        int(n: number): number {
            s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
            return s % n;
        },
    };
}

/** Bytes that are none of the grammars: shared by every target. */
function sharedCorpus(): Uint8Array[] {
    return [
        new Uint8Array(0),
        new TextEncoder().encode('%PDF-1.7\n%%EOF'),
        new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n'),
        Uint8Array.of(0xFF, 0xD8, 0xFF),
        Uint8Array.of(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
        Uint8Array.of(0x00, 0x01, 0x00, 0x00, 0x00, 0x00),
        Uint8Array.of(0x78, 0x9C, 0x03, 0x00),
    ];
}

/** What each target's seeds must be: input its parser reads without refusing. */
const READS: Readonly<Record<FuzzTarget, (seed: Uint8Array) => unknown>> = {
    tokenizer: (s) => { const t = pdfnative.createTokenizer(s); while (t.next() !== null) { /* to the end */ } },
    'object-parser': (s) => pdfnative.parseValue(pdfnative.createTokenizer(s)),
    xref: (s) => pdfnative.parseXrefTable(s),
    inflate: (s) => pdfnative.inflateSync(s),
    document: (s) => {
        const reader = pdfnative.openPdf(s);
        if (reader.pageCount < 1) throw new Error('a seed document has no page');
        return pdfnative.extractText(s);
    },
    image: (s) => pdfnative.parseImage(s),
    'font-data': (s) => parseFontData(s),
};

let SEEDS: Readonly<Record<FuzzTarget, readonly Uint8Array[]>>;
beforeAll(async () => { SEEDS = await fuzzSeeds(); });

const nameOf = (file: string): FuzzTarget => file.replace(/\.js$/, '') as FuzzTarget;

describe('fuzz targets', () => {
    it('should be the set the container builds and seeds', () => {
        // build.sh names each target; a file added here and not there is a
        // target that never runs, which is worse than no target at all.
        expect(TARGETS).toEqual(FUZZ_TARGETS.map((t) => `${t}.js`));
        const build = readFileSync('.clusterfuzzlite/build.sh', 'utf8');
        for (const target of TARGETS) {
            expect(build, `build.sh does not compile ${target}`).toContain(`compile_javascript_fuzzer pdfnative fuzz/${target} --sync`);
        }
        expect(build, 'build.sh does not loop over every target when zipping seeds').toContain(`for target in ${FUZZ_TARGETS.join(' ')}; do`);
        expect(build).toContain('npx tsx tests/fuzzing/_fuzz-seeds.ts');
    });

    it('should pin the engine to one version and every package of its tree to an integrity hash', () => {
        // An unpinned `npm install @jazzer.js/core` resolves whatever the
        // registry serves on the day of the build — a supply-chain input the
        // project's own lockfile discipline exists to refuse.
        const manifest = JSON.parse(readFileSync('.clusterfuzzlite/engine/package.json', 'utf8')) as { dependencies: Record<string, string> };
        expect(Object.keys(manifest.dependencies)).toEqual(['@jazzer.js/core']);
        const version = manifest.dependencies['@jazzer.js/core'] ?? '';
        expect(version, 'an exact version, not a range').toMatch(/^\d+\.\d+\.\d+$/);

        const lock = JSON.parse(readFileSync('.clusterfuzzlite/engine/package-lock.json', 'utf8')) as {
            lockfileVersion: number;
            packages: Record<string, { version?: string; integrity?: string; resolved?: string }>;
        };
        expect(lock.lockfileVersion).toBe(3);
        expect(lock.packages['node_modules/@jazzer.js/core']?.version).toBe(version);
        const installed = Object.entries(lock.packages).filter(([path]) => path !== '');
        expect(installed.length).toBeGreaterThan(1);
        for (const [path, entry] of installed) {
            expect(entry.integrity, `${path} has no sha512 integrity`).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
            expect(entry.resolved, `${path} resolves outside the npm registry`).toMatch(/^https:\/\/registry\.npmjs\.org\//);
        }

        const build = readFileSync('.clusterfuzzlite/build.sh', 'utf8');
        const commands = build.split('\n').filter((line) => !line.trimStart().startsWith('#'));
        expect(commands.filter((line) => /\bnpm (install|i|add)\b/.test(line)), 'build.sh installs outside a lockfile').toEqual([]);
        expect(commands.join('\n')).toContain('(cd .clusterfuzzlite/engine && npm ci --ignore-scripts)');
        expect(readFileSync('.clusterfuzzlite/engine/.npmrc', 'utf8')).toContain('ignore-scripts=true');
    });

    it('should keep the engine out of the package: no runtime dependency, and fuzz/ is not published', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: unknown; files?: string[] };
        expect(pkg.dependencies ?? {}).toEqual({});
        expect(pkg.files ?? [], 'package.json "files" must whitelist, and never fuzz/ or .clusterfuzzlite/').not.toEqual([]);
        for (const entry of pkg.files ?? []) expect(entry).not.toMatch(/fuzz|clusterfuzzlite/);
    });

    it.each(FUZZ_TARGETS)('the %s seeds should be read by the target\'s parser, so the fuzzer starts inside the grammar', (target) => {
        expect(SEEDS[target].length).toBeGreaterThan(0);
        for (const seed of SEEDS[target]) expect(() => READS[target](seed)).not.toThrow();
    });

    it.each(TARGETS)('%s should survive the seeded corpus, truncated and mutated', async (file) => {
        const { fuzz } = await import(/* @vite-ignore */ `../../fuzz/${file}`) as Target;
        expect(typeof fuzz, `${file} exports no fuzz function`).toBe('function');

        const rand = prng(0x5EED_1009);
        for (const seed of SEEDS[nameOf(file)]) fuzz(seed);
        for (const seed of [...sharedCorpus(), ...SEEDS[nameOf(file)].slice(0, 3)]) {
            // Up to 64 cuts per seed: every byte of a short seed, a stride on a long one.
            const stride = Math.max(1, Math.ceil(seed.length / 64));
            for (let cut = 0; cut < seed.length; cut += stride) fuzz(seed.subarray(0, cut));
            for (let i = 0; i < 64; i++) {
                const mutated = Uint8Array.from(seed);
                if (mutated.length > 0) mutated[rand.int(mutated.length)] = rand.int(256);
                fuzz(mutated);
            }
        }
        for (let i = 0; i < 256; i++) {
            fuzz(Uint8Array.from({ length: rand.int(48) }, () => rand.int(256)));
        }
    }, 120_000);

    it.each(TARGETS)('%s should rethrow an engine error, or it finds nothing', async (file) => {
        // The one assertion that keeps a target honest, and it cannot be made
        // with real input: the library is supposed never to throw an engine
        // error, so the only way to prove the target would surface one is to
        // make the library misbehave on purpose. A target whose catch had
        // been widened to `catch {}` would fuzz for a week, crash on nothing
        // and report success — and no coverage number would say so.
        //
        // Every function export is planted, not a list of names: a target
        // that starts calling a new parser is covered without an edit here.
        vi.resetModules();
        const plant = async (specifier: string): Promise<Record<string, unknown>> => {
            const actual = await vi.importActual<Record<string, unknown>>(specifier);
            const boom = (): never => { throw new TypeError('planted: an engine error'); };
            return Object.fromEntries(Object.entries(actual).map(([name, value]) =>
                [name, typeof value === 'function' && /^[a-z]/.test(name) ? boom : value]));
        };
        vi.doMock('pdfnative', () => plant('pdfnative'));
        vi.doMock('pdfnative/tools', () => plant('pdfnative/tools'));
        try {
            const { fuzz } = await import(/* @vite-ignore */ `../../fuzz/${file}`) as Target;
            expect(() => { fuzz(Uint8Array.of(0x25, 0x50, 0x44, 0x46)); }).toThrow('planted: an engine error');
        } finally {
            vi.doUnmock('pdfnative');
            vi.doUnmock('pdfnative/tools');
            vi.resetModules();
        }
    });
});
