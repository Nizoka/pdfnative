/**
 * pdfnative — English-only prose detector (v1.8.0)
 * ==================================================
 * The project language is English. Another language may appear only as
 * demonstrated content — a French punctuation convention, a script coverage
 * sample — framed by an English title and marked on or above the line:
 *
 *     // demo-language: fr (punctuationSpacing 'fr' is a French convention)
 *     <!-- demo-language: fr (French guillemets) -->
 *
 * This module is the one definition both guards share: the `prose-language`
 * rule of scripts/verify-docs.ts (docs, README, recipes, release notes) and
 * the regression suite's scan of generators, benchmarks and tests.
 *
 * Detection is deliberately narrow — French is the language that has slipped
 * in — and cheap: a line is flagged when it carries two distinct French
 * function words, one French word from a short list of the terms that
 * appeared in the 1.8.0 samples, or UTF-8 read as Latin-1 (mojibake), which
 * is not a language but the same class of unreviewed text.
 *
 * Skipped by construction: comment lines in TypeScript (`//`, `*`, `/*`),
 * fenced code blocks in Markdown when the fence is preceded by a marker,
 * and any line whose own or preceding line carries `demo-language:` or a
 * `verify-docs:allow prose-language` suppression.
 *
 * @module scripts/lib/prose-language
 */

export interface ProseFinding {
    /** 1-based line number. */
    readonly line: number;
    /** What was matched, for the report. */
    readonly reason: string;
    /** The offending line, trimmed and truncated. */
    readonly snippet: string;
}

/** Marker that exempts a line (and the line after it) as demonstrated content. */
export const DEMO_LANGUAGE_MARKER = 'demo-language:';

/**
 * French function words. Two distinct hits on one line flag it; a single one
 * does not, because English shares `par`, `sur`, `est`, `des` in names and
 * abbreviations.
 */
const FUNCTION_WORDS = /\b(le|la|les|des|une|est|sont|pour|avec|dans|sur|par|qui|que|ne|pas|nous|vous|cette|ces|leur|aussi|très|sans|sous|entre|chaque|tous|toutes|mais|donc|alors|comme|cela|ceci|notre|votre)\b/gi;

/**
 * French words that have no English homograph and that appeared in the
 * samples, docs or fixtures the 1.8.0 audit found.
 */
// "guillemets" is absent on purpose: it is the English typographic term too.
const FRENCH_WORDS = /\b(césure|crénage|métriques?|fonctionnalités?|déclare|aligné|justifié|janvier|février|décembre|débit|crédit|référence|libellé|opérations?|généré|solde|montant|remise|facture|chiffres|ponctuation|paragraphe|colonne|espaces?\s+insécables?|texte|fournisseur|identité|autorisées?|inconnue|ajouter|résumé|relevé|révisé)\b/i;

/** UTF-8 bytes decoded as Latin-1: `â€”` for —, `â‚¬` for €, `Ã©` for é. */
const MOJIBAKE = /â€|â‚¬|Ã[©¨  §ª«¢]/;

const TS_COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

function distinctMatches(re: RegExp, text: string): Set<string> {
    const seen = new Set<string>();
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) seen.add(m[1].toLowerCase());
    return seen;
}

/**
 * Why a line is not English, or `null` when nothing suspicious is on it.
 * Exported for tests and for one-off probes.
 */
export function classifyLine(line: string): string | null {
    if (MOJIBAKE.test(line)) return 'UTF-8 text decoded as Latin-1 (mojibake)';
    const word = FRENCH_WORDS.exec(line);
    if (word) return `French word "${word[0]}"`;
    const fn = distinctMatches(FUNCTION_WORDS, line);
    if (fn.size >= 2) return `French function words ${[...fn].map(w => `"${w}"`).join(', ')}`;
    return null;
}

export interface ProseScanOptions {
    /** `ts` skips comment lines; `md` handles fenced code blocks. Default: by extension. */
    readonly kind?: 'ts' | 'md' | 'other';
    /** Extra suppression marker honoured on the same or previous line (e.g. `verify-docs:allow prose-language`). */
    readonly suppress?: string;
}

/**
 * Scan a file's text and return every unmarked non-English line.
 *
 * @param text     Whole file.
 * @param filename Used to infer the kind when `options.kind` is absent.
 */
export function findNonEnglishProse(text: string, filename: string, options: ProseScanOptions = {}): ProseFinding[] {
    const kind = options.kind ?? (/\.(ts|mts|cts|js|mjs|cjs)$/i.test(filename) ? 'ts' : /\.md$/i.test(filename) ? 'md' : 'other');
    const lines = text.split('\n');
    const findings: ProseFinding[] = [];
    let fenceExempt = false;
    let inFence = false;

    const marked = (i: number): boolean => {
        const here = lines[i] ?? '';
        const above = lines[i - 1] ?? '';
        if (here.includes(DEMO_LANGUAGE_MARKER) || above.includes(DEMO_LANGUAGE_MARKER)) return true;
        if (options.suppress && (here.includes(options.suppress) || above.includes(options.suppress))) return true;
        return false;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (kind === 'md' && /^\s*(```|~~~)/.test(line)) {
            if (!inFence) {
                inFence = true;
                fenceExempt = marked(i);
            } else {
                inFence = false;
                fenceExempt = false;
            }
            continue;
        }
        if (inFence && fenceExempt) continue;
        if (kind === 'ts' && TS_COMMENT_LINE.test(line)) continue;
        if (marked(i)) continue;
        const reason = classifyLine(line);
        if (reason === null) continue;
        const trimmed = line.trim();
        findings.push({ line: i + 1, reason, snippet: trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed });
    }
    return findings;
}
