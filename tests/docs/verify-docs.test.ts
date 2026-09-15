import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * `scripts/verify-docs.ts` is a CI gate made of regex-driven rules. A rule that
 * silently matches nothing looks identical to a rule that passes, so these
 * tests do not just assert a clean run — each one perturbs the tree and
 * requires the corresponding rule to report it.
 *
 * The script is a top-level program rather than a module, so it is exercised as
 * a subprocess against a temporary copy of the repository's documentation.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-docs.ts');

interface Run {
    readonly status: number;
    readonly output: string;
}

/**
 * The verifier resolves its root from its own location, not from `cwd`, so a
 * sandbox run must invoke the *copy* inside the sandbox. `cwd` stays at the
 * repository root purely so `npx` can find `tsx`.
 */
function runVerifier(root: string): Run {
    const script = root === ROOT ? SCRIPT : join(root, 'scripts', 'verify-docs.ts');
    try {
        // shell:true (required for npx.cmd on Windows) does not quote args —
        // a temp path with spaces or `&` would break the command line.
        const scriptArg = process.platform === 'win32' ? JSON.stringify(script) : script;
        const output = execFileSync('npx', ['tsx', scriptArg], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        });
        return { status: 0, output };
    } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

/**
 * Copy the parts of the repo the verifier reads into a scratch directory, so a
 * perturbation cannot touch the working tree.
 */
function makeSandbox(): string {
    const dir = mkdtempSync(join(tmpdir(), 'pdfnative-verify-'));
    // .claude feeds agent-config-parity, claude-rules-sync, claude-rules-budget
    // and skills-shape (settings, hook, generated rules, skills).
    for (const entry of ['docs', 'src', 'tests', 'scripts', 'bench', 'recipes', '.github', '.claude']) {
        const from = join(ROOT, entry);
        if (existsSync(from)) cpSync(from, join(dir, entry), { recursive: true });
    }
    // package.json declares "type": "module"; without it tsx compiles the
    // verifier as CJS and its top-level await fails to transform.
    // CLAUDE.md and .nvmrc feed claude-md-budget and node-pin-parity; the
    // sandbox is not a git checkout, so sitemap-lastmod-vs-git skips itself
    // there (it is exercised by the run against the committed tree above).
    // internal-links also walks README.md, CHANGELOG.md and the current release
    // note, whose links reach LICENSE, CITATION.cff, THIRD-PARTY-NOTICES.md and
    // release-notes/ — copied so the sandbox resolves them like the tree does.
    for (const file of ['package.json', 'README.md', 'ROADMAP.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'llms.txt', '.nvmrc', '.node-version', '.gitattributes', 'CHANGELOG.md', 'LICENSE', 'CITATION.cff', 'THIRD-PARTY-NOTICES.md']) {
        const from = join(ROOT, file);
        if (existsSync(from)) cpSync(from, join(dir, file));
    }
    if (existsSync(join(ROOT, 'release-notes'))) cpSync(join(ROOT, 'release-notes'), join(dir, 'release-notes'), { recursive: true });
    // scripts/build-guides.ts imports `marked` from node_modules; link the real
    // install into the sandbox (junction: no admin rights needed on Windows).
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'junction');
    return dir;
}

function patch(dir: string, relPath: string, from: string, to: string): void {
    const p = join(dir, relPath);
    const text = readFileSync(p, 'utf8');
    expect(text, `${relPath} should contain the text this test perturbs`).toContain(from);
    writeFileSync(p, text.replace(from, to));
}

describe('verify-docs', () => {
    it('passes on the committed tree', () => {
        const run = runVerifier(ROOT);
        expect(run.output).toContain('rules passed');
        expect(run.status).toBe(0);
    }, 120_000);

    describe('each rule reports the defect it exists for', () => {
        let sandbox: string;

        // The control every perturbation test depends on: a sandbox that has
        // NOT been perturbed must be clean, otherwise the `status === 1`
        // assertions below are satisfied by pre-existing noise instead of by
        // the rule under test (which is exactly how a missing `recipes/` copy
        // once made every negative test vacuous).
        it('an unperturbed sandbox is clean', () => {
            withSandbox((dir) => {
                const run = runVerifier(dir);
                expect(run.output).toContain('rules passed');
                expect(run.status).toBe(0);
            });
        }, 120_000);

        function withSandbox(fn: (dir: string) => void): void {
            sandbox = makeSandbox();
            try {
                fn(sandbox);
            } finally {
                rmSync(sandbox, { recursive: true, force: true });
            }
        }

        it('stale-token compares counts for equality, not against a blocklist', () => {
            withSandbox((dir) => {
                // A value that no blocklist would have enumerated.
                patch(dir, 'docs/guides/mcp.md', '**28 tools**', '**29 tools**');
                const run = runVerifier(dir);
                expect(run.output).toContain('stale-token');
                expect(run.output).toContain('the manifest says 28');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('api-exists rejects a denylisted identifier in src/, not only in docs', () => {
            withSandbox((dir) => {
                patch(
                    dir,
                    'src/core/pdf-stream-writer.ts',
                    ' * @param stream   An async generator of PDF byte chunks.',
                    ' * Example: streamDocumentPdf({ blocks })\n * @param stream   An async generator of PDF byte chunks.',
                );
                const run = runVerifier(dir);
                expect(run.output).toContain('api-exists');
                expect(run.output).toContain('streamDocumentPdf');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('contrast checks every surface a token is used on, not only the page background', () => {
            withSandbox((dir) => {
                // Passes against --c-bg (4.76:1) and fails against --c-surface (4.34:1).
                patch(dir, 'docs/style.css', '--c-text-dim:   #54606f;', '--c-text-dim:   #64748b;');
                const run = runVerifier(dir);
                expect(run.output).toContain('contrast');
                expect(run.output).toContain('--c-surface');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('guide-render-sync catches a shell whose Markdown source moved on', () => {
            withSandbox((dir) => {
                // Edit the .md without regenerating the pre-rendered shell.
                patch(dir, 'docs/guides/charts.md', '# Charts (native vector)', '# Charts (native vector, perturbed)');
                const run = runVerifier(dir);
                expect(run.output).toContain('guide-render-sync');
                expect(run.output).toContain('docs/guides/charts.html');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('error-parity rejects a diagnostic code the docs invent', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/guides/pdfa.md', 'PDFA_NO_FONT_ENTRIES', 'PDFA_IMAGINARY_CODE');
                const run = runVerifier(dir);
                expect(run.output).toContain('error-parity');
                expect(run.output).toContain('PDFA_IMAGINARY_CODE');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('error-parity rejects a registry that drops a code the PdfDiagnosticCode union declares', () => {
            withSandbox((dir) => {
                // The 1.8.0 gap: TYPOGRAPHY_FEATURE_INEFFECTIVE was declared, emitted
                // and documented while the registry and the old prefix-based rule
                // had never heard of it.
                patch(dir, 'docs/data/errors.json', '"code": "TYPOGRAPHY_FEATURE_INEFFECTIVE"', '"code": "TYPOGRAPHY_FEATURE_INEFFECTIVX"');
                const run = runVerifier(dir);
                expect(run.output).toContain('error-parity');
                expect(run.output).toContain('PdfDiagnosticCode declares "TYPOGRAPHY_FEATURE_INEFFECTIVE"');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('error-parity rejects a thrown PDF/X message missing from buildErrors', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/data/errors.json', '"message": "PDF/X forbids encryption (ISO 15930-7) — drop layout.encryption or layout.pdfx"', '"message": "PDF/X forbids encryption (ISO 15930-7) — drop layout.encryptio"');
                const run = runVerifier(dir);
                expect(run.output).toContain('error-parity');
                expect(run.output).toContain('is not in docs/data/errors.json buildErrors');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('version-token sees a linked package name in a Markdown table row and the homepage badge', () => {
            withSandbox((dir) => {
                patch(dir, 'README.md', '[`pdfnative`](https://www.npmjs.com/package/pdfnative) | **v1.8.0**', '[`pdfnative`](https://www.npmjs.com/package/pdfnative) | **v1.7.0**');
                patch(dir, 'docs/index.html', 'data-pn-badge="pdfnative">v1.8.0<', 'data-pn-badge="pdfnative">v1.7.0<');
                const run = runVerifier(dir);
                expect(run.output).toContain('version-token');
                expect(run.output).toContain('README.md');
                expect(run.output).toContain('docs/index.html');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('count-tokens rejects a playground count written as a word numeral and a stale script count', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'guides', 'faq.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nTen zero-install playgrounds cover 22 Unicode scripts.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('count-tokens');
                expect(run.output).toContain('derived.playgrounds');
                expect(run.output).toContain('declared.scripts');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('playgrounds-manifest rejects a control id the page does not contain and an unlisted playground', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/data/playgrounds.json', '"id": "preset"', '"id": "preset-that-does-not-exist"');
                const run = runVerifier(dir);
                expect(run.output).toContain('playgrounds-manifest');
                expect(run.output).toContain('preset-that-does-not-exist');
                expect(run.status).toBe(1);
            });
            withSandbox((dir) => {
                rmSync(join(dir, 'docs', 'data', 'playgrounds.json'));
                const run = runVerifier(dir);
                expect(run.output).toContain('playgrounds-manifest');
                expect(run.output).toContain('missing');
                expect(run.status).toBe(1);
            });
        }, 240_000);

        it('llms-sync requires the current release note to be indexed', () => {
            withSandbox((dir) => {
                patch(dir, 'llms.txt', 'release-notes/v1.8.0.md', 'release-notes/v1.8.1.md');
                patch(dir, 'docs/llms.txt', 'release-notes/v1.8.0.md', 'release-notes/v1.8.1.md');
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-sync');
                expect(run.output).toContain('does not link release-notes/v1.8.0.md');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('internal-links resolves CHANGELOG links and absolute site anchors', () => {
            withSandbox((dir) => {
                const p = join(dir, 'CHANGELOG.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nSee [a draft](release-notes/draft-issue-that-never-existed.md) and [the api](https://pdfnative.dev/#no-such-anchor).\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('internal-links');
                expect(run.output).toContain('draft-issue-that-never-existed.md');
                expect(run.output).toContain('no id "no-such-anchor"');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('anchor-parity catches a deep link to a renamed section', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/guides/streaming.md', '#streaming-merge--split', '#streaming-merge--split-renamed');
                const run = runVerifier(dir);
                expect(run.output).toContain('anchor-parity');
                expect(run.output).toContain('streaming-merge--split-renamed');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('api-json-sync catches a stale API surface', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/assets/api.json', '"package": "pdfnative"', '"package": "perturbed"');
                const run = runVerifier(dir);
                expect(run.output).toContain('api-json-sync');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('llms-index-sync catches a stale machine index', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/llms-index.json', '"site": "https://pdfnative.dev"', '"site": "https://perturbed.example"');
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-index-sync');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('llms-index-quality rejects a summary that is source code, not prose', () => {
            withSandbox((dir) => {
                // The exact shape of the defect the rule exists for: the FAQ's
                // summary once shipped as a line lifted out of a fenced code
                // block, and llms-index-sync — comparing a deterministic bug
                // against itself — stayed green for three releases.
                // (The perturbation also trips llms-index-sync; the assertions
                // below target the quality rule's own message.)
                patch(
                    dir,
                    'docs/llms-index.json',
                    '"summary": "Frequently asked questions about pdfnative',
                    '"summary": "const pdf = buildDocumentPDFBytes(x); questions about pdfnative',
                );
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-index-quality');
                expect(run.output).toContain('starts with source code');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('llms-index-quality rejects a summary severed mid-sentence', () => {
            withSandbox((dir) => {
                patch(
                    dir,
                    'docs/llms-index.json',
                    'no OCR engine, no rasterisation."',
                    'no OCR engine, no"',
                );
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-index-quality');
                expect(run.output).toContain('cut mid-sentence');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('verified-on-parity rejects a stamp that disagrees with the manifest', () => {
            withSandbox((dir) => {
                // Read the current stamp from the manifest: a literal date broke
                // this test at every documentation re-audit.
                const manifest = JSON.parse(readFileSync(join(ROOT, 'docs', 'assets', 'ecosystem.json'), 'utf8')) as { verifiedOn: string };
                patch(dir, 'docs/agent-brief.md', `_Verified on ${manifest.verifiedOn}`, '_Verified on 2000-01-01');
                const run = runVerifier(dir);
                expect(run.output).toContain('verified-on-parity');
                expect(run.output).toContain('stamped 2000-01-01');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('bench-parity ties the homepage figures to bench/RESULTS.md', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/index.html', '<span class="bench-value">~98 ms</span>', '<span class="bench-value">~33 ms</span>');
                const run = runVerifier(dir);
                expect(run.output).toContain('bench-parity');
                expect(run.output).toContain('RESULTS.md records');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('internal-links rejects a href that does not resolve', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/responsibility.html', 'href="guides/"', 'href="guides/does-not-exist.html"');
                const run = runVerifier(dir);
                expect(run.output).toContain('internal-links');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('jsonld-version rejects a softwareVersion that disagrees with the manifest', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/index.html', '"softwareVersion": "1.4.0"', '"softwareVersion": "1.3.0"');
                const run = runVerifier(dir);
                expect(run.output).toContain('jsonld-version');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('cdn-sri rejects a third-party script with no integrity hash', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'playgrounds', 'charts.html');
                const text = readFileSync(p, 'utf8');
                writeFileSync(p, text.replace(/ integrity="sha384-[^"]+"/, ''));
                const run = runVerifier(dir);
                expect(run.output).toContain('cdn-sri');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('version-token rejects a package name paired with a version the manifest contradicts', () => {
            withSandbox((dir) => {
                // The exact drift that survived two releases: a prose sentence
                // pairing a package name with a superseded version. stale-token
                // never matched it because no counted noun follows.
                const p = join(dir, 'README.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nThe pdfnative-mcp v9.9.9 server does things.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('version-token');
                expect(run.output).toContain('pdfnative-mcp is');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('cdn pinning is enforced in .js and .md files, not only in HTML', () => {
            withSandbox((dir) => {
                // The homepage demo runner imported the registry `latest` for a
                // full release train because the pin scan stopped at HTML.
                const p = join(dir, 'docs', 'app.js');
                const text = readFileSync(p, 'utf8');
                expect(text).toMatch(/https:\/\/esm\.sh\/pdfnative@\d+\.\d+\.\d+/);
                writeFileSync(p, text.replace(/(https:\/\/esm\.sh\/pdfnative)@\d+\.\d+\.\d+/, '$1'));
                const run = runVerifier(dir);
                expect(run.output).toContain('cdn-sri');
                expect(run.output).toContain('unpinned');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('api-exists rejects a denylisted identifier in .github/instructions/', () => {
            withSandbox((dir) => {
                // Instruction files teach agents what to write; a phantom API
                // there propagates into every future contribution.
                const p = join(dir, '.github', 'instructions', 'api-design.instructions.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nCall streamPdf(params) for streaming.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('api-exists');
                expect(run.output).toContain('streamPdf');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('llms-sync requires the served docs/llms.txt to match the root llms.txt', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'llms.txt');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nDrifted line.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-sync');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('llms-sync requires docs/llms-full.txt to be regenerated when a guide changes', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'guides', 'quickstart.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nA new paragraph the concatenation does not have.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('llms-sync');
                expect(run.output).toContain('stale');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('seo-head requires the x-default hreflang self-reference', () => {
            withSandbox((dir) => {
                // x-default is the only hreflang signal that matters on a
                // monolingual site; a page that loses it silently drops out of
                // international URL selection.
                const p = join(dir, 'docs', 'index.html');
                const text = readFileSync(p, 'utf8');
                expect(text).toMatch(/hreflang="x-default"/);
                writeFileSync(p, text.replace(/^[ \t]*<link rel="alternate" hreflang="x-default"[^\n]*\n/m, ''));
                const run = runVerifier(dir);
                expect(run.output).toContain('seo-head');
                expect(run.output).toContain('x-default');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('sitemap-parity requires each <url> to carry its hreflang alternates', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'sitemap.xml');
                const text = readFileSync(p, 'utf8');
                expect(text).toMatch(/<xhtml:link/);
                writeFileSync(p, text.replace(/^[ \t]*<xhtml:link rel="alternate" hreflang="x-default"[^\n]*\n/m, ''));
                const run = runVerifier(dir);
                expect(run.output).toContain('sitemap-parity');
                expect(run.output).toContain('x-default');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('seo-head requires page-level JSON-LD nodes to declare inLanguage', () => {
            withSandbox((dir) => {
                const p = join(dir, 'docs', 'playgrounds', 'charts.html');
                const text = readFileSync(p, 'utf8');
                expect(text).toMatch(/"inLanguage": "en",/);
                writeFileSync(p, text.replace(/^[ \t]*"inLanguage": "en",\r?\n/m, ''));
                const run = runVerifier(dir);
                expect(run.output).toContain('seo-head');
                expect(run.output).toContain('inLanguage');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('learn-chain rejects a broken prev/next link', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/learn/03-tables.html', 'rel="next" href="04-page-furniture.html"', 'rel="next" href="08-next-steps.html"');
                const run = runVerifier(dir);
                expect(run.output).toContain('learn-chain');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('count-tokens rejects a test count the manifest contradicts, anywhere in the corpus', () => {
            withSandbox((dir) => {
                // The 1.8.0 drift: the same sentence carried three figures
                // across README, homepage and llms.txt, and only the homepage
                // had an assertion. Any "N tests" token is now checked.
                const p = join(dir, 'CONTRIBUTING.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nThe suite holds 999999 tests across 3 files.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('count-tokens');
                expect(run.output).toContain('declared.tests');
                expect(run.output).toContain('derived.testFiles');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('count-tokens holds a coverage figure quoted with a decimal to declared.coverageMeasured', () => {
            withSandbox((dir) => {
                // Three different decimals (90.93, ≈ 90.9, 91.1) shipped in the
                // 1.8.0 docs while the floor rule only bounded the integer part.
                const p = join(dir, 'CONTRIBUTING.md');
                writeFileSync(p, readFileSync(p, 'utf8') + '\nMeasured: 90.93% statements at this release.\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('count-tokens');
                expect(run.output).toContain('declared.coverageMeasured');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('count-tokens rejects a coverage claim above the measured floor but accepts one at it', () => {
            withSandbox((dir) => {
                const manifest = JSON.parse(readFileSync(join(ROOT, 'docs', 'assets', 'ecosystem.json'), 'utf8')) as {
                    declared: { coverageStatements: number };
                };
                const floor = manifest.declared.coverageStatements;
                const p = join(dir, 'CONTRIBUTING.md');
                writeFileSync(p, readFileSync(p, 'utf8') + `\nCoverage: ${floor}%+ statement coverage, and ${floor + 5}% statements.\n`);
                const run = runVerifier(dir);
                expect(run.output).toContain('count-tokens');
                expect(run.output).toContain(`"${floor + 5}% statements"`);
                expect(run.output).not.toContain(`"${floor}%+ statement coverage"`);
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('manifest-shape rejects an assertion whose literal expect disagrees with its expectFrom source', () => {
            withSandbox((dir) => {
                patch(
                    dir,
                    'docs/assets/ecosystem.json',
                    '"expectFrom": "declared.pdfaSamples",',
                    '"expectFrom": "declared.pdfaSamples",\n      "expect": 99,',
                );
                const run = runVerifier(dir);
                expect(run.output).toContain('manifest-shape');
                expect(run.output).toContain('says expect 99 but declared.pdfaSamples is');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('claude-md-budget requires CLAUDE.md to start by importing AGENTS.md', () => {
            withSandbox((dir) => {
                patch(dir, 'CLAUDE.md', '@AGENTS.md', '# A fork of AGENTS.md');
                const run = runVerifier(dir);
                expect(run.output).toContain('claude-md-budget');
                expect(run.output).toContain('must be "@AGENTS.md"');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('prose-language rejects an unmarked French heading in a guide', () => {
            withSandbox((dir) => {
                // demo-language: fr (the French heading is the fixture under test)
                patch(dir, 'docs/guides/typography.md', '## Page breaking', '## Coupure des paragraphes entre les pages');
                const run = runVerifier(dir);
                expect(run.output).toContain('prose-language');
                expect(run.output).toContain('typography.md');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('prose-language accepts French that is marked as demonstrated content', () => {
            withSandbox((dir) => {
                // demo-language: fr (the marked French heading is the fixture under test)
                patch(dir, 'docs/guides/typography.md', '## Page breaking', '<!-- demo-language: fr (test) -->\n## Coupure des paragraphes entre les pages');
                const run = runVerifier(dir);
                expect(run.output).not.toContain('prose-language');
            });
        }, 120_000);

        it('governance-sources rejects a capability_manifest path that does not exist', () => {
            withSandbox((dir) => {
                patch(dir, '.github/ai-governance.json', '".github/AGENT_RULES.md"', '".github/AGENT_RULES_MOVED.md"');
                const run = runVerifier(dir);
                expect(run.output).toContain('governance-sources');
                expect(run.output).toContain('AGENT_RULES_MOVED.md');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('node-pin-parity rejects an .nvmrc whose major disagrees with engines.node', () => {
            withSandbox((dir) => {
                const p = join(dir, '.nvmrc');
                writeFileSync(p, '20\n');
                const run = runVerifier(dir);
                expect(run.output).toContain('node-pin-parity');
                expect(run.output).toContain('.nvmrc pins 20');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('ruleset-parity rejects a required status check that names no workflow job', () => {
            withSandbox((dir) => {
                patch(dir, '.github/rulesets/main.json', '"context": "sample-regression"', '"context": "sample-regresion"');
                const run = runVerifier(dir);
                expect(run.output).toContain('ruleset-parity');
                expect(run.output).toContain('"sample-regresion" names no job');
                expect(run.output).toContain('"sample-regression" is not a required status check');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('agent-config-parity rejects a CLAUDE.md "Never Read" glob that settings.json does not deny', () => {
            withSandbox((dir) => {
                patch(dir, '.claude/settings.json', '      "Read(coverage/**)",\n', '');
                const run = runVerifier(dir);
                expect(run.output).toContain('agent-config-parity');
                expect(run.output).toContain('Read(coverage/**)');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('claude-rules-sync rejects a rule edited by hand instead of regenerated', () => {
            withSandbox((dir) => {
                patch(dir, '.claude/rules/worker.md', '# ', '# Edited by hand: ');
                const run = runVerifier(dir);
                expect(run.output).toContain('claude-rules-sync');
                expect(run.output).toContain('.claude/rules/worker.md');
                expect(run.output).toContain('npm run agents:rules');
                expect(run.status).toBe(1);
            });
        }, 120_000);

        it('playground-syntax rejects an inline module script that does not parse', () => {
            withSandbox((dir) => {
                // A truncated statement is the classic hand-edit accident: the
                // page still serves, the switcher still renders, but the module
                // never executes — a silently dead playground.
                const p = join(dir, 'docs', 'playgrounds', 'charts.html');
                const text = readFileSync(p, 'utf8');
                writeFileSync(p, text.replace(/<script type="module">/, '<script type="module">\nconst broken = {;\n'));
                const run = runVerifier(dir);
                expect(run.output).toContain('playground-syntax');
                expect(run.status).toBe(1);
            });
        }, 120_000);
    });
});
