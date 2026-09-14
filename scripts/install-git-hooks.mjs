#!/usr/bin/env node
/**
 * pdfnative — opt-in git hooks.
 *
 *   npm run hooks:install     # git config core.hooksPath .githooks
 *   npm run hooks:uninstall   # git config --unset core.hooksPath
 *
 * The hooks in .githooks/ (pre-commit: lint + CRLF guard; pre-push: the fast
 * gate) are never activated by `npm install` or by any lifecycle script: a
 * contributor chooses them. The setting is local to this clone.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = '.githooks';

function git(...args) {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function currentHooksPath() {
    try {
        return git('config', '--get', 'core.hooksPath');
    } catch {
        return null;
    }
}

function main(argv) {
    const uninstall = argv.includes('--uninstall');
    const unknown = argv.filter(a => a !== '--uninstall');
    if (unknown.length > 0) {
        process.stderr.write(`Unknown argument(s): ${unknown.join(' ')}\nUsage: node scripts/install-git-hooks.mjs [--uninstall]\n`);
        return 2;
    }

    const current = currentHooksPath();

    if (uninstall) {
        if (current === null) {
            process.stdout.write('Git hooks were not installed (core.hooksPath is unset).\n');
            return 0;
        }
        if (current !== HOOKS_DIR) {
            process.stderr.write(`core.hooksPath is "${current}", not "${HOOKS_DIR}" — left untouched.\n`);
            return 1;
        }
        git('config', '--unset', 'core.hooksPath');
        process.stdout.write('Git hooks uninstalled (core.hooksPath unset).\n');
        return 0;
    }

    const dir = join(REPO_ROOT, HOOKS_DIR);
    if (!existsSync(dir)) {
        process.stderr.write(`${HOOKS_DIR}/ not found next to package.json.\n`);
        return 1;
    }
    // Git ignores a hook it cannot execute; the bit is not preserved by every
    // checkout on Windows, so set it here rather than trust the tree.
    for (const f of readdirSync(dir)) {
        try { chmodSync(join(dir, f), 0o755); } catch { /* read-only FS: git still runs hooks through sh */ }
    }
    if (current !== null && current !== HOOKS_DIR) {
        process.stderr.write(`core.hooksPath is already "${current}"; refusing to overwrite it. Unset it first.\n`);
        return 1;
    }
    git('config', 'core.hooksPath', HOOKS_DIR);
    process.stdout.write(`Git hooks installed: core.hooksPath = ${HOOKS_DIR} (pre-commit, pre-push). Remove with: npm run hooks:uninstall\n`);
    return 0;
}

process.exit(main(process.argv.slice(2)));
