import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USE_UNICODE_VERSION } from '../../src/shaping/use-data.js';

// ── Workflow, supply-chain and contributor invariants ─────────────────
//
// None of this is visible to the type checker or to the test suite proper:
// a floating action tag, a checkout that keeps the job token, a release job
// that quietly skips veraPDF, an npm client that drifts between two publishes,
// a source font that no longer matches the module built from it. Each is
// locked here as a plain-text assertion on the files that carry it.

const ROOT = process.cwd();
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const workflowFiles = readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml')).sort();
const readWorkflow = (f: string): string => readFileSync(join(WORKFLOWS, f), 'utf8');
const readText = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');
/** Escape every regular-expression metacharacter, backslash included, of a literal. */
const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

const COMPOSITE_ACTIONS = ['.github/actions/setup-verapdf/action.yml'];

const HARDEN_RUNNER = 'step-security/harden-runner@';

/** Every `- name:`/`- uses:` step block of every job, in order, keyed by job id. */
function jobSteps(text: string): Map<string, string[]> {
    const jobs = new Map<string, string[]>();
    const jobsAt = text.search(/^jobs:\s*$/m);
    if (jobsAt < 0) return jobs;
    let job: string | null = null;
    let steps: string[] | null = null;
    for (const line of text.slice(jobsAt).split('\n').slice(1)) {
        const jobHead = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
        if (jobHead) { job = jobHead[1]; steps = null; continue; }
        if (/^    steps:\s*$/.test(line) && job) { steps = []; jobs.set(job, steps); continue; }
        if (steps === null) continue;
        if (/^      - /.test(line)) steps.push(line);
        else if (/^ {8,}\S/.test(line) && steps.length > 0) steps[steps.length - 1] += `\n${line}`;
    }
    return jobs;
}

// ── Actions: pinned, hardened, credential-free ───────────────────────

describe('every workflow and composite action', () => {
    const allFiles = [
        ...workflowFiles.map((f) => ({ label: f, text: readWorkflow(f) })),
        ...COMPOSITE_ACTIONS.map((p) => ({ label: p, text: readText(...p.split('/')) })),
    ];

    it('pins every action to a 40-hex commit SHA with a version comment', () => {
        for (const { label, text } of allFiles) {
            const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)[^\n]*$/gm)];
            expect(uses.length, `${label} declares no action`).toBeGreaterThan(0);
            for (const m of uses) {
                const ref = m[1];
                if (ref.startsWith('./')) continue; // local composite action
                expect(ref, `${label}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
                expect(m[0], `${label}: ${ref} lacks a "# vX.Y.Z" comment`).toMatch(/#\s*v\d+\.\d+\.\d+\s*$/);
            }
        }
    });

    it('every actions/checkout step disables persist-credentials', () => {
        for (const { label, text } of allFiles) {
            const re = /uses: actions\/checkout@[^\n]*\n((?:[ \t]+[^\n]*\n)*)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const block = m[1].split('\n').filter((l) => l.trim() !== '' && !/^\s+- /.test(l));
                expect(block.some((l) => /persist-credentials:\s*false/.test(l)), `${label}: checkout keeps credentials`).toBe(true);
            }
        }
    });
});

describe('every workflow job', () => {
    it("starts with harden-runner in audit mode", () => {
        for (const f of workflowFiles) {
            const jobs = jobSteps(readWorkflow(f));
            expect(jobs.size, `${f}: no job with steps`).toBeGreaterThan(0);
            for (const [job, steps] of jobs) {
                expect(steps[0], `${f} › ${job}: first step`).toContain(HARDEN_RUNNER);
                expect(steps[0], `${f} › ${job}: egress policy`).toMatch(/egress-policy:\s*audit/);
            }
        }
    });

    it('installs dependencies with --ignore-scripts', () => {
        for (const f of workflowFiles) {
            for (const m of readWorkflow(f).matchAll(/run: npm ci\b[^\n]*/g)) {
                expect(m[0], `${f}`).toContain('npm ci --ignore-scripts');
            }
        }
    });
});

// ── The gate is the only definition of green ─────────────────────────

describe('ci.yml', () => {
    const ci = readWorkflow('ci.yml');

    it('keeps the job id and matrix the ruleset requires (ci (22), ci (24))', () => {
        expect(ci).toMatch(/^  ci:\s*$/m);
        expect(ci).toMatch(/node-version:\s*\[22, 24\]/);
        const ruleset = JSON.parse(readText('.github', 'rulesets', 'main.json')) as {
            rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
        };
        const contexts = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
        expect(contexts).toEqual(expect.arrayContaining(['ci (22)', 'ci (24)']));
    });

    it('runs the gate with --require-all and audits outside it', () => {
        expect(ci).toMatch(/run: npx tsx scripts\/gate\.ts --ci --require-all/);
        expect(ci).toMatch(/run: npm audit --audit-level=high/);
        expect(ci).toMatch(/if: failure\(\)[\s\S]*upload-artifact[\s\S]*test-output\/\.gate\//);
    });

    it('lists no gate step by hand', () => {
        for (const step of ['typecheck:all', 'verify:unicode', 'test:coverage', 'verify:bundle', 'validate:pdfa', 'verify:samples', 'npm run build', 'npm run lint']) {
            expect(ci, step).not.toMatch(new RegExp(`run: (npm run )?${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'));
        }
    });
});

describe('publish.yml', () => {
    const publish = readWorkflow('publish.yml');
    const jobs = jobSteps(publish);

    it('mints an OIDC token and never reads an NPM_TOKEN secret', () => {
        expect(publish).toMatch(/^\s*id-token:\s*write/m);
        expect(publish).not.toMatch(/secrets\.NPM_TOKEN/);
    });

    it('publishes from the npm-publish environment, one release at a time', () => {
        expect(publish).toMatch(/^\s*environment:\s*npm-publish\s*$/m);
        expect(publish).toMatch(/concurrency:\s*\n\s*group:\s*publish\s*\n\s*cancel-in-progress:\s*false/);
    });

    it('pins the npm client to one exact 11.x release, at least 11.5.1, before publishing', () => {
        const pins = [...publish.matchAll(/npm install -g npm@(\S+)/g)].map((m) => m[1]);
        expect(pins).toHaveLength(1);
        expect(pins[0]).toMatch(/^\d+\.\d+\.\d+$/);
        const [major, minor, patch] = pins[0].split('.').map(Number);
        expect(major === 11 && (minor > 5 || (minor === 5 && patch >= 1))).toBe(true);
        expect(publish).toContain(`test "$(npm --version)" = "${pins[0]}"`);
        expect(publish.indexOf('npm install -g npm@')).toBeLessThan(publish.indexOf('run: npm publish'));
    });

    it('builds on the .nvmrc Node line and publishes with provenance', () => {
        expect(publish).toMatch(/node-version-file:\s*\.nvmrc/);
        expect(publish).toMatch(/run: npm publish --provenance --access public\s*$/m);
        expect(publish).toMatch(/run: npm pack --dry-run/);
    });

    it('verifies the tag against package.json', () => {
        expect(publish).toMatch(/does not match package\.json version/);
    });

    it('runs the publish gate with --require-all after veraPDF and the fonts, and lists no gate step by hand', () => {
        const steps = jobs.get('publish') ?? [];
        const index = (needle: string | RegExp): number => steps.findIndex((s) => (typeof needle === 'string' ? s.includes(needle) : needle.test(s)));
        const verapdf = index('./.github/actions/setup-verapdf');
        const fonts = index('run: npm run fonts:download');
        const gate = index('run: npx tsx scripts/gate.ts --publish --require-all');
        const pack = index('run: npm pack --dry-run');
        const pub = index(/run: npm publish/);
        expect([verapdf, fonts, gate, pack, pub].every((i) => i >= 0)).toBe(true);
        expect(verapdf).toBeLessThan(gate);
        expect(fonts).toBeLessThan(gate);
        expect(gate).toBeLessThan(pack);
        expect(pack).toBeLessThan(pub);
        for (const hand of ['npm run validate:pdfa', 'npm run verify:samples', 'npm run test:coverage', 'npm run typecheck:all']) {
            expect(publish, hand).not.toContain(`run: ${hand}`);
        }
    });

    it('has an attest job with exactly three permissions that attests the tarball and the SBOM', () => {
        const attest = /^  attest:\s*\n([\s\S]*?)(?=^  [a-z-]+:\s*$|(?![\s\S]))/m.exec(publish);
        expect(attest).not.toBeNull();
        const body = attest![1];
        expect(body).toMatch(/needs:\s*publish/);
        const perms = /permissions:\s*\n((?:\s{6}[a-z-]+:\s*\w+\s*\n)+)/.exec(body);
        expect(perms).not.toBeNull();
        const granted = perms![1].trim().split('\n').map((l) => l.trim()).sort();
        expect(granted).toEqual(['attestations: write', 'contents: write', 'id-token: write']);
        expect(body).toMatch(/npm sbom --sbom-format cyclonedx --omit dev --package-lock-only/);
        expect(body).toMatch(/uses: actions\/attest-build-provenance@[0-9a-f]{40}/);
        expect(body).toMatch(/gh release view "v\$\{VERSION\}"[\s\S]*gh release upload "v\$\{VERSION\}"[^\n]*--clobber/);
        expect(body).not.toMatch(/gh release create/);
    });

    it('lists the endpoints for the future block policy', () => {
        for (const host of ['api.github.com', 'registry.npmjs.org', 'raw.githubusercontent.com', 'software.verapdf.org', 'api.adoptium.net', 'fulcio.sigstore.dev', 'rekor.sigstore.dev', 'tuf-repo-cdn.sigstore.dev']) {
            expect(publish).toContain(host);
        }
    });
});

describe('package.json publish settings', () => {
    const pkg = JSON.parse(readText('package.json')) as {
        publishConfig?: Record<string, unknown>;
        scripts: Record<string, string>;
    };

    it('declares public access with provenance', () => {
        expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
    });

    it('exposes the opt-in git hooks', () => {
        expect(pkg.scripts['hooks:install']).toBe('node scripts/install-git-hooks.mjs');
        expect(pkg.scripts['hooks:uninstall']).toBe('node scripts/install-git-hooks.mjs --uninstall');
        expect(existsSync(join(ROOT, '.githooks', 'pre-commit'))).toBe(true);
        expect(existsSync(join(ROOT, '.githooks', 'pre-push'))).toBe(true);
    });
});

// ── veraPDF: pinned and checksummed ──────────────────────────────────

describe('setup-verapdf composite action', () => {
    const action = readText('.github', 'actions', 'setup-verapdf', 'action.yml');

    it('checks the installer against a committed SHA-256 before installing it', () => {
        const version = /default:\s*'(\d+\.\d+\.\d+)'/.exec(action)?.[1];
        expect(version).toBeDefined();
        expect(action).toMatch(/sha256sum -c/);
        const checksum = readText('.github', 'checksums', `verapdf-greenfield-${version}-installer.zip.sha256`);
        expect(checksum).toMatch(new RegExp(`^[0-9a-f]{64}  verapdf-greenfield-${escapeRegExp(version!)}-installer\\.zip\\n$`));
    });

    it('is what verapdf.yml and publish.yml use', () => {
        expect(readWorkflow('verapdf.yml')).toContain('uses: ./.github/actions/setup-verapdf');
        expect(readWorkflow('publish.yml')).toContain('uses: ./.github/actions/setup-verapdf');
        for (const f of ['verapdf.yml', 'publish.yml']) expect(readWorkflow(f), f).not.toMatch(/software\.verapdf\.org\/rel\/[\d.]+\/verapdf/);
    });
});

// ── Dependency hygiene ───────────────────────────────────────────────

describe('dependency review and audit', () => {
    it('reviews every pull request for high vulnerabilities and licences', () => {
        const review = readWorkflow('dependency-review.yml');
        expect(review).toMatch(/^on:\s*\n\s*pull_request:/m);
        expect(review).toMatch(/uses: actions\/dependency-review-action@[0-9a-f]{40}/);
        expect(review).toMatch(/fail-on-severity:\s*high/);
        expect(review).toMatch(/allow-licenses:\s*MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense/);
        expect(review).toMatch(/comment-summary-in-pr:\s*on-failure/);
    });

    it('audits the lockfile weekly', () => {
        const audit = readWorkflow('audit.yml');
        expect(audit).toMatch(/schedule:\s*\n\s*- cron:/);
        expect(audit).toMatch(/workflow_dispatch:/);
        expect(audit).toMatch(/run: npm ci --ignore-scripts/);
        expect(audit).toMatch(/run: npm audit --audit-level=high/);
    });

    it('.npmrc and .node-version carry the contributor defaults', () => {
        expect(readText('.npmrc')).toBe('ignore-scripts=true\nfund=false\naudit-level=high\n');
        expect(readText('.node-version')).toBe('22\n');
    });

    it('protects release tags with a ruleset', () => {
        const tags = JSON.parse(readText('.github', 'rulesets', 'tags.json')) as {
            target: string; conditions: { ref_name: { include: string[] } }; rules: Array<{ type: string }>;
        };
        expect(tags.target).toBe('tag');
        expect(tags.conditions.ref_name.include).toEqual(['refs/tags/v*']);
        expect(tags.rules.map((r) => r.type).sort()).toEqual(['deletion', 'non_fast_forward', 'update']);
    });
});

// ── Source fonts: pinned by commit and hash ──────────────────────────

describe('fonts/SOURCES.json', () => {
    const manifest = JSON.parse(readText('fonts', 'SOURCES.json')) as {
        upstream: { repo: string; commit: string; resolvedOn: string };
        fonts: Array<{ local: string; sha256: string; bytes: number; dir?: string; remote?: string; origin?: string; commit?: string; repo?: string; tag?: string; asset?: string; path?: string; copyright?: string }>;
        derived: Array<{ local: string; from: string; tool: string; codepoints: string; layout: boolean; command: string; sha256: string; bytes: number }>;
    };
    const listed = new Set([...manifest.fonts, ...manifest.derived].map((f) => f.local));

    it('pins google/fonts to a commit and dates the resolution', () => {
        expect(manifest.upstream.repo).toBe('google/fonts');
        expect(manifest.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(manifest.upstream.resolvedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        for (const f of manifest.fonts) {
            expect(f.sha256, f.local).toMatch(/^[0-9a-f]{64}$/);
            expect(f.bytes, f.local).toBeGreaterThan(0);
            if (f.origin === 'release') {
                // A hinted static instance from a notofonts release archive: repository, tag, asset and entry path.
                expect(f.repo, f.local).toMatch(/^notofonts\/[a-z]+$/);
                expect(f.tag, f.local).toMatch(/^NotoSans[A-Za-z]+-v\d+\.\d{3}$/);
                expect(f.asset, f.local).toBe(`${f.tag}.zip`);
                expect(f.path, f.local).toMatch(new RegExp(`^NotoSans[A-Za-z]+/hinted/ttf/${f.local.replace('.', '\\.')}$`));
                expect(f.dir).toBeUndefined();
            } else {
                expect(f.origin, f.local).toBeUndefined();
                expect(f.dir, f.local).toBeTruthy();
                expect(f.remote, f.local).toBeTruthy();
            }
            if (f.commit !== undefined) expect(f.commit, f.local).toMatch(/^[0-9a-f]{40}$/);
        }
    });

    it('lists every source font the bundled modules declare', () => {
        const fontsDir = join(ROOT, 'fonts');
        const modules = readdirSync(fontsDir).filter((f) => f.endsWith('-data.js'));
        expect(modules.length).toBeGreaterThan(25);
        for (const mod of modules) {
            // Only the header is read: the modules are megabytes of data.
            const head = readFileSync(join(fontsDir, mod), { encoding: 'utf8' }).slice(0, 2000);
            const src = /Source: (\S+\.ttf)/.exec(head)?.[1];
            expect(src, `${mod}: no Source header`).toBeDefined();
            expect(listed.has(src!), `${mod}: ${src} is not in fonts/SOURCES.json`).toBe(true);
        }
    });

    it('records the five Latin subsets as derived by the library from the pinned variable font, and the four static instances as release assets', () => {
        expect(manifest.derived.map((d) => d.local).sort()).toEqual([
            'NotoSans-Cyrillic.ttf', 'NotoSans-Greek.ttf', 'NotoSans-Polish.ttf', 'NotoSans-Turkish.ttf', 'NotoSans-Vietnamese.ttf',
        ]);
        for (const d of manifest.derived) {
            expect(d.from).toBe('NotoSans-VF.ttf');
            expect(d.tool).toContain('subsetTTF');
            expect(d.tool).not.toContain('pyftsubset');
            expect(d.codepoints).toMatch(/^fonts\/subsets\/NotoSans-[A-Za-z]+\.codepoints\.txt$/);
            expect(existsSync(join(ROOT, ...d.codepoints.split('/'))), `${d.codepoints} is not in the tree`).toBe(true);
            expect(typeof d.layout).toBe('boolean');
            expect(d.command).toContain('build-latin-subsets');
            expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        // Only the Cyrillic module carries layout tables (kern, otl, mark anchors).
        expect(manifest.derived.filter((d) => d.layout).map((d) => d.local)).toEqual(['NotoSans-Cyrillic.ttf']);
        expect(manifest.fonts.filter((f) => f.origin === 'release').map((f) => f.local).sort()).toEqual([
            'NotoSansArabic-Regular.ttf', 'NotoSansArmenian-Regular.ttf', 'NotoSansGeorgian-Regular.ttf', 'NotoSansHebrew-Regular.ttf',
        ]);
    });

    it('commits no font binary: fonts/ttf/ is ignored whole', () => {
        const gitignore = readText('.gitignore');
        expect(gitignore).toMatch(/^fonts\/ttf\/\*$/m);
        expect(gitignore).not.toMatch(/^!fonts\/ttf\//m);
        const tracked = execFileSync('git', ['ls-files', 'fonts/ttf'], { cwd: ROOT, encoding: 'utf8' }).trim();
        expect(tracked).toBe('');
    });

    // Third-party notices: every source font, its upstream and its copyright
    // statement are named, and fonts/LICENSE carries every statement (OFL §2).
    it('is mirrored by THIRD-PARTY-NOTICES.md and fonts/LICENSE', () => {
        const notices = readText('THIRD-PARTY-NOTICES.md');
        const licence = readText('fonts', 'LICENSE');
        for (const f of [...manifest.fonts, ...manifest.derived]) {
            expect(notices, f.local).toContain(`\`${f.local}\``);
        }
        for (const f of manifest.fonts) {
            expect(f.copyright, `${f.local} has no copyright statement in fonts/SOURCES.json`).toBeTruthy();
            expect(notices, f.local).toContain(f.copyright!);
            expect(licence, f.local).toContain(f.copyright!);
            if (f.origin === 'release') {
                expect(notices).toContain(f.repo!);
                expect(notices).toContain(`\`${f.tag}\``);
            } else {
                expect(notices).toContain(`\`ofl/${f.dir}\``);
            }
            if (f.commit) expect(notices).toContain(f.commit.slice(0, 12));
        }
        expect(notices).toContain(manifest.upstream.commit);
        expect(notices).toContain('Modified Version');
        expect(notices).toContain('subsetTTF');
        expect(notices).toContain('fonts/subsets/');
        expect(licence).toContain('Modified');
        expect(licence).toContain('The Noto Project Authors');
        // The CJK fonts declare a Reserved Font Name; the notices must say so.
        const reserved = manifest.fonts.filter((f) => /Reserved Font Name/.test(f.copyright ?? ''));
        expect(reserved.map((f) => f.local).sort()).toEqual(['NotoSansJP-Regular.ttf', 'NotoSansKR-Regular.ttf', 'NotoSansSC-Regular.ttf']);
        expect(notices).toMatch(/Reserved\s+Font Name \*\*"Source"\*\*/);
        expect(licence).toContain('Reserved Font Name "Source"');
    });

    it('names the other third-party material: Unicode data, the HarfBuzz overrides and the Adobe Core 14 metrics', () => {
        const notices = readText('THIRD-PARTY-NOTICES.md');
        expect(notices).toContain(`Unicode ${USE_UNICODE_VERSION}`);
        expect(readText('scripts', 'data', 'README.md')).toContain(USE_UNICODE_VERSION);
        expect(notices).toMatch(/HarfBuzz.*cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec/is);
        expect(readText('scripts', 'data', 'README.md')).toContain('cdbe72ca8bf2c077e91ae10c4e428e1183d7d5ec');
        expect(notices).toContain('Helvetica.afm');
        expect(notices).toContain('Helvetica-Bold.afm');
        expect(readText('src', 'fonts', 'base14-metrics.ts')).toContain('Helvetica.afm');
        // Nothing binary is committed under fonts/ttf/, and the notices say so.
        expect(notices).toContain('No font file is committed');
    });

    it('is what the font-reproducibility workflow watches', () => {
        const wf = readWorkflow('font-reproducibility.yml');
        expect(wf).toMatch(/pull_request:/);
        expect(wf).toContain("'fonts/SOURCES.json'");
        expect(wf).toContain("'fonts/subsets/*.txt'");
        expect(wf).toContain("'src/fonts/font-subsetter.ts'");
        expect(wf).toContain("'scripts/lib/latin-subsets.ts'");
        expect(wf).not.toContain("'fonts/ttf/*.ttf'");
        expect(wf).toMatch(/run: npm run fonts:download/);
        expect(wf).toMatch(/run: npm run verify:fonts/);
    });
});

// ── Contributor checklist parity ─────────────────────────────────────

describe('pull request template', () => {
    it('lists the gate and the same conditional items as CONTRIBUTING.md', () => {
        const template = readText('.github', 'pull_request_template.md');
        const contributing = readText('CONTRIBUTING.md');
        const section = /## Pull Request Checklist\s*\n([\s\S]*?)\n## /.exec(contributing);
        expect(section).not.toBeNull();
        const items = section![1].split('\n').filter((l) => l.startsWith('- [ ]'));
        expect(items.length).toBeGreaterThan(5);
        // Links are rewritten to reach CONTRIBUTING.md from .github/; the wording is identical.
        const normalise = (s: string): string => s.replace(/\]\((?:\.\.\/CONTRIBUTING\.md)?#/g, '](#');
        for (const item of items) expect(normalise(template), item.slice(0, 60)).toContain(normalise(item));
        // And nothing the other way: every checklist item of the template is one of CONTRIBUTING's
        // (verify:docs rule `pr-template-parity` enforces the same from the docs side).
        const templateItems = template.split('\n').filter((l) => l.startsWith('- [ ]'));
        expect(templateItems.map(normalise).sort()).toEqual(items.map(normalise).sort());
        expect(template).toMatch(/`npm run gate` passes/);
        for (const mention of ['ROADMAP.md', 'release-notes/vX.Y.Z.md', 'rebaseline', 'Downstream integration notes']) {
            expect(template).toContain(mention);
        }
    });
});
