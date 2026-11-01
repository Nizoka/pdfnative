---
name: satellite-align
description: Align the companion docs (guides, use cases, playgrounds, surfaces.json, ecosystem.json) with new pdfnative-cli / pdfnative-mcp / pdfnative-react releases from the facts sheet that scripts/satellite-sync.ts generates — writers never read satellite source, one reviewer checks behavioural claims only. Run by the maintainer after a satellite release; never invoked by the model on its own.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npm run *), Bash(npx tsx scripts/*), Bash(npx vitest *), Bash(git diff*), Bash(git log*), Bash(git show*), Bash(git status*), Agent
argument-hint: cli=<version> mcp=<version> react=<version>
---

# Satellite alignment

Align pdfnative.dev and the repository docs on the satellite versions given as `cli=`, `mcp=` and `react=` (any subset; an omitted package keeps its manifest version). The pass is mechanical wherever `verify:docs` can hold the fact, and written by agents only where prose must change. Budget target: about 1 M subagent tokens for a three-package bump — the facts sheet replaces exploration, the worklist replaces planning, and the rules replace the counting audit.

## 0. Preconditions

- The satellite checkouts sit beside this repository (`../pdfnative-cli`, `../pdfnative-mcp`, `../pdfnative-react`) at the released tags, each with `npm ci` done; a different location is passed with `--cli`, `--mcp`, `--react`.
- `git status` is clean here and the work happens on a `docs/<topic>` branch, never on `main`.
- Nothing in this skill pushes, tags or publishes (`.claude/hooks/guard.mjs` refuses those anyway).

## 1. Facts, mechanical edits, worklist

Run once:

```bash
npx tsx scripts/satellite-sync.ts --expect cli=<v> mcp=<v> react=<v> --capture --apply --worklist
```

It writes the facts sheet *facts.md* (+ *facts.json*) under `test-output/.satellites/`, applies every edit a rule can prove (manifest rows and `counts`, `versions.js`, JSON-LD, badges, importmaps, the `pdfnative-react` devDependency, the README ecosystem row, the `llms.txt` lines, the six stamps) and writes *worklist.md* beside it: the remaining `verify:docs` findings grouped by batch, the blind-spot rows that still disagree, and the per-package delta lists. Run `npm install` if the script printed it. A satellite whose checkout carries `<satellite>/docs/assets/surface.json` is read in contract mode; otherwise the script derives the surface from the package's own artefacts and lists what it could not derive under "Unverified".

## 2. Coordinator reads only the facts and the worklist

Read *facts.md* and *worklist.md*. Do not read satellite `src/`, READMEs, release notes or CHANGELOGs — a fact that is missing from *facts.md* is a gap in `scripts/lib/satellite-surface.ts`, to be fixed there (and its test), not looked up by hand.

## 3. Writers — at most eight, one batch each

Spawn one Agent per non-empty batch of the worklist (B1 `docs/guides/cli.md`, B2 `docs/guides/mcp.md`, B3 `docs/guides/react.md`, B4 `docs/data/surfaces.json` + `docs/guides/choose.md`, B5 use-case guides and their diagrams, B6 README / homepage / `docs/agent-brief.md` / `llms.txt`, B7 the CLI and MCP playgrounds, B8 the React and DocSpec-lint playgrounds). Each brief is `writer.md` plus the package's section of *facts.md* plus the batch's worklist lines — nothing else. Writers edit only their batch, write numbers from the facts, and leave `<!-- unverified: … -->` where a fact is missing.

## 4. Gates

`npm run docs:all`, then `cp llms.txt docs/llms.txt`, then `npm run verify:docs` (loop until clean; re-run `docs:guides` / `docs:llms` after every late edit). `npm run verify:diagrams` and `npm run verify:overflow` only when an SVG or a stylesheet changed. One `npm run gate -- --fast` at the end; take `declared.tests` from the gate report.

## 5. Review — one agent, behavioural claims only

Spawn one Agent with `reviewer.md` over `git diff` of the pass. Counts, enum values, versions and pins are held by `verify:docs` and are out of its scope; it checks sentences that state a behaviour, fixes them against the engine source, and lists what it could not verify.

## 6. Pull-request draft

Fill `pr-template.md` from *facts.json* (counts before → after, deltas, rule and test counts) into `RELEASE_PR_docs_<cli>-<mcp>-<react>.md` at the repository root (git-ignored). Record the writers' and reviewer's unverified markers under "Explicitly NOT claimed".

## 7. Social images

A satellite pass never touches `docs/assets/og-image.svg` or `social-preview.svg`: they carry engine-level facts only. An engine release that changes the headline re-renders both PNGs (command in each SVG header) and the maintainer re-uploads the social preview in the repository settings.

## Known blind spots

- `verify:docs` holds counts and versions, not behaviour: a sentence copied from a satellite release note can be wrong (the 1.6.0 / 1.8.0 / 1.4.0 pass found three such claims). The reviewer's trigger words exist for that reason.
- Degraded mode cannot see CLI flag defaults until the satellites ship `surface.json` — the contract is `surface-contract.md`.
