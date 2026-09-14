import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `.claude/hooks/guard.mjs` is the PreToolUse hook that enforces the
 * human-in-the-loop gate (.github/AGENT_RULES.md §5) on every Bash call of a
 * Claude Code session. A rule that is too narrow lets an agent push or
 * publish; a rule that is too wide refuses `git status` and bricks the
 * session — so both directions are tabled here, and the stdin protocol is
 * exercised as a subprocess.
 *
 * `PDFNATIVE_GUARD_HOOK` points the suite at a candidate copy of the hook
 * (the live file guards the session that edits it, so a rewrite is tested
 * before it is installed).
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const HOOK = process.env['PDFNATIVE_GUARD_HOOK'] ?? join(ROOT, '.claude', 'hooks', 'guard.mjs');
const guard = (await import(pathToFileURL(HOOK).href)) as typeof import('../../.claude/hooks/guard.mjs');

const DENIED: ReadonlyArray<readonly [command: string, what: RegExp]> = [
    ['npm publish', /npm publish/],
    ['npm publish --access public --provenance', /npm publish/],
    ['npm unpublish pdfnative@1.8.0', /unpublish/],
    ['npm deprecate pdfnative@1.0.0 "old"', /deprecate/],
    ['npm dist-tag add pdfnative@1.8.0 latest', /dist-tag/],
    ['npm version patch', /version/],
    ['npx npm@11 publish', /npx npm publish/],
    ['npx npm publish --provenance', /npx npm publish/],
    ['gh pr create --fill', /gh pr create/],
    ['gh pr edit 12 --title x', /gh pr create/],
    ['gh pr close 12', /gh pr create/],
    ['gh pr merge 12 --squash', /gh pr create/],
    ['gh pr comment 12 -b "x"', /gh pr create/],
    ['gh issue create -t x -b y', /gh issue create/],
    ['gh issue edit 3 --add-label bug', /gh issue create/],
    ['gh issue close 3', /gh issue create/],
    ['gh issue comment 3 -b x', /gh issue create/],
    ['gh release create v1.8.0 --notes-file x', /gh release/],
    ['gh release list', /gh release/],
    ['gh api repos/x/y/issues --method POST -f title=x', /gh api/],
    ['gh api -X DELETE repos/x/y/releases/1', /gh api/],
    ['gh api --method=PATCH repos/x/y', /gh api/],
    ['gh api repos/x/y/issues --input body.json', /gh api/],
    ['gh api graphql -F query=@m.graphql', /gh api/],
    ['git push', /git push/],
    ['git push origin feat/release-v1.8.0', /git push/],
    ['git push --force-with-lease', /git push/],
    ['git push -f origin main', /git push/],
    ['git -C /tmp/clone push', /git push/],
    ['git -c core.autocrlf=false -C . push origin', /git push/],
    ['git add --renormalize .', /renormalize/],
    ['git add -A --renormalize', /renormalize/],
    ['git tag v1.8.0', /git tag/],
    ['git tag -a v1.8.0 -m "release"', /git tag/],
    ['git tag -d v1.8.0', /git tag/],
    ['git tag -f v1.8.0', /git tag/],
    ['cd /tmp && gh pr create --fill', /gh pr create/],
    ['npm test; git push', /git push/],
    ['npm run build || npm publish', /npm publish/],
    ['echo origin | xargs git push', /git push/],
    ['git status && (cd sub; git push)', /git push/],
    ['ls\ngit push', /git push/],
    ['NPM_TOKEN=x npm publish', /npm publish/],
    ['env NODE_ENV=production npm publish', /npm publish/],
    ['time git push', /git push/],
    ['nohup npm publish &', /npm publish/],
    ['sudo -u deploy git push', /git push/],
    ["bash -c 'git push origin main'", /git push/],
    ['sh -lc "npm publish"', /npm publish/],
    ['zsh -c "cd x && gh release create v1"', /gh release/],
    ['pwsh -Command "git push"', /git push/],
    ['powershell -NoProfile -Command git push origin main', /git push/],
    ["node -e \"require('child_process').execSync('git push')\"", /git push/],
    ['node --eval "import(\'child_process\').then(m => m.execSync(\'npm publish\'))"', /npm publish/],
    ['npx -c "npm publish"', /npm publish/],
    ['echo $(git push)', /git push/],
    ['echo `gh release create v1`', /gh release/],
];

const ALLOWED: readonly string[] = [
    'git status',
    'git status --short | head -1',
    'git commit -m "feat(core): x"',
    'git add .',
    'git add -A',
    'git tag -l',
    'git tag --list',
    'git tag -n',
    'git tag',
    "git tag -l 'v1.*'",
    'git tag --contains HEAD',
    'npm run gate -- --fast',
    'npm run gate',
    'npx vitest run tests/tools/guard.test.ts',
    'node -e "1"',
    'node -e "console.log(process.version)"',
    'gh api repos/Nizoka/pdfnative',
    'gh api repos/Nizoka/pdfnative/releases --method GET',
    'git log --oneline -5',
    'npm view npm@11 version',
    'npm version',
    'npm pack --dry-run',
    'echo hi',
    'echo "npm publish is the maintainer\'s job"',
    'npm test',
    'npx tsx scripts/verify-docs.ts --json',
    'npx tsc --noEmit',
    'git diff --stat',
    'git show HEAD --stat',
    'git pull --ff-only',
    'git fetch origin',
    'git push-dummy',
    'gh pr view 12',
    'gh pr list',
    'gh issue list',
    'gh issue view 3',
    'gh run list',
    'npm -v',
    'git describe --tags',
    'node .claude/hooks/guard.mjs',
    'grep -rn "gh release" docs/',
    'cat .github/pull_request_template.md',
];

describe('guard hook — rule table', () => {
    it('tables at least 25 denied and 20 allowed commands', () => {
        expect(DENIED.length).toBeGreaterThanOrEqual(25);
        expect(ALLOWED.length).toBeGreaterThanOrEqual(20);
    });

    it.each(DENIED)('denies %j', (command, what) => {
        const verdict = guard.decide(command);
        expect(verdict.deny, command).toBe(true);
        expect(verdict.what, command).toMatch(what);
    });

    it.each(ALLOWED.map((c) => [c] as const))('allows %j', (command) => {
        expect(guard.decide(command)).toEqual({ deny: false });
    });

    it('exports a frozen rule table with a reason per rule', () => {
        expect(Object.isFrozen(guard.RULES)).toBe(true);
        for (const rule of guard.RULES) {
            expect(rule.re).toBeInstanceOf(RegExp);
            expect(rule.what.length).toBeGreaterThan(0);
        }
    });

    it('candidates() yields segments, substitutions and interpreter payloads', () => {
        const list = guard.candidates("cd x && echo $(git log -1) | bash -c 'npm publish'");
        expect(list).toContain('cd x');
        expect(list).toContain('git log -1');
        expect(list).toContain('npm publish');
    });

    it('stripPrefixes() removes launch wrappers only', () => {
        expect(guard.stripPrefixes('FOO=1 BAR="a b" env -i time nohup git push')).toBe('git push');
        expect(guard.stripPrefixes('git push')).toBe('git push');
    });

    it('decide() allows a non-string command', () => {
        expect(guard.decide(undefined as unknown as string)).toEqual({ deny: false });
    });
});

describe('guard hook — stdin protocol', () => {
    function run(input: string): { status: number | null; stdout: string; stderr: string } {
        const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', windowsHide: true });
        return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    }

    it('prints a deny payload and exits 0 for a forbidden command', () => {
        const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'cd x && gh pr create --fill' } }));
        expect(r.status).toBe(0);
        const payload = JSON.parse(r.stdout) as ReturnType<typeof guard.denyPayload>;
        expect(payload.hookSpecificOutput.hookEventName).toBe('PreToolUse');
        expect(payload.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(payload.hookSpecificOutput.permissionDecisionReason).toContain('AGENT_RULES.md §5');
        expect(payload.hookSpecificOutput.permissionDecisionReason).toContain('gh pr create');
    });

    it('prints nothing and exits 0 for an allowed command', () => {
        const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }));
        expect(r.status).toBe(0);
        expect(r.stdout).toBe('');
    });

    it('fails closed on malformed JSON: deny payload and exit 2', () => {
        const r = run('{ not json');
        expect(r.status).toBe(2);
        const payload = JSON.parse(r.stdout) as ReturnType<typeof guard.denyPayload>;
        expect(payload.hookSpecificOutput.permissionDecision).toBe('deny');
        expect(payload.hookSpecificOutput.permissionDecisionReason).toContain('fail closed');
        expect(r.stderr).toContain('fail closed');
    });

    it('allows a payload that carries no command (not a Bash call)', () => {
        const r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }));
        expect(r.status).toBe(0);
        expect(r.stdout).toBe('');
    });
});
