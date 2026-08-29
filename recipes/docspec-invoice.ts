/**
 * A stored DocSpec — the token-frugal JSON an AI agent (or a
 * store-the-spec-not-the-PDF architecture) persists instead of the rendered
 * file — compiled to real PDF bytes by pdfnative-react's spec renderer.
 * Rendering is synchronous and DOM-free, so the exact same call works in
 * Node, a browser tab or an edge runtime; the emitted bytes are then read
 * back with the engine's own parser, closing the loop.
 *
 * @task Render a persisted DocSpec (JSON) to PDF with pdfnative-react
 * @surface react
 * @since 1.1.0
 * @expect pages === 1
 * @expect text of page 0 contains 'Quarterly report'
 * @expect text of page 0 contains 'Total'
 */
import { renderSpecToBytes } from 'pdfnative-react';
import type { DocSpec } from 'pdfnative-react';
import { openPdf, extractText } from 'pdfnative';

// The spec is plain data — ~600 bytes where the rendered PDF is tens of
// kilobytes. Version it, diff it, patch a typo, re-render on demand.
const spec: DocSpec = {
    title: 'Quarterly report Q2-2026',
    footerText: 'Acme Widgets Ltd — internal',
    blocks: [
        ['h1', 'Quarterly report Q2-2026'],
        ['p', 'Revenue grew in every segment; margin held above target.'],
        ['table', {
            h: ['Segment', 'Revenue', 'Margin'],
            r: [
                ['SMB', '1.2M', '22%'],
                ['Enterprise', '2.4M', '26%'],
            ],
            zebra: true,
        }],
        ['p', 'Total: 3.6M — up 18% quarter on quarter.', { align: 'right' }],
    ],
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number; text: string }> {
    // Synchronous by design: no DOM, no reconciler event loop — a DocSpec
    // compiles straight through the component layer to engine params.
    const bytes = renderSpecToBytes(spec);
    const pages = openPdf(bytes).pageCount;
    const text = extractText(bytes, { pages: [0] })[0].text;
    return { bytes, pages, text };
}
