# docs: pdfnative-cli {{cli.version}} + pdfnative-mcp {{mcp.version}} + pdfnative-react {{react.version}} ecosystem alignment

> Local draft of the PR body (git-ignored as `RELEASE_PR_*.md`); the maintainer opens the PR.

## Summary

Documentation-only pass aligning pdfnative.dev and the repository docs on the satellite releases of {{releasedOn}}: pdfnative-cli **{{cli.version}}**, pdfnative-mcp **{{mcp.version}}**, pdfnative-react **{{react.version}}** (pins `{{cli.pin}}` / `{{mcp.pin}}` / `{{react.pin}}`). No runtime change; nothing under `src/`.

## Mechanical edits (`scripts/satellite-sync.ts --apply`)

{{apply.summary}}

## Counts before → after

| Package | Counter | Before | After |
|---|---|---|---|
{{counts.rows}}

## What changed in each package (delta)

{{delta.bullets}}

## Written changes by batch

{{batches.summary}}

## Review

{{review.summary}}

## Explicitly NOT claimed

{{unverified.list}}

## Verification

- `npm run verify:docs` — {{verify.rules}} rules passed across {{verify.files}} files.
- `npm run gate -- --fast` — {{gate.summary}}.
- `og-image.png` / `social-preview.png` unchanged (satellite pass; engine-level images).

## Post-merge

- Deploy pdfnative.dev, then `npm run verify:docs -- --online` once (npm-drift on the new versions).
- Satellite-side follow-ups: {{followups}}
