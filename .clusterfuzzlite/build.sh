#!/bin/bash -eu
# pdfnative — the ClusterFuzzLite build step.
#
# What the targets fuzz is `dist/`, the bytes a consumer installs, reached by
# the package's own name through the `exports` map (Node self-reference:
# `pdfnative` and `pdfnative/tools`). `tests/fuzzing/targets.test.ts` runs the
# same files against `src/` through vitest's aliases, so the targets are
# proved callable and proved to rethrow an engine error before they ever
# reach a container. One file, two engines, and the half that can be checked
# anywhere is checked everywhere.

cd "$SRC/pdfnative"

# --ignore-scripts, the same rule as every runner and every contributor
# machine (.npmrc): no dependency's lifecycle script runs while building a
# fuzzing image either.
npm ci --ignore-scripts
npm run build

# Seed corpora, built by the library itself (tests/fuzzing/_fuzz-seeds.ts):
# documents in every shape the writer emits — classic and stream xref,
# compressed, encrypted, tagged, with images, annotations and form fields —
# plus PDF syntax snippets, zlib streams, the four image formats and a
# bundled TrueType face. Starting a PDF fuzzer from random bytes wastes days
# rediscovering `%PDF` and `obj`; starting it from a file that parses puts
# it inside the grammar on the first mutation. targets.test.ts proves every
# seed parses, on every gate run.
seeds="$(mktemp -d)"
npx tsx tests/fuzzing/_fuzz-seeds.ts "$seeds"
for target in document font-data image inflate object-parser tokenizer xref; do
  zip -j "$OUT/${target}_seed_corpus.zip" "$seeds/$target"/*.bin >/dev/null
done

# The engine, never in the manifest. .clusterfuzzlite/engine/package.json
# names one exact version, and its package-lock.json pins every package of
# the engine's tree to a version and a sha512 integrity that `npm ci` checks
# before it unpacks anything — no range, no resolution at build time, the
# same supply-chain rule as the project's own lockfile. The project's
# node_modules is then replaced by the engine's: the targets import only
# `dist/`, which has no dependency, and the OSS-Fuzz wrapper runs
# `<project>/node_modules/@jazzer.js/core/dist/cli.js`.
(cd .clusterfuzzlite/engine && npm ci --ignore-scripts)
rm -rf node_modules
mv .clusterfuzzlite/engine/node_modules node_modules

compile_javascript_fuzzer pdfnative fuzz/document.js --sync
compile_javascript_fuzzer pdfnative fuzz/font-data.js --sync
compile_javascript_fuzzer pdfnative fuzz/image.js --sync
compile_javascript_fuzzer pdfnative fuzz/inflate.js --sync
compile_javascript_fuzzer pdfnative fuzz/object-parser.js --sync
compile_javascript_fuzzer pdfnative fuzz/tokenizer.js --sync
compile_javascript_fuzzer pdfnative fuzz/xref.js --sync
