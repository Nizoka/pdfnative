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
 * the regression suite's scan of generators, sample data, benchmarks and
 * tests.
 *
 * What it detects, and what it does not
 * -------------------------------------
 * A line is flagged when it carries two distinct lowercase function words
 * of one Latin-script language that shares an alphabet with English —
 * French, Spanish, Italian, Portuguese or German — or one word from a short
 * French list (the language that actually slipped into 1.8.0), or UTF-8
 * decoded as Latin-1 (mojibake), which is not a language but the same class
 * of unreviewed text. Every list is filtered against English homographs,
 * HTML tag names and domain fragments (no `is`, `as`, `over`, `per`, `em`,
 * `com`), and against this repository's own vocabulary (no `der` — DER
 * encoding — and no `mit` — the licence). Word boundaries are Unicode-aware,
 * so `est` never matches inside `está`. Only lowercase tokens count: a
 * capitalised token mid-line is a proper name (`Noto Sans Tai Le`).
 *
 * Turkish, Vietnamese, Polish and every non-Latin script are NOT detected:
 * they live in sample data records that carry their own `lang` label and
 * are demonstration content by nature. The written rule (AGENTS.md) says so.
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

interface LanguageProfile {
    readonly tag: string;
    readonly name: string;
    /** Lowercase function words; two distinct hits on one line flag it. */
    readonly words: readonly string[];
}

/**
 * Function words per language. Shared articles (`la`, `que`, `una`, `des`)
 * appear in several lists on purpose: the language with the most distinct
 * hits wins the label, and a line flagged under the wrong sibling language
 * is still correctly flagged as not English.
 */
const LANGUAGES: readonly LanguageProfile[] = [
    {
        tag: 'fr', name: 'French',
        words: ['le', 'la', 'les', 'des', 'une', 'est', 'sont', 'pour', 'avec', 'dans', 'sur', 'par', 'qui', 'que', 'ne', 'pas',
            'nous', 'vous', 'cette', 'ces', 'leur', 'aussi', 'très', 'sans', 'sous', 'entre', 'chaque', 'tous', 'toutes', 'mais',
            'donc', 'alors', 'comme', 'cela', 'ceci', 'notre', 'votre'],
    },
    {
        tag: 'es', name: 'Spanish',
        words: ['el', 'la', 'los', 'las', 'una', 'unos', 'unas', 'está', 'están', 'pero', 'porque', 'muy', 'también', 'sobre',
            'entre', 'cada', 'todo', 'todos', 'todas', 'hasta', 'desde', 'nosotros', 'ustedes', 'ellos', 'ellas', 'esta', 'estos',
            'estas', 'aquí', 'allí', 'dónde', 'cuándo', 'cómo', 'qué', 'más', 'siempre', 'nunca', 'aún', 'que'],
    },
    {
        tag: 'it', name: 'Italian',
        words: ['lo', 'gli', 'una', 'uno', 'degli', 'delle', 'della', 'dello', 'nella', 'nello', 'nelle', 'negli', 'sono', 'però',
            'perché', 'anche', 'molto', 'sempre', 'questo', 'questa', 'questi', 'queste', 'quello', 'quella', 'dove', 'quando',
            'più', 'già', 'così', 'ogni', 'tutti', 'tutte', 'senza', 'che'],
    },
    {
        tag: 'pt', name: 'Portuguese',
        words: ['uma', 'umas', 'uns', 'são', 'também', 'muito', 'sempre', 'nunca', 'porque', 'sobre', 'entre', 'cada', 'todos',
            'todas', 'até', 'desde', 'nós', 'eles', 'elas', 'esta', 'estes', 'estas', 'aqui', 'ali', 'onde', 'quando', 'mais',
            'já', 'ainda', 'então', 'pelo', 'pela', 'pelos', 'pelas', 'não', 'está', 'estão', 'que'],
    },
    {
        tag: 'de', name: 'German',
        words: ['und', 'nicht', 'ist', 'sind', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen', 'das', 'dem', 'auf', 'aus',
            'für', 'von', 'zu', 'nach', 'über', 'unter', 'zwischen', 'wenn', 'aber', 'oder', 'auch', 'noch', 'nur', 'sehr',
            'schon', 'immer', 'wird', 'werden', 'wurde', 'kann', 'können', 'muss', 'haben', 'sich', 'dieser', 'diese', 'dieses',
            'jeder', 'jede', 'jedes', 'alle', 'keine', 'kein'],
    },
];

/**
 * French words that have no English homograph and that appeared in the
 * samples, docs or fixtures the 1.8.0 audit found. One hit flags the line
 * regardless of case: titles were the failure mode ("Crénage").
 * "guillemets" is absent on purpose: it is the English typographic term too.
 */
const FRENCH_WORDS = /(?<![\p{L}\p{N}])(césure|crénage|métriques?|fonctionnalités?|déclare|aligné|justifié|janvier|février|décembre|débit|crédit|référence|libellé|opérations?|généré|solde|montant|remise|facture|chiffres|ponctuation|paragraphe|colonne|espaces?\s+insécables?|texte|fournisseur|identité|autorisées?|inconnue|ajouter|relevé|révisé)(?![\p{L}\p{N}])/iu;

/** UTF-8 bytes decoded as Latin-1: `â€”` for —, `â‚¬` for €, `Ã©` for é. */
const MOJIBAKE = /â€|â‚¬|Ã[©¨  §ª«¢]/;

const TS_COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** Every lowercase word token of the line, with Unicode-aware boundaries. */
const LOWER_TOKEN = /(?<![\p{L}\p{N}])(\p{Ll}[\p{Ll}\p{M}]*)(?![\p{L}\p{N}])/gu;

const WORD_SETS: readonly { readonly profile: LanguageProfile; readonly set: ReadonlySet<string> }[] =
    LANGUAGES.map(profile => ({ profile, set: new Set(profile.words) }));

/**
 * Why a line is not English, or `null` when nothing suspicious is on it.
 * Exported for tests and for one-off probes.
 */
export function classifyLine(line: string): string | null {
    if (MOJIBAKE.test(line)) return 'UTF-8 text decoded as Latin-1 (mojibake)';
    const word = FRENCH_WORDS.exec(line);
    if (word) return `French word "${word[0]}"`;

    const tokens = new Set<string>();
    for (const m of line.matchAll(LOWER_TOKEN)) tokens.add(m[1]);
    if (tokens.size < 2) return null;

    let best: { readonly profile: LanguageProfile; readonly hits: string[] } | null = null;
    for (const { profile, set } of WORD_SETS) {
        const hits = [...tokens].filter(t => set.has(t));
        if (hits.length >= 2 && (best === null || hits.length > best.hits.length)) best = { profile, hits };
    }
    if (best === null) return null;
    return `${best.profile.name} function words ${best.hits.map(w => `"${w}"`).join(', ')}`;
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
