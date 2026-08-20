/**
 * EMOJI CLI — pure argument & selection logic
 * ===========================================
 * Side-effect-free helpers for the `pdfnative-build-emoji-font` CLI, split out
 * so they can be unit-tested without a 24 MB font on disk. All I/O (download,
 * read, write) lives in `scripts/build-emoji-font.ts`.
 */

import { CURATED_EMOJI } from './curated-emoji.js';
import { CURATED_FLAGS, CURATED_ZWJ, CURATED_SEQUENCES, flagSequence } from './curated-emoji-sequences.js';

export interface CliOptions {
    ttf?: string;
    download: boolean;
    all: boolean;
    preset?: string;
    codepoints?: string;
    ranges?: string;
    /** Named sequence preset: 'flags' | 'zwj' | 'all' | 'none'. (v1.7.0) */
    sequences?: string;
    /** Explicit sequences: country codes and/or hyphen-joined hex scalars. (v1.7.0) */
    sequenceList?: string;
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
            case '--sequences': opts.sequences = next(); break;
            case '--sequence-list': opts.sequenceList = next(); break;
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

/**
 * Resolve the multi-codepoint sequence selection (v1.7.0). Backward
 * compatible: with neither `--sequences` nor `--sequence-list`, no sequence
 * is bundled and the generated module is shaped exactly like pre-1.7 output
 * (plus an inert `sequences = null` export).
 *
 * `--sequences`: `flags` (curated flag set), `zwj` (curated ZWJ set),
 * `all` (both), `none`.
 * `--sequence-list`: comma-separated entries — a 2-letter country code
 * (`FR`, `DE`) or hyphen-joined hex scalars (`1F468-200D-1F680`,
 * `1F3F4-200D-2620-FE0F`).
 */
export function resolveSequences(opts: CliOptions): number[][] {
    const out: number[][] = [];
    if (opts.sequences) {
        switch (opts.sequences) {
            case 'flags': out.push(...CURATED_FLAGS.map(c => [...flagSequence(c)])); break;
            case 'zwj': out.push(...CURATED_ZWJ.map(s => [...s])); break;
            case 'all': out.push(...CURATED_SEQUENCES.map(s => [...s])); break;
            case 'none': break;
            default:
                throw new Error(`Unknown --sequences preset: "${opts.sequences}" (use flags, zwj, all or none)`);
        }
    }
    if (opts.sequenceList) {
        for (const tok of opts.sequenceList.split(',')) {
            const t = tok.trim();
            if (!t) continue;
            if (/^[A-Za-z]{2}$/.test(t)) {
                out.push([...flagSequence(t)]);
            } else {
                const cps = t.split('-').map(parseHex);
                if (cps.length < 2) throw new Error(`Sequence needs at least 2 codepoints: "${tok}"`);
                out.push(cps);
            }
        }
    }
    return out;
}
