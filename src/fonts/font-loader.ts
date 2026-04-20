/**
 * pdfnative — Font Loader
 * =========================
 * Configurable font registry and lazy-loading.
 * Users register font data loaders, which are invoked on demand and cached.
 */

import type { FontData } from '../types/pdf-types.js';

/** Font loader function type — returns a FontData or module with default export */
export type FontLoader = () => Promise<FontData | { default: FontData }>;

/** Global font registry: language code → loader function */
const _fontRegistry = new Map<string, FontLoader>();

/** Cache for loaded font data */
const _fontDataCache = new Map<string, FontData>();

/**
 * Per-FontData decoded binary cache. WeakMap ensures entries are GC'd when FontData
 * is no longer referenced (e.g., after clearFontCache / resetFontRegistry).
 * Avoids re-running base64 decode + charCodeAt loop on every buildPDF() call.
 */
const _fontBinaryCache = new WeakMap<FontData, Uint8Array>();

/**
 * Decode the TTF binary for a FontData object and return a cached Uint8Array.
 * Subsequent calls for the same FontData instance are zero-cost (WeakMap lookup).
 *
 * This is an internal helper used by pdf-builder and pdf-document to feed
 * subsetTTF() the Uint8Array path, skipping the charCodeAt decode loop.
 */
export function getDecodedFontBytes(fontData: FontData): Uint8Array {
    const cached = _fontBinaryCache.get(fontData);
    if (cached) return cached;

    // Decode base64 → Uint8Array (runs once per FontData instance)
    let bytes: Uint8Array;
    if (typeof atob === 'function') {
        const binaryStr = atob(fontData.ttfBase64);
        bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    } else {
        const buf = (globalThis as Record<string, unknown>)['Buffer'] as { from(s: string, e: string): Uint8Array };
        bytes = buf.from(fontData.ttfBase64, 'base64');
    }

    _fontBinaryCache.set(fontData, bytes);
    return bytes;
}

/**
 * Register a font data loader for a language.
 *
 * @example
 * ```ts
 * registerFont('th', () => import('./fonts/noto-thai-data.js'));
 * registerFont('ja', () => import('./fonts/noto-jp-data.js'));
 * ```
 */
export function registerFont(lang: string, loader: FontLoader): void {
    _fontRegistry.set(lang, loader);
}

/**
 * Register multiple font loaders at once.
 *
 * @example
 * ```ts
 * registerFonts({
 *   th: () => import('./fonts/noto-thai-data.js'),
 *   ja: () => import('./fonts/noto-jp-data.js'),
 * });
 * ```
 */
export function registerFonts(fonts: Record<string, FontLoader>): void {
    for (const [lang, loader] of Object.entries(fonts)) {
        _fontRegistry.set(lang, loader);
    }
}

/**
 * Lazy-load pre-built font data for a language.
 * Returns cached data if already loaded. Retries once on failure.
 *
 * @param lang - Language code (e.g. 'th', 'ja', 'zh')
 * @returns Font data or null if unavailable
 */
export async function loadFontData(lang: string): Promise<FontData | null> {
    const cached = _fontDataCache.get(lang);
    if (cached) return cached;

    const loader = _fontRegistry.get(lang);
    if (!loader) return null;

    // Retry once after 500ms to handle cache race on fresh install
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const mod = await loader();
            // Support both direct FontData and ES module default export
            const fontData = ('default' in mod) ? mod.default : mod;
            _fontDataCache.set(lang, fontData as FontData);
            return fontData as FontData;
        } catch {
            if (attempt === 0) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }
    return null;
}

/**
 * Check if a font loader is registered for the given language.
 */
export function hasFontLoader(lang: string): boolean {
    return _fontRegistry.has(lang);
}

/**
 * Get all registered language codes.
 */
export function getRegisteredLangs(): string[] {
    return [..._fontRegistry.keys()];
}

/**
 * Clear font cache (useful for testing).
 */
export function clearFontCache(): void {
    _fontDataCache.clear();
}

/**
 * Clear all registered fonts and cache (useful for testing).
 */
export function resetFontRegistry(): void {
    _fontRegistry.clear();
    _fontDataCache.clear();
}
