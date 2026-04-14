/**
 * Text shaping deep-dive — Thai GSUB/GPOS, Bengali conjuncts, Tamil split vowels.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {

    // ── 1. Thai GSUB/GPOS shaping ───────────────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['th']);
        const params: DocumentParams = {
            title: 'Thai Text Shaping – GSUB/GPOS Deep Dive',
            blocks: [
                { type: 'heading', text: 'Thai Text Shaping — GSUB + GPOS', level: 1 },
                { type: 'paragraph', text: 'Thai script uses combining marks (tone marks, vowel above/below, Sara Am) positioned via OpenType GPOS anchors. GSUB substitutes presentation forms for mark clusters.' },

                { type: 'heading', text: 'Tone Marks & Above Vowels', level: 2 },
                { type: 'paragraph', text: 'กา กี กู เก แก ไก โก ก็ กั กิ์ กื กึ' },
                { type: 'paragraph', text: 'Combining diacritics stack above/below base consonants using mark-to-base and mark-to-mark GPOS. Each tone mark (่ ้ ๊ ๋) is anchored to the consonant or preceding vowel mark.' },

                { type: 'heading', text: 'Sara Am Decomposition', level: 2 },
                { type: 'paragraph', text: 'กำ คำ จำ ขำ ทำ ลำ' },
                { type: 'paragraph', text: 'Sara Am (ำ) decomposes into Nikhahit (ํ) + Sara Aa (า). GSUB rewrites the cluster so Nikhahit attaches above the base consonant.' },

                { type: 'heading', text: 'Full Sentences', level: 2 },
                { type: 'paragraph', text: 'สวัสดีครับ ยินดีต้อนรับสู่ระบบการสร้างเอกสาร PDF' },
                { type: 'paragraph', text: 'ภาษาไทยใช้ระบบ OpenType สำหรับการจัดตำแหน่งสระและวรรณยุกต์' },

                { type: 'heading', text: 'Edge Cases: Stacking', level: 2 },
                { type: 'paragraph', text: 'กิ่ กี้ กื๊ กึ๋ — multiple marks stacked: vowel + tone on same base.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Thai Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping-thai.pdf'), 'shaping-thai.pdf', buildDocumentPDFBytes(params));
    }

    // ── 2. Bengali conjunct formation ────────────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['bn']);
        const params: DocumentParams = {
            title: 'Bengali Text Shaping – Conjuncts & Marks',
            blocks: [
                { type: 'heading', text: 'Bengali Text Shaping — GSUB Conjuncts', level: 1 },
                { type: 'paragraph', text: 'Bengali uses Hasanta (্) to form conjunct consonants. GSUB lookup tables replace consonant + Hasanta + consonant sequences with precomposed conjunct glyphs.' },

                { type: 'heading', text: 'Basic Conjuncts', level: 2 },
                { type: 'paragraph', text: 'ক্ষ (ক + ্ + ষ), জ্ঞ (জ + ্ + ঞ), ত্র (ত + ্ + র), দ্ধ (দ + ্ + ধ)' },
                { type: 'paragraph', text: 'ন্ত (ন + ্ + ত), স্ত (স + ্ + ত), ম্প (ম + ্ + প), ঙ্গ (ঙ + ্ + গ)' },

                { type: 'heading', text: 'Mark Positioning (GPOS)', level: 2 },
                { type: 'paragraph', text: 'কি কী কু কূ কে কৈ কো কৌ' },
                { type: 'paragraph', text: 'Dependent vowel signs are positioned around the base consonant via GPOS mark-to-base anchors.' },

                { type: 'heading', text: 'Full Sentences', level: 2 },
                { type: 'paragraph', text: 'বাংলা ভাষায় যুক্তাক্ষর গঠনের জন্য হসন্ত ব্যবহার করা হয়।' },
                { type: 'paragraph', text: 'এই পিডিএফ নথিটি সম্পূর্ণরূপে TypeScript দিয়ে তৈরি।' },

                { type: 'heading', text: 'Three-Consonant Conjuncts', level: 2 },
                { type: 'paragraph', text: 'ক্ষ্ম (ক + ্ + ষ + ্ + ম), ন্ত্র (ন + ্ + ত + ্ + র)' },
                { type: 'paragraph', text: 'Triple conjuncts chain two Hasanta characters to join three consonants into a single visual glyph.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Bengali Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping-bengali.pdf'), 'shaping-bengali.pdf', buildDocumentPDFBytes(params));
    }

    // ── 3. Tamil split vowel decomposition ───────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['ta']);
        const params: DocumentParams = {
            title: 'Tamil Text Shaping – Split Vowels & GSUB',
            blocks: [
                { type: 'heading', text: 'Tamil Text Shaping — Split Vowels', level: 1 },
                { type: 'paragraph', text: 'Tamil split vowels (கொ, கோ, கௌ) decompose into left and right parts that wrap around the base consonant. GSUB lookup tables handle the reordering.' },

                { type: 'heading', text: 'Split Vowel Signs', level: 2 },
                { type: 'paragraph', text: 'கொ (க + ொ), கோ (க + ோ), கௌ (க + ௌ)' },
                { type: 'paragraph', text: 'Each split vowel is decomposed: ொ → ெ + ா, ோ → ே + ா, ௌ → ெ + ௗ. The left part renders before the consonant, the right part after.' },

                { type: 'heading', text: 'Dependent Vowels', level: 2 },
                { type: 'paragraph', text: 'கா கி கீ கு கூ கெ கே கை' },
                { type: 'paragraph', text: 'Standard dependent vowels attach directly to the base consonant without splitting.' },

                { type: 'heading', text: 'Full Sentences', level: 2 },
                { type: 'paragraph', text: 'தமிழ் மொழியில் பிரிந்த உயிரெழுத்துக்கள் மிக முக்கியம்.' },
                { type: 'paragraph', text: 'இந்த PDF ஆவணம் முழுவதும் TypeScript இல் உருவாக்கப்பட்டது.' },

                { type: 'heading', text: 'Consonant Clusters', level: 2 },
                { type: 'paragraph', text: 'க்ஷ (க + ் + ஷ), ஸ்ரீ (ஸ + ் + ர + ீ)' },
                { type: 'paragraph', text: 'Tamil uses Pulli (்) as a virama to suppress the inherent vowel and form consonant clusters.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Tamil Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping-tamil.pdf'), 'shaping-tamil.pdf', buildDocumentPDFBytes(params));
    }
}
