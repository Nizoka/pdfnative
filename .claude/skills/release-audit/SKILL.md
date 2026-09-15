---
name: release-audit
description: Pre-release audit of pdfnative — two parallel auditors (claims vs code; docs, counters and machine surfaces), an adversarial verifier, a docs-autonomy pass and a GO/NO-GO ledger under test-output/.audit/<version>/. Run by the maintainer before every release; never invoked by the model on its own.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(npm run *), Bash(npx tsx scripts/*), Bash(npx vitest *), Bash(git diff*), Bash(git log*), Bash(git show*), Agent
argument-hint: [release-notes/vX.Y.Z.md] [previous-tag]
---

# Release audit

Audit the release described by `$0` (default: the newest `release-notes/v*.md`) against everything that changed since `$1` (default: the previous `v*` tag from `git tag -l`). The audit produces findings, never fixes: every fix goes through the normal edit → gate loop afterwards, and the ledger records what was fixed.

Read `ledger.md` first for the ledger and verdict formats. Each phase below hands a template to the agents it spawns; the agents return findings, you file them.

## Ledger location

`test-output/.audit/<version>/` — `test-output/` is git-ignored (check `.gitignore` covers it before writing), so nothing here is ever committed. One Markdown file per report: auditor-a, auditor-b, verifier-1, auditor-d, verifier-2, then the ledger and the verdict (formats in `ledger.md`).

## Phase A and B — two auditors, in parallel

Spawn both with the Agent tool in the same message (distinct angles; neither sees the other's report):

- **Auditor A — claims vs code.** Template: `auditor-a.md`. Every claim in the release note and the top CHANGELOG entry is checked against `src/`, `tests/` and the sample generators; at least one assertion per claim is *reproduced with a command* (a test, a script, a sample byte count), not inferred from reading.
- **Auditor B — docs and machine surfaces.** Template: `auditor-b.md`. Guides, README recipes, `docs/assets/ecosystem.json` counters, `docs/data/*.json`, `llms.txt`, `docs/agent-brief.md`, playground presets, downstream integration notes — every surface an agent or a downstream package reads — compared with the behaviour that actually shipped.

Both write their report in the finding format of `ledger.md` (id, severity, claim, evidence command, observed, expected).

## Phase C — adversarial verifier

Spawn one verifier (template: `verifier.md`) with both reports. It re-derives every finding from scratch — re-runs the evidence command, reads the cited lines — and stamps each one `CONFIRMED | DOWNGRADED | REJECTED | DUPLICATE` with a one-line justification. Auditors have about 10 % false findings; the verifier exists to keep them out of the ledger. A finding the verifier cannot reproduce is `REJECTED`, not "probably fine".

## Phase D — docs autonomy pass, then verify

Spawn Auditor D (template: `auditor-b.md`, section "Autonomy pass") with one question: *can an agent that has only the published docs (`docs/`, `llms.txt`, `docs/llms-full.txt`, `docs/agent-brief.md`, the recipes) use every 1.x feature without reading `src/`?* It picks every feature the release note names plus a sample of older ones, writes the call it would make from the docs alone, and runs it. Then a second verifier pass (template: `verifier.md`) over its findings.

## Phase E — GO / NO-GO

Merge the confirmed findings into the ledger, then write the verdict file (both formats are in `ledger.md`):

- **GO** — no CONFIRMED finding of severity `blocker`; every `major` has a fix commit or an explicit maintainer waiver in the ledger.
- **NO-GO** — otherwise. List the blockers first, each with its evidence command, so the fix loop starts from the ledger, not from memory.

Report the verdict, the counts per severity and per stamp, and the ledger path. Do not push, tag, open a PR or publish: `release-prepare.ts` and the maintainer take over from `GO`.

## Known blind spots

Add a check for each of these to the auditor briefs; they are where the last two audits missed something.

- Machine surfaces lag behind prose: `docs/data/errors.json`, `docs/data/surfaces.json`, `docs/data/playgrounds.json`, `docs/llms-index.json` and `docs/agent-brief.md` are updated after the guides, and sometimes not at all.
- Playground presets go stale: a preset that calls an option the release renamed still renders the old output silently.
- README recipes drift from behaviour changes: a recipe that still runs is not a recipe that still demonstrates the documented behaviour.
- Regex-driven `verify:docs` rules are blind to wording: they prove counts, versions, links and presence, never that a sentence is true.
- CI assumptions live outside the repo: trusted publishing needs npm >= 11.5.1 on the runner; a green local gate proves nothing about the publish job.
- Auditors have ~10 % false findings — never file an unverified finding, and never let a `REJECTED` one reach the verdict.
- Publish-related strings in a Bash command trip the guard hook (`.claude/hooks/guard.mjs`): anything containing `npm publish`, `gh release`, `git push` or `git tag <name>` inside a segment, a `$( )`, or an interpreter payload is refused. Write such strings into files with Edit or Write, never through `echo` or a heredoc.
