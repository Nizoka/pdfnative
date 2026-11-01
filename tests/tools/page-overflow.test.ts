import { describe, it, expect } from 'vitest';
import { OVERFLOW_MESSAGE, describeFinding, hostPage, judgeOverflow, parseOverflowDom, wrapPage } from '../../scripts/lib/page-overflow.js';

// The pure half of `npm run verify:overflow`: the browser lays the page out
// and leaves a measurement on <body>; these functions prepare the page,
// read the measurement back and decide what is a defect. Synthetic DOM
// strings stand in for the browser.

const COLLECTOR = 'document.body.dataset.overflow = "0";';

describe('wrapPage', () => {
    const page = '<!doctype html><html lang="en"><head>\n<meta charset="utf-8">\n<link rel="stylesheet" href="style.css">\n</head><body><p>hi</p></body></html>';

    it('places <base href> right after <head>, before the first <link>, and the collector before </body>', () => {
        const out = wrapPage(page, 'file:///repo/docs/', COLLECTOR);
        expect(out.indexOf('<base href="file:///repo/docs/">')).toBe(out.indexOf('<head>') + '<head>'.length);
        expect(out.indexOf('<base ')).toBeLessThan(out.indexOf('<link'));
        expect(out.indexOf(`<script>${COLLECTOR}</script>`)).toBe(out.indexOf('</body>') - `<script>${COLLECTOR}</script>`.length);
        expect(out.match(/<base\b/g)).toHaveLength(1);
    });

    it('adds <base> once: a page that already carries one keeps it', () => {
        const withBase = page.replace('<head>', '<head><base href="https://pdfnative.dev/">');
        const out = wrapPage(withBase, 'file:///repo/docs/', COLLECTOR);
        expect(out.match(/<base\b/g)).toHaveLength(1);
        expect(out).toContain('<base href="https://pdfnative.dev/">');
    });

    it('escapes the href and copes with a page without <head> or </body>', () => {
        const out = wrapPage('<link rel="stylesheet" href="a.css"><p>x</p>', 'file:///a&b/"c"/', COLLECTOR);
        expect(out.startsWith('<base href="file:///a&amp;b/&quot;c&quot;/"><link')).toBe(true);
        expect(out.endsWith(`<script>${COLLECTOR}</script>`)).toBe(true);
    });
});

describe('hostPage', () => {
    it('frames the prepared copy at exactly the asked viewport and listens for its measurement', () => {
        const host = hostPage('file:///repo/test-output/.overflow/run-1/index.html.375.html', 375, 812);
        expect(host).toContain('<iframe src="file:///repo/test-output/.overflow/run-1/index.html.375.html" width="375" height="812">');
        expect(host).toContain(`d.type !== '${OVERFLOW_MESSAGE}'`);
        expect(host).toContain('document.body.dataset.overflow = String(d.overflow)');
        expect(host).toContain('document.body.dataset.clientWidth = String(d.clientWidth)');
        expect(host).toContain('document.body.dataset.navClip = String(d.navClip)');
    });

    it('escapes the frame URL', () => {
        expect(hostPage('file:///a&b/"c".html', 375, 812)).toContain('src="file:///a&amp;b/&quot;c&quot;.html"');
    });
});

describe('parseOverflowDom', () => {
    it('returns null when the collector never ran (no data-overflow on <body>)', () => {
        expect(parseOverflowDom('<html><head></head><body class="home"><p>x</p></body></html>')).toBeNull();
        expect(parseOverflowDom('')).toBeNull();
    });

    it('reads the overflow and the entity-encoded culprits Chromium serialises', () => {
        const dom = '<html><body data-overflow="282" data-overflow-culprits="[&quot;li.nav-item (right 1316px)&quot;,&quot;pre.language-bash (right 1309px)&quot;]"><p>x</p></body></html>';
        expect(parseOverflowDom(dom)).toEqual({ overflow: 282, culprits: ['li.nav-item (right 1316px)', 'pre.language-bash (right 1309px)'] });
    });

    it('reads the viewport the page was laid out at when the collector recorded it', () => {
        expect(parseOverflowDom('<body data-overflow="0" data-overflow-culprits="[]" data-client-width="1280">')).toEqual({ overflow: 0, culprits: [], clientWidth: 1280 });
    });

    it('reads what the navigation clips when the collector recorded it, and leaves it absent otherwise', () => {
        expect(parseOverflowDom('<body data-overflow="0" data-overflow-culprits="[&quot;ul.nav-links (clips 48px)&quot;]" data-client-width="1025" data-nav-clip="48">'))
            .toEqual({ overflow: 0, culprits: ['ul.nav-links (clips 48px)'], clientWidth: 1025, navClip: 48 });
        expect(parseOverflowDom('<body data-overflow="0" data-overflow-culprits="[]" data-client-width="1280">')).not.toHaveProperty('navClip');
    });

    it('reads a clean page as 0 with no culprits, and tolerates missing or broken culprits', () => {
        expect(parseOverflowDom('<body data-overflow="0" data-overflow-culprits="[]">')).toEqual({ overflow: 0, culprits: [] });
        expect(parseOverflowDom('<body data-overflow="12">')).toEqual({ overflow: 12, culprits: [] });
        expect(parseOverflowDom('<body data-overflow="12" data-overflow-culprits="not json">')).toEqual({ overflow: 12, culprits: [] });
    });
});

describe('judgeOverflow', () => {
    it('reports nothing when every page measures 0 px', () => {
        expect(judgeOverflow([
            { page: 'index.html', width: 375, overflow: 0, culprits: [] },
            { page: 'index.html', width: 1280, overflow: 0, culprits: [] },
        ])).toEqual([]);
    });

    it('reports every non-zero measurement with its culprits (tolerance 0 px)', () => {
        const findings = judgeOverflow([
            { page: 'index.html', width: 375, overflow: 1, culprits: ['div.onboarding-card (right 681px)'] },
            { page: 'index.html', width: 1025, overflow: 0, culprits: [] },
            { page: 'index.html', width: 1280, overflow: 282, culprits: ['li.nav-item (right 1562px)'] },
        ]);
        expect(findings).toEqual([
            { page: 'index.html', width: 375, overflow: 1, culprits: ['div.onboarding-card (right 681px)'] },
            { page: 'index.html', width: 1280, overflow: 282, culprits: ['li.nav-item (right 1562px)'] },
        ]);
    });

    it('reports a navigation that clips its entries even when the document itself does not scroll', () => {
        const findings = judgeOverflow([
            { page: 'index.html', width: 1025, overflow: 0, culprits: ['ul.nav-links (clips 48px)'], navClip: 48 },
            { page: 'index.html', width: 1280, overflow: 0, culprits: [], navClip: 0 },
            { page: 'guides/quickstart.html', width: 1025, overflow: 0, culprits: [] },
        ]);
        expect(findings).toEqual([
            { page: 'index.html', width: 1025, overflow: 0, culprits: ['ul.nav-links (clips 48px)'], navClip: 48 },
        ]);
    });
});

describe('describeFinding', () => {
    it('names the sideways scroll, the clipped navigation, or both, and the culprits', () => {
        expect(describeFinding({ page: 'index.html', width: 375, overflow: 12, culprits: ['pre.language-bash (right 400px)'] }))
            .toBe('375 px viewport scrolls sideways by 12 px — pre.language-bash (right 400px)');
        expect(describeFinding({ page: 'index.html', width: 1025, overflow: 0, culprits: ['ul.nav-links (clips 48px)'], navClip: 48 }))
            .toBe('the navigation clips 48 px of its entries at 1025 px — ul.nav-links (clips 48px)');
        expect(describeFinding({ page: 'index.html', width: 1025, overflow: 3, culprits: [], navClip: 48 }))
            .toBe('1025 px viewport scrolls sideways by 3 px; the navigation clips 48 px of its entries at 1025 px — no element reaches past the viewport');
    });
});
