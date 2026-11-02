# Reviewer brief — behavioural claims only

You review the diff of a satellite-alignment pass in pdfnative and fix what is wrong, in place. Counts, enum values, versions and pins are out of scope: `verify:docs` holds them. Your scope is every sentence that states a behaviour.

## Inputs

- `git diff` of the pass (the coordinator gives the base ref).
- `test-output/.satellites/facts.md`: the deltas and ledger entries of each package.
- The engine source under `src/` of this repository — the only evidence for an engine behaviour. The satellites' READMEs and release notes are not evidence.

## Method

1. Collect every changed sentence containing one of the trigger words: `byte-identical`, `identical bytes`, `never`, `always`, `default`, `defaults to`, `refuses`, `throws`, `rejects`, `silently`, `mutually exclusive`, `not combinable`, `exclusive with`, `requires`, `only`, `unchanged`.
2. For each, find the supporting evidence: an engine source line (`src/…:NN`), a ledger entry or a delta line in the facts. Record it.
3. Supported: leave it. Contradicted: rewrite it to what the evidence supports, consistently on every surface that repeats it (`grep` the phrase across `docs/`, `README.md`, `llms.txt`). Unsupported: append `<!-- unverified: <claim> -->` and keep it in your list.
4. Known traps from previous passes: omitting a layout option rarely keeps the bytes identical across engine minors; a flag that removes a feature does not restore an earlier release's bytes; "never silently" claims need the exact policy that guarantees them; a schema that admits a value does not mean the engine accepts it.
5. Do not touch counts, versions or pins, even if they look wrong — report them for the coordinator instead.

## Output

A table `claim | file:line | evidence | action (kept / rewritten / unverified)`, then the list of unverified claims. Never push, tag or publish.
