import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Release and CI workflow invariants (A-001, A-011) ────────────────
//
// The 1.8.0 final review found the publish job pinned to the .nvmrc Node
// line (22, npm 10.9) while npm Trusted Publishing needs npm ≥ 11.5.1, and
// seven checkout steps that kept the job token in .git/config. Both are
// invisible to the type checker and to the test suite proper, so they are
// locked here as plain-text assertions on the workflow files.

const WORKFLOWS = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml'));
const read = (f: string): string => readFileSync(join(WORKFLOWS, f), 'utf8');

describe('publish workflow (A-001)', () => {
    const publish = read('publish.yml');

    it('mints an OIDC token and never reads an NPM_TOKEN secret', () => {
        expect(publish).toMatch(/^\s*id-token:\s*write/m);
        expect(publish).not.toMatch(/secrets\.NPM_TOKEN/);
    });

    it('upgrades npm to a Trusted-Publishing-capable release before publishing', () => {
        const upgrade = /npm install -g npm@\^?(\d+)\.(\d+)\.(\d+)/.exec(publish);
        expect(upgrade).not.toBeNull();
        const [, major, minor, patch] = upgrade!.map(Number);
        const atLeast = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
        expect(atLeast).toBe(true);
        expect(publish.indexOf('npm install -g npm@')).toBeLessThan(publish.indexOf('run: npm publish'));
    });

    it('builds and validates on the .nvmrc Node line', () => {
        expect(publish).toMatch(/node-version-file:\s*\.nvmrc/);
        expect(publish).toMatch(/npm run validate:pdfa/);
        expect(publish).toMatch(/npm run verify:samples/);
    });
});

describe('checkout steps (A-011)', () => {
    it('every actions/checkout step disables persist-credentials', () => {
        const offenders: string[] = [];
        for (const f of files) {
            const text = read(f);
            const re = /uses: actions\/checkout@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                // The `with:` block, if any, is the indented lines that follow.
                const block = m[1].split('\n').filter((l) => l.trim() !== '');
                const withLines = block.filter((l) => /^\s+(with:|[a-z-]+:)/.test(l) && !/^\s+- /.test(l));
                if (!withLines.some((l) => /persist-credentials:\s*false/.test(l))) offenders.push(f);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('pins every action to a commit SHA', () => {
        for (const f of files) {
            for (const m of read(f).matchAll(/uses:\s*([^\s@]+)@([^\s#]+)/g)) {
                expect(m[2], `${f}: ${m[1]}`).toMatch(/^[0-9a-f]{40}$/);
            }
        }
    });
});
