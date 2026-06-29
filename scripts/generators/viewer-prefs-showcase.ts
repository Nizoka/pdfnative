/**
 * Viewer preferences showcase (v1.4.0).
 *
 * Demonstrates `PdfLayoutOptions.viewerPreferences`: how a conforming viewer
 * presents a document on open — initial /PageLayout, /PageMode, and the
 * /ViewerPreferences flags (display doc title, fit/centre window, hide chrome,
 * reading direction, print scaling). Purely presentational and PDF/A-safe.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, ViewerPreferences } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

const body: DocumentParams['blocks'] = [
    { type: 'heading', text: 'Chapter 1', level: 1 },
    { type: 'paragraph', text: 'Open this PDF and observe the initial presentation chosen by the viewer.' },
    { type: 'pageBreak' },
    { type: 'heading', text: 'Chapter 2', level: 1 },
    { type: 'paragraph', text: 'Two-column continuous layout shows odd pages on the left.' },
    { type: 'pageBreak' },
    { type: 'heading', text: 'Chapter 3', level: 1 },
    { type: 'paragraph', text: 'The window title shows the document title via displayDocTitle.' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── Two-column continuous, bookmark panel, title in titlebar ──
    {
        const viewerPreferences: ViewerPreferences = {
            pageLayout: 'twoColumnLeft',
            pageMode: 'useOutlines',
            displayDocTitle: true,
            fitWindow: true,
            centerWindow: true,
        };
        const params: DocumentParams = {
            title: 'Viewer Preferences — two-column + outlines',
            blocks: body,
            outline: 'auto',
            layout: { viewerPreferences },
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'viewer', 'viewer-twocolumn-outlines.pdf'),
            'viewer/viewer-twocolumn-outlines.pdf',
            buildDocumentPDFBytes(params),
        );
    }

    // ── Full-screen presentation, hidden chrome, RTL reading ──────
    {
        const viewerPreferences: ViewerPreferences = {
            pageLayout: 'singlePage',
            pageMode: 'fullScreen',
            nonFullScreenPageMode: 'useThumbs',
            hideToolbar: true,
            hideMenubar: true,
            direction: 'r2l',
            printScaling: 'none',
        };
        const params: DocumentParams = {
            title: 'Viewer Preferences — fullscreen kiosk',
            blocks: body,
            layout: { viewerPreferences },
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'viewer', 'viewer-fullscreen-kiosk.pdf'),
            'viewer/viewer-fullscreen-kiosk.pdf',
            buildDocumentPDFBytes(params),
        );
    }
}
