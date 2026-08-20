/**
 * CURATED EMOJI SEQUENCES — bundled multi-codepoint set (v1.7.0)
 * ==============================================================
 * Flag (regional-indicator pair) and ZWJ sequences resolved into the bundled
 * colour-emoji module by scripts/build-color-emoji-data.ts. Skin-tone (RGI
 * Fitzpatrick) variants are deliberately NOT bundled — the combinatorial set
 * belongs to the CLI: `npx pdfnative-build-emoji-font --sequences all` or
 * `--sequence-list 1F468-1F3FB-200D-1F4BB,…`.
 *
 * Keep this list small and stable: the module ships in every npm install and
 * is guarded by a size budget in build-color-emoji-data.ts.
 */

const RI_BASE = 0x1F1E6; // Regional Indicator Symbol Letter A

/** Convert an ISO 3166-1 alpha-2 code to its regional-indicator pair. */
export function flagSequence(code: string): readonly [number, number] {
    const c = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new Error(`flagSequence: invalid country code '${code}'`);
    return [RI_BASE + c.charCodeAt(0) - 65, RI_BASE + c.charCodeAt(1) - 65];
}

/**
 * Bundled flags: EU + UN + the G20 members + widely used locales.
 * ~50 flags ≈ what everyday business documents actually reference.
 */
export const CURATED_FLAGS: readonly string[] = [
    'EU', 'UN',
    // G20
    'AR', 'AU', 'BR', 'CA', 'CN', 'FR', 'DE', 'IN', 'ID', 'IT',
    'JP', 'KR', 'MX', 'RU', 'SA', 'ZA', 'TR', 'GB', 'US',
    // Widely used locales
    'AT', 'BE', 'CH', 'CL', 'CO', 'CZ', 'DK', 'EG', 'ES', 'FI',
    'GR', 'HK', 'HU', 'IE', 'IL', 'MA', 'NL', 'NO', 'NZ', 'PE',
    'PH', 'PL', 'PT', 'RO', 'SE', 'SG', 'TH', 'TW', 'UA', 'VN',
];

const ZWJ = 0x200D;
const VS16 = 0xFE0F;

/** Bundled ZWJ sequences (skin-tone-free RGI forms). */
export const CURATED_ZWJ: readonly (readonly number[])[] = [
    [0x2764, VS16, ZWJ, 0x1F525],            // ❤️‍🔥 heart on fire
    [0x2764, VS16, ZWJ, 0x1FA79],            // ❤️‍🩹 mending heart
    [0x1F468, ZWJ, 0x1F469, ZWJ, 0x1F467],   // 👨‍👩‍👧 family: man, woman, girl
    [0x1F468, ZWJ, 0x1F469, ZWJ, 0x1F467, ZWJ, 0x1F466], // 👨‍👩‍👧‍👦
    [0x1F469, ZWJ, 0x1F469, ZWJ, 0x1F466],   // 👩‍👩‍👦
    [0x1F468, ZWJ, 0x1F466],                 // 👨‍👦
    [0x1F469, ZWJ, 0x1F467],                 // 👩‍👧
    [0x1F468, ZWJ, 0x1F4BB],                 // 👨‍💻 man technologist
    [0x1F469, ZWJ, 0x1F4BB],                 // 👩‍💻 woman technologist
    [0x1F468, ZWJ, 0x2695, VS16],            // 👨‍⚕️ man health worker
    [0x1F469, ZWJ, 0x2695, VS16],            // 👩‍⚕️ woman health worker
    [0x1F468, ZWJ, 0x1F373],                 // 👨‍🍳 man cook
    [0x1F469, ZWJ, 0x1F373],                 // 👩‍🍳 woman cook
    [0x1F468, ZWJ, 0x1F680],                 // 👨‍🚀 man astronaut
    [0x1F469, ZWJ, 0x1F680],                 // 👩‍🚀 woman astronaut
    [0x1F3F3, VS16, ZWJ, 0x1F308],           // 🏳️‍🌈 rainbow flag
    [0x1F3F3, VS16, ZWJ, 0x26A7, VS16],      // 🏳️‍⚧️ transgender flag
    [0x1F3F4, ZWJ, 0x2620, VS16],            // 🏴‍☠️ pirate flag
    [0x1F62E, ZWJ, 0x1F4A8],                 // 😮‍💨 face exhaling
    [0x1F635, ZWJ, 0x1F4AB],                 // 😵‍💫 face with spiral eyes
    [0x1F43B, ZWJ, 0x2744, VS16],            // 🐻‍❄️ polar bear
    [0x1F408, ZWJ, 0x2B1B],                  // 🐈‍⬛ black cat
];

/** The complete bundled sequence set, flags first, byte-stable order. */
export const CURATED_SEQUENCES: readonly (readonly number[])[] = [
    ...CURATED_FLAGS.map(flagSequence),
    ...CURATED_ZWJ,
];
