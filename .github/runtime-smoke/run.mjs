// pdfnative — runtime smoke, command-line runtimes
// ================================================
// `deno run .github/runtime-smoke/run.mjs`, `bun .github/runtime-smoke/run.mjs`
// (and `node`, for the maintainer): loads the built package and one bundled
// font module, and runs the shared checks. Exit 0 when every check passed,
// 1 otherwise. No permission flag is needed under Deno: a static import of a
// local module is allowed.

import * as pdfnative from '../../dist/index.js';
import * as arabic from '../../fonts/noto-arabic-data.js';
import { runChecks } from './checks.mjs';

const runtime = typeof Deno !== 'undefined' ? `Deno ${Deno.version.deno}`
    : typeof Bun !== 'undefined' ? `Bun ${Bun.version}`
    : `Node ${globalThis.process?.version ?? '?'}`;

try {
    for (const line of await runChecks(pdfnative, { arabic })) console.log(`ok - ${line}`);
    console.log(`runtime smoke: every check passed on ${runtime}`);
} catch (err) {
    console.error(`not ok - ${runtime}: ${err instanceof Error ? err.message : String(err)}`);
    if (typeof Deno !== 'undefined') Deno.exit(1);
    globalThis.process.exit(1);
}
