import { describe, it, expect } from 'vitest';
import { SCRIPT_SHAPERS, findShaper } from '../../src/shaping/shaper-registry.js';
import { shapeThaiText } from '../../src/shaping/thai-shaper.js';
import { shapeDevanagariText } from '../../src/shaping/devanagari-shaper.js';
import * as notoThai from '../../fonts/noto-thai-data.js';
import type { FontData } from '../../src/types/pdf-types.js';

// v1.8.0 — the registry that replaced three hand-written dispatch ladders.

const thai = notoThai as unknown as FontData;

/** One sample string per registered script, in the registry's own order. */
const SAMPLES: Record<string, string> = {
    thai: 'สวัสดี',
    lao: 'ລາວ',
    bengali: 'বাংলা',
    tamil: 'தமிழ்',
    telugu: 'తెలుగు',
    sinhala: 'සිංහල',
    tibetan: 'བོད་སྐད',
    khmer: 'ភាសាខ្មែរ',
    myanmar: 'မြန်မာ',
    devanagari: 'नमस्ते',
};

describe('SCRIPT_SHAPERS', () => {
    it('registers every script the engine shapes', () => {
        expect(SCRIPT_SHAPERS.map(s => s.id)).toEqual([
            'thai', 'lao', 'bengali', 'tamil', 'telugu', 'sinhala',
            'tibetan', 'khmer', 'myanmar', 'devanagari',
        ]);
    });

    it('gives every entry a distinct id', () => {
        expect(new Set(SCRIPT_SHAPERS.map(s => s.id)).size).toBe(SCRIPT_SHAPERS.length);
    });

    it('omits Arabic, which is reached only after BiDi resolution', () => {
        expect(SCRIPT_SHAPERS.some(s => s.id === 'arabic')).toBe(false);
    });
});

describe('findShaper', () => {
    it('picks the right shaper for each script', () => {
        for (const [id, text] of Object.entries(SAMPLES)) {
            expect(findShaper(text)?.id, `${id} sample`).toBe(id);
        }
    });

    it('returns null for text with no complex script', () => {
        expect(findShaper('Hello, world')).toBeNull();
        expect(findShaper('')).toBeNull();
        expect(findShaper('日本語 한국어 Ελληνικά')).toBeNull();
    });

    it('resolves a mixed run to the earliest registered script', () => {
        // First match wins, exactly as the hand-written ladders did — this is
        // what keeps output byte-identical across the refactor.
        expect(findShaper(`${SAMPLES.devanagari}${SAMPLES.thai}`)?.id).toBe('thai');
        expect(findShaper(`${SAMPLES.myanmar}${SAMPLES.bengali}`)?.id).toBe('bengali');
    });

    it('never falls through to Devanagari for unrecognised text', () => {
        // The old hex-path ternary chain ended in an unguarded
        // `: shapeDevanagariText`, so anything reaching it was shaped as
        // Devanagari whether or not it was.
        expect(findShaper('中文')).toBeNull();
    });

    it('shapes through the registry exactly as the direct call does', () => {
        const viaRegistry = findShaper(SAMPLES.thai)!.shape(SAMPLES.thai, thai);
        expect(viaRegistry).toEqual(shapeThaiText(SAMPLES.thai, thai));
    });

    it('exposes the same function identity as the shaper module', () => {
        expect(SCRIPT_SHAPERS.find(s => s.id === 'devanagari')!.shape).toBe(shapeDevanagariText);
    });
});
