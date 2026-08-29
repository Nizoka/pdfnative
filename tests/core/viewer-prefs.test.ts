/**
 * Tests for ViewerPreferences (v1.4.0) — catalog `/PageLayout`, `/PageMode`
 * and the `/ViewerPreferences` sub-dictionary.
 *
 * Covers the pure builder, document-level integration, outline+pageMode
 * precedence, and the byte-stable path when no preferences are supplied.
 */

import { describe, it, expect } from 'vitest';
import { buildViewerPreferences } from '../../src/core/pdf-viewer-prefs.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { ViewerPreferences } from '../../src/types/pdf-types.js';

function bytesToLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

// ── Unit: builder ────────────────────────────────────────────────────

describe('buildViewerPreferences', () => {
    it('maps page layout and page mode to catalog names', () => {
        const r = buildViewerPreferences({ pageLayout: 'twoColumnLeft', pageMode: 'useOutlines' });
        expect(r.pageLayout).toBe('TwoColumnLeft');
        expect(r.pageMode).toBe('UseOutlines');
    });

    it('emits boolean flags in the /ViewerPreferences dict', () => {
        const r = buildViewerPreferences({ hideToolbar: true, fitWindow: true, displayDocTitle: true });
        expect(r.dict).toContain('/ViewerPreferences <<');
        expect(r.dict).toContain('/HideToolbar true');
        expect(r.dict).toContain('/FitWindow true');
        expect(r.dict).toContain('/DisplayDocTitle true');
    });

    it('encodes false explicitly', () => {
        const r = buildViewerPreferences({ centerWindow: false });
        expect(r.dict).toContain('/CenterWindow false');
    });

    it('maps NonFullScreenPageMode, Direction and PrintScaling', () => {
        const r = buildViewerPreferences({
            nonFullScreenPageMode: 'useThumbs',
            direction: 'r2l',
            printScaling: 'none',
        });
        expect(r.dict).toContain('/NonFullScreenPageMode /UseThumbs');
        expect(r.dict).toContain('/Direction /R2L');
        expect(r.dict).toContain('/PrintScaling /None');
    });

    it('returns an empty dict when only layout/mode are set', () => {
        const r = buildViewerPreferences({ pageLayout: 'singlePage' });
        expect(r.dict).toBe('');
        expect(r.pageLayout).toBe('SinglePage');
    });

    it('returns empty fragments for an empty object', () => {
        const r = buildViewerPreferences({});
        expect(r.dict).toBe('');
        expect(r.pageLayout).toBeUndefined();
        expect(r.pageMode).toBeUndefined();
    });
});

// ── Integration ──────────────────────────────────────────────────────

describe('document viewer preferences integration', () => {
    // Pin the date so repeated builds embed the same /CreationDate (and thus
    // the same content-derived /ID) — without this the byte-identical test
    // flakes when two calls straddle a second boundary (same pattern as
    // pdf-stream-pagebypage.test.ts). Merged into the single layout object
    // rather than passed as a second argument, because layoutOptions REPLACES
    // params.layout and would silently drop viewerPreferences.
    const PINNED = new Date('2026-01-01T00:00:00.000Z');

    function doc(viewerPreferences?: ViewerPreferences, extra?: Partial<DocumentParams>): string {
        const params: DocumentParams = {
            title: 'VP',
            blocks: [
                { type: 'heading', text: 'One', level: 1 },
                { type: 'paragraph', text: 'p' },
            ],
            ...extra,
        };
        const withVp: DocumentParams = {
            ...params,
            layout: {
                ...params.layout,
                creationDate: PINNED,
                ...(viewerPreferences ? { viewerPreferences } : {}),
            },
        };
        return bytesToLatin1(buildDocumentPDFBytes(withVp));
    }

    it('injects /PageLayout, /PageMode and /ViewerPreferences into the catalog', () => {
        const pdf = doc({ pageLayout: 'twoColumnLeft', pageMode: 'useThumbs', hideToolbar: true });
        expect(pdf).toContain('/PageLayout /TwoColumnLeft');
        expect(pdf).toContain('/PageMode /UseThumbs');
        expect(pdf).toContain('/ViewerPreferences << /HideToolbar true >>');
    });

    it('lets an explicit viewer pageMode win over the outline default', () => {
        const pdf = doc({ pageMode: 'useThumbs' }, { outline: 'auto' });
        expect(pdf).toContain('/PageMode /UseThumbs');
        expect(pdf).not.toContain('/PageMode /UseOutlines');
        expect(pdf).toContain('/Outlines');
    });

    it('keeps the outline /PageMode /UseOutlines when viewer prefs set no pageMode', () => {
        const pdf = doc({ pageLayout: 'singlePage' }, { outline: 'auto' });
        expect(pdf).toContain('/PageMode /UseOutlines');
        expect(pdf).toContain('/PageLayout /SinglePage');
    });

    it('does not emit viewer keys when unset (byte-stable path)', () => {
        const pdf = doc();
        expect(pdf).not.toContain('/ViewerPreferences');
        expect(pdf).not.toContain('/PageLayout');
    });

    it('produces byte-identical output when no viewer prefs are supplied', () => {
        const a = doc();
        const b = doc();
        expect(a).toBe(b);
    });
});
