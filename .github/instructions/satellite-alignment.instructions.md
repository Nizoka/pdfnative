---
description: "Use when editing the companion-package docs (the cli, mcp and react guides, use cases, playgrounds, surfaces.json, ecosystem.json, versions.js) after a pdfnative-cli, pdfnative-mcp or pdfnative-react release."
applyTo: "docs/guides/cli.md, docs/guides/mcp.md, docs/guides/react.md, docs/guides/use-cases*.md, docs/guides/choose.md, docs/playgrounds/cli.html, docs/playgrounds/mcp.html, docs/playgrounds/react.html, docs/playgrounds/docspec-lint.html, docs/data/surfaces.json, docs/assets/ecosystem.json, docs/assets/versions.js"
---
# Satellite alignment

The companion packages (pdfnative-cli, pdfnative-mcp, pdfnative-react) release on their own cadence; pdfnative.dev documents them. This file says where their facts come from and which rules hold them.

## Source of truth

- A satellite's surface is its `docs/assets/surface.json` (versions, pins, lists, deltas) when the package ships one, otherwise the facts sheet `npx tsx scripts/satellite-sync.ts` derives from the package's own artefacts (`test-output/.satellites/facts.md`). Never quote a satellite README, CHANGELOG or release note for a behaviour: the 1.6.0 / 1.8.0 / 1.4.0 pass found behavioural claims in all three that their source contradicted.
- Versions, pins and counts live in `docs/assets/ecosystem.json` under `packages.<name>` (`version`, `pin`, `counts`) and are written by `npx tsx scripts/satellite-sync.ts --apply`, never by hand.
- An engine behaviour is proven by `src/` of this repository, cited by file and line.

## Rules that hold these docs

- `version-token`: `pdfnative-x vX.Y.Z` prose, README table cells, `data-pn-badge` badges and JSON-LD `softwareVersion` against the manifest.
- `satellite-stamps`: the forms `version-token` cannot reach — `docs/assets/versions.js`, the `llms.txt` ecosystem lines, "New in vX" in `docs/agent-brief.md`, `docs/learn/08-next-steps.html`, importmaps, the backtick and `<strong>` forms — and every pin written in prose.
- `count-tokens`: commands, flags, subjects, error codes, envelope fields, prompts, operator variables, examples, lint rules (and their severity split), DocSpec fields, components and blocks, in the companion docs too.
- `surfaces-shape`: `docs/data/surfaces.json` names exist in the manifest, `since` is a version the package reached, an unsupported cell says why.

## Conventions

- Historical sentences keep their numbers with `<!-- verify-docs:allow <rule> (historical: …) -->` on the same line or the line above.
- Floors are written `≥ X.Y.Z`; pins only inside backticks; the dual claim is "the PDF/A-2 + PDF/X-4 dual claim".
- Outside the three companion guides, satellite helpers are named without parentheses (`api-exists`).
- Social images (`og-image.svg`, `social-preview.svg`) carry engine-level facts only: a satellite pass never changes them.

A full pass is the maintainer-invoked skill `/satellite-align cli=<v> mcp=<v> react=<v>` (`.claude/skills/satellite-align/SKILL.md`).
