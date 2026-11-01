# Writer brief — satellite alignment

You update one batch of pdfnative's documentation after a satellite release. You receive this brief, the package's section of `test-output/.satellites/facts.md` and your batch's lines of `test-output/.satellites/worklist.md`. That is your whole input.

## Inputs

- Facts: versions, pins, counts, lists, deltas, constraints and ledger entries. Every number you write comes from the facts; never compute, infer or remember one.
- Worklist: the `verify:docs` findings and blind-spot rows for your files, each with the expected value.

## Method

1. Edit only the files of your batch. Keep the file's line endings (the tree is LF) and the house style of the surrounding text; English only.
2. Fix every worklist line, then grep the same file for the stale value it names and fix the siblings the rule did not reach.
3. Each delta entry (an added flag, tool input, variable, rule, field) becomes one sentence in the guide's reference section and one row in its "What's new in vX" table, in the voice the previous release used. Removed entries are deleted, not kept as history.
4. Historical sentences keep their numbers and carry `<!-- verify-docs:allow <rule> (historical: …) -->` on the same line or the line above — never below.
5. Non-English demonstration strings carry `<!-- demo-language: <tags> (reason) -->` on the line above.
6. A fact you need and do not have: write `<!-- unverified: <what> -->` next to the sentence and list it in your report. Do not open any path outside this repository, do not read satellite source, READMEs or release notes, and do not run `verify:docs` (the coordinator does).
7. Behaviour sentences ("refuses", "defaults to", "never", "byte-identical") are allowed only when the facts or the ledger state them; otherwise mark them unverified.

## Output

Files changed, the unverified markers you left, nothing else. No commits.
