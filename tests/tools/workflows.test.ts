import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USE_UNICODE_VERSION } from '../../src/shaping/use-data.js';
import * as pdfnative from '../../src/index.js';
import * as notoArabic from '../../fonts/noto-arabic-data.js';

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
// Normalised to LF: the assertions anchor on line ends, and a Windows checkout may hold CRLF.
const readWorkflow = (f: string): string => readFileSync(join(WORKFLOWS, f), 'utf8').replace(/\r\n/g, '\n');
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

/** The workflow files, by name: a file added without a line here is a workflow nobody reviewed. */
const EXPECTED_WORKFLOWS = [
    'audit.yml', 'bench.yml', 'ci.yml', 'codeql.yml', 'dependency-review.yml', 'docs.yml', 'font-reproducibility.yml',
    'fuzz.yml', 'node-current.yml', 'publish.yml', 'sample-regression.yml', 'scorecard.yml', 'verapdf.yml', 'visual-regression.yml',
];

/** One job's text, from its head to the next job head. */
const jobBody = (text: string, job: string): string =>
    new RegExp(`^  ${job}:\\s*\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\s*$|(?![\\s\\S]))`, 'm').exec(text)?.[1] ?? '';

/** The YAML without its comments, for assertions about what a job does rather than what it says. */
const stripComments = (text: string): string => text.split('\n').map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');

/** Every `name:` of a matrix include — the status-check names GitHub reports. */
const checkNames = (text: string): string[] => [...text.matchAll(/^\s+- \{ name: '?([^,']+)'?,/gm)].map((m) => m[1]);

describe('every workflow and composite action', () => {
    const allFiles = [
        ...workflowFiles.map((f) => ({ label: f, text: readWorkflow(f) })),
        ...COMPOSITE_ACTIONS.map((p) => ({ label: p, text: readText(...p.split('/')) })),
    ];

    it('is exactly the expected set of workflow files', () => {
        expect(workflowFiles).toEqual(EXPECTED_WORKFLOWS);
    });

    it('pins every action to a 40-hex commit SHA with a version comment', () => {
        for (const { label, text } of allFiles) {
            const uses = [...text.matchAll(/^\s*(?:- )?uses:\s*(\S+)[^\n]*$/gm)];
            expect(uses.length, `${label} declares no action`).toBeGreaterThan(0);
            for (const m of uses) {
                const ref = m[1];
                if (ref.startsWith('./')) continue; // local composite action
                expect(ref, `${label}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
                expect(m[0], `${label}: ${ref} lacks a "# vX.Y.Z" comment`).toMatch(/#\s*v\d+(\.\d+\.\d+)?\s*$/);
            }
        }
    });

    it('resolves every action to a single SHA across the whole tree', () => {
        // Dependabot groups the action bumps (dependabot.yml); a bump that
        // landed in some files and not others would be two versions of one
        // action, which is how a stale pin outlives its advisory.
        const shas = new Map<string, Set<string>>();
        for (const { text } of allFiles) {
            for (const m of text.matchAll(/^\s*(?:- )?uses:\s*([^@\s]+)@([0-9a-f]{40})/gm)) {
                const set = shas.get(m[1]) ?? new Set<string>();
                set.add(m[2]);
                shas.set(m[1], set);
            }
        }
        for (const [action, set] of shas) expect([...set], action).toHaveLength(1);
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

    it('declares read-only workflow-level permissions (writes only at job level) and a timeout on every job', () => {
        for (const f of workflowFiles) {
            const text = readWorkflow(f);
            const head = text.slice(0, text.search(/^jobs:\s*$/m));
            const top = /^permissions:(?:[ \t]*(read-all)[ \t]*$|[ \t]*\n((?:[ \t]+[a-z-]+:[^\n]*\n)+))/m.exec(head);
            expect(top, `${f}: no workflow-level permissions block`).not.toBeNull();
            if (top?.[1] !== 'read-all') {
                const grants = (top?.[2] ?? '').split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter((l) => l !== '');
                expect(grants, `${f}: workflow-level permissions must be contents: read alone`).toEqual(['contents: read']);
            }
            for (const job of jobSteps(text).keys()) {
                expect(jobBody(text, job), `${f} › ${job}: no timeout-minutes`).toMatch(/^\s+timeout-minutes:\s*\d+\s*$/m);
            }
        }
    });
});

describe('every workflow job', () => {
    it('starts with harden-runner, in block mode with an allow-list or in audit mode with a dated reason', () => {
        // Audit is where every job starts; what the test refuses is audit
        // without a date and a reason, which is how "for the first two weeks"
        // becomes forever.
        for (const f of workflowFiles) {
            const jobs = jobSteps(readWorkflow(f));
            expect(jobs.size, `${f}: no job with steps`).toBeGreaterThan(0);
            for (const [job, steps] of jobs) {
                expect(steps[0], `${f} › ${job}: first step`).toContain(HARDEN_RUNNER);
                const block = /egress-policy:\s*block\s*\n\s+allowed-endpoints: >\s*\n((?:\s+\S+:443\s*\n)+)/.test(steps[0]);
                const audit = /egress-policy:\s*audit # \d{4}-\d{2}-\d{2}: \S[^\n]+$/m.test(steps[0]);
                expect(block || audit, `${f} › ${job}: egress policy is neither block+allow-list nor audit with a dated reason`).toBe(true);
            }
        }
    });

    it('runs harden-runner on macOS too: no platform carve-out', () => {
        // The vendor README at the pinned SHA lists GitHub-hosted Windows and
        // macOS runners as supported in audit mode; an `if: runner.os` on the
        // step would be a silent exemption.
        for (const f of workflowFiles) {
            for (const [job, steps] of jobSteps(readWorkflow(f))) {
                expect(steps[0], `${f} › ${job}`).not.toMatch(/^\s+if:/m);
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
    const ciJob = (job: string): string => jobBody(ci, job);

    it('runs on every pull request and push, with no path filter that could leave a required check pending', () => {
        // GitHub leaves the checks of a path-filtered workflow pending
        // forever, which blocks a docs-only pull request (draft
        // ci-paths-ignore-blocks-required-checks, fixed in 1.9.0).
        expect(ci).not.toMatch(/^\s+paths(-ignore)?:/m);
        expect(ci).toMatch(/^on:\s*\n\s+push:\s*\n\s+branches: \[main, master\]\s*\n\s+pull_request:\s*\n\s+branches: \[main, master\]\s*$/m);
    });

    it('reports exactly the status checks the ruleset requires, on all three platforms', () => {
        // `name:` is what decides the check name, which is why renaming a job
        // here — or dropping the `name:` — would leave required checks pending
        // forever. Adding a platform must stay additive.
        expect(ci).toMatch(/^ {2}ci:\s*\n\s+name: \$\{\{ matrix\.name \}\}/m);
        expect(checkNames(ci).sort()).toEqual(['ci (22)', 'ci (24)', 'macos', 'windows']);
        expect(ci).toMatch(/^ {2}compat-previous:\s*\n {4}name: compat-previous\s*$/m);
        expect(ci).toMatch(/^ {2}runtimes:\s*\n {4}name: runtimes\s*$/m);
        expect(ci).toMatch(/^ {2}workflow-lint:\s*\n {4}name: workflow lint\s*$/m);
        for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) expect(ci, os).toContain(`os: ${os}`);
        expect(ci).toMatch(/node-version: 22/);
        expect(ci).toMatch(/node-version: 24/);
    });

    it('tests, on Linux, the Node line the release is built and uploaded on', () => {
        const pinned = readText('.nvmrc').trim();
        expect(ci).toMatch(new RegExp(`name: 'ci \\(${pinned}\\)', os: ubuntu-latest, node-version: ${pinned},`));
    });

    it('runs the gate with --require-all once, for every platform, and audits only once', () => {
        expect([...ci.matchAll(/run: npx tsx scripts\/gate\.ts --ci --require-all/g)]).toHaveLength(1);
        expect(ci).toMatch(/if: matrix\.audit\s*\n\s+run: npm audit --audit-level=high/);
        expect(checkNames(ci).length, 'the gate runs once per matrix entry').toBe(4);
        expect(ci).toMatch(/if: failure\(\)[\s\S]*upload-artifact[\s\S]*test-output\/\.gate\//);
    });

    it('lists no gate step by hand', () => {
        for (const step of ['typecheck:all', 'verify:unicode', 'test:coverage', 'verify:bundle', 'validate:pdfa', 'verify:samples', 'npm run build', 'npm run lint']) {
            expect(ciJob('ci'), step).not.toMatch(new RegExp(`run: (npm run )?${escapeRegExp(step)}\\s*$`, 'm'));
        }
    });

    it('replays the previous release\'s suite after fetching its tag anonymously', () => {
        const steps = jobSteps(ci).get('compat-previous') ?? [];
        const fetch = steps.findIndex((s) => s.includes('Fetch the previous release tag'));
        const run = steps.findIndex((s) => s.includes('run: npm run compat:previous'));
        expect(fetch).toBeGreaterThan(0);
        expect(run).toBeGreaterThan(fetch);
        expect(steps[fetch]).toMatch(/git fetch --no-tags --depth=1 origin "\+refs\/tags\/\$\{TAG\}:refs\/tags\/\$\{TAG\}"/);
        expect(steps[fetch]).toContain("readdirSync('tests/compat')");
    });

    it('smoke-tests the built package on Deno, Bun and headless Chromium, with pinned runtimes', () => {
        const job = ciJob('runtimes');
        const order = ['run: npm run build', 'denoland/setup-deno@', 'oven-sh/setup-bun@', 'run: deno run .github/runtime-smoke/run.mjs', 'run: bun .github/runtime-smoke/run.mjs', 'node .github/runtime-smoke/browser.mjs']
            .map((needle) => job.indexOf(needle));
        expect(order.every((i) => i >= 0), String(order)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(job).toMatch(/deno-version: \d+\.\d+\.\d+\s*$/m);
        expect(job).toMatch(/bun-version: \d+\.\d+\.\d+\s*$/m);
        expect(job).toMatch(/no-cache: true/);
        for (const f of ['checks.mjs', 'run.mjs', 'browser.mjs']) expect(existsSync(join(ROOT, '.github', 'runtime-smoke', f)), f).toBe(true);
    });

    it('lints the workflows with a pinned zizmor and a checksum-verified actionlint', () => {
        const job = ciJob('workflow-lint');
        expect(job).toMatch(/uses: zizmorcore\/zizmor-action@[0-9a-f]{40} # v\d/);
        expect(job).toMatch(/^\s+version: \d+\.\d+\.\d+\s*$/m);
        expect(job).toMatch(/min-severity: medium/);
        expect(job).toMatch(/ACTIONLINT_SHA256: [0-9a-f]{64}\s*$/m);
        const check = job.indexOf('sha256sum --check --strict');
        expect(check).toBeGreaterThan(0);
        expect(check).toBeLessThan(job.indexOf('/actionlint" -color'));
    });
});

describe('the main ruleset', () => {
    const ruleset = JSON.parse(readText('.github', 'rulesets', 'main.json')) as {
        rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string; integration_id?: number }> } }>;
    };
    const contexts = ruleset.rules.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks ?? [];

    /** Jobs that report a check on purpose without blocking a merge. */
    const ADVISORY = ['runtimes'];

    /** Every check a workflow reports: the matrix `name:` values, else the job `name:`, else the job id. */
    function reported(file: string): string[] {
        const text = readWorkflow(file);
        const out: string[] = [];
        for (const job of jobSteps(text).keys()) {
            const body = jobBody(text, job);
            const name = /^ {4}name:\s*(.+?)\s*$/m.exec(body)?.[1] ?? job;
            if (name === '${{ matrix.name }}') out.push(...checkNames(body));
            else out.push(name);
        }
        return out;
    }

    it('requires exactly the blocking checks ci.yml and sample-regression.yml report, all from GitHub Actions', () => {
        // Both directions: a required context nothing reports blocks every
        // pull request; a blocking job nobody requires is advisory in fact.
        const blocking = ['ci.yml', 'sample-regression.yml'].flatMap(reported).filter((c) => !ADVISORY.includes(c)).sort();
        expect(contexts.map((c) => c.context).sort()).toEqual(blocking);
        for (const c of contexts) expect(c.integration_id, c.context).toBe(15368);
        for (const f of ['ci.yml', 'sample-regression.yml']) expect(readWorkflow(f), f).not.toMatch(/^\s+paths(-ignore)?:/m);
        // The advisory jobs exist, so the list above is a decision, not a typo.
        for (const job of ADVISORY) expect(reported('ci.yml')).toContain(job);
    });

    it('is described the same way in CONTRIBUTING.md', () => {
        const contributing = readText('CONTRIBUTING.md');
        for (const c of contexts) expect(contributing, c.context).toContain(`\`${c.context}\``);
    });
});

describe('codeql.yml', () => {
    const codeql = readWorkflow('codeql.yml');

    it('scans every push and pull request, the workflows as well as the TypeScript, with the extended suite', () => {
        expect(codeql).not.toMatch(/^\s+paths(-ignore)?:/m);
        expect(codeql).toMatch(/- \{ language: actions, build-mode: none \}/);
        expect(codeql).toMatch(/- \{ language: javascript-typescript, build-mode: none \}/);
        expect(codeql).toMatch(/queries: security-extended/);
        expect(stripComments(codeql)).not.toContain('autobuild');
    });

    it('holds security-events: write at the job level only', () => {
        const head = codeql.slice(0, codeql.search(/^jobs:\s*$/m));
        expect(head).not.toMatch(/security-events/);
        expect(jobBody(codeql, 'analyze')).toMatch(/^ {6}security-events: write/m);
    });
});

describe('the advisory workflows', () => {
    it('node-current runs the gate on the Current line and blocks nothing', () => {
        const nc = readWorkflow('node-current.yml');
        expect(nc).toMatch(/node-version: 26\s*$/m);
        expect(nc).toMatch(/run: npx tsx scripts\/gate\.ts --ci --require-all/);
        expect(nc).not.toMatch(/^\s+continue-on-error:/m);
        const required = JSON.parse(readText('.github', 'rulesets', 'main.json')) as { rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }> };
        const contexts = required.rules.find((r) => r.type === 'required_status_checks')?.parameters?.required_status_checks?.map((c) => c.context) ?? [];
        for (const name of ['node 26 (current, advisory)', 'benchmarks', 'fuzz (code change)', 'fuzz (batch)']) expect(contexts).not.toContain(name);
    });

    it('bench archives the run context with the numbers, weekly, and blocks nothing', () => {
        const bench = readWorkflow('bench.yml');
        expect(bench).toMatch(/schedule:\s*\n(?:\s*#[^\n]*\n)*\s*- cron:/);
        expect(bench).toMatch(/run: npm run bench 2>&1 \| tee -a bench-results\.md/);
        for (const field of ['commit:', 'runner:', 'node:', 'cpu:']) expect(bench).toContain(field);
        expect(bench).not.toMatch(/^\s+continue-on-error:/m);
    });

    it('fuzz builds the targets through ClusterFuzzLite on pull requests and weekly, and blocks nothing', () => {
        const fuzz = readWorkflow('fuzz.yml');
        expect(fuzz).toMatch(/google\/clusterfuzzlite\/actions\/build_fuzzers@[0-9a-f]{40}/);
        expect(fuzz).toMatch(/google\/clusterfuzzlite\/actions\/run_fuzzers@[0-9a-f]{40}/);
        expect(fuzz).toMatch(/mode: code-change/);
        expect(fuzz).toMatch(/mode: batch/);
        expect(fuzz).not.toMatch(/^\s+continue-on-error:/m);
        expect(readText('.clusterfuzzlite', 'project.yaml')).toContain('base_os_version: ubuntu-24-04');
        expect(readText('.clusterfuzzlite', 'Dockerfile')).toMatch(/^FROM gcr\.io\/oss-fuzz-base\/base-builder-javascript:ubuntu-24-04@sha256:[0-9a-f]{64}$/m);
    });
});

describe('publish.yml', () => {
    const publish = readWorkflow('publish.yml');
    const jobs = jobSteps(publish);
    const pkg = JSON.parse(readText('package.json')) as { packageManager?: string; devEngines?: { packageManager?: { name?: string } } };

    const body = (job: string): string => jobBody(publish, job);
    /** The permissions a job grants, trailing comments stripped, sorted. */
    const grants = (job: string): string[] => {
        const block = /^ {4}permissions:\s*\n((?: {6}[a-z-]+:[^\n]*\n)+)/m.exec(body(job))?.[1] ?? '';
        return block.trim().split('\n').map((l) => l.replace(/#.*$/, '').trim()).sort();
    };
    const stepIndex = (job: string, needle: string | RegExp): number =>
        (jobs.get(job) ?? []).findIndex((s) => (typeof needle === 'string' ? s.includes(needle) : needle.test(s)));

    /**
     * Whether a setup-node step restores the npm cache: an explicit `cache:`
     * input, or — what a reading of the file misses — nothing said while
     * package.json names npm in `packageManager`, which setup-node v6 treats
     * as "cache npm" unless `package-manager-cache: false` is set.
     */
    function npmCacheEnabled(step: string, manifest: typeof pkg): boolean {
        if (/^\s+cache:\s*npm\s*$/m.test(step)) return true;
        if (/package-manager-cache:\s*false/.test(step)) return false;
        const pm = manifest.packageManager ?? manifest.devEngines?.packageManager?.name ?? '';
        return /^npm(@|$)/.test(pm);
    }

    it('starts from a published release or a manual run, never from a bare tag push', () => {
        expect(publish).toMatch(/^on:\s*\n\s+release:\s*\n\s+types: \[published\]\s*\n\s+workflow_dispatch:\s*$/m);
        expect(publish).not.toMatch(/^\s+push:\s*$/m);
    });

    it('mints an OIDC token and never reads an NPM_TOKEN secret', () => {
        expect(publish).toMatch(/^\s*id-token:\s*write/m);
        expect(publish).not.toMatch(/secrets\.NPM_TOKEN/);
    });

    it('runs exactly four jobs: guard, then build, then publish, then attest', () => {
        expect([...jobs.keys()]).toEqual(['guard', 'build', 'publish', 'attest']);
        expect(body('guard')).not.toMatch(/^\s*needs:/m);
        expect(body('build')).toMatch(/^ {4}needs:\s*guard\s*$/m);
        expect(body('publish')).toMatch(/^ {4}needs:\s*build\s*$/m);
        expect(body('attest')).toMatch(/^ {4}needs:\s*\[build, publish\]\s*$/m);
    });

    it('publishes from the npm-publish environment, and only the publishing job, one release at a time', () => {
        expect([...publish.matchAll(/^\s*environment:/gm)]).toHaveLength(1);
        expect(body('publish')).toMatch(/^ {4}environment:\s*npm-publish\s*$/m);
        expect(publish).toMatch(/concurrency:\s*\n\s*group:\s*publish\s*\n\s*cancel-in-progress:\s*false/);
    });

    it('holds id-token: write only where nothing from the dev toolchain runs', () => {
        expect(grants('guard')).toEqual(['contents: read']);
        expect(grants('build')).toEqual(['contents: read']);
        expect(grants('publish')).toEqual(['contents: read', 'id-token: write']);
        expect(grants('attest')).toEqual(['attestations: write', 'contents: write', 'id-token: write']);
        // The publishing job: no lockfile install, no repository script, no
        // gate, and a checkout of .nvmrc alone.
        expect(stripComments(body('publish'))).not.toMatch(/npm ci|npm run |npx |scripts\/|npm install/);
        const checkouts = (jobs.get('publish') ?? []).filter((s) => s.includes('actions/checkout@'));
        expect(checkouts).toHaveLength(1);
        expect(checkouts[0]).toMatch(/sparse-checkout: \.nvmrc\s*$/m);
        expect(checkouts[0]).toMatch(/sparse-checkout-cone-mode: false/);
    });

    it('publishes from a tag only: the guard refuses a branch before any approval is asked', () => {
        // The defect this shape removes (draft publish-no-tag-guard): the tag
        // check sat inside the job carrying `environment:`, which asks for
        // the approval before its first step, and fired only when the ref
        // already was a tag.
        const guard = body('guard');
        expect(guard).not.toMatch(/^\s*environment:/m);
        expect(stripComments(guard)).not.toMatch(/npm (ci|install|publish)|secrets\.|id-token/);
        const steps = jobs.get('guard') ?? [];
        expect(steps).toHaveLength(3);
        expect(steps[2]).toMatch(/if \[ "\$\{GITHUB_REF_TYPE\}" != "tag" \]; then\s*\n\s*echo "::error::publish runs from a v\* tag only[^\n]*\n\s*exit 1/);
        expect(steps[2]).toContain('does not match package.json version');
        expect(steps[2].indexOf('!= "tag"')).toBeLessThan(steps[2].indexOf('does not match'));
        expect(guard).toMatch(/^ {6}version:\s*\$\{\{ steps\.version\.outputs\.version \}\}\s*$/m);
    });

    it('restores no dependency cache in any release job — the effective setup-node behaviour, not a spelling', () => {
        // Draft publish-release-cache-and-rebuilt-attestation: deleting
        // `cache: npm` is not enough while packageManager names npm.
        const setups = [...jobs.values()].flat().filter((s) => s.includes('actions/setup-node@'));
        expect(setups.length).toBe(3);
        for (const step of setups) expect(npmCacheEnabled(step, pkg), step.split('\n')[0]).toBe(false);
        expect(pkg.packageManager ?? '').toMatch(/^npm@/);
        expect(npmCacheEnabled('      - uses: actions/setup-node@x\n        with:\n          node-version-file: .nvmrc', pkg)).toBe(true);
        expect(npmCacheEnabled('      - uses: actions/setup-node@x\n        with:\n          node-version-file: .nvmrc', {})).toBe(false);
        expect(npmCacheEnabled('      - uses: actions/setup-node@x\n        with:\n          cache: npm\n          package-manager-cache: false', pkg)).toBe(true);
    });

    it('builds, tests and uploads on the .nvmrc Node line, the one CI tests', () => {
        for (const job of ['build', 'publish', 'attest']) {
            const setup = (jobs.get(job) ?? []).find((s) => s.includes('actions/setup-node@')) ?? '';
            expect(setup, job).toMatch(/node-version-file:\s*\.nvmrc/);
            expect(setup, job).not.toMatch(/^\s+node-version:/m);
        }
        const pinned = readText('.nvmrc').trim();
        expect(readWorkflow('ci.yml')).toMatch(new RegExp(`os: ubuntu-latest, node-version: ${pinned},`));
    });

    it('confirms, before anything is installed, that the version it builds is the one the guard passed', () => {
        const steps = jobs.get('build') ?? [];
        const confirm = stepIndex('build', 'Confirm the guarded version');
        const install = stepIndex('build', 'run: npm ci --ignore-scripts');
        expect(confirm).toBeGreaterThanOrEqual(0);
        expect(confirm).toBeLessThan(install);
        expect(steps[confirm]).toContain('GUARDED: ${{ needs.guard.outputs.version }}');
        expect(steps[confirm]).toMatch(/\[ "\$\{VERSION\}" != "\$\{GUARDED\}" \][\s\S]*exit 1/);
    });

    it('runs the publish gate with --require-all after veraPDF, the fonts and the previous tag, then packs once and hands the tarball on with its digests', () => {
        const verapdf = stepIndex('build', './.github/actions/setup-verapdf');
        const fonts = stepIndex('build', 'run: npm run fonts:download');
        const tag = stepIndex('build', 'Fetch the previous release tag');
        const gate = stepIndex('build', 'run: npx tsx scripts/gate.ts --publish --require-all');
        const dry = stepIndex('build', 'run: npm pack --dry-run');
        const pack = stepIndex('build', 'Pack the tarball and record its digests');
        const upload = stepIndex('build', 'actions/upload-artifact@');
        expect([verapdf, fonts, tag, gate, dry, pack, upload].every((i) => i >= 0)).toBe(true);
        expect(Math.max(verapdf, fonts, tag)).toBeLessThan(gate);
        expect(gate).toBeLessThan(dry);
        expect(dry).toBeLessThan(pack);
        expect(pack).toBeLessThan(upload);
        const steps = jobs.get('build') ?? [];
        expect(steps[verapdf]).toMatch(/^\s+id: verapdf\s*$/m);
        expect(steps[gate]).toContain('VERAPDF_HOME: ${{ steps.verapdf.outputs.home }}');
        expect(steps[pack]).toMatch(/sha256sum "\$\{RUNNER_TEMP\}\/release\/\$\{TARBALL\}"/);
        expect(steps[pack]).toMatch(/INTEGRITY="sha512-\$\(openssl dgst -sha512 -binary/);
        for (const out of ['tarball', 'sha256', 'integrity']) expect(body('build')).toMatch(new RegExp(`^ {6}${out}: \\$\\{\\{ steps\\.pack\\.outputs\\.${out} \\}\\}\\s*$`, 'm'));
        for (const hand of ['npm run validate:pdfa', 'npm run verify:samples', 'npm run test:coverage', 'npm run typecheck:all', 'npm run compat:previous']) {
            expect(publish, hand).not.toContain(`run: ${hand}`);
        }
    });

    it('uploads exactly the handed-on tarball, after checking both digests and its version, with a client pinned by content', () => {
        const text = body('publish');
        const receive = stepIndex('publish', 'actions/download-artifact@');
        const verify = stepIndex('publish', 'Verify the tarball against the build job');
        const client = stepIndex('publish', 'Fetch and verify the pinned npm client');
        const upload = stepIndex('publish', /publish "\.\/\$\{TARBALL\}"/);
        expect([receive, verify, client, upload].every((i) => i >= 0)).toBe(true);
        expect(receive).toBeLessThan(verify);
        expect(verify).toBeLessThan(upload);
        expect(client).toBeLessThan(upload);
        const steps = jobs.get('publish') ?? [];
        expect(steps[verify]).toContain('sha256sum --check --strict');
        expect(steps[verify]).toContain('= "${INTEGRITY}"');
        expect(steps[verify]).toMatch(/tar -xzOf "\$\{TARBALL\}" package\/package\.json/);
        expect(steps[upload]).toMatch(/run: node "\$\{RUNNER_TEMP\}\/npm-client\/package\/bin\/npm-cli\.js" publish "\.\/\$\{TARBALL\}" --provenance --access public\s*$/m);
        // The client: an exact 11.x at least 11.5.1 (Trusted Publishing),
        // whose registry tarball must equal a recorded SHA-512 before it runs.
        const version = /^ {6}NPM_CLIENT_VERSION: (\d+)\.(\d+)\.(\d+)\s*$/m.exec(text);
        expect(version).not.toBeNull();
        const [major, minor, patch] = (version ?? []).slice(1).map(Number);
        expect(major === 11 && (minor > 5 || (minor === 5 && patch >= 1))).toBe(true);
        expect(text).toMatch(/^ {6}NPM_CLIENT_INTEGRITY: sha512-[A-Za-z0-9+/]{86}==\s*$/m);
        expect(steps[client]).toMatch(/test "sha512-\$\(openssl dgst -sha512 -binary npm-client\.tgz \| base64 -w0\)" = "\$\{NPM_CLIENT_INTEGRITY\}"/);
        expect(steps[client].indexOf('NPM_CLIENT_INTEGRITY')).toBeLessThan(steps[client].indexOf('tar -xzf'));
        expect(stripComments(publish)).not.toMatch(/npm install -g/);
    });

    it('attests the bytes npm serves, checked against the build digests and the registry signatures', () => {
        // Fetching the tarball back makes the attested file the published
        // file by construction; comparing it with the build job's digests
        // makes it the file the gate checked. Before 1.9.0 this job rebuilt
        // the package and attested the rebuild.
        const attest = body('attest');
        const fetch = stepIndex('attest', 'Fetch the published tarball and check it against the build');
        const signatures = stepIndex('attest', 'npm audit signatures');
        const provenance = stepIndex('attest', 'actions/attest-build-provenance@');
        expect([fetch, signatures, provenance].every((i) => i >= 0)).toBe(true);
        expect(fetch).toBeLessThan(signatures);
        expect(signatures).toBeLessThan(provenance);
        const steps = jobs.get('attest') ?? [];
        expect(steps[fetch]).toMatch(/npm pack "pdfnative@\$\{VERSION\}"/);
        expect(steps[fetch]).toContain('sha256sum --check --strict');
        expect(steps[fetch]).toMatch(/test "\$\(npm view "pdfnative@\$\{VERSION\}" dist\.integrity\)" = "\$\{INTEGRITY\}"/);
        expect(attest).not.toMatch(/run: npm run build|run: npm ci/);
        expect(attest).not.toMatch(/^\s*run: npm pack\s*$/m);
    });

    it('writes the runtime SBOMs (CycloneDX and SPDX, empty by design) and the toolchain SBOM, and attests all of them', () => {
        const attest = body('attest');
        expect(attest).toContain('npm sbom --sbom-format cyclonedx --omit dev --package-lock-only > "pdfnative-${VERSION}.cdx.json"');
        expect(attest).toContain('npm sbom --sbom-format spdx --omit dev --package-lock-only > "pdfnative-${VERSION}.spdx.json"');
        expect(attest).toContain('npm sbom --sbom-format cyclonedx --package-lock-only > "pdfnative-${VERSION}.toolchain.cdx.json"');
        const subjects = /subject-path: \|\s*\n((?:\s+pdfnative-[^\n]+\n?)+)/.exec(attest)?.[1].trim().split('\n').map((l) => l.trim());
        expect(subjects).toEqual(['pdfnative-${{ env.VERSION }}.tgz', 'pdfnative-${{ env.VERSION }}.cdx.json', 'pdfnative-${{ env.VERSION }}.spdx.json', 'pdfnative-${{ env.VERSION }}.toolchain.cdx.json']);
    });

    it('attaches the files and the Sigstore bundle to the release, and never creates, edits or deletes one', () => {
        const attach = (jobs.get('attest') ?? []).find((s) => s.includes('gh release upload')) ?? '';
        expect(attach).toContain('BUNDLE: ${{ steps.attest.outputs.bundle-path }}');
        expect(attach).toContain('cp "${BUNDLE}" "pdfnative-${VERSION}.sigstore.json"');
        expect(attach).toMatch(/if gh release view "v\$\{VERSION\}"/);
        for (const f of ['.tgz', '.cdx.json', '.spdx.json', '.toolchain.cdx.json', '.sigstore.json']) expect(attach).toContain(`"pdfnative-\${VERSION}${f}"`);
        expect(attach).toContain('--clobber --repo "${GITHUB_REPOSITORY}"');
        expect(publish).not.toMatch(/gh release (create|edit|delete)/);
    });

    it('states the provenance level exactly — SLSA Build L2 — and no document claims L3', () => {
        // Draft faq-slsa-l3-claim: the FAQ said "SLSA L3-equivalent" while
        // the job that signs the provenance also ran the dev toolchain.
        expect(publish).toContain('SLSA Build L2');
        expect(publish).not.toMatch(/SLSA Level 2\+/);
        const claims = ['README.md', 'SECURITY.md', 'llms.txt', 'docs/llms.txt', 'docs/guides/faq.md', 'docs/guides/faq.html', 'docs/index.html'];
        for (const file of claims) {
            expect(readText(...file.split('/')), file).not.toMatch(/SLSA[ -]?(Build[ -])?L(evel[ -])?3|L3-equivalent/i);
        }
    });
});

describe('package.json publish settings', () => {
    const pkg = JSON.parse(readText('package.json')) as {
        publishConfig?: Record<string, unknown>;
        scripts: Record<string, string>;
        dependencies?: Record<string, string>;
    };

    it('declares public access with provenance, and no runtime dependency', () => {
        expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
        expect(pkg.dependencies ?? {}).toEqual({});
    });

    it('exposes the opt-in git hooks and the compat runner', () => {
        expect(pkg.scripts['hooks:install']).toBe('node scripts/install-git-hooks.mjs');
        expect(pkg.scripts['hooks:uninstall']).toBe('node scripts/install-git-hooks.mjs --uninstall');
        expect(pkg.scripts['compat:previous']).toBe('npx tsx scripts/run-compat.ts');
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

    it('hands the install directory back as an output instead of writing GITHUB_ENV or GITHUB_PATH', () => {
        // zizmor github-env (draft workflow-hardening-codeql-verapdf-scorecard):
        // the consuming step scopes VERAPDF_HOME with `env:`, so the trust
        // boundary is written down where the value is used.
        expect(action).not.toMatch(/>> "?$GITHUB_(ENV|PATH)"?/);
        expect(action).toMatch(/^outputs:\s*\n\s+home:\s*\n(?:\s+description:[^\n]*\n)?\s+value: \$\{\{ steps\.install\.outputs\.home \}\}/m);
        expect(action).toMatch(/echo "home=\$HOME\/verapdf" >> "\$GITHUB_OUTPUT"/);
    });

    it('is what verapdf.yml and publish.yml use, each passing the output as VERAPDF_HOME', () => {
        for (const f of ['verapdf.yml', 'publish.yml']) {
            const text = readWorkflow(f);
            expect(text, f).toContain('uses: ./.github/actions/setup-verapdf');
            expect(text, f).toMatch(/id: verapdf\s*\n\s+uses: \.\/\.github\/actions\/setup-verapdf/);
            expect(text, f).toContain('VERAPDF_HOME: ${{ steps.verapdf.outputs.home }}');
            expect(text, f).not.toMatch(/software\.verapdf\.org\/rel\/[\d.]+\/verapdf/);
        }
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

    it('holds every Dependabot ecosystem back seven days, and moves the actions as one group', () => {
        const dependabot = readText('.github', 'dependabot.yml');
        const blocks = dependabot.split(/^ {2}- package-ecosystem: /m).slice(1);
        expect(blocks.map((b) => b.split('\n')[0].trim()).sort()).toEqual(['docker', 'github-actions', 'npm', 'npm']);
        for (const block of blocks) {
            const days = /cooldown:\s*\n\s+default-days:\s*(\d+)/.exec(block)?.[1];
            expect(Number(days), block.split('\n')[0]).toBeGreaterThanOrEqual(7);
        }
        const actions = blocks.find((b) => b.startsWith('github-actions')) ?? '';
        expect(actions).toMatch(/groups:\s*\n\s+actions:\s*\n\s+patterns:\s*\n\s+- "\*"/);
        expect(blocks.some((b) => /directory: \/\.clusterfuzzlite\/engine/.test(b))).toBe(true);
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

// ── Runtime smoke: the checks the runtimes job runs, run here on the sources ──

describe('.github/runtime-smoke/checks.mjs', () => {
    type Checks = { runChecks: (m: unknown, fonts: { arabic: unknown }) => Promise<string[]> };
    const smoke = '../../.github/runtime-smoke/checks.mjs';

    it('passes against the sources, so a red runtimes job means the runtime, not the checks', async () => {
        const { runChecks } = (await import(/* @vite-ignore */ smoke)) as Checks;
        const lines = await runChecks(pdfnative, { arabic: notoArabic });
        expect(lines.length).toBeGreaterThanOrEqual(5);
        expect(lines[0]).toContain('Helvetica');
        expect(lines[1]).toContain('ToUnicode');
    });

    it('fails loudly when the package under test misbehaves', async () => {
        const { runChecks } = (await import(/* @vite-ignore */ smoke)) as Checks;
        const broken = { ...pdfnative, extractText: () => [{ text: '' }] };
        await expect(runChecks(broken, { arabic: notoArabic })).rejects.toThrow(/runtime smoke: the paragraph extracts/);
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
