/**
 * `scripts/build-guides.ts` — the helpers behind heading ids and JSON-LD text.
 *
 * CodeQL (js/double-escaping, js/incomplete-multi-character-sanitization)
 * flagged the two helpers below in 1.9.0: `decodeEntities` decoded `&amp;`
 * first, so `&amp;lt;` became `<`, and `stripTags` removed tags in one pass,
 * so `<<b>>x` kept a `<>`. Both run over marked's own output, where neither
 * input occurs, but the fixed helpers are held here so the order and the
 * fixed point cannot regress — and so the 37 committed shells stay
 * byte-identical (`verify:docs` rule `guide-render-sync` holds that).
 */

import { describe, it, expect } from 'vitest';
import { decodeEntities, stripTags, slugify } from '../../scripts/build-guides.js';

describe('build-guides helpers', () => {
    it('decodes &amp; last, so a double-escaped entity stays escaped once', () => {
        expect(decodeEntities('a &amp;lt; b')).toBe('a &lt; b');
        expect(decodeEntities('&lt;code&gt; &quot;x&quot; &#39;y&#39; &amp; z')).toBe('<code> "x" \'y\' & z');
    });

    it('strips tags to a fixed point', () => {
        expect(stripTags('<<b>>x</b>')).toBe('x');
        expect(stripTags('<code>one</code> and <em>two</em>')).toBe('one and two');
        expect(stripTags('no tags')).toBe('no tags');
        expect(stripTags('<unterminated')).toBe('unterminated');
    });

    it('keeps the GitHub heading slug shape', () => {
        expect(slugify('Flag &amp; ZWJ')).toBe('flag--zwj');
        expect(slugify('Case 5 — Swap the compressor: <code>zipnative</code>')).toBe('case-5--swap-the-compressor-zipnative');
    });
});
