# Satellite surface contract — `docs/assets/surface.json`

What each companion package (pdfnative-cli, pdfnative-mcp, pdfnative-react) emits at `release:prepare` so that `scripts/satellite-sync.ts` reads it in contract mode instead of deriving the surface from captures. Until a package ships it, the script runs in degraded mode and lists under "Unverified" what it could not derive. The maintainer's issue draft for the three repositories is `.github/drafts/satellite-surface-contract.md` (git-ignored, local).


Each satellite commits, at `release:prepare`, a `docs/assets/surface.json` describing its public surface as **lists** (not counts) plus the delta against the previous release, so that the engine repository's alignment pass is a file read: `npx tsx scripts/satellite-sync.ts --expect cli=<v> mcp=<v> react=<v> --apply --worklist` reads it in *contract* mode, writes the facts sheet, applies the mechanical edits and prints the worklist. The engine's `verify:docs` then holds every count, version and pin.

Common shape (one file per package):

```json
{
  "$schema": "https://pdfnative.dev/schema/surface/1.json",
  "kind": "satellite-surface",
  "package": "pdfnative-cli",
  "version": "1.6.0",
  "previous": "1.5.0",
  "releasedOn": "2026-11-01",
  "engine": { "pin": "^1.9.0", "pinField": "dependencies", "minimum": "1.9.0" },
  "runtime": { "node": ">=22" },
  "lists": { "commands": ["render", "fill"], "globalFlags": ["--json"], "errorCodes": ["E_INPUT"] },
  "structured": { "commands": [{ "name": "render", "group": "Create & edit", "flags": ["--direction"] }] },
  "counts": { "commands": 21, "errorCodes": 12 },
  "delta": { "commands": { "added": [], "removed": [] }, "flags:render": { "added": ["--direction", "--actual-text"], "removed": [] } },
  "constraints": ["--data is exclusive with --cert / --ocsp / --crl (exit 2)"],
  "engineCoverage": { "feat(color)": "tested", "feat(bidi)": "waived" },
  "ledger": [{ "id": "C1", "summary": "the PDF/A-2 + PDF/X-4 dual claim is accepted" }],
  "docs": { "guide": "https://pdfnative.dev/guides/cli.html", "llms": "https://github.com/Nizoka/pdfnative-cli/blob/main/llms.txt", "agentContract": "docs/AGENT_CONTRACT.md" }
}
```

Per package, the lists reuse the extractors that already compute `derived` in `scripts/lib/<name>-surface.ts`:

- **pdfnative-cli** (`cli-surface.ts`): `commands` with `group` and `flags` (`commandNames()`, `completionFlags()`, the `commandGroups` of `ecosystem.json`), `globalFlags`, `errorCodes` (`errorCodeValues()`), `subjects`, `manifestCommands`, `statusFields` (keys of the `schema status` properties), `diagnosticCodes`, `fontModules`, `scripts`, and `flagDefaults` (`"<command>.<flag>": "<default>"`) — the missing fact behind the README's wrong `--direction auto` default.
- **pdfnative-mcp** (`mcp-surface.ts`): `tools` with `group` and top-level `inputs` from `listToolsPayload()` (export it from `src/server.ts` so `tsx` suffices without `dist/`), `prompts` (`promptNames()`), `envVars` as `{ name, default, isSecret }` (`serverJsonEnvVars()` returning objects), `errorCodes`, `crossFieldConstraints` (the `ToolError('VALIDATION_ERROR', '… mutually exclusive …')` literals), `toolsListBytes`, `instructionsBytes`, `examples`, `langValues`, `colourSites`.
- **pdfnative-react** (`react-surface.ts`): `components`, `clientComponents`, `blocks`, `specFields`, `lintRules` as `{ code, severity }` (`lintRuleTable()`), `errorCodes`, `schemaSubjects`, `engineInputErrorPrefixes` (`ENGINE_INPUT_ERROR_PREFIXES`, absent from `capabilityManifest()` today), `entrypoints`.


## Per-repository checklist


Per repository, one pull request:

1. `computeSurface(root): SatelliteSurface` next to `computeDerived(root)` in `scripts/lib/<name>-surface.ts`, with a unit test over inline fixtures; `counts` derived from the lists so `computeDerived` can call it.
2. `release:prepare` writes `docs/assets/surface.json` (`delta` against `git show v<previous>:docs/assets/surface.json`; the first time against the existing previous-version captures) and `verify:docs` gains a `surface-sync` rule (the committed file equals a fresh `computeSurface`).
3. `release:prepare` refreshes the sibling `packages.*` rows from `../pdfnative-<other>/docs/assets/surface.json` and `../pdfnative/docs/assets/ecosystem.json` when the checkouts are present, else prints a warning naming the row.
4. `release-notes/TEMPLATE.md` gains `## Downstream integration notes` (the engine's wording; pdfnative-react renames its `## Downstream / ecosystem notes`), and the CHANGELOG heading takes the engine form `## [X.Y.Z] – YYYY-MM-DD`.
5. Package-specific: the CLI's `schema manifest` carries `flagDefaults`; the MCP server exports `listToolsPayload()`; pdfnative-react dumps the current `capabilityManifest()` beside the frozen baselines.

