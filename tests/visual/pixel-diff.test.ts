/**
 * Visual regression — rendered-glyph pixel diff.
 *
 * Builds each extreme-script fixture, rasterises it by scan-filling the
 * embedded TrueType outlines at the shaped glyph positions, and compares the
 * resulting grayscale bitmap against a committed PNG baseline. This exercises
 * the FULL pipeline (shaping → PDF emission → font embedding → outline
 * rendering) and fails when the rendered text geometry drifts.
 *
 * Baselines live under tests/visual/baselines/. To regenerate after an
 * intentional change, run with UPDATE_SNAPSHOTS=1.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPages } from './helpers/extract.js';
import { rasterizePage, bitmapDiff } from './helpers/raster.js';
import { encodePng, decodePng } from './helpers/png.js';
import { FIXTURES } from './fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = resolve(HERE, 'baselines');
const SCALE = 0.5; // device px per point → A4 ≈ 298×421
const DIFF_TOLERANCE = 0.01; // ≤1% differing pixels allowed
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

describe('visual regression — rendered-glyph pixel diff', () => {
    for (const fixture of FIXTURES) {
        const pngPath = resolve(BASELINE_DIR, `${fixture.name}.png`);

        it(`${fixture.name} matches its rendered pixel baseline`, async () => {
            const bytes = await fixture.build();
            const pages = extractPages(bytes);
            expect(pages.length).toBeGreaterThan(0);

            const bmp = rasterizePage(pages[0], SCALE);

            // Sanity: the page must contain rendered ink.
            let ink = 0;
            for (let i = 0; i < bmp.data.length; i++) if (bmp.data[i] === 0) ink++;
            expect(ink).toBeGreaterThan(0);

            if (UPDATE || !existsSync(pngPath)) {
                mkdirSync(dirname(pngPath), { recursive: true });
                writeFileSync(pngPath, encodePng(bmp));
                return;
            }

            const baseline = decodePng(new Uint8Array(readFileSync(pngPath)));
            const diff = bitmapDiff(bmp, baseline);
            expect(diff).toBeLessThanOrEqual(DIFF_TOLERANCE);
        });
    }
});
