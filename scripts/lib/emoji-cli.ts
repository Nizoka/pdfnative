/**
 * EMOJI CLI — pure argument & selection logic
 * ===========================================
 * Side-effect-free helpers for the `pdfnative-build-emoji-font` CLI, split out
 * so they can be unit-tested without a 24 MB font on disk. All I/O (download,
 * read, write) lives in `scripts/build-emoji-font.ts`.
 */

import { CURATED_EMOJI } from './curated-emoji.js';

export interface CliOptions {
    ttf?: string;
    download: boolean;
    all: boolean;
    preset?: string;
    codepoints?: string;
    ranges?: string;
    out: string;
    fontName?: string;
    types: string;
    help: boolean;
}

export const DEFAULT_OUT = 'noto-color-emoji-data.js';
export const DEFAULT_TYPES = 'pdfnative';

export function parseArgs(argv: readonly string[]): CliOptions {
    const opts: CliOptions = {
        download: false,
        all: false,
        out: DEFAULT_OUT,
        types: DEFAULT_TYPES,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`Missing value for ${arg}`);
            return v;
        };
        switch (arg) {
            case '-h': case '--help': opts.help = true; break;
            case '--ttf': opts.ttf = next(); break;
            case '--download': opts.download = true; break;
            case '--all': opts.all = true; break;
            case '--preset': opts.preset = next(); break;
            case '--codepoints': opts.codepoints = next(); break;
            case '--ranges': opts.ranges = next(); break;
            case '--out': opts.out = next(); break;
            case '--font-name': opts.fontName = next(); break;
            case '--types': opts.types = next(); break;
            default: throw new Error(`Unknown option: ${arg} (try --help)`);
        }
    }
    return opts;
}

/** Parse one hex scalar value, tolerating `U+`, `0x`, and `#` prefixes. */
export function parseHex(token: string): number {
    const t = token.trim().replace(/^(u\+|0x|#)/i, '');
    if (!/^[0-9a-f]+$/i.test(t)) throw new Error(`Invalid codepoint: "${token}"`);
    const cp = parseInt(t, 16);
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) {
        throw new Error(`Codepoint out of range: "${token}"`);
    }
    return cp;
}

/**
 * Resolve the full codepoint selection from the parsed flags. `allColor` is a
 * lazy resolver (the font's complete colour-glyph codepoint list), invoked only
 * for `--all` / `--preset all` so callers without a font can still test the
 * curated / explicit paths.
 */
export function resolveCodepoints(opts: CliOptions, allColor: () => number[]): number[] {
    if (opts.all || opts.preset === 'all') return [...allColor()].sort((a, b) => a - b);

    if (opts.preset && opts.preset !== 'curated') {
        throw new Error(`Unknown preset: "${opts.preset}" (use 'curated' or 'all')`);
    }

    const set = new Set<number>();
    let explicit = false;
    if (opts.preset === 'curated') { for (const cp of CURATED_EMOJI) set.add(cp); explicit = true; }
    if (opts.codepoints) {
        for (const tok of opts.codepoints.split(',')) {
            if (tok.trim()) { set.add(parseHex(tok)); explicit = true; }
        }
    }
    if (opts.ranges) {
        for (const tok of opts.ranges.split(',')) {
            if (!tok.trim()) continue;
            const [a, b] = tok.split('-');
            if (a === undefined || b === undefined) throw new Error(`Invalid range: "${tok}"`);
            const lo = parseHex(a); const hi = parseHex(b);
            if (hi < lo) throw new Error(`Range end before start: "${tok}"`);
            if (hi - lo > 0x20000) throw new Error(`Range too large: "${tok}"`);
            for (let cp = lo; cp <= hi; cp++) set.add(cp);
            explicit = true;
        }
    }
    // Default to the curated set when nothing was selected.
    if (!explicit) for (const cp of CURATED_EMOJI) set.add(cp);
    return [...set].sort((a, b) => a - b);
}
