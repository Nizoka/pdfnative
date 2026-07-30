import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, existsSync } from 'node:fs';
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
        const output = execFileSync('npx', ['tsx', script], {
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
    for (const entry of ['docs', 'src', 'tests', 'scripts', 'bench']) {
        const from = join(ROOT, entry);
        if (existsSync(from)) cpSync(from, join(dir, entry), { recursive: true });
    }
    // package.json declares "type": "module"; without it tsx compiles the
    // verifier as CJS and its top-level await fails to transform.
    for (const file of ['package.json', 'README.md', 'ROADMAP.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'llms.txt']) {
        const from = join(ROOT, file);
        if (existsSync(from)) cpSync(from, join(dir, file));
    }
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
                patch(dir, 'docs/guides/mcp.md', '**24 tools**', '**25 tools**');
                const run = runVerifier(dir);
                expect(run.output).toContain('stale-token');
                expect(run.output).toContain('the manifest says 24');
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
                patch(dir, 'docs/index.html', '"softwareVersion": "1.3.0"', '"softwareVersion": "1.2.0"');
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

        it('learn-chain rejects a broken prev/next link', () => {
            withSandbox((dir) => {
                patch(dir, 'docs/learn/03-tables.html', 'rel="next" href="04-page-furniture.html"', 'rel="next" href="08-next-steps.html"');
                const run = runVerifier(dir);
                expect(run.output).toContain('learn-chain');
                expect(run.status).toBe(1);
            });
        }, 120_000);
    });
});
