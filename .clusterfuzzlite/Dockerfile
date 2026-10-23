# pdfnative — the ClusterFuzzLite build image.
#
# Jazzer.js is installed HERE and never in package.json. That is the whole
# reason this directory exists in this shape: the zero-dependency promise is
# a property of what `npm install pdfnative` puts in a consumer's tree, and
# an engine that lives only inside a build image cannot reach it. The
# `no runtime dependency` assertion in tests/tools/workflows.test.ts keeps
# that true from the other side.
#
# The base image is pinned by digest, like every action in .github/workflows.
# Nothing bumps it automatically — Dependabot's docker ecosystem proposes the
# bump, a human reviews it. Resolve a new one with:
#   curl -sI -H 'Accept: application/vnd.docker.distribution.manifest.v2+json' \
#     https://gcr.io/v2/oss-fuzz-base/base-builder-javascript/manifests/ubuntu-24-04 \
#     | grep -i docker-content-digest
# The ubuntu-24-04 variant, matching `base_os_version` in project.yaml.
FROM gcr.io/oss-fuzz-base/base-builder-javascript:ubuntu-24-04@sha256:b577e8a8d3623194cebaddd95ab01d7121d38bb699515a9de9ee685e88d6786b

# ClusterFuzzLite validates SANITIZER against address, memory, undefined and
# coverage, and OSS-Fuzz's `compile` refuses every sanitizer but none and
# coverage for JavaScript: no value passes both and still fuzzes. The workflow
# passes `address`, which ClusterFuzzLite accepts, and this wrapper builds with
# `none`, the mode OSS-Fuzz documents for Jazzer.js. Nothing native is
# instrumented either way: the targets are pure JavaScript, and bad_build_check
# skips its sanitizer checks for javascript.
RUN mv /usr/local/bin/compile /usr/local/bin/compile-oss-fuzz \
    && printf '#!/bin/bash -eu\nexport SANITIZER=none\nexec /usr/local/bin/compile-oss-fuzz "$@"\n' > /usr/local/bin/compile \
    && chmod +x /usr/local/bin/compile

COPY . $SRC/pdfnative
COPY .clusterfuzzlite/build.sh $SRC/build.sh
WORKDIR $SRC/pdfnative
