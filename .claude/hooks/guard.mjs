// .claude/hooks/guard.mjs — Claude Code PreToolUse hook (matcher: Bash).
//
// Enforces the human-in-the-loop gate of .github/AGENT_RULES.md §5 at the
// tool boundary: an agent may prepare a release, a PR body or an issue draft,
// but the maintainer is the one who publishes, pushes, tags, or opens or edits
// anything on GitHub. Claude Code pipes `{ tool_name, tool_input: { command } }`
// on stdin; printing a `permissionDecision: "deny"` payload (exit 0) blocks the
// call and shows the reason to the agent, while exit 0 with no output allows it.
//
// The command is checked as a whole, per shell segment (`&&`, `||`, `;`, `|`,
// `&`, newline), inside `$( … )` and backticks, and inside the payload of
// `sh -c`, `bash -c`, `zsh -c`, `pwsh -Command`, `powershell -c`, `node -e`
// and `npx -c` — so `cd x && gh pr create` and `bash -c 'git push'` are both
// caught. Every rule is anchored at the start of a candidate, after optional
// `VAR=value`, `env`, `time`, `nohup`, `xargs` and `sudo` prefixes, so prose
// that merely mentions a forbidden command in an `echo` argument is allowed.
//
// The module is import-safe: `RULES`, `candidates()` and `decide()` are pure
// and unit-tested by tests/tools/guard.test.ts; the stdin main only runs when
// the file is the program entry. Plain Node ESM, zero dependencies.
//
// Fail closed: unreadable stdin or malformed JSON produce a deny payload and
// exit 2 (a blocking hook error); a well-formed payload without a command is
// not a Bash call and is allowed.

import { fileURLToPath } from 'node:url';

/** `git` global options that may precede the subcommand. */
const GIT_OPTS = String.raw`(?:(?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--no-pager|--no-optional-locks)\s+)*`;

/** `npm` / `npx` flags that may precede the subcommand (no separate value). */
const NPM_FLAGS = String.raw`(?:-\S+\s+)*`;

/** End of a subcommand word: whitespace or end of input (`push-dummy` is not `push`). */
const END = String.raw`(?=\s|$)`;

const NPM_WRITE = String.raw`(?:publish|unpublish|deprecate|dist-tag|version)${END}`;

/**
 * Each rule is tried against every candidate (see `candidates()`), anchored at
 * the start once the launch prefixes have been stripped. `what` is quoted in
 * the deny reason; `allow`, when present, exempts a match (read-only forms).
 *
 * @type {ReadonlyArray<{ re: RegExp; what: string; allow?: RegExp }>}
 */
export const RULES = Object.freeze([
    {
        re: new RegExp(String.raw`^npm\s+${NPM_FLAGS}${NPM_WRITE}`),
        // A bare `npm version` only prints the version table; with an argument it
        // bumps package.json and creates a tag.
        allow: new RegExp(String.raw`^npm\s+${NPM_FLAGS}version\s*$`),
        what: '`npm publish` / `unpublish` / `deprecate` / `dist-tag` / `version <bump>`',
    },
    { re: new RegExp(String.raw`^npx\s+${NPM_FLAGS}npm(?:@\S+)?\s+${NPM_FLAGS}${NPM_WRITE}`), what: '`npx npm publish` (and its siblings)' },
    { re: /^gh\s+pr\s+(?:create|edit|close|merge|comment)\b/, what: '`gh pr create` / `edit` / `close` / `merge` / `comment`' },
    { re: /^gh\s+issue\s+(?:create|edit|close|comment)\b/, what: '`gh issue create` / `edit` / `close` / `comment`' },
    { re: /^gh\s+release\b/, what: '`gh release`' },
    {
        re: /^gh\s+api\b(?=.*(?:\s(?:--method|-X)(?:[\s=]+)(?:POST|PUT|PATCH|DELETE)\b|\s--input\b|\s(?:-f|-F|--field|--raw-field)(?:\s|=|$)))/i,
        what: '`gh api` with a writing method or a request body',
    },
    { re: new RegExp(String.raw`^git\s+${GIT_OPTS}push${END}`), what: '`git push`' },
    { re: new RegExp(String.raw`^git\s+${GIT_OPTS}add${END}.*\s--renormalize${END}`), what: '`git add --renormalize`' },
    {
        re: new RegExp(String.raw`^git\s+${GIT_OPTS}tag${END}`),
        // Bare `git tag`, `-l`/`--list`, `-n[<num>]` and the other list-only
        // switches read the tag list; everything else creates, moves or deletes.
        allow: new RegExp(
            String.raw`^git\s+${GIT_OPTS}tag(?:\s+(?:-l|--list|-n\d*|-i|--ignore-case|--column|--no-column|--sort=\S+|--format=\S+` +
            String.raw`|(?:--contains|--no-contains|--points-at|--merged|--no-merged)(?:\s+\S+)?|\S*\*\S*))*\s*$`,
        ),
        what: '`git tag`',
    },
]);

/** Launch prefixes that do not change what the command does. */
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
const WRAPPER = /^(?:(?:env|time|nohup|xargs|exec|command)\s+(?:-\S+\s+)*|sudo\s+(?:-[ugCDhpRTU]\s+\S+\s+|-\S+\s+)*)/;

/** Strip `FOO=bar`, `env -i`, `time`, `nohup`, `xargs -0`, `sudo -u x` … prefixes. */
export function stripPrefixes(candidate) {
    let s = candidate.trim();
    for (let i = 0; i < 16; i++) {
        const before = s;
        s = s.replace(ENV_ASSIGN, '').replace(WRAPPER, '');
        if (s === before) break;
    }
    return s;
}

const SPLIT = /&&|\|\||;|\||&|\r?\n/;

/** Unescape a double-quoted shell string body (`\"`, `\\`, `\$`, `` \` ``). */
function unescapeDouble(body) {
    return body.replace(/\\(["\\$`])/g, '$1');
}

/** Unescape a single-quoted shell string body (only the `'\''` idiom). */
function unescapeSingle(body) {
    return body.replace(/'\\''/g, "'");
}

const QUOTED = String.raw`(?:'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(\S+))`;
/** PowerShell takes the rest of the line as the command when it is unquoted. */
const QUOTED_OR_REST = String.raw`(?:'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(.+))`;

/** Interpreters whose next quoted argument is a program in its own right. */
const INTERPRETERS = [
    // sh -c '…', bash -lc "…", zsh -c …, dash -c …
    new RegExp(String.raw`(?:^|\s)(?:sh|bash|zsh|dash|ksh)\s+(?:-[A-Za-z]*[^c\s-]\S*\s+|--\S+\s+)*-[A-Za-z]*c\s+${QUOTED}`, 'g'),
    // pwsh -c …, powershell -Command "…", powershell.exe -NoProfile -Command …
    new RegExp(String.raw`(?:^|\s)(?:pwsh|powershell)(?:\.exe)?\s+(?:-(?!c\b|Command\b)\S+(?:\s+(?!-)\S+)?\s+)*-(?:c|Command)\s+${QUOTED_OR_REST}`, 'gi'),
    // node -e '…', node --eval "…", node -p …
    new RegExp(String.raw`(?:^|\s)node(?:\.exe)?\s+(?:-\S+\s+)*?(?:-e|--eval|-p|--print)\s+${QUOTED}`, 'g'),
    // npx -c '…', npx --call "…"
    new RegExp(String.raw`(?:^|\s)npx\s+(?:-\S+\s+)*?(?:-c|--call)\s+${QUOTED}`, 'g'),
];

/** The string literals of a JavaScript / PowerShell payload — `execSync('git push')`. */
const LITERALS = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** `$( … )` (one level of nested parentheses) and backtick substitutions. */
const SUBSTITUTIONS = [/\$\(((?:[^()]|\([^()]*\))*)\)/g, /`([^`]*)`/g];

/**
 * Every fragment of `command` that could be a program by itself: the whole
 * command, each shell segment, each command substitution, each interpreter
 * payload, and the string literals inside those payloads.
 *
 * @param {string} command
 * @returns {string[]}
 */
export function candidates(command) {
    const out = new Set();
    collect(command, out, 0);
    return [...out];
}

function collect(text, out, depth) {
    if (typeof text !== 'string' || depth > 4) return;
    const whole = text.trim();
    if (whole.length === 0) return;
    add(whole, out);
    for (const seg of whole.split(SPLIT)) add(seg.trim(), out);
    for (const re of SUBSTITUTIONS) {
        for (const m of whole.matchAll(re)) collect(m[1], out, depth + 1);
    }
    for (const re of INTERPRETERS) {
        for (const m of whole.matchAll(re)) {
            const payload = m[1] !== undefined ? unescapeSingle(m[1]) : m[2] !== undefined ? unescapeDouble(m[2]) : m[3];
            collect(payload, out, depth + 1);
            for (const lit of payload.matchAll(LITERALS)) {
                collect(lit[1] ?? lit[2] ?? lit[3], out, depth + 1);
            }
        }
    }
}

function add(candidate, out) {
    // `(cd x; git push)` and `{ git push; }` — the grouping punctuation is not
    // part of the command word.
    const bare = candidate.replace(/^[({\s]+|[)}\s]+$/g, '');
    if (bare.length > 0) out.add(bare);
}

/**
 * The verdict for one Bash command.
 *
 * @param {string} command
 * @returns {{ deny: boolean; what?: string }}
 */
export function decide(command) {
    if (typeof command !== 'string') return { deny: false };
    for (const candidate of candidates(command)) {
        const normalised = stripPrefixes(candidate);
        for (const rule of RULES) {
            if (!rule.re.test(normalised)) continue;
            if (rule.allow !== undefined && rule.allow.test(normalised)) continue;
            return { deny: true, what: rule.what };
        }
    }
    return { deny: false };
}

/** The Claude Code deny payload; `reason` is shown to the agent verbatim. */
export function denyPayload(reason) {
    return {
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
        },
    };
}

export function reasonFor(what) {
    return `Human-in-the-loop gate (.github/AGENT_RULES.md §5): ${what} is submitted by the maintainer, not by an agent.`;
}

// ── stdin main ───────────────────────────────────────────────────────

function main() {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
        raw += chunk;
    });
    process.stdin.on('error', (err) => failClosed(`stdin could not be read (${err.message})`));
    process.stdin.on('end', () => {
        let input;
        try {
            input = JSON.parse(raw);
        } catch (err) {
            failClosed(`the hook payload is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
            return;
        }
        const command = input?.tool_input?.command;
        if (typeof command !== 'string') {
            process.exit(0);
        }
        const verdict = decide(command);
        if (verdict.deny) {
            process.stdout.write(JSON.stringify(denyPayload(reasonFor(verdict.what))));
        }
        process.exit(0);
    });
}

function failClosed(why) {
    const reason = `guard.mjs could not evaluate this command and denies it (fail closed): ${why}.`;
    process.stdout.write(JSON.stringify(denyPayload(reason)));
    process.stderr.write(`${reason}\n`);
    process.exit(2);
}

// Run only when invoked directly (keeps the module import-safe for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
