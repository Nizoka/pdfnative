/**
 * pdfnative/tools — Programmatic build-time helpers
 * =================================================
 *
 * A zero-dependency, cross-platform sub-path export exposing the font
 * compilation logic of the `pdfnative-build-font` CLI as importable functions,
 * for serverless / edge / sandboxed / in-browser workflows where spawning a
 * shell is impossible.
 *
 * ```ts
 * import { parseFontData, compileFontData } from 'pdfnative/tools';
 * import { registerFont } from 'pdfnative';
 *
 * const fd = parseFontData(ttfBytes);
 * registerFont('custom', () => Promise.resolve(fd));
 * ```
 *
 * @module pdfnative/tools
 * @since 1.5.0
 */

export {
    parseFontData,
    compileFontData,
} from './font-compiler.js';

export type {
    FontDataObject,
    CompiledFontMetrics,
    CompileFontDataOptions,
    ParseFontDataOptions,
} from './font-compiler.js';
