/**
 * Visual-regression fixtures.
 *
 * Self-contained, deterministic extreme-script documents built with the REAL
 * bundled fonts (so embedded `glyf` outlines exist for rasterisation). These
 * fixtures do not depend on the sample-generation pipeline or on
 * `test-output/`; they are the single source of truth for both the
 * glyph-position snapshot guard and the rendered-glyph pixel diff.
 *
 * TEST-ONLY tooling — not part of the published library.
 */

import { registerFonts, loadFontData, buildDocumentPDFBytes } from '../../src/index.js';
import type { FontLoader, FontEntry, DocumentParams } from '../../src/index.js';

const fl = (loader: () => Promise<unknown>): FontLoader => loader as FontLoader;

let registered = false;
function registerVisualFonts(): void {
    if (registered) return;
    registerFonts({
        ta: fl(() => import('../../fonts/noto-tamil-data.js')),
        bn: fl(() => import('../../fonts/noto-bengali-data.js')),
        hi: fl(() => import('../../fonts/noto-devanagari-data.js')),
        ar: fl(() => import('../../fonts/noto-arabic-data.js')),
        he: fl(() => import('../../fonts/noto-hebrew-data.js')),
        th: fl(() => import('../../fonts/noto-thai-data.js')),
        lo: fl(() => import('../../fonts/noto-lao-data.js')),
        nod: fl(() => import('../../fonts/noto-taitham-data.js')),
        cjm: fl(() => import('../../fonts/noto-cham-data.js')),
        km: fl(() => import('../../fonts/noto-khmer-data.js')),
        my: fl(() => import('../../fonts/noto-myanmar-data.js')),
        si: fl(() => import('../../fonts/noto-sinhala-data.js')),
    });
    registered = true;
}

async function entries(langs: string[]): Promise<FontEntry[]> {
    const out: FontEntry[] = [];
    for (let i = 0; i < langs.length; i++) {
        const fd = await loadFontData(langs[i]);
        if (fd) out.push({ fontData: fd, fontRef: `/F${3 + i}`, lang: langs[i] });
    }
    return out;
}

export interface Fixture {
    readonly name: string;
    readonly build: () => Promise<Uint8Array>;
}

export const FIXTURES: readonly Fixture[] = [
    {
        name: 'tamil',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['ta']);
            const params: DocumentParams = {
                title: 'Tamil shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Tamil — conjuncts and split vowels', level: 1 },
                    { type: 'paragraph', text: 'தமிழ் எழுத்துரு வடிவமைப்பு சோதனை: க்ஷ ஸ்ரீ ணௌ கௌ. பிளவு உயிர்மெய் எழுத்துக்கள்.' },
                    { type: 'paragraph', text: 'வணக்கம் உலகம் — Hello World 12345.' },
                    { type: 'list', items: ['முதல் உருப்படி', 'இரண்டாவது உருப்படி', 'மூன்றாவது'], style: 'bullet' },
                ],
                footerText: 'tamil fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params);
        },
    },
    {
        name: 'bengali-devanagari',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['bn', 'hi']);
            const params: DocumentParams = {
                title: 'Bengali + Devanagari fixture',
                blocks: [
                    { type: 'heading', text: 'Bengali conjuncts', level: 1 },
                    { type: 'paragraph', text: 'বাংলা যুক্তাক্ষর পরীক্ষা: ক্ষ জ্ঞ ত্র ন্ত্র স্ক্র। য-ফলা ও র-ফলা।' },
                    { type: 'heading', text: 'Devanagari reph + matras', level: 2 },
                    { type: 'paragraph', text: 'देवनागरी संयुक्ताक्षर: क्ष त्र ज्ञ श्र। रेफ और मात्रा का सही स्थान।' },
                ],
                footerText: 'indic fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params);
        },
    },
    {
        name: 'arabic',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['ar']);
            const params: DocumentParams = {
                title: 'Arabic shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Arabic positional shaping', level: 1 },
                    { type: 'paragraph', text: 'السلام عليكم ورحمة الله وبركاته. لا إله إلا الله محمد رسول الله.' },
                    { type: 'paragraph', text: 'النص يحتوي على حروف متصلة ومفصولة مع الـ ligatures.' },
                ],
                footerText: 'arabic fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params);
        },
    },
    {
        name: 'lao',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['lo']);
            const params: DocumentParams = {
                title: 'Lao shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Lao — leading vowels and contextual marks', level: 1 },
                    // Leading vowels render left of a base that follows them in memory.
                    { type: 'paragraph', text: 'ເກ ແກ ໂກ ໃກ ໄກ — ສະບາຍດີ ພາສາລາວ.' },
                    // Tall and descender bases pull different mark variants.
                    { type: 'paragraph', text: 'ປີ ກີ ຊຸ ກຸ ງຸ — ກ່ ກ້ ກ໊ ກ໋.' },
                    // Sara am decomposes; the pali virama sits below its base.
                    { type: 'paragraph', text: 'ກຳ ພຣ຺ະ — ໐ ໑ ໒ ໓ ໔.' },
                ],
                footerText: 'lao fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params, { creationDate: new Date('2026-01-01T00:00:00Z') });
        },
    },
    {
        name: 'taitham-cham',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['nod', 'cjm']);
            const params: DocumentParams = {
                title: 'Tai Tham + Cham fixture',
                blocks: [
                    { type: 'heading', text: 'Tai Tham \u2014 sakot stacks and pre-base vowels', level: 1 },
                    // Composed base + pre-base vowel, then two sakot stacks.
                    { type: 'paragraph', text: '\u1A20\u1A6E \u1A3E\u1A6E \u1A20\u1A60\u1A20 \u1A32\u1A62\u1A60\u1A45 \u1A3F\u1A60\u1A3F.' },
                    { type: 'paragraph', text: '\u1A20\u1A63 \u1A20\u1A65 \u1A20\u1A69 \u1A20\u1A75 \u1A20\u1A77.' },
                    { type: 'heading', text: 'Cham \u2014 pre-base vowels and composed medials', level: 2 },
                    { type: 'paragraph', text: '\uAA00\uAA2F \uAA00\uAA30 \uAA00\uAA35\uAA36 \uAA00\uAA4C \uAA00\uAA2A.' },
                ],
                footerText: 'tai tham + cham fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params, { creationDate: new Date('2026-01-01T00:00:00Z') });
        },
    },
    {
        name: 'khmer',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['km']);
            const params: DocumentParams = {
                title: 'Khmer shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Khmer \u2014 coeng stacks, pre-base vowels, robat', level: 1 },
                    // Coeng subscripts, one and two deep.
                    { type: 'paragraph', text: '\u1780\u17D2\u1780 \u179F\u17D2\u178F \u1784\u17D2\u1780 \u1780\u17D2\u179A\u17D2\u1798.' },
                    // Pre-base vowels, which render left of a base that follows them.
                    { type: 'paragraph', text: '\u1780\u17C1 \u1780\u17C2 \u1780\u17C3 \u1780\u17BE \u1780\u17C4.' },
                    // Robat U+17CC, and marks stacked on marks.
                    { type: 'paragraph', text: '\u1780\u17CC \u1780\u17BB\u17C6 \u1780\u17B7\u17CB \u2014 \u1797\u17B6\u179F\u17B6\u1781\u17D2\u1798\u17C2\u179A.' },
                ],
                footerText: 'khmer fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params, { creationDate: new Date('2026-01-01T00:00:00Z') });
        },
    },
    {
        name: 'myanmar',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['my']);
            const params: DocumentParams = {
                title: 'Myanmar shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Myanmar \u2014 kinzi, medials, stacks', level: 1 },
                    // Kinzi: nga + asat + virama, drawn above the following base.
                    { type: 'paragraph', text: '\u1004\u103A\u1039\u1000 \u1004\u103A\u1039\u1015.' },
                    // The four medials, alone and combined.
                    { type: 'paragraph', text: '\u1000\u103B \u1000\u103C \u1000\u103D \u1000\u103E \u1000\u103C\u103D.' },
                    // Stacked consonants and marks on marks.
                    { type: 'paragraph', text: '\u1000\u1039\u1000 \u1000\u102D\u102F \u1019\u103C\u1014\u103A\u1019\u102C.' },
                ],
                footerText: 'myanmar fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params, { creationDate: new Date('2026-01-01T00:00:00Z') });
        },
    },
    {
        name: 'sinhala',
        build: async () => {
            registerVisualFonts();
            const fontEntries = await entries(['si']);
            const params: DocumentParams = {
                title: 'Sinhala shaping fixture',
                blocks: [
                    { type: 'heading', text: 'Sinhala \u2014 conjuncts, split vowels, al-lakuna', level: 1 },
                    // Touching conjuncts through the al-lakuna U+0DCA.
                    { type: 'paragraph', text: '\u0D9A\u0DCA\u0D9A \u0DAF\u0DCA\u0DC0 \u0D9A\u0DCA\u200D\u0DBB.' },
                    // Split vowels, whose parts sit on both sides of the base.
                    { type: 'paragraph', text: '\u0D9A\u0DD9 \u0D9A\u0DDA \u0D9A\u0DDC \u0D9A\u0DDD \u0D9A\u0DDE.' },
                    { type: 'paragraph', text: '\u0DC3\u0DD2\u0D82\u0DC4\u0DBD \u2014 \u0DC1\u0DCA\u200D\u0DBB\u0DD3.' },
                ],
                footerText: 'sinhala fixture',
                fontEntries,
            };
            return buildDocumentPDFBytes(params, { creationDate: new Date('2026-01-01T00:00:00Z') });
        },
    },
];
