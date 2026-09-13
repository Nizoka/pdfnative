// .claude/hooks/guard.mjs — Claude Code PreToolUse hook (matcher: Bash).
//
// Enforces the human-in-the-loop gate of .github/AGENT_RULES.md §5 at the
// tool boundary: an agent may prepare a release, a PR body or an issue draft,
// but the maintainer is the one who publishes, pushes with force, or opens
// anything on GitHub. Claude Code pipes `{ tool_name, tool_input: { command } }`
// on stdin; printing a `permissionDecision: "deny"` payload (exit 0) blocks the
// call and shows the reason to the agent, while exit 0 with no output allows it.
// The command is checked as a whole and per `&&` / `||` / `;` / `|` segment, so
// `cd x && gh pr create` is caught. Plain Node ESM, zero dependencies.

const RULES = [
    { re: /^npm\s+publish\b/, what: '`npm publish`' },
    { re: /^gh\s+pr\s+create\b/, what: '`gh pr create`' },
    { re: /^gh\s+issue\s+create\b/, what: '`gh issue create`' },
    { re: /^gh\s+release\b/, what: '`gh release`' },
    { re: /^git\s+(?:-C\s+\S+\s+)?push\b.*(?:\s--force(?:-with-lease)?\b|\s-f\b)/, what: '`git push --force`' },
    { re: /^git\s+(?:-C\s+\S+\s+)?add\b.*\s--renormalize\b/, what: '`git add --renormalize`' },
];

function deny(what) {
    const payload = {
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
                `Human-in-the-loop gate (.github/AGENT_RULES.md §5): ${what} is submitted by the maintainer, not by an agent.`,
        },
    };
    process.stdout.write(JSON.stringify(payload));
}

function segments(command) {
    return command
        .split(/&&|\|\||;|\|/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    raw += chunk;
});
process.stdin.on('end', () => {
    let input;
    try {
        input = JSON.parse(raw);
    } catch {
        process.exit(0);
    }
    const command = input?.tool_input?.command;
    if (typeof command !== 'string') process.exit(0);
    const candidates = [command.trim(), ...segments(command)];
    for (const candidate of candidates) {
        for (const rule of RULES) {
            if (rule.re.test(candidate)) {
                deny(rule.what);
                process.exit(0);
            }
        }
    }
    process.exit(0);
});
