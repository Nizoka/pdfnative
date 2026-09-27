/**
 * Locate a Chromium-family browser (Chrome, Chromium, Edge) for headless use
 * ==========================================================================
 * Used by `scripts/verify-diagrams.ts` and by the gate's skip condition. No
 * download, no npm dependency: an installed browser or nothing.
 * `CHROME_PATH`, when set, is used as is and replaces the search.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
