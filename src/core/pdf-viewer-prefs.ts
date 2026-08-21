/**
 * pdfnative — Viewer Preferences (ISO 32000-1 §12.2, Table 150 + §7.7.2)
 * ======================================================================
 * Builds the catalog-level `/PageLayout` and `/PageMode` entries plus the
 * `/ViewerPreferences` sub-dictionary that tell a conforming PDF viewer how to
 * present the document when it is first opened: the initial page layout
 * (single page, continuous, two-up…), whether the bookmark/thumbnail panel is
 * shown, window fit/centering, UI-chrome visibility, and whether the window
 * title shows the document title instead of the file name.
 *
 * All entries are optional and purely presentational — they never change page
 * content and are PDF/A-safe.
 *
 * @since 1.4.0
 */

import type { ViewerPreferences } from '../types/pdf-types.js';

/** Initial document page layout → catalog `/PageLayout` name. */
const PAGE_LAYOUT: Record<NonNullable<ViewerPreferences['pageLayout']>, string> = {
    singlePage: 'SinglePage',
    oneColumn: 'OneColumn',
    twoColumnLeft: 'TwoColumnLeft',
    twoColumnRight: 'TwoColumnRight',
    twoPageLeft: 'TwoPageLeft',
    twoPageRight: 'TwoPageRight',
};

/** Initial document page mode → catalog `/PageMode` name. */
const PAGE_MODE: Record<NonNullable<ViewerPreferences['pageMode']>, string> = {
    useNone: 'UseNone',
    useOutlines: 'UseOutlines',
    useThumbs: 'UseThumbs',
    fullScreen: 'FullScreen',
    useOC: 'UseOC',
    useAttachments: 'UseAttachments',
};

/** `/ViewerPreferences /NonFullScreenPageMode` allowed names. */
const NON_FS_PAGE_MODE: Record<NonNullable<ViewerPreferences['nonFullScreenPageMode']>, string> = {
    useNone: 'UseNone',
    useOutlines: 'UseOutlines',
    useThumbs: 'UseThumbs',
    useOC: 'UseOC',
};

/** Resolved catalog fragments for viewer preferences. */
export interface ViewerPreferencesResult {
    /** Resolved `/PageLayout` name (without the leading slash), or `undefined`. */
    readonly pageLayout?: string;
    /** Resolved `/PageMode` name (without the leading slash), or `undefined`. */
    readonly pageMode?: string;
    /**
     * The ` /ViewerPreferences << … >>` catalog fragment (with a leading
     * space), or `''` when no sub-dictionary entries were set.
     */
    readonly dict: string;
}

/**
 * Translate a {@link ViewerPreferences} object into catalog fragments.
 *
 * `/PageLayout` and `/PageMode` are catalog-level keys (not part of the
 * `/ViewerPreferences` dictionary); the remaining flags populate the
 * `/ViewerPreferences` sub-dictionary.
 *
 * @since 1.4.0
 */
export function buildViewerPreferences(prefs: ViewerPreferences): ViewerPreferencesResult {
    const pageLayout = prefs.pageLayout ? PAGE_LAYOUT[prefs.pageLayout] : undefined;
    const pageMode = prefs.pageMode ? PAGE_MODE[prefs.pageMode] : undefined;

    const entries: string[] = [];
    const bool = (key: string, v: boolean | undefined): void => {
        if (v !== undefined) entries.push(`/${key} ${v ? 'true' : 'false'}`);
    };

    bool('HideToolbar', prefs.hideToolbar);
    bool('HideMenubar', prefs.hideMenubar);
    bool('HideWindowUI', prefs.hideWindowUI);
    bool('FitWindow', prefs.fitWindow);
    bool('CenterWindow', prefs.centerWindow);
    bool('DisplayDocTitle', prefs.displayDocTitle);

    if (prefs.nonFullScreenPageMode) {
        entries.push(`/NonFullScreenPageMode /${NON_FS_PAGE_MODE[prefs.nonFullScreenPageMode]}`);
    }
    if (prefs.direction) {
        entries.push(`/Direction /${prefs.direction === 'r2l' ? 'R2L' : 'L2R'}`);
    }
    if (prefs.printScaling) {
        entries.push(`/PrintScaling /${prefs.printScaling === 'none' ? 'None' : 'AppDefault'}`);
    }

    // Print-dialog defaults (ISO 32000-1 §12.2, Table 150; v1.7.0).
    if (prefs.duplex) {
        const DUPLEX: Record<NonNullable<ViewerPreferences['duplex']>, string> = {
            simplex: 'Simplex',
            duplexFlipShortEdge: 'DuplexFlipShortEdge',
            duplexFlipLongEdge: 'DuplexFlipLongEdge',
        };
        entries.push(`/Duplex /${DUPLEX[prefs.duplex]}`);
    }
    bool('PickTrayByPDFSize', prefs.pickTrayByPDFSize);
    if (prefs.printPageRange && prefs.printPageRange.length > 0) {
        for (const [first, last] of prefs.printPageRange) {
            if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) {
                throw new Error('viewerPreferences.printPageRange entries must be 1-based [first, last] pairs with last >= first');
            }
        }
        // The API is 1-based; /PrintPageRange holds 0-based page indices.
        const flat = prefs.printPageRange.map(([first, last]) => `${first - 1} ${last - 1}`).join(' ');
        entries.push(`/PrintPageRange [${flat}]`);
    }
    if (prefs.numCopies !== undefined) {
        if (!Number.isInteger(prefs.numCopies) || prefs.numCopies < 1) {
            throw new Error('viewerPreferences.numCopies must be a positive integer');
        }
        entries.push(`/NumCopies ${prefs.numCopies}`);
    }

    const dict = entries.length > 0 ? ` /ViewerPreferences << ${entries.join(' ')} >>` : '';
    return { pageLayout, pageMode, dict };
}
