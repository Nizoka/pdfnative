import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
    REPO_ROOT, OUTPUT_DIR, BASELINE_PATH, ENCRYPTED_SAMPLES,
    walkPdfs, relPath, fingerprintAll, loadBaseline, compareToBaseline,
    canonicalJson, sha256Hex, semanticProjection,
} from '../../scripts/lib/sample-fingerprint.js';

// v1.8.0 — sample regression gate.
//
// The sample corpus lives in the git-ignored `test-output/`, which only
// `npm run test:generate` populates. This suite therefore SKIPS when the
// corpus is absent (mirroring how `validate:pdfa` skips when veraPDF is not
// installed) and is blocking in the dedicated CI workflow, which generates
// the samples first.

const samples = [...walkPdfs(OUTPUT_DIR)];
const havecorpus = samples.length > 0;

describe.runIf(havecorpus)('sample regression baseline', () => {
    it('every tracked sample still emits what its reference release emitted', () => {
        const baseline = loadBaseline();
        expect(baseline, `missing baseline at ${BASELINE_PATH}`).not.toBeNull();

        const { entries, unreadable, missingEncrypted } = fingerprintAll();
        expect(unreadable, 'samples that could not be fingerprinted').toEqual([]);
        expect(missingEncrypted, 'ENCRYPTED_SAMPLES entries with no generated file').toEqual([]);

        const { changed, removed } = compareToBaseline(entries, baseline!);
        expect(changed, 'samples whose output changed').toEqual([]);
        expect(removed, 'baseline entries with no generated sample').toEqual([]);
        // `added` is deliberately not asserted: a sample introduced by the
        // release under development has no earlier reference to be held to.
        // `verify-samples --strict` is the opt-in gate for that.
    });

    it('pins the creation instant and timezone the baseline was built with', () => {
        const baseline = loadBaseline()!;
        expect(baseline.timezone).toBe('UTC');
        expect(Number.isNaN(Date.parse(baseline.creationDate))).toBe(false);
    });

    it('anchors every entry to the release its reference was captured at', () => {
        const baseline = loadBaseline()!;
        const semver = /^\d+\.\d+\.\d+$/;
        for (const [path, entry] of Object.entries(baseline.entries)) {
            expect(entry.since, `${path} has no \`since\``).toMatch(semver);
        }
    });

    it('never stamps an entry with a release later than the baseline itself', () => {
        const baseline = loadBaseline()!;
        const rank = (v: string): number => {
            const [a, b, c] = v.split('.').map(Number);
            return a * 1e6 + b * 1e3 + c;
        };
        const ceiling = rank(baseline.baselineVersion);
        for (const [path, entry] of Object.entries(baseline.entries)) {
            expect(rank(entry.since), `${path} claims a reference from the future`).toBeLessThanOrEqual(ceiling);
        }
    });

    it('carries forward references from the previous release', () => {
        // The chain is the point: most 1.8.0 entries must still be held to
        // what 1.7.0 emitted, not silently re-anchored to the current tree.
        const baseline = loadBaseline()!;
        const inherited = Object.values(baseline.entries)
            .filter(e => e.since !== baseline.baselineVersion).length;
        expect(inherited).toBeGreaterThan(0);
    });

    it('uses semantic mode for exactly the encrypted samples', () => {
        const { entries } = fingerprintAll();
        const semantic = Object.entries(entries)
            .filter(([, e]) => e.mode === 'semantic')
            .map(([p]) => p)
            .sort();
        expect(semantic).toEqual(Object.keys(ENCRYPTED_SAMPLES).sort());
    });

    it('detects a content change in an encrypted sample', () => {
        // The semantic projection must not be a constant: two different
        // encrypted samples have to fingerprint differently, otherwise the
        // mode would silently pass everything.
        const [a, b] = Object.keys(ENCRYPTED_SAMPLES);
        const hashOf = (rel: string): string =>
            sha256Hex(semanticProjection(readFileSync(join(OUTPUT_DIR, rel)), ENCRYPTED_SAMPLES[rel]));
        expect(hashOf(a)).not.toBe(hashOf(b));
    });

    it('fingerprints an encrypted sample identically on repeat reads', () => {
        const rel = Object.keys(ENCRYPTED_SAMPLES)[0];
        const bytes = readFileSync(join(OUTPUT_DIR, rel));
        const once = semanticProjection(bytes, ENCRYPTED_SAMPLES[rel]);
        const twice = semanticProjection(bytes, ENCRYPTED_SAMPLES[rel]);
        expect(twice).toBe(once);
    });
});

describe('sample fingerprint helpers', () => {
    it('serialises object keys in a stable order', () => {
        expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
        expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
        expect(canonicalJson([{ z: 1, y: 2 }])).toBe('[{"y":2,"z":1}]');
        expect(canonicalJson(null)).toBe('null');
    });

    it('hashes strings and bytes consistently', () => {
        expect(sha256Hex('abc')).toBe(sha256Hex(new TextEncoder().encode('abc')));
        expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
    });

    it('normalises sample paths to forward slashes', () => {
        expect(relPath(join(OUTPUT_DIR, 'toc', 'toc-full.pdf'))).toBe('toc/toc-full.pdf');
    });

    it('ships a committed baseline', () => {
        expect(existsSync(BASELINE_PATH)).toBe(true);
    });
});

describe('sample generation is environment-independent', () => {
    // Reproducibility needs more than a pinned clock. `toLocaleString()` with
    // no explicit locale follows the machine's: on a fr-FR developer machine
    // 1500 formats as "1 500" with U+202F, on a C/en-US CI runner as "1,500".
    // That silently made three samples machine-dependent, so their committed
    // hashes could never have matched in CI.
    const LOCALE_SENSITIVE = /\.toLocale(?:String|DateString|TimeString)\(\s*\)/;

    function* walkTs(dir: string): Generator<string> {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) yield* walkTs(p);
            else if (entry.name.endsWith('.ts')) yield p;
        }
    }

    it('never formats numbers or dates without an explicit locale', () => {
        const offenders: string[] = [];
        for (const dir of ['scripts', 'src', 'recipes']) {
            const abs = join(REPO_ROOT, dir);
            if (!existsSync(abs)) continue;
            for (const file of walkTs(abs)) {
                const src = readFileSync(file, 'utf8');
                src.split('\n').forEach((line, i) => {
                    if (LOCALE_SENSITIVE.test(line)) {
                        offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}`);
                    }
                });
            }
        }
        expect(offenders, 'pass an explicit locale, e.g. toLocaleString(\'en-US\')').toEqual([]);
    });

    it('runs the generator in UTC', () => {
        // scripts/helpers/tz.ts pins it; PDF dates carry a local offset, so
        // without this the same instant renders differently per machine.
        const tz = readFileSync(join(REPO_ROOT, 'scripts', 'helpers', 'tz.ts'), 'utf8');
        expect(tz).toContain("process.env.TZ = 'UTC'");
    });
});
