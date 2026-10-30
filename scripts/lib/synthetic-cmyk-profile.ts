/**
 * Synthetic output profiles — the sample generators' import path
 * ================================================================
 * The builders moved to `src/tools/synthetic-profiles.ts` in 1.9.0 (they
 * are exported from `pdfnative/tools` since then, #86); this module keeps
 * the path the 1.8.0 generators, recipes and tests import from.
 */
export { buildSyntheticCmykProfile, buildSyntheticGrayProfile } from '../../src/tools/synthetic-profiles.js';
