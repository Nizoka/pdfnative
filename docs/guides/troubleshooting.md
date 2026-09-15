# Troubleshooting

> **Symptom-first fixes for the classic failures** — tofu boxes (a font registered but never loaded), RTL text appearing backwards, oversized files, PDF/A validation errors, PDF/X-4 builds that throw, a font feature that does nothing, a compressor that produced blank pages, parser rejections — each with the check that identifies it and the change that fixes it.

## Font Not Rendering (Boxes or Blank)

**Symptom:** Non-Latin text shows as empty rectangles or missing glyphs.

**Cause:** The font for that script is not registered or not loaded.

**Fix:**
```typescript
import { registerFonts, loadFontData } from 'pdfnative';

// 1. Register font loaders (lazy — no data loaded yet)
registerFonts({
  th: () => import('pdfnative/fonts/noto-thai-data.js'),
  ar: () => import('pdfnative/fonts/noto-arabic-data.js'),
});

// 2. Load font data when needed
const thaiFont = await loadFontData('th');

// 3. Pass fontEntries to your builder
const pdf = buildDocumentPDFBytes({
  blocks: [{ type: 'paragraph', text: 'สวัสดี' }],
  fontEntries: [{ fontData: thaiFont!, fontRef: '/F3', lang: 'th' }],
});
```

## PDF File Too Large

**Symptom:** Output PDF is unexpectedly large (>1 MB for text content).

**Causes & fixes:**

1. **Enable compression:**
   ```typescript
   buildPDFBytes(params, { compress: true });
   ```
   FlateDecode typically reduces size by 50–90%.

2. **Initialize native compression (Node.js):**
   ```typescript
   import { initNodeCompression } from 'pdfnative';
   await initNodeCompression();
   ```
   Without this, a stored-block fallback is used (minimal compression).

3. **Large images:** JPEG is already compressed (DCTDecode). For PNG, the raw pixels are FlateDecode-compressed. Use JPEG for photos.

4. **Font subsetting:** Automatic — only used glyphs are embedded. If you're embedding many scripts, each adds a font subset.

## RTL Text Backwards

**Symptom:** Arabic or Hebrew text appears in logical order instead of visual (right-to-left) order.

**Cause:** Font entries must include the correct `lang` property for BiDi detection.

**Fix:**
```typescript
const fontEntries = [
  { fontData: arabicFont, fontRef: '/F3', lang: 'ar' },
  { fontData: hebrewFont, fontRef: '/F4', lang: 'he' },
];
```

The `lang` property triggers:
- BiDi run detection (`containsRTL()`)
- Arabic positional shaping (GSUB forms)
- Glyph mirroring for brackets and other paired delimiters (the full 428-pair
  Unicode BidiMirroring table since v1.7.0, per UAX #9 rule L4)

**Reversed digits or backwards parentheses in RTL text?** Fixed in v1.7.0 with
no API change: digit runs now take even embedding levels (UAX #9 rules I1/I2),
so a number like `1405` keeps its digit order instead of rendering `5041`, and
rule L4 mirrors delimiters during reversal, so a logical `(X)` no longer
renders `)X(`. If you see either symptom, upgrade pdfnative.

## PDF/A Validation Fails

**Symptom:** veraPDF reports non-conformance.

**Common issues:**

1. **Missing tagged mode:**
   ```typescript
   buildPDFBytes(params, { tagged: true }); // PDF/A-2b
   // or
   buildPDFBytes(params, { tagged: 'pdfa1b' }); // PDF/A-1b
   ```

2. **PDF/A + encryption conflict:** ISO 19005-1 §6.3.2 forbids encryption in PDF/A. Use one or the other.

3. **Transparency in PDF/A-1b:** Watermarks with opacity < 1.0 are blocked in PDF/A-1b (ISO 19005-1 §6.4). Use PDF/A-2b or remove transparency.

## PDF/X-4 Build Throws (v1.8.0)

**Symptom:** `buildDocumentPDFBytes()` with `pdfx: 'pdfx4'` throws before producing bytes.

**Cause:** the PDF/X claim is checked for coherence up front. The message names the conflict — one of these seven, listed with every other build-time message in [`docs/data/errors.json`](../data/errors.json):

1. `layout.pdfx: unknown target '${target}' — use one of ${PDF_X_CONFORMANCE_TARGETS}` — use `'pdfx4'`.
2. `layout.pdfx and layout.tagged cannot be combined — pdfnative writes one conformance claim per file; drop one of them` — build the print file and the archival file separately.
3. `PDF/X forbids encryption (ISO 15930-7) — drop layout.encryption or layout.pdfx` — drop one.
4. `PDF/X-4 requires layout.outputIntent: the ICC profile of the printing condition, e.g. ISO Coated v2 or GRACoL from your printer. pdfnative ships no press profile` — pass the profile your printer names.
5. `PDF/X-4 requires an output (printer) profile as layout.outputIntent — the supplied profile's class is '${deviceClass}'` — sRGB is a monitor (`mntr`) profile; use a press (`prtr`) profile.
6. `PDF/X requires the trapping state to be known — set metadata.trapped to 'True' or 'False', or omit it for 'False'` — pdfnative never traps, so `'False'` is accurate.
7. `PDF/X pages carry a TrimBox or an ArtBox, not both — drop print.artBox, or print.trimBox and print.bleed` — keep one box.

Once the build succeeds, `validatePdfX(bytes)` reports what the structure can prove (`{ valid, errors, warnings }`); a certified preflight remains necessary before press. See [Print production](print.html).

## Font Feature Has No Effect (v1.8.0)

**Symptom:** `typography: { fontFeatures: ['tnum'] }` changes nothing and the console shows `TYPOGRAPHY_FEATURE_INEFFECTIVE`.

**Cause:** no registered font declares the tag, or it declares it but no glyph in the document was substituted. With the bundled Noto Sans, `tnum` and `lnum` are no-ops because its figures are already tabular and lining; `pnum` and `onum` do substitute. Features need a registered font — the base-14 faces carry no OpenType tables.

**Fix:** drop the tag, or register a font whose GSUB declares it for the characters you set (the effective tags are the keys of the font module's `features` table). Capture the diagnostic with `layout.onDiagnostic`, or make it fatal with `layout.strict: true`.

## Blank Pages After `setDeflateImpl()` / Build Throws Naming It

**Symptom:** on v1.7.0, every page rendered blank and `extractText()` returned `''`; on v1.8.0 the build throws a message pointing at `setDeflateImpl()`.

**Cause:** the injected compressor returns raw DEFLATE (RFC 1951) — fflate's `deflateSync`, `CompressionStream`'s `'deflate-raw'` — while `/FlateDecode` needs the zlib envelope (RFC 1950). The v1.7.0 README recommended the raw function; v1.8.0 validates the result and refuses it ([#78](https://github.com/Nizoka/pdfnative/issues/78)).

**Fix:**
```typescript
import { setDeflateImpl, setDeflateRawImpl } from 'pdfnative';
import { zlibSync, deflateSync } from 'fflate';

setDeflateImpl(zlibSync);        // zlib-wrapped — the contract of setDeflateImpl()
// or keep the raw function and let pdfnative add the envelope (v1.8.0):
setDeflateRawImpl(deflateSync);
```
An asynchronous compressor (callback, Promise or `CompressionStream`) cannot be adapted; use `initNodeCompression()` on Node or a synchronous library elsewhere.

## French Punctuation Spacing Looks Canadian

**Symptom:** `typography: { punctuationSpacing: 'fr' }` renders no space before `;` `!` `?`, exactly like `'fr-CA'`.

**Cause:** `'fr'` inserts a narrow no-break space (U+202F), which WinAnsi cannot encode. On the base-14 (non-embedded) path it degrades to an ordinary space.

**Fix:** register a Latin font that carries the glyph (Noto Sans does) and pass it in `fontEntries`; the narrow space is then rendered as written and extracts as U+202F.

## "Document has too many blocks" / Very Large Documents

**Symptom:** Generating a multi-thousand-page report throws a "too many blocks" error.

**Cause:** The document builder caps the number of content blocks as a safety rail. Before v1.3.0 this was a hard-coded 10 000. As of **v1.3.0** the default is **100 000** and is configurable.

**Fix:** raise the limit via the layout option:

```typescript
buildDocumentPDFBytes(params, { maxBlocks: 500000 });
// also honoured by the streaming builders:
buildDocumentPDFStream(params, { maxBlocks: 500000 }, { chunkSize: 65536 });
```

For very large outputs, prefer the streaming builders (`buildDocumentPDFStream`, or `buildDocumentPDFStreamTrue` for constant memory) so the full binary never has to sit in memory at once.

## Parser Fails on External PDF

**Symptom:** `openPdf()` throws on a PDF file not generated by pdfnative.

**Common causes:**

1. **Encrypted PDF opened without a password:** Since v1.6.0 the parser decrypts the Standard Security Handler (RC4 V1-V4, AES-128, AES-256 R6) — but it needs the password. Call `openPdf(bytes, { password })`. Without one you get `PdfPasswordError`; with an algorithm the handler does not cover, `PdfEncryptionUnsupportedError`.
2. **Linearized PDF:** The parser follows standard xref/trailer. Linearized hint tables may cause offset issues.
3. **Non-standard formatting:** Some PDF generators produce non-compliant output. The parser follows ISO 32000-1 strictly.

## Build / Import Issues

**ESM import paths:**
```typescript
// Bare package import — no extension involved
import { buildPDFBytes } from 'pdfnative';

// Font data modules — the .js extension IS required here (ESM subpath),
// and the modules only have named exports, so use a namespace import:
import * as thaiData from 'pdfnative/fonts/noto-thai-data.js';
```

**Browser vs Node.js:** The library works in both environments. For compression in Node.js, call `initNodeCompression()` once at startup.
