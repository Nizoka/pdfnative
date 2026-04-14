/**
 * Font registration for sample generation.
 */

import { registerFonts, loadFontData } from '../../src/index.js';
import type { FontLoader } from '../../src/index.js';
import type { FontEntry, FontData } from '../../src/index.js';

const fl = (loader: () => Promise<unknown>): FontLoader => loader as FontLoader;

export function registerAllFonts(): void {
    registerFonts({
        th: fl(() => import('../../fonts/noto-thai-data.js')),
        ja: fl(() => import('../../fonts/noto-jp-data.js')),
        zh: fl(() => import('../../fonts/noto-sc-data.js')),
        ko: fl(() => import('../../fonts/noto-kr-data.js')),
        el: fl(() => import('../../fonts/noto-greek-data.js')),
        hi: fl(() => import('../../fonts/noto-devanagari-data.js')),
        tr: fl(() => import('../../fonts/noto-turkish-data.js')),
        vi: fl(() => import('../../fonts/noto-vietnamese-data.js')),
        pl: fl(() => import('../../fonts/noto-polish-data.js')),
        ar: fl(() => import('../../fonts/noto-arabic-data.js')),
        he: fl(() => import('../../fonts/noto-hebrew-data.js')),
        ru: fl(() => import('../../fonts/noto-cyrillic-data.js')),
        ka: fl(() => import('../../fonts/noto-georgian-data.js')),
        hy: fl(() => import('../../fonts/noto-armenian-data.js')),
        bn: fl(() => import('../../fonts/noto-bengali-data.js')),
        ta: fl(() => import('../../fonts/noto-tamil-data.js')),
    });
}

export async function loadFontEntries(lang: string, fontRef = '/F3'): Promise<FontEntry[] | undefined> {
    const fd = await loadFontData(lang);
    if (!fd) return undefined;
    return [{ fontData: fd, fontRef, lang }];
}

export async function loadSelectedFontEntries(langs: string[]): Promise<FontEntry[]> {
    const entries: FontEntry[] = [];
    for (let i = 0; i < langs.length; i++) {
        const fd = await loadFontData(langs[i]);
        if (fd) entries.push({ fontData: fd, fontRef: `/F${3 + i}`, lang: langs[i] });
    }
    return entries;
}

export async function loadMultiFontEntries(): Promise<FontEntry[]> {
    return loadSelectedFontEntries(['th', 'ja', 'zh', 'ko', 'el', 'hi', 'tr', 'vi', 'pl', 'ar', 'he', 'ru', 'ka', 'hy', 'bn', 'ta']);
}

export { loadFontData };
export type { FontEntry, FontData };
