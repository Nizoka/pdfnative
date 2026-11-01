#!/usr/bin/env tsx
/**
 * pdfnative — site horizontal-overflow check
 * ==========================================
 * Loads the pages of pdfnative.dev that carry the shared layout (home,
 * guides index, a guide, playgrounds index, a playground) in a headless
 * Chromium at five viewport widths — a phone, the first width above the
 * hamburger breakpoint, two laptops and a desktop — and fails when any of
 * them scrolls sideways (`scrollWidth > clientWidth`, tolerance 0 px) or
 * when the navigation clips its entries: `.nav-links` is a scroll container
 * without a visible scrollbar, so an entry past its edge would not widen
 * the page and is reported on its own (`navClip`). The report names the
 * outermost elements that reach past the viewport, so a navigation entry
 * or a code sample that reintroduces the scroll is found in one line.
 *
 * What is measured is the local layout: the pages are copied under
 * test-output/ with a `<base href>` back to docs/, so `style.css`,
 * `guide.css` and the local scripts resolve; every CDN host is mapped to
 * NOTFOUND so Prism, marked and DOMPurify fail fast instead of waiting on
 * the network (a guide body rendered from Markdown is therefore absent —
 * the chrome around it is what overflows or not). One colour scheme is
 * enough: overflow is geometry, the theme only recolours it.
 *
 * Each copy is shown inside an `<iframe>` of exactly the asked size in a
 * host page: a headless window cannot be narrower than 500 px and its
 * chrome makes the viewport narrower than `--window-size`, while a frame
 * is the viewport it is told to be. The page's collector posts its
 * measurement to the host, which stores it on the one document
 * `--dump-dom` prints; a measurement at any other width than the one
 * asked is a failure, never a pass at another width.
 *
 * Usage:
 *   npm run verify:overflow
 *   npx tsx scripts/verify-overflow.ts --json          # { pages, viewports, findings: [{ page, width, overflow, culprits }] } (+ skipped | error)
 *   npx tsx scripts/verify-overflow.ts --docs <dir>    # measure another checkout's docs/ (a worktree of an older commit: does the guard bite?)
 *
 * Exit codes:
 *   0 — no finding; or no Chromium-family browser is installed (skip).
 *   1 — one or more findings.
 *   2 — the browser could not be launched or returned no measurement.
 *
 * `CHROME_PATH` selects the browser. No npm dependency.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { dumpDom, findChromium } from './lib/chromium.js';
import {
    OVERFLOW_MESSAGE, describeFinding, hostPage, judgeOverflow, parseOverflowDom, wrapPage, type OverflowFinding, type OverflowResult,
} from './lib/page-overflow.js';

const ROOT = resolve(import.meta.dirname, '..');
const json = process.argv.includes('--json');
const docsFlag = process.argv.indexOf('--docs');
const DOCS = docsFlag >= 0 && process.argv[docsFlag + 1] !== undefined ? resolve(process.argv[docsFlag + 1]!) : join(ROOT, 'docs');

/** Pages relative to docs/: every layout the site has (home, guides, a guide, playgrounds, a playground). */
const PAGES = ['index.html', 'playgrounds/index.html', 'guides/index.html', 'guides/quickstart.html', 'playgrounds/cli.html'] as const;

/** Viewports: a phone, just above the hamburger breakpoint (≤ 1100 px), two laptops, a desktop. */
const VIEWPORTS: readonly { readonly width: number; readonly height: number }[] = [
    { width: 375, height: 812 },
    { width: 1101, height: 768 },
    { width: 1280, height: 900 },
    { width: 1366, height: 768 },
    { width: 1560, height: 900 },
];

/** Every CDN host resolves to nothing: the layout under test is the local one. */
const OFFLINE = '--host-resolver-rules=MAP * ~NOTFOUND';

/**
 * Runs in the framed page once it has loaded and settled (300 ms of page
 * time): measures the horizontal overflow of the document, its viewport
 * width and the outermost elements whose right edge passes the viewport,
 * and posts them to the host page (or stores them on its own <body> when
 * it is the top document). An element inside a scroll container
 * (`overflow-x: auto | scroll | hidden | clip`) or a fixed one does not
 * widen the page, so those subtrees are not reported — except that a
 * scroll container inside a `<nav>` whose content is wider than itself
 * clips navigation entries (the site hides its scrollbar), which is
 * reported as `navClip` with the container among the culprits.
 */
const COLLECTOR = `
(function () {
  function measure() {
    var de = document.documentElement;
    var cw = de.clientWidth;
    var out = [];
    var navClip = 0;
    function name(el) {
      var cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean) : [];
      return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
    }
    function visit(el) {
      if (out.length >= 5) return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.position === 'fixed') return;
      var r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > cw + 0.5) {
        out.push(name(el) + ' (right ' + Math.round(r.right) + 'px)');
        return;
      }
      if (/auto|scroll|hidden|clip/.test(cs.overflowX)) {
        var clip = el.scrollWidth - el.clientWidth;
        if (clip > 0 && el.closest('nav') !== null) {
          navClip = Math.max(navClip, clip);
          out.push(name(el) + ' (clips ' + clip + 'px)');
        }
        return;
      }
      for (var i = 0; i < el.children.length; i++) visit(el.children[i]);
    }
    visit(document.body);
    var result = { type: '${OVERFLOW_MESSAGE}', overflow: de.scrollWidth - cw, clientWidth: cw, culprits: out, navClip: navClip };
    if (window.parent !== window) { window.parent.postMessage(result, '*'); return; }
    document.body.dataset.overflow = String(result.overflow);
    document.body.dataset.clientWidth = String(result.clientWidth);
    document.body.dataset.navClip = String(result.navClip);
    document.body.dataset.overflowCulprits = JSON.stringify(result.culprits);
  }
  function arm() { setTimeout(measure, 300); }
  if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm);
})();`;

function fail(message: string): void {
    process.stderr.write(`verify-overflow: ${message}\n`);
}

async function measure(browser: string, dir: string, page: string, width: number, height: number): Promise<OverflowResult | null> {
    const source = readFileSync(join(DOCS, page), 'utf8');
    const baseHref = `${pathToFileURL(join(DOCS, dirname(page))).href}/`;
    const stem = join(dir, `${page.replace(/[\\/]/g, '__')}.${String(width)}`);
    writeFileSync(`${stem}.html`, wrapPage(source, baseHref, COLLECTOR));
    writeFileSync(`${stem}.host.html`, hostPage(pathToFileURL(`${stem}.html`).href, width, height));
    // The window only has to hold the frame; Chromium clamps anything under 500 px.
    const windowSize = `--window-size=${String(Math.max(width + 32, 500))},${String(height + 100)}`;
    const dom = await dumpDom(browser, pathToFileURL(`${stem}.host.html`).href, [windowSize, OFFLINE], (reason, stderr) => {
        fail(`${browser} failed on ${page} at ${String(width)} px: ${reason}\n${stderr.slice(-2000)}`);
    });
    if (dom === null) return null;
    const measured = parseOverflowDom(dom);
    if (measured === null) return null;
    if (measured.clientWidth !== width) {
        fail(`${page}: asked for ${String(width)} px, laid out at ${String(measured.clientWidth ?? NaN)} px`);
        return null;
    }
    return {
        page, width, overflow: measured.overflow, culprits: measured.culprits,
        ...(measured.navClip === undefined ? {} : { navClip: measured.navClip }),
    };
}

async function main(): Promise<void> {
    const browser = findChromium();
    if (!browser) {
        const reason = 'no Chromium-family browser found (set CHROME_PATH)';
        process.stderr.write(`verify-overflow: skipped — ${reason}.\n`);
        if (json) process.stdout.write(JSON.stringify({ pages: 0, viewports: 0, skipped: reason, findings: [] }) + '\n');
        return;
    }
    // Inside the repository (git-ignored test-output/), not os.tmpdir(): a snap-packaged
    // Chromium has a private /tmp and cannot open pages written there. Dot-prefixed,
    // like the gate's own `.gate`: verify-docs (`derived-counts`) counts every plain
    // directory under test-output/ as a sample category, so a scratch directory that
    // existed while the two scripts overlapped would be reported as a 40th category.
    // Removed in the `finally` below whatever happens.
    const scratch = join(ROOT, 'test-output', '.overflow');
    mkdirSync(scratch, { recursive: true });
    const dir = mkdtempSync(join(scratch, 'run-'));
    const results: OverflowResult[] = [];
    try {
        for (const page of PAGES) {
            for (const { width, height } of VIEWPORTS) {
                const result = await measure(browser, dir, page, width, height);
                if (!result) {
                    const error = `${page} at ${String(width)} px: the browser could not be launched or returned no measurement`;
                    fail(error);
                    if (json) process.stdout.write(JSON.stringify({ pages: PAGES.length, viewports: VIEWPORTS.length, error, findings: judgeOverflow(results) }) + '\n');
                    process.exitCode = 2;
                    return;
                }
                results.push(result);
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    const findings: OverflowFinding[] = judgeOverflow(results);
    if (json) {
        process.stdout.write(JSON.stringify({ pages: PAGES.length, viewports: VIEWPORTS.length, findings }, null, 2) + '\n');
    } else {
        for (const f of findings) {
            process.stdout.write(`docs/${f.page}  [overflow] ${describeFinding(f)}\n`);
        }
        process.stdout.write(`verify-overflow: ${String(PAGES.length)} pages × ${String(VIEWPORTS.length)} viewports — ${findings.length === 0 ? 'clean' : `${String(findings.length)} finding(s)`}.\n`);
    }
    if (findings.length > 0) process.exitCode = 1;
}

void main();
