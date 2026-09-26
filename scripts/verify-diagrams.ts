#!/usr/bin/env tsx
/**
 * pdfnative — documentation diagram geometry check
 * ================================================
 * Renders every hand-written diagram in `docs/assets/*.svg` in a headless
 * Chromium, measures what the browser actually drew, and fails on text that
 * overflows its box, boxes that overlap, texts that collide, and lines that
 * cross a label. Brand images (logo, Open Graph, social preview) are skipped.
 *
 * Each diagram is measured twice: with its own font stack (what readers see)
 * and with Arial forced (metric-identical on Windows and macOS, and on Linux
 * through Liberation Sans), so a pass does not depend on which fonts happen
 * to be installed.
 *
 * Usage:
 *   npm run verify:diagrams
 *   npx tsx scripts/verify-diagrams.ts --json     # { diagrams, findings: [{ file, pass, kind, message }] }
 *
 * Exit codes:
 *   0 — no finding; or no Chromium-family browser is installed (skip).
 *   1 — one or more findings.
 *   2 — the browser ran but returned no measurement.
 *
 * Deliberate overlaps are declared in the SVG, never guessed: see
 * scripts/lib/diagram-geometry.ts (`data-overlap="intentional"`, halos).
 * `CHROME_PATH` selects the browser. No npm dependency.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyseDiagram, type DiagramGeometry } from './lib/diagram-geometry.js';
import { findChromium } from './lib/chromium.js';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'docs', 'assets');
const SKIP = new Set(['logo.svg', 'og-image.svg', 'social-preview.svg']);
const json = process.argv.includes('--json');

/**
 * Runs in the page: collects the rendered geometry of the inline SVG in the
 * root SVG coordinate system and stores it, base64-encoded, on <body>.
 */
const COLLECTOR = `
(function () {
  var svg = document.querySelector('svg');
  var toRoot = function (el, x, y) {
    var p = svg.createSVGPoint(); p.x = x; p.y = y;
    var m = el.getCTM(); var r = svg.getCTM().inverse();
    return p.matrixTransform(m).matrixTransform(r);
  };
  var box = function (el) {
    var b = el.getBBox();
    var a = toRoot(el, b.x, b.y), c = toRoot(el, b.x + b.width, b.y + b.height);
    return { x: Math.min(a.x, c.x), y: Math.min(a.y, c.y), w: Math.abs(c.x - a.x), h: Math.abs(c.y - a.y) };
  };
  var skip = function (el) { return !!el.closest('defs, marker, clipPath, mask, pattern, symbol'); };
  var flag = function (el) { return !!el.closest('[data-overlap="intentional"]'); };
  var vb = svg.viewBox.baseVal;
  var out = { width: vb.width, height: vb.height, texts: [], rects: [], strokes: [] };
  var order = new Map(); var n = 0;
  svg.querySelectorAll('*').forEach(function (el) { order.set(el, n++); });
  var opaque = function (el) {
    var cs = getComputedStyle(el);
    if (!cs.fill || cs.fill === 'none') return false;
    return parseFloat(cs.fillOpacity || '1') * parseFloat(cs.opacity || '1') >= 0.9;
  };
  svg.querySelectorAll('text').forEach(function (t) {
    if (skip(t)) return;
    var b = box(t);
    var order = (t.getAttribute('paint-order') || getComputedStyle(t).paintOrder || '').trim();
    b.label = t.textContent.replace(/\\s+/g, ' ').trim(); b.intentional = flag(t); b.halo = order.indexOf('stroke') === 0;
    out.texts.push(b);
  });
  svg.querySelectorAll('rect').forEach(function (r) {
    if (skip(r)) return; var b = box(r); b.intentional = flag(r); b.order = order.get(r); b.opaque = opaque(r); out.rects.push(b);
  });
  svg.querySelectorAll('line, path, polyline').forEach(function (s) {
    if (skip(s)) return;
    var len; try { len = s.getTotalLength(); } catch (e) { return; }
    var pts = [];
    for (var k = 0; k <= 80; k++) { var p = s.getPointAtLength(len * k / 80); var q = toRoot(s, p.x, p.y); pts.push({ x: q.x, y: q.y }); }
    out.strokes.push({ tag: s.tagName, points: pts, intentional: flag(s), order: order.get(s) });
  });
  document.body.setAttribute('data-geometry', btoa(unescape(encodeURIComponent(JSON.stringify(out)))));
})();`;

const ARIAL = '<style>svg text { font-family: Arial, "Liberation Sans", sans-serif !important; }</style>';

interface Finding { readonly file: string; readonly pass: string; readonly kind: string; readonly message: string }

function measure(browser: string, dir: string, file: string, svg: string, pass: 'site fonts' | 'Arial'): DiagramGeometry | null {
    const width = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    const sized = width ? svg.replace('<svg ', `<svg width="${width[1]}" height="${width[2]}" `) : svg;
    const page = join(dir, `${file}.${pass === 'Arial' ? 'arial' : 'site'}.html`);
    writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8">${pass === 'Arial' ? ARIAL : ''}</head>` +
        `<body style="margin:0">${sized}<script>${COLLECTOR}</script></body></html>`);
    const run = spawnSync(browser, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
        '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    const encoded = /data-geometry="([A-Za-z0-9+/=]+)"/.exec(run.stdout ?? '')?.[1];
    if (encoded === undefined) return null;
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as DiagramGeometry;
}

function main(): void {
    const browser = findChromium();
    if (!browser) {
        process.stderr.write('verify-diagrams: skipped — no Chromium-family browser found (set CHROME_PATH).\n');
        return;
    }
    const files = readdirSync(ASSETS).filter((f) => f.endsWith('.svg') && !SKIP.has(f)).sort();
    const dir = mkdtempSync(join(tmpdir(), 'pdfnative-diagrams-'));
    const findings: Finding[] = [];
    try {
        for (const file of files) {
            const svg = readFileSync(join(ASSETS, file), 'utf8');
            for (const pass of ['site fonts', 'Arial'] as const) {
                const geometry = measure(browser, dir, file, svg, pass);
                if (!geometry) {
                    process.stderr.write(`verify-diagrams: ${file} (${pass}) — the browser returned no measurement\n`);
                    process.exitCode = 2;
                    return;
                }
                for (const f of analyseDiagram(geometry)) findings.push({ file: `docs/assets/${file}`, pass, ...f });
            }
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    if (json) {
        process.stdout.write(JSON.stringify({ diagrams: files.length, findings }, null, 2) + '\n');
    } else {
        for (const f of findings) process.stdout.write(`${f.file}  [${f.kind}] (${f.pass}) ${f.message}\n`);
        process.stdout.write(`verify-diagrams: ${files.length} diagrams × 2 font passes — ${findings.length === 0 ? 'clean' : `${findings.length} finding(s)`}.\n`);
    }
    if (findings.length > 0) process.exitCode = 1;
}

main();
