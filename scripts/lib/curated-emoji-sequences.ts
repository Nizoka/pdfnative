/**
 * CURATED EMOJI SEQUENCES — bundled multi-codepoint set (v1.7.0, v1.8.0)
 * ======================================================================
 * Flag (regional-indicator pair), ZWJ, and skin-tone sequences resolved into
 * the bundled colour-emoji module by scripts/build-color-emoji-data.ts.
 *
 * Skin tones (v1.8.0). Unicode defines 667 RGI modifier sequences and 1 365
 * skin-toned ZWJ sequences; each costs about 3 KB in the module, and the
 * whole modifier set alone would take it from 4.6 MB to 6.6 MB. A curated
 * subset is bundled instead: the everyday gestures and the generic people,
 * each in all five Fitzpatrick tones, so a document never has to show one
 * skin tone for lack of the others. Everything else — every RGI modifier
 * sequence, and skin-toned ZWJ forms such as a technologist with a tone —
 * stays with the CLI: `npx pdfnative-build-emoji-font --sequence-list
 * 1F468-1F3FB-200D-1F4BB,…`.
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

/** The five Fitzpatrick skin-tone modifiers, light to dark. */
const SKIN_TONES: readonly number[] = [0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF];

/**
 * Modifier bases bundled in every skin tone (v1.8.0). Each is an
 * Emoji_Modifier_Base whose untoned form already ships in the curated set.
 * RGI modifier sequences carry no variation selector, so ✌ + tone is the
 * complete sequence.
 */
export const SKIN_TONE_BASES: readonly number[] = [
    // Gestures
    0x1F44D, // 👍 thumbs up
    0x1F44E, // 👎 thumbs down
    0x1F44F, // 👏 clapping hands
    0x1F64F, // 🙏 folded hands
    0x1F44B, // 👋 waving hand
    0x1F91D, // 🤝 handshake
    0x270C,  // ✌ victory hand
    0x1F44C, // 👌 OK hand
    0x270B,  // ✋ raised hand
    0x270A,  // ✊ raised fist
    0x1F44A, // 👊 oncoming fist
    0x1F91E, // 🤞 crossed fingers
    0x1F4AA, // 💪 flexed biceps
    0x261D,  // ☝ index pointing up
    0x1F449, // 👉 backhand index pointing right
    0x1F448, // 👈 backhand index pointing left
    0x1F446, // 👆 backhand index pointing up
    0x1F447, // 👇 backhand index pointing down
    0x1F64C, // 🙌 raising hands
    0x270D,  // ✍ writing hand
    // People
    0x1F476, // 👶 baby
    0x1F9D2, // 🧒 child
    0x1F466, // 👦 boy
    0x1F467, // 👧 girl
    0x1F9D1, // 🧑 person
    0x1F468, // 👨 man
    0x1F469, // 👩 woman
    0x1F9D3, // 🧓 older person
    0x1F474, // 👴 old man
    0x1F475, // 👵 old woman
];

/** Every bundled base in every tone, bases in list order, tones light to dark. */
export const CURATED_SKIN_TONES: readonly (readonly number[])[] =
    SKIN_TONE_BASES.flatMap(base => SKIN_TONES.map(tone => [base, tone]));

/** The complete bundled sequence set, flags first, byte-stable order. */
export const CURATED_SEQUENCES: readonly (readonly number[])[] = [
    ...CURATED_FLAGS.map(flagSequence),
    ...CURATED_ZWJ,
    ...CURATED_SKIN_TONES,
];
