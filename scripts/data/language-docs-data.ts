/**
 * Language conformance documents — one page per language, every edge case
 * of its script visible at once (v1.8.0).
 *
 * The 1.8.0 report on Devanagari, Tamil and Telugu showed what a per-language
 * sample is for: a reader who knows the script must be able to judge the
 * rendering of every construction on a single page. Each record below feeds
 * `document/doc-<name>.pdf` through `scripts/generators/document-builder.ts`:
 * a native title and paragraph, an "Edge cases" table whose left and right
 * columns are English and whose middle column carries the native sample,
 * a short native list, a footer. `tests/regression/language-docs.test.ts`
 * holds every document to one page and every sample to real glyphs.
 *
 * Every record carries a `lang` label: the native text is demonstration
 * content by nature (AGENTS.md, "English everywhere").
 */

/** One row of the "Edge cases" table. */
export interface LanguageEdgeCase {
    /** What the row exercises, in English. */
    readonly what: string;
    /** The native sample. */
    readonly sample: string;
    /** What a correct rendering shows, in English. */
    readonly note: string;
}

/** One language conformance document. */
export interface LanguageDoc {
    /** Font-registry key (`scripts/helpers/fonts.ts`). */
    readonly lang: string;
    /** Output name without extension, under `document/`. */
    readonly filename: string;
    /** English language name, for the subtitle and the docs. */
    readonly language: string;
    /** Script name, for the subtitle. */
    readonly script: string;
    /** Native title (heading 1). */
    readonly title: string;
    /** Native introductory paragraph. */
    readonly intro: string;
    readonly edgeCases: readonly LanguageEdgeCase[];
    /** Native list, three or four short items. */
    readonly list: readonly string[];
    readonly footer: string;
}

export const LANGUAGE_DOCS: readonly LanguageDoc[] = [
    {
        lang: 'th',
        filename: 'doc-thai',
        language: 'Thai',
        script: 'Thai',
        title: 'คู่มือผู้ใช้ – ระบบจัดการเอกสาร',
        intro: 'ยินดีต้อนรับสู่ระบบจัดการเอกสารอัจฉริยะ เอกสารฉบับนี้จะแนะนำขั้นตอนการใช้งานระบบอย่างละเอียด ระบบรองรับการสร้างเอกสาร PDF หลายภาษา รวมถึงภาษาไทยที่มีสระ วรรณยุกต์ และเครื่องหมายเฉพาะ',
        edgeCases: [
            { what: 'Tone mark over a vowel', sample: 'น้ำ ป้า ผู้ใช้ ตั้ง', note: 'mark-to-mark stacking' },
            { what: 'Above vowels', sample: 'สิ่ง ที่ ปี ถึง คือ', note: 'ิ ี ึ ื anchored above' },
            { what: 'Below vowels', sample: 'คุณ ผู้ ลูก ดู', note: 'ุ ู anchored below' },
            { what: 'Leading vowels', sample: 'เอกสาร แนะนำ โรงเรียน ใจ ไทย', note: 'เ แ โ ใ ไ before the consonant' },
            { what: 'Sara am', sample: 'น้ำ ทำ จำนวน', note: 'ำ decomposed into nikhahit + aa' },
            { what: 'Silent and tone-less marks', sample: 'สิทธิ์ ศิลป์ ฯลฯ', note: 'thanthakhat, repetition mark' },
            { what: 'Digits and currency', sample: '๑,๐๐๐ ฿990 ๒๕๖๙', note: 'Thai digits, baht' },
            { what: 'Mixed with Latin', sample: 'มาตรฐาน PDF/A-2b FlateDecode', note: 'ASCII inside the run' },
        ],
        list: ['สร้างเอกสาร PDF คุณภาพสูงแบบอัตโนมัติ', 'รองรับภาษาไทยพร้อมการจัดวางตัวอักษรที่ถูกต้อง (GSUB + GPOS)', 'เป็นไปตามมาตรฐาน PDF/A-2b'],
        footer: 'pdfnative – คู่มือผู้ใช้ระบบจัดการเอกสาร',
    },
    {
        lang: 'bn',
        filename: 'doc-bengali',
        language: 'Bengali',
        script: 'Bengali',
        title: 'বাংলা নথিপত্র – প্রতিবেদন',
        intro: 'এটি pdfnative লাইব্রেরির বাংলা নথিপত্র নির্মাণের প্রদর্শন। এই পাতায় শিরোনাম, অনুচ্ছেদ, তালিকা এবং সারণি রয়েছে, আর প্রতিটি যুক্তাক্ষর ও স্বরচিহ্ন এক পাতায় দেখা যায়।',
        edgeCases: [
            { what: 'Reph', sample: 'কর্ম ধর্ম বর্ণ সূর্য', note: 'র্ drawn over the following consonant' },
            { what: 'Ya-phala', sample: 'ব্যবস্থা সাহায্য ব্যাংক', note: '্য post-base form' },
            { what: 'Ra-phala', sample: 'প্রতিবেদন প্রধান গ্রাম', note: '্র below the base' },
            { what: 'Conjuncts', sample: 'ক্ষ জ্ঞ ষ্ণ ক্ত ন্ত্র স্ট', note: 'akhn and cjct forms' },
            { what: 'Pre-base vowel signs', sample: 'কি কে কৈ বিভক্ত দেশ', note: 'ি ে ৈ drawn to the left' },
            { what: 'Two-part vowel signs', sample: 'কো কৌ লোক নৌকা', note: 'ো ৌ split around the base' },
            { what: 'Nasal and visarga signs', sample: 'বাংলা চাঁদ দুঃখ সংযুক্ত', note: 'anusvara, candrabindu, visarga' },
            { what: 'Nukta and khanda ta', sample: 'ড় ঢ় য় ৎ পড়া', note: 'dotted consonants' },
            { what: 'Digits and currency', sample: '১,০০০ টাকা ৳ ২০২৬', note: 'Bengali digits, taka' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b সমর্থন ISO 32000-1', note: 'ASCII inside the run' },
        ],
        list: ['বাংলা OpenType শেপিং (GSUB + GPOS)', 'রেফ, য-ফলা ও র-ফলা', 'PDF/A-2b সমর্থন'],
        footer: 'pdfnative – বাংলা নথিপত্র নমুনা',
    },
    {
        lang: 'ta',
        filename: 'doc-tamil',
        language: 'Tamil',
        script: 'Tamil',
        title: 'தமிழ் ஆவணம் – முன்மாதிரி',
        intro: 'இது pdfnative நூலகத்தின் தமிழ் ஆவண உருவாக்கத்தின் முன்மாதிரியாகும். இந்த பக்கத்தில் தலைப்புகள், பத்திகள், பட்டியல்கள் மற்றும் அட்டவணை உள்ளன; ஒவ்வொரு உயிர்மெய்யும் ஒரே பக்கத்தில் காணலாம்.',
        edgeCases: [
            { what: 'i-matra to the right of its base', sample: 'விலை நிலை தமிழ் கிளி', note: 'ி stays after the consonant (the 1.8.0 report)' },
            { what: 'Pre-base vowel signs', sample: 'கெ கே கை செய் நேரம்', note: 'ெ ே ை drawn to the left' },
            { what: 'Two-part vowel signs', sample: 'கொ கோ கௌ போய் தோட்டம்', note: 'ொ ோ ௌ split around the base' },
            { what: 'Pulli', sample: 'ல் ண் ழ் அத்தியாயம் முடிந்தது', note: 'consonant + pulli forms (haln)' },
            { what: 'u and uu ligatures', sample: 'ரூ கு கூ மு நூல்', note: 'consonant–vowel ligatures (psts)' },
            { what: 'Conjuncts', sample: 'ஸ்ரீ க்ஷ', note: 'akhn ligatures' },
            { what: 'Grantha letters', sample: 'ஜ ஷ ஸ ஹ ஜப்பான்', note: 'Grantha consonants' },
            { what: 'Digits and symbols', sample: '௧,௦௦௦ ௨௦௨௬ ௹ ௳', note: 'Tamil digits, rupee, day sign' },
            { what: 'Long words', sample: 'முன்மாதிரியாகும் அம்சங்கள் மறுசீரமைப்பு', note: 'mark chains and wrapping' },
            { what: 'Aytham and Latin', sample: 'அஃது PDF/A-2b', note: 'spacing sign, ASCII inside the run' },
        ],
        list: ['தமிழ் OpenType வடிவமைப்பு (GSUB + GPOS)', 'முன்-அடிப்படை உயிர்க்குறிகள் மறுசீரமைப்பு', 'PDF/A-2b ஆதரவு'],
        footer: 'pdfnative – தமிழ் ஆவண மாதிரி',
    },
    {
        lang: 'hi',
        filename: 'doc-devanagari',
        language: 'Hindi',
        script: 'Devanagari',
        title: 'हिन्दी दस्तावेज़ – प्रदर्शन',
        intro: 'यह pdfnative पुस्तकालय के द्वारा हिन्दी (देवनागरी) में PDF निर्माण का नमूना है। इस दस्तावेज़ में शीर्षक, अनुच्छेद, सूची और तालिका शामिल हैं, और हर संयुक्ताक्षर एक ही पृष्ठ पर दिखता है।',
        edgeCases: [
            { what: 'i-matra reordered', sample: 'हिन्दी विकिपीडिया किताब', note: 'ि drawn to the left of its consonant' },
            { what: 'Above vowel signs', sample: 'सेवा वैसे रेल देश', note: 'े ै at their designed height (the 1.8.0 report)' },
            { what: 'Reph', sample: 'प्रदर्शन समर्थन कर्म पूर्ण', note: 'र् as a hook over the following consonant' },
            { what: 'Rakar', sample: 'प्रकार क्रम त्रुटि', note: '्र below the consonant' },
            { what: 'Half forms', sample: 'दस्तावेज़ सप्ताह विश्व', note: 'स्त प्त श्व join through half forms' },
            { what: 'Conjuncts', sample: 'क्ष ज्ञ त्र द्य श्र क्त', note: 'akhn and cjct ligatures' },
            { what: 'Nukta', sample: 'ज़रूरी क़लम फ़िल्म पढ़ना', note: 'dotted consonants' },
            { what: 'Post-base vowel signs', sample: 'कोई सौ लोग जाओ', note: 'ो ौ single glyphs to the right' },
            { what: 'Anusvara, candrabindu, visarga', sample: 'हैं चाँद अंत दुःख', note: 'zero-advance signs above and beside' },
            { what: 'Reph with i-matra', sample: 'र्कि सर्दी कार्तिक', note: 'both marks on one consonant' },
            { what: 'Digits and currency', sample: '₹ १,२३,४५६.७८ २०२६', note: 'Devanagari digits, rupee' },
            { what: 'Punctuation and Latin', sample: 'नमस्ते। PDF/A-2b ॥', note: 'danda, double danda, ASCII inside the run' },
        ],
        list: ['देवनागरी OpenType शेपिंग (GSUB + GPOS)', 'संयुक्ताक्षर, रेफ़ और मात्रा पुनर्व्यवस्था', 'PDF/A-2b समर्थन'],
        footer: 'pdfnative – हिन्दी दस्तावेज़ नमूना',
    },
    {
        lang: 'te',
        filename: 'doc-telugu',
        language: 'Telugu',
        script: 'Telugu',
        title: 'తెలుగు పత్రం – ప్రదర్శన',
        intro: 'ఇది pdfnative లైబ్రరీ ద్వారా తెలుగులో PDF రూపొందించడానికి ఒక ప్రాయోగిక ఉదాహరణ. ఈ పత్రంలో శీర్షికలు, అనుచ్ఛేదాలు, పట్టికలు మరియు తాలికల రెండరింగ్ ఉంటుంది; ప్రతి సంయుక్తాక్షరం ఒకే పేజీలో కనిపిస్తుంది.',
        edgeCases: [
            { what: 'Subjoined consonants', sample: 'ప్రదర్శన సంయుక్తాక్షరాల', note: 'ర శ stack below the base (the 1.8.0 report)' },
            { what: 'Three-consonant clusters', sample: 'క్ష స్త్రీ జ్ఞానం', note: 'akhn and stacked forms' },
            { what: 'Above vowel signs', sample: 'తెలుగు పేరు కైవల్యం', note: 'ె ే ై above and to the right' },
            { what: 'Below vowel signs', sample: 'పుస్తకం మూడు గురువు', note: 'ు ూ below' },
            { what: 'aa and i signs', sample: 'ప్రాథమిక పత్రికలు నమూనా', note: 'ా ి hooked to the right' },
            { what: 'Anusvara and visarga', sample: 'పత్రం అంశాలు దుఃఖం', note: 'zero-advance signs beside the base' },
            { what: 'Contextual vowel forms', sample: 'షేపింగ్ కొత్త రూపొందించడం', note: 'variants the font selects' },
            { what: 'Digits and currency', sample: '₹ 1,000 ౧౨౩ 2026', note: 'Telugu digits, rupee' },
            { what: 'Mixed with Latin', sample: 'CIDFont Type2 + Identity-H ఎన్‌కోడింగ్', note: 'ASCII inside the run, ZWNJ' },
        ],
        list: ['తెలుగు OpenType షేపింగ్ (GSUB + GPOS)', 'విరామ ఆధారిత యుక్తాక్షరాల ఏర్పాటు', 'PDF/A-2b అనుకూలత'],
        footer: 'pdfnative – తెలుగు పత్ర మాదరి',
    },
    {
        lang: 'si',
        filename: 'doc-sinhala',
        language: 'Sinhala',
        script: 'Sinhala',
        title: 'සිංහල ලේඛනය – pdfnative',
        intro: 'pdfnative සිංහල භාෂාවෙන් PDF ලේඛන සඳයි, සංයෝග අකුරහ සහ ස්වර සංඥා සඳහා සම්පූර්ණ සහාය සමඟ. මෙම පිටුවේ සෑම බැඳි අකුරක්ම එකවර දැකිය හැකිය.',
        edgeCases: [
            { what: 'Kombuva', sample: 'කෙ කේ කෛ දේශය', note: 'ෙ ේ ෛ drawn to the left' },
            { what: 'Two-part vowel signs', sample: 'කො කෝ කෞ ලෝකය', note: 'ො ෝ ෞ split around the base' },
            { what: 'Rakaransaya and yansaya', sample: 'ශ්‍රී ක්‍ය ප්‍ර', note: 'through al-lakuna + ZWJ' },
            { what: 'Touching conjuncts', sample: 'ක්‍ෂ ද්‍ධ', note: 'ZWJ conjuncts' },
            { what: 'Hal kirima', sample: 'ක් ත් ලංකාවේ', note: 'explicit al-lakuna' },
            { what: 'Above and below signs', sample: 'කි කී කු කූ', note: 'is-pilla, paa-pilla' },
            { what: 'Nasals', sample: 'සිංහල ලංකා අංක', note: 'anusvara' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b ආයුබෝවන්', note: 'ASCII inside the run' },
        ],
        list: ['සිංහල OpenType හැඩගැන්වීම (GSUB + GPOS)', 'කොම්බුව සහ බැඳි අකුරු', 'PDF/A-2b සහාය'],
        footer: 'pdfnative – සිංහල ලේඛන නියැදිය',
    },
    {
        lang: 'bo',
        filename: 'doc-tibetan',
        language: 'Tibetan',
        script: 'Tibetan',
        title: 'བོད་ཡིག – pdfnative',
        intro: 'pdfnative ནི་བོད་ཡིག་གི་ PDF ཡིག་ཆ་བཟོ་བ་དང་མིང་གཞི་བརྩེགས་མ་ལ་རྒྱབ་སྐྱོར་བྱེད།',
        edgeCases: [
            { what: 'Subjoined stacks', sample: 'བསྒྲུབས སྐད རྒྱ', note: 'vertical consonant stacks' },
            { what: 'Vowel signs', sample: 'བོད ཡིག ཀུ ཀེ', note: 'ོ ི ུ ེ above and below' },
            { what: 'Tsheg and shad', sample: 'བཀྲ་ཤིས་བདེ་ལེགས།', note: 'syllable and sentence marks' },
            { what: 'Numerals', sample: '༡༢༣༤༥ ༢༠༢༦', note: 'Tibetan digits' },
            { what: 'Deep stacks', sample: 'སྒྲ ཨ་ཀ ཧྥ', note: 'three-glyph stacks' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b Noto Serif Tibetan', note: 'ASCII inside the run' },
        ],
        list: ['Vertical subjoined-consonant stacking', 'GSUB subjoined-form ligatures and GPOS anchors', 'PDF/A-2b support'],
        footer: 'pdfnative – Tibetan document sample',
    },
    {
        lang: 'km',
        filename: 'doc-khmer',
        language: 'Khmer',
        script: 'Khmer',
        title: 'ខ្មែរ – pdfnative',
        intro: 'pdfnative បង្កើតឯកសារ PDF ជាភាសាខ្មែរ ដោយមានការគាំទ្រពេញលេញចំពោះព្យញ្ជនៈជើង និងស្រៈ។',
        edgeCases: [
            { what: 'Coeng stacks', sample: 'ស្ត្រី ក្រុម ខ្មែរ', note: 'subscript consonants' },
            { what: 'Pre-base vowels', sample: 'ខ្មែរ ដែល តើ', note: 'ែ េ ើ drawn to the left' },
            { what: 'Two-part vowels', sample: 'ក្តៅ ខ្មោច', note: 'ៅ ោ split around the base' },
            { what: 'Above marks', sample: 'ភាសាខ្មែរ ដ៏ ក៏', note: 'anchored above' },
            { what: 'Digits and symbols', sample: '១២៣ ៛ ២០២៦', note: 'Khmer digits, riel' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b Noto Sans Khmer', note: 'ASCII inside the run' },
        ],
        list: ['USE-lite cluster classification', 'Coeng subscripts and pre-base vowels', 'PDF/A-2b support'],
        footer: 'pdfnative – Khmer document sample',
    },
    {
        lang: 'my',
        filename: 'doc-myanmar',
        language: 'Burmese',
        script: 'Myanmar',
        title: 'မြန်မာ – pdfnative',
        intro: 'pdfnative သည် မြန်မာဘာသာဖြင့် PDF စာရွက်စာတမ်းများကို ဖန်တီးပြီး ဗျည်းတွဲနှင့် သရများကို ပြည့်စုံစွာ ပံ့ပိုးသည်။',
        edgeCases: [
            { what: 'Kinzi', sample: 'အင်္ဂလိပ်', note: 'kinzi above the base' },
            { what: 'Medials', sample: 'ကြ ကျ ကွ ကှ မြန်မာ', note: 'medial ra, ya, wa, ha' },
            { what: 'Stacked consonants', sample: 'ဗုဒ္ဓ သဒ္ဒါ', note: 'virama stacking' },
            { what: 'Pre-base e vowel', sample: 'ပေး မြေ ကျေး', note: 'ေ drawn to the left' },
            { what: 'Vowels and tones', sample: 'ကို ကူ ကံ ကး', note: 'above, below, beside' },
            { what: 'Digits', sample: '၁၂၃၄ ၂၀၂၆', note: 'Myanmar digits' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b Noto Sans Myanmar', note: 'ASCII inside the run' },
        ],
        list: ['USE-lite cluster classification', 'Medials, kinzi and stacked consonants', 'PDF/A-2b support'],
        footer: 'pdfnative – Myanmar document sample',
    },
    {
        lang: 'am',
        filename: 'doc-amharic',
        language: 'Amharic',
        script: 'Ethiopic',
        title: 'አማርኛ – pdfnative',
        intro: 'pdfnative በአማርኛ ቋንቋ የ PDF ሰነዶችን ይፍጥራል፣ ለኢትዮጵያ ሆሄያት ሙሉ ድጋፍ ጋር።',
        edgeCases: [
            { what: 'Seven vowel orders', sample: 'ሀ ሁ ሂ ሃ ሄ ህ ሆ', note: 'one glyph per syllable' },
            { what: 'Labialised syllables', sample: 'ቋ ኳ ጓ ቧ', note: 'no reordering needed' },
            { what: 'Punctuation', sample: 'ሰላም። እንኳን፣ ደህና፤', note: 'full stop, comma, semicolon' },
            { what: 'Numerals', sample: '፩ ፪ ፫ ፲ ፻', note: 'Ethiopic numerals' },
            { what: 'Words', sample: 'እንኳን ደህና መጡ ኢትዮጵያ አዲስ አበባ', note: 'wrapping' },
            { what: 'Mixed with Latin', sample: 'PDF/A-2b Noto Sans Ethiopic', note: 'ASCII inside the run' },
        ],
        list: ['Ethiopic syllabic abugida (U+1200–U+137F)', 'Detection and font routing, no reordering', 'PDF/A-2b support'],
        footer: 'pdfnative – Amharic (Ethiopic) document sample',
    },
    {
        lang: 'ar',
        filename: 'doc-arabic',
        language: 'Arabic',
        script: 'Arabic',
        title: 'منشئ المستندات – العربية',
        intro: 'هذا المستند يوضح قدرات منشئ المستندات في pdfnative للنصوص العربية من اليمين إلى اليسار. يدعم المحرك تشكيل الحروف العربية تلقائياً بما في ذلك الأشكال المعزولة والابتدائية والوسطى والنهائية، والحركات فوق الحروف وتحتها.',
        edgeCases: [
            { what: 'Contextual forms', sample: 'كتاب مكتبة بيت عين', note: 'initial, medial, final, isolated' },
            { what: 'Lam-alef', sample: 'لا الله سلام إلا', note: 'ligature' },
            { what: 'Harakat', sample: 'مُحَمَّدٌ كَتَبَ الوَلَدُ', note: 'fatha, damma, shadda, tanwin' },
            { what: 'Stacked marks', sample: 'شَدَّةٌ وَكَسْرَةٌ لِلْحَرَكَاتِ', note: 'shadda + kasra, mark-to-mark' },
            { what: 'Arabic-Indic digits', sample: '١٢٣٤٥٦٧٨٩٠ ٢٠٢٦', note: 'left-to-right inside RTL' },
            { what: 'Persian and Urdu letters', sample: 'گ چ پ ژ ک ی ے', note: 'extended letters' },
            { what: 'Mixed direction', sample: 'معيار ISO 32000-1 و PDF/A-2b', note: 'BiDi with Latin' },
            { what: 'Hamza and tatweel', sample: 'أ إ ؤ ئ كـــتاب', note: 'hamza carriers, kashida' },
        ],
        list: ['دعم ثنائي الاتجاه (BiDi) وفق معيار UAX #9', 'تشكيل الحروف العربية (GSUB) مع ربطات لام-ألف', 'توافق مع PDF/A-2b (ISO 19005-2)'],
        footer: 'pdfnative – نموذج مستند عربي',
    },
    {
        lang: 'he',
        filename: 'doc-hebrew',
        language: 'Hebrew',
        script: 'Hebrew',
        title: 'בונה מסמכים – עברית',
        intro: 'מסמך זה מדגים את יכולות בונה המסמכים של pdfnative עבור טקסט עברי מימין לשמאל. המנוע תומך בזיהוי כיוון דו-כיווני אוטומטי לפי תקן UAX #9, בצורות סופיות ובניקוד.',
        edgeCases: [
            { what: 'Final forms', sample: 'כ/ך מ/ם נ/ן פ/ף צ/ץ שלום', note: 'sofit letters' },
            { what: 'Niqqud', sample: 'שָׁלוֹם עוֹלָם בְּרֵאשִׁית', note: 'vowel points below and above' },
            { what: 'Dagesh and shin dots', sample: 'בּ כּ שׁ שׂ', note: 'mark-to-base' },
            { what: 'Mixed direction', sample: 'תקן ISO 32000-1 ו-PDF/A-2b', note: 'BiDi with Latin' },
            { what: 'Maqaf and geresh', sample: 'בית־ספר צ׳ ג׳', note: 'punctuation' },
            { what: 'Numbers and currency', sample: '2026 ₪ 1,000', note: 'left-to-right inside RTL' },
        ],
        list: ['תמיכה בכיוון דו-כיווני (BiDi)', 'צורות סופיות אוטומטיות – Sofit', 'תאימות PDF/A-2b (ISO 19005-2)'],
        footer: 'pdfnative – דוגמת מסמך בעברית',
    },
    {
        lang: 'ha',
        filename: 'doc-hausa',
        language: 'Hausa',
        script: 'Latin',
        title: 'Takardar Hausa – Nuni',
        intro: 'Wannan takarda tana nuna yadda pdfnative ke rubuta Hausa da haruffan boko: ɓ, ɗ, ƙ da ƴ, da kuma digraphs kamar sh, ts da ʼy. Babu buƙatar wani font na musamman: Noto Sans ya isa.',
        edgeCases: [
            { what: 'Hooked letters', sample: 'ɓaure ɗaki ƙasa ƴanci', note: 'Latin Extended-B and IPA glyphs' },
            { what: 'Capitals', sample: 'Ɓ Ɗ Ƙ Ƴ Ɓarau Ɗan Ƙarfi', note: 'Latin Extended-B capitals' },
            { what: 'Digraphs and apostrophe', sample: 'shekara tsari ʼyaʼya', note: 'modifier letter apostrophe U+02BC' },
            { what: 'Tone marks', sample: 'kàrátù dà ƙàsá', note: 'combining grave and acute' },
            { what: 'Numbers and currency', sample: '₦ 1,000 2026', note: 'naira' },
            { what: 'Long words', sample: 'Jamhuriyar Tarayyar Najeriya', note: 'wrapping' },
        ],
        list: ['Haruffan boko ɓ ɗ ƙ ƴ', 'Noto Sans, ba tare da sabon module ba', 'PDF/A-2b'],
        footer: 'pdfnative – samfurin takardar Hausa',
    },
    {
        lang: 'yo',
        filename: 'doc-yoruba',
        language: 'Yoruba',
        script: 'Latin',
        title: 'Ìwé Yorùbá – Àfihàn',
        intro: 'Ìwé yìí fi hàn bí pdfnative ṣe ń kọ èdè Yorùbá pẹ̀lú àwọn ààmì ohùn àti àwọn fáwẹ̀lì tí ó ní àmì ìsàlẹ̀: ẹ, ọ, ṣ. Àwọn ààmì ohùn lórí ẹ àti ọ jẹ́ àmì àpapọ̀ tí GPOS ń gbé sí ipò wọn.',
        edgeCases: [
            { what: 'Dotted vowels', sample: 'ẹ ọ ṣ Ẹ Ọ Ṣ', note: 'precomposed letters' },
            { what: 'Tone on plain vowels', sample: 'á à ā é è ó ò ú ù', note: 'precomposed letters' },
            { what: 'Tone on dotted vowels', sample: 'ẹ́ ẹ̀ ọ́ ọ̀', note: 'combining marks placed by GPOS' },
            { what: 'Stacked marks', sample: 'ọ̃́ ẹ̃̀', note: 'mark-to-mark' },
            { what: 'Syllabic nasals', sample: 'ń ǹ m̀ ḿ', note: 'tone on a consonant' },
            { what: 'Words', sample: 'Ẹ n lẹ́ o, Yorùbá, Ọjọ́ àìkú, ọmọ', note: 'greeting, names' },
            { what: 'Numbers and currency', sample: '₦ 1,000 2026', note: 'naira' },
        ],
        list: ['Àwọn ààmì ohùn lórí fáwẹ̀lì', 'Noto Sans láìsí module tuntun', 'PDF/A-2b'],
        footer: 'pdfnative – àpẹẹrẹ ìwé Yorùbá',
    },
    {
        lang: 'ig',
        filename: 'doc-igbo',
        language: 'Igbo',
        script: 'Latin',
        title: 'Akwụkwọ Igbo – Ngosi',
        intro: 'Akwụkwọ a na-egosi otú pdfnative si ede asụsụ Igbo, tinyere mkpụrụedemede ndị nwere ntụpọ n’okpuru: ị, ọ, ụ, na ṅ. Akara ụda olu na-anọ n’elu ha site na GPOS.',
        edgeCases: [
            { what: 'Dotted letters', sample: 'ị ọ ụ Ị Ọ Ụ', note: 'precomposed letters' },
            { what: 'n with dot above', sample: 'ṅ ṅụ ṅaa', note: 'precomposed letter' },
            { what: 'Tone marks', sample: 'ị́ ụ̀ ọ́ ọ̀', note: 'combining marks placed by GPOS' },
            { what: 'Digraphs', sample: 'gb kp nw ny gw kw', note: 'two-letter consonants' },
            { what: 'Words', sample: 'Ndeewo, Kedụ, Ụmụaka, Nne na Nna', note: 'greeting, kinship' },
            { what: 'Numbers and currency', sample: '₦ 1,000 2026', note: 'naira' },
        ],
        list: ['Mkpụrụedemede nwere ntụpọ', 'Noto Sans na-enweghị module ọhụrụ', 'PDF/A-2b'],
        footer: 'pdfnative – ihe atụ akwụkwọ Igbo',
    },
    {
        lang: 'sw',
        filename: 'doc-swahili',
        language: 'Swahili',
        script: 'Latin',
        title: 'Hati ya Kiswahili – Onyesho',
        intro: 'Hati hii inaonyesha jinsi pdfnative inavyoandika Kiswahili: alfabeti ya Kilatini bila alama za ziada, hivyo fonti ya msingi ya Helvetica inatosha, na Noto Sans hutumika chini ya PDF/A.',
        edgeCases: [
            { what: 'Plain ASCII', sample: 'Habari za asubuhi, karibu sana', note: 'no combining marks' },
            { what: 'Digraphs', sample: 'ng’ombe chakula shule dhahabu', note: 'ng’ with U+2019' },
            { what: 'Long words', sample: 'kutokuwajibika Jamhuri ya Muungano', note: 'wrapping' },
            { what: 'Numbers and currency', sample: 'TSh 1,000 KSh 2,500 2026', note: 'shillings' },
            { what: 'Mixed with English', sample: 'PDF/A-2b ISO 32000-1', note: 'standard names' },
            { what: 'Proverb', sample: 'Haraka haraka haina baraka', note: 'idiom' },
        ],
        list: ['Alfabeti ya Kilatini pekee', 'Helvetica au Noto Sans', 'PDF/A-2b'],
        footer: 'pdfnative – mfano wa hati ya Kiswahili',
    },
];
