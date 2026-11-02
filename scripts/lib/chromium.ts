/**
 * Locate and drive a Chromium-family browser (Chrome, Chromium, Edge) headless
 * ===========================================================================
 * Used by `scripts/verify-diagrams.ts`, `scripts/verify-overflow.ts` and by
 * the gate's skip conditions. No download, no npm dependency: an installed
 * browser or nothing. `CHROME_PATH`, when set, is used as is and replaces
 * the search. `dumpDom()` is the one launcher: load a URL, let the page run
 * under a virtual-time budget, return the serialised DOM.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function candidates(): string[] {
    const env = process.env;
    const out: string[] = [];
    // An explicit override is authoritative: a wrong path fails loudly instead of
    // silently falling back to another browser.
    if (env['CHROME_PATH']) return [env['CHROME_PATH']];
    if (process.platform === 'win32') {
        for (const base of [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]) {
            if (!base) continue;
            out.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
            out.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
            out.push(join(base, 'Chromium', 'Application', 'chrome.exe'));
        }
    } else if (process.platform === 'darwin') {
        out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
        out.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
        out.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    } else {
        for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
            out.push(`/usr/bin/${name}`);
        }
        out.push('/snap/bin/chromium');
    }
    return out;
}

/** Absolute path of an installed Chromium-family browser, or null. */
export function findChromium(): string | null {
    const override = process.env['CHROME_PATH'];
    if (override) return override; // used as is: a wrong path fails at launch (exit 2), never a silent skip
    for (const path of candidates()) {
        if (existsSync(path)) return path;
    }
    return null;
}

/** The flags every headless run shares: new headless mode, no GPU, no sandbox, no scrollbars, no first-run UI. */
const HEADLESS_ARGS = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
    '--virtual-time-budget=3000', '--dump-dom',
] as const;

/** How long one page may take before the launch is given up. */
const LAUNCH_TIMEOUT_MS = 60_000;

/**
 * Where the per-launch browser profiles go: inside the repository (git-ignored
 * test-output/, a snap-packaged Chromium cannot read os.tmpdir()), dot-prefixed
 * so verify-docs does not count it as a sample category.
 */
const PROFILES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-output', '.chromium');

/**
 * Load `url` in `browser` and resolve with the DOM it serialises once the
 * page has run for the virtual-time budget (3 s of page time, elapsed
 * instantly), or with null when the browser could not be launched, exited
 * non-zero or printed nothing within 60 s.
 *
 * Every launch gets its own fresh `--user-data-dir`, removed afterwards.
 * Without it, `chrome.exe --headless=new` on a workstation where the same
 * browser is already open hands the URL to that running instance and never
 * prints anything: the check then times out whenever the maintainer has a
 * browser window open. With an isolated profile it returns at once.
 *
 * The dump ends with `</html>`; the browser is terminated as soon as that
 * is on stdout rather than awaited to its exit. A page whose scripts keep
 * timers or observers alive (the site pages do) otherwise holds the
 * shutdown for ten seconds to a minute while the measurement already sits
 * in the pipe — the diagrams, inert SVG, never did.
 *
 * `extraArgs` go before the URL (`--window-size=…`, `--host-resolver-rules=…`);
 * `onFailure` receives the reason and the browser's stderr so the caller can
 * report it in its own words.
 */
export function dumpDom(
    browser: string,
    url: string,
    extraArgs: readonly string[] = [],
    onFailure?: (reason: string, stderr: string) => void,
): Promise<string | null> {
    return new Promise((resolve) => {
        let out = '';
        let err = '';
        let settled = false;
        mkdirSync(PROFILES, { recursive: true });
        const profile = mkdtempSync(join(PROFILES, 'profile-'));
        const child = spawn(browser, [...HEADLESS_ARGS, `--user-data-dir=${profile}`, ...extraArgs, url], { windowsHide: true });
        const finish = (value: string | null, reason?: string): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (reason !== undefined) onFailure?.(reason, err);
            resolve(value);
        };
        const discardProfile = (): void => {
            // The browser may still be releasing its files on Windows: retry, then leave it (git-ignored).
            try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* left under test-output/.chromium/ */ }
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(null, `no complete DOM within ${String(LAUNCH_TIMEOUT_MS / 1000)} s`);
        }, LAUNCH_TIMEOUT_MS);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            out += chunk;
            if (/<\/html>\s*$/i.test(out)) {
                finish(out);
                child.kill();
            }
        });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => { err += chunk; });
        child.on('error', (e) => { finish(null, e.message); discardProfile(); });
        child.on('close', (code) => {
            if (code === 0 && out !== '') finish(out);
            else finish(null, `exit ${String(code)}`);
            discardProfile();
        });
    });
}
