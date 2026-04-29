/**
 * Extreme-script shaping samples — visual regression baseline.
 *
 * These samples exercise the most demanding cases for our text-shaping
 * pipeline: deep BiDi mixing across 3+ scripts, complex Indic conjuncts
 * with reph + multi-halant chains, isolated Arabic harakat, and Thai
 * mark stacking on tall consonants. They serve both as showcase PDFs
 * (test-output/extreme/) and as regression anchors when shaping rules
 * evolve.
 *
 * Output: test-output/extreme/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. Extreme BiDi: Arabic + Hebrew + Thai + Latin + digits ─
    {
        const fontEntries = await loadSelectedFontEntries(['ar', 'he', 'th']);
        if (fontEntries.length === 3) {
            const params: DocumentParams = {
                title: 'Extreme BiDi — Arabic + Hebrew + Thai + Latin',
                blocks: [
                    { type: 'heading', text: 'Extreme BiDi — Arabic + Hebrew + Thai + Latin + Numerals', level: 1 },
                    { type: 'paragraph', text: 'Multi-script bidirectional paragraph with Arabic, Hebrew, Thai, Latin, and ASCII digits. The UAX #9 simplified implementation must resolve paragraph level, weak/neutral types, and reorder runs while preserving punctuation affinity and bracket pairing.' },

                    { type: 'heading', text: 'Arabic shaping with diacritics', level: 2 },
                    { type: 'paragraph', text: 'هذا اختبار للـ shaping المتقدم في اللغة العربية: السلام عليكم ورحمة الله وبركاته. النص يحتوي على حروف متصلة ومفصولة. اختبار الـ ligatures: لا إله إلا الله محمد رسول الله.' },

                    { type: 'heading', text: 'Hebrew with niqqud', level: 2 },
                    { type: 'paragraph', text: 'בדיקה של טקסט עברי מורכב עם ניקוד: שָׁלוֹם עֲלֵיכֶם. זהו מבחן לשילוב של אותיות, ניקוד וסימנים. בדיקת BiDi: שלום עולם — Hello World.' },

                    { type: 'heading', text: 'Thai cluster shaping', level: 2 },
                    { type: 'paragraph', text: 'การทดสอบภาษาไทย: สวัสดีครับ ขอบคุณมากครับ การประมวลผลข้อความที่มีพยัญชนะและสระและวรรณยุกต์ซ้อนกันต้องวางตำแหน่งให้ถูกต้อง.' },

                    { type: 'heading', text: 'Heavy mixed BiDi', level: 2 },
                    { type: 'paragraph', text: 'مثال BiDi قوي: السلام عليكم 654321 — שלום עולם — สวัสดี + Hello from Thailand 789 (mix Arabic + Hebrew + Thai + English + numbers).' },
                    { type: 'paragraph', text: 'هذا النص العربي الطويل جدًا لاختبار خوارزمية BiDi و line-breaking والـ shaping في الوقت نفسه. يجب أن يتم عرضه من اليمين إلى اليسار بشكل صحيح مع الحفاظ على السياق والروابط بين الحروف حتى في الجمل الطويلة والمعقدة التي تحتوي على أرقام وكلمات أجنبية.' },

                    { type: 'heading', text: 'Bullet stress', level: 2 },
                    { type: 'list', items: [
                        'اختبار shaping عربي: الله أكبر',
                        'בדיקת עברית: ברכות',
                        'การทดสอบภาษาไทย: สวัสดีครับ',
                        'مثال مختلط: مرحبا — שלום — สวัสดี',
                    ], style: 'bullet' },
                ],
                footerText: 'pdfnative — extreme BiDi visual regression baseline',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'extreme', 'extreme-bidi.pdf'), 'extreme/extreme-bidi.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 2. Tamil ultra-extreme: deep conjuncts + split vowels + BiDi mix
    {
        const fontEntries = await loadSelectedFontEntries(['ta', 'ar']);
        if (fontEntries.length === 2) {
            const params: DocumentParams = {
                title: 'Extreme Tamil — Conjuncts, Split Vowels, BiDi Mix',
                blocks: [
                    { type: 'heading', text: 'Tamil ultra-extreme — shaping & positioning', level: 1 },
                    { type: 'paragraph', text: 'எழுத்துக்களின் stacking சோதனை: க கா கி கீ கு கூ கெ கே கை கொ கோ கௌ க்ஷ க்ஷி க்ஷீ க்ஷு க்ஷூ க்ஷெ க்ஷே க்ஷை க்ஷொ க்ஷோ க்ஷௌ.' },
                    { type: 'paragraph', text: 'இது ஒரு மிக நீண்ட தமிழ் வரிக்கையம். இதில் எழுத்துக்களின் இணைப்பு, உயிர்மெய் எழுத்துக்கள், ஒற்றெழுத்துக்கள், சிந்த, வில்லினம் மெல்லினம் இடையினம் ஆகியவற்றின் சரியான விடவமைப்பை சேரிதிக்கிறோம். தமிழ் மொழியின் எழுத்து அமைப்பு மிகவும் சிக்கலானது.' },
                    { type: 'paragraph', text: 'BiDi extreme mix: வணக்கம் ௧௨௩௪௫ — 123456 — السلام عليكم — Hello from தமிழ்நாடு (Tamil + Arabic + English + numbers).' },
                    { type: 'list', items: [
                        'லக்ஷ்மீ சோதனை: தமிழ்நாடு செய்ய்யவென்ன',
                        'உயிர்மெய் stacking: கி கீ கு கூ கெ கே',
                        'BiDi mix: வணக்கம் — مرحبا — Hello',
                        'எண்கள்: ௧௨௩௪௫௬௭௮௯௦',
                    ], style: 'bullet' },
                    { type: 'paragraph', text: 'முடிவு: pdfnative நூலகம் தமிழ் எழுத்துக்களை pure TypeScript இல் சிறப்பாக கையாளுகிறது என்று நம்புகிறோம். இது ஒரு சிறந்த முயற்சி. தமிழ் மொழியின் சிக்கலான எழுத்து விடவமைப்பை சரியாக ரெண்டர் செய்யும் திறன் மிக முக்கியம்.' },
                ],
                footerText: 'pdfnative — extreme Tamil visual regression baseline',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'extreme', 'extreme-tamil.pdf'), 'extreme/extreme-tamil.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 3. Bengali + Devanagari ultra-extreme: reph + multi-halant ─
    {
        const fontEntries = await loadSelectedFontEntries(['bn', 'hi', 'ar']);
        if (fontEntries.length === 3) {
            const params: DocumentParams = {
                title: 'Extreme Bengali + Devanagari — Reph, Conjuncts, Matras',
                blocks: [
                    { type: 'heading', text: 'Bengali & Devanagari extreme — shaping & positioning', level: 1 },
                    { type: 'paragraph', text: 'বাংলা stacking ও conjuncts পরীক্ষা: ক কা কি কী কু কূ কে কৈ কো কৌ ক্ত ক্ক ক্ষ ক্ষ্ম ক্ষ্ণ ক্ল ক্ব ক্য ক্র ক্ল ক্শ ক্ষ্ণ ক্ষ্ম ক্রু লক্ষ্মী.' },
                    { type: 'paragraph', text: 'देवनागरी stacking और conjuncts परीक्षा: क का कि की कु कू के कै को कौ क्त क्क क्ष क्ष्म क्ष्ण क्ल क्व क्म क्य क्र क्ल क्ष्ण क्र क्लु क्ष्मी.' },
                    { type: 'paragraph', text: 'এটি একটি অত্যন্ত দীর্ঘ বাংলা বাক্য যা লাইন ব্রেকিং, শেপিং এবং যুক্তাক্ষরের সঠিক অবস্থান পরীক্ষা করে। বাংলা লিপির জটিলতা অনেক বেশি, বিশেষ করে যুক্তাক্ষর এবং স্বরচিহ্নের সঠিক স্থাপনা।' },
                    { type: 'paragraph', text: 'यह एक अत्यंत लंबा देवनागरी वाक्य है जो लाइन ब्रेकिंग, शेपिंग और संयुक्ताक्षर की सही स्थिति की परीक्षा करता है। देवनागरी लिपि की जटिलता बहुत अधिक है, विशेष रूप से संयुक्ताक्षर और स्वर चिह्नों की सही स्थापना में।' },
                    { type: 'paragraph', text: 'BiDi extreme mix: বাংলা ১২৩৪৫ — हिंदी ६७८९० — السلام عليكم — Hello from বাংলাদেশ और भारत (Bengali + Devanagari + Arabic + English).' },
                    { type: 'list', items: [
                        'বাংলা যুক্তাক্ষর: ক্ষ ক্ষ্ম ক্ষ্ণ ক্র ক্ল',
                        'देवनागरी conjuncts: क्ष क्ष्म क्ष्ण क्र क्ल',
                        'BiDi mix: বাংলা — हिंदी — مرحبا — Hello',
                        'সংখ্যা: ১২৩৪৫৬৭৮৯০ — १२३४५६७८९०',
                    ], style: 'bullet' },
                    { type: 'paragraph', text: 'সারাংশ: pdfnative লাইব্রেরি বাংলা ও দেবনাগরী লিপির shaping pure TypeScript-এ ভালোভাবে পরিচালনা করছে বলে মনে হয়। এটি একটি প্রশংসনীয় প্রচেষ্টা।' },
                ],
                footerText: 'pdfnative — extreme Bengali + Devanagari visual regression baseline',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'extreme', 'extreme-bengali-devanagari.pdf'), 'extreme/extreme-bengali-devanagari.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 4. Arabic harakat regression — isolated diacritic stress ──
    {
        const fontEntries = await loadSelectedFontEntries(['ar']);
        if (fontEntries.length === 1) {
            const params: DocumentParams = {
                title: 'Extreme Arabic — Harakat & Tashkeel Anchoring',
                blocks: [
                    { type: 'heading', text: 'Arabic harakat — isolated and contextual', level: 1 },
                    { type: 'paragraph', text: 'النص محرَّك بالكامل: بِسْمِ ٱللَّٰهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ — ٱلْحَمْدُ لِلَّٰهِ رَبِّ ٱلْعَٰلَمِينَ.' },
                    { type: 'paragraph', text: 'علامات التشكيل المعزولة على التطويل: ـَ ـِ ـُ ـً ـٍ ـٌ ـّ ـْ.' },
                    { type: 'paragraph', text: 'مع التشكيل المركَّب: مَدَرَسَةٌ — كِتَابٌ — قَلَمٌ — طَالِبٌ — مُعَلِّمَةٌ.' },
                    { type: 'paragraph', text: 'النص الكامل المركَّب: ٱلسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ ٱللَّٰهِ وَبَرَكَاتُهُ.' },
                    { type: 'list', items: [
                        'فتحة: ـَ',
                        'كسرة: ـِ',
                        'ضمة: ـُ',
                        'تنوين الفتح: ـً',
                        'تنوين الكسر: ـٍ',
                        'تنوين الضم: ـٌ',
                        'شدة: ـّ',
                        'سكون: ـْ',
                    ], style: 'bullet' },
                ],
                footerText: 'pdfnative — extreme Arabic harakat visual regression baseline',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'extreme', 'extreme-arabic-harakat.pdf'), 'extreme/extreme-arabic-harakat.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 5. UAX #9 isolates regression — LRI / RLI / FSI / PDI ────
    {
        const fontEntries = await loadSelectedFontEntries(['ar', 'he']);
        if (fontEntries.length === 2) {
            // U+2066 LRI, U+2067 RLI, U+2068 FSI, U+2069 PDI
            const LRI = '\u2066';
            const RLI = '\u2067';
            const FSI = '\u2068';
            const PDI = '\u2069';
            const params: DocumentParams = {
                title: 'Extreme BiDi — UAX #9 Isolates (LRI / RLI / FSI / PDI)',
                blocks: [
                    { type: 'heading', text: 'UAX #9 isolates — v1.1.0 regression baseline', level: 1 },
                    { type: 'paragraph', text: 'pdfnative v1.1.0 honours the four Unicode bidirectional isolate characters (U+2066 LRI, U+2067 RLI, U+2068 FSI, U+2069 PDI). Isolated runs are resolved with a forced paragraph level and recursed independently of the surrounding context.' },

                    { type: 'heading', text: 'LRI inside an RTL paragraph', level: 2 },
                    { type: 'paragraph', text: `\u0627\u0644\u0639\u0646\u0648\u0627\u0646: ${LRI}pdfnative v1.1.0${PDI} \u0635\u062f\u0631 \u0641\u064a 2026.` },

                    { type: 'heading', text: 'RLI inside an LTR paragraph', level: 2 },
                    { type: 'paragraph', text: `Document title: ${RLI}\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645${PDI} appears between Latin words.` },

                    { type: 'heading', text: 'Nested isolates (FSI auto-detect)', level: 2 },
                    { type: 'paragraph', text: `Outer LTR ${FSI}\u05e9\u05dc\u05d5\u05dd ${LRI}Hello${PDI} \u05e2\u05d5\u05dc\u05dd${PDI} continues.` },

                    { type: 'heading', text: 'Unmatched isolates fall through', level: 2 },
                    { type: 'paragraph', text: `Open ${LRI}without close — graceful fallback (no PDI here).` },

                    { type: 'list', items: [
                        `LRI demo: ${LRI}forced LTR${PDI}`,
                        `RLI demo: ${RLI}forced RTL${PDI}`,
                        `FSI demo: ${FSI}first-strong${PDI}`,
                        'PDI closes the most recent matching isolate',
                    ], style: 'bullet' },
                ],
                footerText: 'pdfnative — UAX #9 isolates visual regression baseline',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'extreme', 'extreme-bidi-isolates.pdf'), 'extreme/extreme-bidi-isolates.pdf', buildDocumentPDFBytes(params));
        }
    }
}
