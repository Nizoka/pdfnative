/**
 * Text shaping deep-dive — Thai GSUB/GPOS, Bengali conjuncts, Tamil split vowels, Telugu virama clusters,
 * Sinhala kombuva reordering, Tibetan subjoined stacking, Khmer coeng, Myanmar medials.
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
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-thai.pdf'), 'shaping/shaping-thai.pdf', buildDocumentPDFBytes(params));
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
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-bengali.pdf'), 'shaping/shaping-bengali.pdf', buildDocumentPDFBytes(params));
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
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-tamil.pdf'), 'shaping/shaping-tamil.pdf', buildDocumentPDFBytes(params));
    }

    // ── 4. Telugu virama-mediated conjuncts ──────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['te']);
        const params: DocumentParams = {
            title: 'Telugu Text Shaping – Virama Clusters & Marks',
            blocks: [
                { type: 'heading', text: 'Telugu Text Shaping — Virama + GSUB + GPOS', level: 1 },
                { type: 'paragraph', text: 'Telugu uses virama-mediated consonant clusters with script-specific ligature behaviour. Vowel signs and modifiers are positioned via mark anchors with no Devanagari-style reph handling.' },

                { type: 'heading', text: 'Virama Clusters', level: 2 },
                { type: 'paragraph', text: 'క్ క్ష జ్ఞ శ్ర త్ర ద్ర గ్న' },
                { type: 'paragraph', text: 'These sequences exercise consonant + virama + consonant cluster formation and common ligature paths.' },

                { type: 'heading', text: 'Vowel Signs & Modifiers', level: 2 },
                { type: 'paragraph', text: 'కా కి కీ కు కూ కె కే కొ కో కౌ కం కః' },
                { type: 'paragraph', text: 'Dependent vowels and modifiers attach around the base consonant according to GPOS anchors in the Telugu font.' },

                { type: 'heading', text: 'Full Sentences', level: 2 },
                { type: 'paragraph', text: 'తెలుగు పాఠ్యం సరైన శేపింగ్‌తో PDF లో స్పష్టంగా కనిపిస్తుంది.' },
                { type: 'paragraph', text: 'విరామం, గుణింతాలు, సంయుక్తాక్షరాలు అన్నీ సక్రమంగా రెండర్ అవుతాయి.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Telugu Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-telugu.pdf'), 'shaping/shaping-telugu.pdf', buildDocumentPDFBytes(params));
    }

    // ── 5. Sinhala virama conjuncts & kombuva reordering ─────────
    {
        const fontEntries = await loadSelectedFontEntries(['si']);
        const params: DocumentParams = {
            title: 'Sinhala Text Shaping – Conjuncts & Kombuva',
            blocks: [
                { type: 'heading', text: 'Sinhala Text Shaping — Virama + Reordering', level: 1 },
                { type: 'paragraph', text: 'Sinhala uses virama-mediated conjunct clusters, pre-base kombuva (ේ) reordering, and two-part vowel decomposition handled by a pure-JS shaper.' },

                { type: 'heading', text: 'Full Sentence', level: 2 },
                { type: 'paragraph', text: '\u0DC3\u0DD2\u0D82\u0DC4\u0DBD \u0DB7\u0DCF\u0DC2\u0DCF\u0DC0\u0DD9\u0DB1\u0DCA PDF \u0DBD\u0DDA\u0D9B\u0DB1 \u0DC3\u0DEF\u0DBA\u0DD2, \u0DC3\u0D82\u0DBA\u0DDD\u0D9C \u0D85\u0D9A\u0DD4\u0DBB\u0DC4 \u0DC3\u0DC4 \u0DC3\u0DCA\u0DC0\u0DBB \u0DC3\u0D82\u0D9E\u0DCF \u0DC3\u0DB3\u0DC4\u0DCF \u0DC3\u0DB8\u0DCA\u0DB4\u0DD6\u0DBB\u0DCA\u0DAB \u0DC3\u0DC4\u0DCF\u0DBA \u0DC3\u0DB8\u0D9F.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Sinhala Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-sinhala.pdf'), 'shaping/shaping-sinhala.pdf', buildDocumentPDFBytes(params));
    }

    // ── 6. Tibetan subjoined-consonant stacking ──────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['bo']);
        const params: DocumentParams = {
            title: 'Tibetan Text Shaping – Subjoined Stacking',
            blocks: [
                { type: 'heading', text: 'Tibetan Text Shaping — Vertical Stacking', level: 1 },
                { type: 'paragraph', text: 'Tibetan stacks subjoined consonants vertically beneath the base consonant. GSUB selects subjoined forms; GPOS anchors position the stack.' },

                { type: 'heading', text: 'Full Sentence', level: 2 },
                { type: 'paragraph', text: 'pdfnative \u0F53\u0F72\u0F0B\u0F56\u0F7C\u0F51\u0F0B\u0F61\u0F72\u0F42\u0F0B\u0F42\u0F72\u0F0B PDF \u0F61\u0F72\u0F42\u0F0B\u0F46\u0F0B\u0F56\u0F5F\u0F7C\u0F0B\u0F56\u0F0B\u0F51\u0F44\u0F0B\u0F58\u0F72\u0F44\u0F0B\u0F42\u0F5E\u0F72\u0F0B\u0F56\u0FA9\u0F7A\u0F42\u0F66\u0F0B\u0F58\u0F0B\u0F63\u0F0B\u0F62\u0F92\u0FB1\u0F56\u0F0B\u0F66\u0F90\u0FB1\u0F7C\u0F62\u0F0B\u0F56\u0FB1\u0F7A\u0F51\u0F0D' },
            ],
            fontEntries,
            footerText: 'pdfnative – Tibetan Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-tibetan.pdf'), 'shaping/shaping-tibetan.pdf', buildDocumentPDFBytes(params));
    }

    // ── 7. Khmer coeng subscripts & pre-base vowels ──────────────
    {
        const fontEntries = await loadSelectedFontEntries(['km']);
        const params: DocumentParams = {
            title: 'Khmer Text Shaping – Coeng & Pre-base Vowels',
            blocks: [
                { type: 'heading', text: 'Khmer Text Shaping — USE-lite', level: 1 },
                { type: 'paragraph', text: 'Khmer uses coeng (subscript) consonant stacking, pre-base vowel reordering, and two-part vowel decomposition via a pragmatic USE-lite shaper.' },

                { type: 'heading', text: 'Full Sentence', level: 2 },
                { type: 'paragraph', text: 'pdfnative \u1794\u1784\u17D2\u1780\u17BE\u178F\u17AF\u1780\u179F\u17B6\u179A PDF \u1787\u17B6\u1797\u17B6\u179F\u17B6\u1781\u17D2\u1798\u17C2\u179A \u178A\u17C4\u1799\u1798\u17B6\u1793\u1780\u17B6\u179A\u1782\u17B6\u17C6\u1791\u17D2\u179A\u1796\u17C1\u1789\u179B\u17C1\u1789\u1785\u17C6\u1796\u17C4\u17C7\u1796\u17D2\u1799\u1789\u17D2\u1787\u1793\u17C8\u1787\u17BE\u1784 \u1793\u17B7\u1784\u179F\u17D2\u179A\u17C8\u17D4' },
            ],
            fontEntries,
            footerText: 'pdfnative – Khmer Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-khmer.pdf'), 'shaping/shaping-khmer.pdf', buildDocumentPDFBytes(params));
    }

    // ── 8. Myanmar medials & pre-base reordering ─────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['my']);
        const params: DocumentParams = {
            title: 'Myanmar Text Shaping – Medials & Reordering',
            blocks: [
                { type: 'heading', text: 'Myanmar Text Shaping — USE-lite', level: 1 },
                { type: 'paragraph', text: 'Myanmar shaping positions medial consonants, reorders pre-base medial-ra (U+103C) and e-vowel (U+1031), and stacks consonants via virama using a pragmatic USE-lite shaper.' },

                { type: 'heading', text: 'Full Sentence', level: 2 },
                { type: 'paragraph', text: 'pdfnative \u101E\u100A\u103A \u1019\u103C\u1014\u103A\u1019\u102C\u1018\u102C\u101E\u102C\u1016\u103C\u1004\u1037\u103A PDF \u1005\u102C\u101B\u103D\u1000\u103A\u1005\u102C\u1010\u1019\u103A\u1038\u1019\u103B\u102C\u1038\u1000\u102D\u102F \u1016\u1014\u103A\u1010\u102E\u1038\u1015\u103C\u102E\u1038 \u1017\u103B\u100A\u103A\u1038\u1010\u103D\u1032\u1014\u103E\u1004\u1037\u103A \u101E\u101B\u1019\u103B\u102C\u1038\u1000\u102D\u102F \u1015\u103C\u100A\u1037\u103A\u1005\u102F\u1036\u1005\u103D\u102C \u1015\u1036\u1037\u1015\u102D\u102F\u1038\u101E\u100A\u103A\u104B' },
            ],
            fontEntries,
            footerText: 'pdfnative – Myanmar Shaping Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'shaping', 'shaping-myanmar.pdf'), 'shaping/shaping-myanmar.pdf', buildDocumentPDFBytes(params));
    }
}
