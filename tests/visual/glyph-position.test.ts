/**
 * Visual regression — glyph-position snapshot guard.
 *
 * Builds each extreme-script fixture with the real bundled fonts, extracts the
 * deterministic text-show operators (font, size, baseline x/y, glyph IDs), and
 * compares them against a committed JSON baseline. Any change to the shaping or
 * positioning pipeline that moves a glyph, swaps a GID, or alters a run fails
 * here.
 *
 * Baselines live under tests/visual/baselines/. To regenerate after an
 * intentional change, run with UPDATE_SNAPSHOTS=1.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPages } from './helpers/extract.js';
import { FIXTURES } from './fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = resolve(HERE, 'baselines');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

interface Snapshot {
    readonly pages: Array<{
        readonly width: number;
        readonly height: number;
        readonly ops: Array<{ font: string; size: number; x: number; y: number; gids: number[] }>;
    }>;
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

function buildSnapshot(bytes: Uint8Array): Snapshot {
    const pages = extractPages(bytes).map((p) => ({
        width: round(p.width),
        height: round(p.height),
        ops: p.ops.map((o) => ({
            font: o.font,
            size: o.size,
            x: round(o.x),
            y: round(o.y),
            gids: [...o.gids],
        })),
    }));
    return { pages };
}

describe('visual regression — glyph-position snapshots', () => {
    for (const fixture of FIXTURES) {
        const snapPath = resolve(BASELINE_DIR, `${fixture.name}.json`);

        it(`${fixture.name} matches its glyph-position baseline`, async () => {
            const bytes = await fixture.build();
            const snapshot = buildSnapshot(bytes);

            // Sanity: the fixture must contain shaped glyph runs.
            const totalOps = snapshot.pages.reduce((s, p) => s + p.ops.length, 0);
            expect(totalOps).toBeGreaterThan(0);

            const serialized = JSON.stringify(snapshot, null, 0);

            if (UPDATE || !existsSync(snapPath)) {
                mkdirSync(dirname(snapPath), { recursive: true });
                writeFileSync(snapPath, serialized + '\n');
                return;
            }

            const baseline = readFileSync(snapPath, 'utf8').trimEnd();
            expect(serialized).toBe(baseline);
        });
    }
});
