// pdfnative — runtime smoke, headless Chromium
// ============================================
// `node .github/runtime-smoke/browser.mjs`: serves dist/, fonts/ and the
// shared checks on 127.0.0.1, opens one page in headless Chromium, and waits
// for the page to POST its result back. Exit 0 when every check passed in
// the browser, 1 otherwise.
//
// The browser is `$CHROME_BIN`, else `google-chrome`, which the GitHub-hosted
// Ubuntu image ships; nothing is downloaded and no npm package is added. The
// result comes back by request rather than by `--dump-dom` because the checks
// are asynchronous, and a DOM dumped at the load event can predate them.
//
// Node built-ins only; this file is a CI harness, never part of the package.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMEOUT_MS = 120_000;

const PAGE = `<!doctype html><meta charset="utf-8"><title>pdfnative runtime smoke</title>
<script type="module">
const report = (body) => fetch('/result', { method: 'POST', body: JSON.stringify(body) });
try {
    const pdfnative = await import('/dist/index.js');
    const arabic = await import('/fonts/noto-arabic-data.js');
    const { runChecks } = await import('/.github/runtime-smoke/checks.mjs');
    await report({ ok: true, lines: await runChecks(pdfnative, { arabic }), agent: navigator.userAgent });
} catch (err) {
    await report({ ok: false, error: String(err && err.stack || err), agent: navigator.userAgent });
}
</script>`;

/** Only the three directories the page imports from are served. */
function serveFile(url) {
    const path = normalize(decodeURIComponent(url.split('?')[0])).replace(/^[\\/]+/, '');
    const allowed = [`dist${sep}`, `fonts${sep}`, `.github${sep}runtime-smoke${sep}`];
    if (!allowed.some((prefix) => path.startsWith(prefix))) return undefined;
    try {
        return readFileSync(join(ROOT, path));
    } catch {
        return undefined;
    }
}

let settle;
const done = new Promise((resolveDone) => { settle = resolveDone; });

const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            res.end('ok');
            settle(JSON.parse(body));
        });
        return;
    }
    if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
    }
    const file = serveFile(req.url ?? '');
    if (file === undefined) {
        res.writeHead(404);
        res.end();
        return;
    }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(file);
});

server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const profile = mkdtempSync(join(tmpdir(), 'pdfnative-chromium-'));
    const flags = [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        // Ubuntu 24.04 restricts the unprivileged user namespaces Chromium's
        // sandbox relies on; the page is this repository's own build, served
        // from loopback, so the sandbox protects nothing here.
        ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
        `http://127.0.0.1:${port}/`,
    ];
    const browser = spawn(process.env.CHROME_BIN ?? 'google-chrome', flags, { stdio: 'ignore' });
    browser.on('error', (err) => settle({ ok: false, error: `could not start the browser: ${err.message}` }));
    const timer = setTimeout(() => settle({ ok: false, error: `no result within ${TIMEOUT_MS / 1000} s` }), TIMEOUT_MS);

    done.then((result) => {
        clearTimeout(timer);
        browser.kill();
        server.close();
        try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold it */ }
        if (result.ok) {
            for (const line of result.lines) console.log(`ok - ${line}`);
            console.log(`runtime smoke: every check passed on ${result.agent}`);
            process.exit(0);
        }
        console.error(`not ok - ${result.agent ?? 'browser'}: ${result.error}`);
        process.exit(1);
    });
});
