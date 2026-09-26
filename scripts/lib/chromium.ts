/**
 * Locate a Chromium-family browser (Chrome, Chromium, Edge) for headless use
 * ==========================================================================
 * Used by `scripts/verify-diagrams.ts` and by the gate's skip condition. No
 * download, no npm dependency: an installed browser or nothing.
 * `CHROME_PATH` overrides the search.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

function candidates(): string[] {
    const env = process.env;
    const out: string[] = [];
    if (env['CHROME_PATH']) out.push(env['CHROME_PATH']);
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
    for (const path of candidates()) {
        if (existsSync(path)) return path;
    }
    return null;
}
