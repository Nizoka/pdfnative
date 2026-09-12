/**
 * pdfnative — Script shaper registry (v1.8.0)
 * =============================================
 * One ordered table naming every complex script pdfnative shapes, so adding
 * a script is a table entry rather than an edit to nine call sites.
 *
 * Before 1.8.0 the dispatch was written out by hand three times inside
 * `encoding-context.ts` — once on the bidirectional path, once on the
 * left-to-right path, once on the hex path — as nine near-identical branches
 * apiece. Adding Lao, or any twenty-fourth script, meant finding all three
 * ladders and hoping the reviewer noticed if one was missed. The predicates
 * and shapers themselves are unchanged; only the dispatch moved.
 *
 * Order is significant and is preserved exactly as the ladders had it: the
 * first entry whose predicate matches wins. A run mixing two complex scripts
 * therefore resolves the same way it did before, which is what keeps output
 * byte-identical across the refactor.
 *
 * Arabic is deliberately absent. It is not a "first match wins on the whole
 * run" script: it is reached only from the bidirectional path, after the
 * run's embedding level has been resolved, and it shapes text that has
 * already been reversed. Folding it in here would flatten a distinction that
 * matters.
 *
 * @module shaping/shaper-registry
 * @since 1.8.0
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import {
    containsThai, containsLao, containsBengali, containsTamil, containsTelugu,
    containsSinhala, containsTibetan, containsKhmer, containsMyanmar,
    containsDevanagari,
} from './script-registry.js';
import { shapeThaiText } from './thai-shaper.js';
import { shapeLaoText } from './lao-shaper.js';
import { shapeBengaliText } from './bengali-shaper.js';
import { shapeTamilText } from './tamil-shaper.js';
import { shapeTeluguText } from './telugu-shaper.js';
import { shapeSinhalaText } from './sinhala-shaper.js';
import { shapeTibetanText } from './tibetan-shaper.js';
import { shapeKhmerText } from './khmer-shaper.js';
import { shapeMyanmarText } from './myanmar-shaper.js';
import { shapeDevanagariText } from './devanagari-shaper.js';

/**
 * One complex script the engine can shape.
 *
 * @since 1.8.0
 */
export interface ScriptShaper {
    /** Stable identifier, matching the font-entry language tag. */
    readonly id: string;
    /** True when the text contains at least one character of this script. */
    readonly detect: (text: string) => boolean;
    /** Turn logical-order text into positioned glyphs. */
    readonly shape: (text: string, fd: FontData) => ShapedGlyph[];
}

/**
 * Every shaped script, in dispatch order.
 *
 * @since 1.8.0
 */
export const SCRIPT_SHAPERS: readonly ScriptShaper[] = [
    { id: 'thai', detect: containsThai, shape: shapeThaiText },
    // Lao sits next to Thai because it shares the mechanism, and after it
    // because the Thai block ends at U+0E7F where Lao begins: neither
    // predicate can claim the other's characters, so the order is a
    // readability choice rather than a correctness one.
    { id: 'lao', detect: containsLao, shape: shapeLaoText },
    { id: 'bengali', detect: containsBengali, shape: shapeBengaliText },
    { id: 'tamil', detect: containsTamil, shape: shapeTamilText },
    { id: 'telugu', detect: containsTelugu, shape: shapeTeluguText },
    { id: 'sinhala', detect: containsSinhala, shape: shapeSinhalaText },
    { id: 'tibetan', detect: containsTibetan, shape: shapeTibetanText },
    { id: 'khmer', detect: containsKhmer, shape: shapeKhmerText },
    { id: 'myanmar', detect: containsMyanmar, shape: shapeMyanmarText },
    { id: 'devanagari', detect: containsDevanagari, shape: shapeDevanagariText },
];

/**
 * The first registered shaper claiming `text`, or `null` when no complex
 * script is present and the caller should take its plain encoding path.
 *
 * @since 1.8.0
 */
export function findShaper(text: string): ScriptShaper | null {
    for (const shaper of SCRIPT_SHAPERS) {
        if (shaper.detect(text)) return shaper;
    }
    return null;
}
