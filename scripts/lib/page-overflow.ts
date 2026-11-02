/**
 * Page overflow analysis — pure, no browser, no file system
 * ==========================================================
 * `scripts/verify-overflow.ts` loads a handful of site pages in a headless
 * Chromium at several viewport widths and asks whether the page scrolls
 * sideways. The browser-facing half (page preparation, DOM reading, verdict)
 * lives here so it can be unit-tested without a browser.
 *
 *   wrapPage          prepares a scratch copy of a page: a `<base href>` so
 *                     its relative stylesheets and scripts still resolve from
 *                     the scratch directory, and the collector script that
 *                     measures the overflow once the page has laid out.
 *   parseOverflowDom  reads the measurement the collector left on <body>
 *                     (`data-overflow`, `data-overflow-culprits`,
 *                     `data-nav-clip`) out of the DOM dump; null when the
 *                     page never measured.
 *   judgeOverflow     turns the measurements into findings: any horizontal
 *                     overflow at all is a defect (tolerance 0 px), and so is
 *                     a navigation scroll container that clips its entries —
 *                     `.nav-links` hides its scrollbar, so an entry past its
 *                     edge is unreachable without widening the page.
 */

export interface OverflowMeasurement {
    /** `scrollWidth - clientWidth` of the document element, in CSS pixels. */
    readonly overflow: number;
    /** The outermost elements whose right edge passes the viewport (tag + classes), up to five. */
    readonly culprits: readonly string[];
    /**
     * The widest `scrollWidth - clientWidth` of a scroll container inside a
     * `<nav>` (`overflow-x: auto | scroll | hidden | clip`), in CSS pixels:
     * what the navigation clips instead of widening the page. Absent when the
     * collector did not record it; 0 when every entry is in view.
     */
    readonly navClip?: number;
    /**
     * The viewport the page was actually laid out at (`clientWidth`), when the
     * collector recorded it: `--window-size` is the window, and a platform's
     * window chrome can make the viewport narrower than asked.
     */
    readonly clientWidth?: number;
}

export interface OverflowResult extends OverflowMeasurement {
    /** The page, relative to `docs/` (`index.html`, `guides/quickstart.html`). */
    readonly page: string;
    /** The viewport width the page was laid out at. */
    readonly width: number;
}

export type OverflowFinding = OverflowResult;

/**
 * Insert `<base href>` right after `<head>` (once — a page that already
 * carries a `<base>` keeps it; a page without `<head>` gets it before the
 * first `<link`) and the collector `<script>` before `</body>`.
 */
export function wrapPage(html: string, baseHref: string, collector: string): string {
    let out = html;
    if (!/<base\b/i.test(out)) {
        const base = `<base href="${baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
        const head = /<head\b[^>]*>/i.exec(out);
        if (head) {
            const at = head.index + head[0].length;
            out = `${out.slice(0, at)}${base}${out.slice(at)}`;
        } else {
            const link = out.search(/<link\b/i);
            out = link >= 0 ? `${out.slice(0, link)}${base}${out.slice(link)}` : `${base}${out}`;
        }
    }
    const script = `<script>${collector}</script>`;
    const end = out.toLowerCase().lastIndexOf('</body>');
    return end >= 0 ? `${out.slice(0, end)}${script}${out.slice(end)}` : `${out}${script}`;
}

/** The `type` of the message the collector posts from the frame to the host page. */
export const OVERFLOW_MESSAGE = 'pdfnative-overflow';

function attribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * The host page: an `<iframe>` of exactly `width` × `height` CSS pixels
 * showing the prepared copy, so the page under test gets the viewport that
 * was asked for — a headless window cannot be narrower than 500 px and its
 * chrome makes the viewport narrower than `--window-size` — and a listener
 * that copies the frame's measurement onto this document's `<body>`, the
 * one `--dump-dom` prints.
 */
export function hostPage(frameHref: string, width: number, height: number): string {
    return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}iframe{display:block;border:0}</style></head>' +
        `<body><iframe src="${attribute(frameHref)}" width="${String(width)}" height="${String(height)}"></iframe><script>` +
        `window.addEventListener('message', function (e) { var d = e.data; if (!d || d.type !== '${OVERFLOW_MESSAGE}') return;` +
        ' document.body.dataset.overflow = String(d.overflow); document.body.dataset.clientWidth = String(d.clientWidth);' +
        ' document.body.dataset.navClip = String(d.navClip);' +
        ' document.body.dataset.overflowCulprits = JSON.stringify(d.culprits); });' +
        '</script></body></html>';
}

/** Decode the entities Chromium's DOM serialiser uses inside attribute values. */
function decodeAttribute(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/**
 * The measurement the collector stored on `<body>`, or null when the
 * attribute is absent (the collector never ran: the page did not load, the
 * dump happened before `load`, or the browser printed something else).
 */
export function parseOverflowDom(dom: string): OverflowMeasurement | null {
    const body = /<body\b[^>]*>/i.exec(dom)?.[0];
    if (body === undefined) return null;
    const overflow = /\bdata-overflow="(-?\d+(?:\.\d+)?)"/.exec(body)?.[1];
    if (overflow === undefined) return null;
    const raw = /\bdata-overflow-culprits="([^"]*)"/.exec(body)?.[1];
    let culprits: string[] = [];
    if (raw !== undefined && raw !== '') {
        try {
            const parsed: unknown = JSON.parse(decodeAttribute(raw));
            if (Array.isArray(parsed)) culprits = parsed.filter((c): c is string => typeof c === 'string');
        } catch {
            culprits = [];
        }
    }
    const clientWidth = /\bdata-client-width="(\d+(?:\.\d+)?)"/.exec(body)?.[1];
    const navClip = /\bdata-nav-clip="(-?\d+(?:\.\d+)?)"/.exec(body)?.[1];
    return {
        overflow: Number(overflow),
        culprits,
        ...(clientWidth === undefined ? {} : { clientWidth: Number(clientWidth) }),
        ...(navClip === undefined ? {} : { navClip: Number(navClip) }),
    };
}

/**
 * Every measurement with a positive overflow is a finding (tolerance 0 px);
 * so is one whose navigation clips its entries (`navClip > 0`), whatever the
 * document's own overflow says.
 */
export function judgeOverflow(results: readonly OverflowResult[]): OverflowFinding[] {
    return results
        .filter((r) => r.overflow > 0 || (r.navClip ?? 0) > 0)
        .map((r) => ({
            page: r.page,
            width: r.width,
            overflow: r.overflow,
            culprits: [...r.culprits],
            ...(r.navClip === undefined ? {} : { navClip: r.navClip }),
        }));
}

/** One line per finding: what scrolls or clips, by how much, and which elements. */
export function describeFinding(f: OverflowFinding): string {
    const parts: string[] = [];
    if (f.overflow > 0) parts.push(`${String(f.width)} px viewport scrolls sideways by ${String(f.overflow)} px`);
    if ((f.navClip ?? 0) > 0) parts.push(`the navigation clips ${String(f.navClip)} px of its entries at ${String(f.width)} px`);
    return `${parts.join('; ')} — ${f.culprits.join(', ') || 'no element reaches past the viewport'}`;
}
