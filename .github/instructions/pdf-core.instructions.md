---
description: "Use when writing or modifying PDF generation code, PDF operators, content streams, xref tables, or object structures. Covers ISO 32000-1 compliance, binary safety, and PDF object model."
applyTo: "src/core/**"
---
# PDF Core Standards (ISO 32000-1)

## PDF Object Model
- Every indirect object: `N 0 obj ... endobj` with sequential numbering
- xref table offsets MUST use `byteLength()` — never `.length` (multi-byte chars break offsets)
- XRef offset guard: validate byte offsets before writing cross-reference table entries
- Cross-reference entries: exactly 20 bytes each (`nnnnnnnnnn ggggg n \r\n`)
- Trailer must contain `/Size`, `/Root`, `/Info`
- `/Info` dictionary: `/Title`, `/Producer (pdfnative)`, `/CreationDate (D:YYYYMMDDHHmmss)`

## Shared Assembly Primitives (pdf-assembler.ts)
- `createPdfWriter()`: creates a reusable PDF binary writer with offset tracking
- `writeXrefTrailer()`: writes xref table and trailer — shared by both `pdf-builder.ts` and `pdf-document.ts`
- Eliminates xref/trailer duplication between the two builders

## Encoding Context (encoding-context.ts)
- `createEncodingContext(fontEntries)`: encoding context factory moved from `fonts/encoding.ts` to `core/`
- Dependency inversion: breaks the `fonts/ → shaping/` cycle
- Both builders import from `core/encoding-context.js`

## Input Validation (system boundary)
- `buildPDF()` validates: params is object, rows is array, headers is array
- Row count limit: 100,000 (throws descriptive error)
- String escaping: `pdfString()` escapes `\`, `(`, `)` for PDF literals
- `/Info` title: independently escaped (backslash + parentheses)

## Content Streams
- Text blocks: `BT ... ET` — never nest, never leave unclosed
- Font selection: `/<ref> <size> Tf` must precede any text operator
- Text positioning: `Td` for relative, `Tm` for absolute matrix
- String encoding: `(WinAnsi)` for Helvetica, `<hex>` for CIDFont glyphs
- RGB color: `r g b rg` (fill), `r g b RG` (stroke) — values 0.0–1.0
- Streams may carry `/Filter /FlateDecode` when `compress: true` — added by `emitStreamObj()`

## Binary Safety
- PDF header: `%PDF-${version}\n%âãÏÓ\n` — version from pdfAConfig (1.7 for PDF/A-2b, 1.4 otherwise)
- Stream lengths must be exact byte counts of stream content
- When compression is active, `/Length` must reflect compressed data size (not original)
- When encryption is active, `/Length` must reflect encrypted data size (not plaintext)
- Compression ordering: compress BEFORE encrypt (ISO 32000-1 §7.3.8)
- `startxref` offset must point to exact byte position of `xref` keyword
- Line endings in xref: `\r\n` (exactly 2 bytes, per spec)

## Performance Rules
- Build PDF string with array `.join('')` — not repeated concatenation
- Pre-compute column positions once, reuse across all rows
- Avoid intermediate string allocations in the rendering loop
- Font metrics lookup: direct property access, no Map overhead in hot path

## Common Mistakes
- Using `.length` instead of `byteLength()` for offset calculation
- Forgetting to increment object count after adding new indirect objects
- Missing `/Type` entries in dictionary objects
- Incorrect `/Length` values in stream objects (causes PDF corruption)

## Tagged PDF Object Model (ISO 32000-1 §14.7–14.8)
- `/MarkInfo << /Marked true >>` on Catalog when tagged mode enabled
- Structure tree: `/StructTreeRoot` → `/Document` → child elements
- Table structure: `/Table` → `/TR` → `/TH|/TD`
- Document blocks: `/H1-H3` for headings, `/P` for paragraphs, `/L` → `/LI` for lists, `/Figure` for images
- Non-table elements: `/P` for title, info items, balance, footer
- Marked content references: `<< /Type /MCR /MCID n /Pg pageRef >>`
- `/ParentTree` number tree maps MCID → parent structure element
- Every page must have `/StructParents` integer linking to ParentTree

## Marked Content Operators
- `/Span << /MCID n /ActualText <UTF-16BE hex> >> BDC` opens marked content
- `EMC` closes marked content — never leave unclosed
- `/ActualText` carries the original Unicode string for shaped/repositioned glyphs
- UTF-16BE encoding with `FEFF` BOM for /ActualText values
- MCID allocation: sequential per page via `createMCIDAllocator()`

## PDF/A Compliance (ISO 19005-1 / ISO 19005-2)
- `resolvePdfAConfig(tagged)` maps tagged option to PDF/A config: version, part, conformance, subtype
- PDF/A-2b (default when `tagged: true`): PDF 1.7, `pdfaid:part=2`, `pdfaid:conformance=B`
- PDF/A-1b (explicit `tagged: 'pdfa1b'`): PDF 1.4, `pdfaid:part=1`, `pdfaid:conformance=B`
- PDF/A-2u (explicit `tagged: 'pdfa2u'`): PDF 1.7, `pdfaid:part=2`, `pdfaid:conformance=U`
- XMP metadata stream: `dc:title`, `pdf:Producer`, `xmp:CreateDate`, plus `pdfaid:part`, `pdfaid:conformance`
- `buildXMPMetadata(title, producer, date, pdfaPart, pdfaConformance)` — parameterized
- `/OutputIntents` array on Catalog with sRGB ICC profile
- `buildOutputIntentDict(iccObjNum, subtype)` — subtype param defaults to 'GTS_PDFA1'
- sRGB ICC profile: 9 required tags (desc, wtpt, cprt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC)
- ICC profile class: monitor (`mntr`), color space: RGB, PCS: XYZ, version 2.1.0
- sRGB D50-adapted primaries: rXYZ(0.4361,0.2225,0.0139), gXYZ(0.3851,0.7169,0.0971), bXYZ(0.1431,0.0606,0.7141)
- TRC: curveType with gamma 2.2 (u8Fixed8 = 0x0233), shared offset for rTRC/gTRC/bTRC
- XMP BOM: must be raw UTF-8 bytes `\xEF\xBB\xBF` — NOT `\uFEFF` (which truncates to single byte 0xFF via charCodeAt & 0xFF)
- All fonts must be embedded (no Helvetica in pure PDF/A — current tagged mode still uses Helvetica)
- Activated by `{ tagged: true }` layout option — backward compatible

## Image XObject Model (ISO 32000-1 §8.9)
- Image XObjects: `/Type /XObject /Subtype /Image` indirect objects
- JPEG images: `/Filter /DCTDecode` — raw JPEG bytes injected as stream
- PNG images: `/Filter /FlateDecode` with `/DecodeParms << /Predictor 15 /Colors N /BitsPerComponent 8 /Columns W >>`
- PNG alpha: separated into `/SMask` XObject (DeviceGray) when alpha decompression available
- Color spaces: `/DeviceRGB`, `/DeviceGray`, `/DeviceCMYK` (JPEG only)
- Image operators: `q W 0 0 H X Y cm /ImN Do Q` — save state, transform, paint, restore
- Page resources must include `/XObject << /Im1 N 0 R /Im2 M 0 R ... >>` for each image
- Object numbering: image XObjects allocated between font objects and page objects
- Format detection: JPEG magic `FF D8 FF`, PNG magic `89 50 4E 47 0D 0A 1A 0A`
- JPEG dimension extraction: scan for SOF0–SOF15 markers (excluding DHT/JPG/DAC), with robustness for edge-case byte sequences
- PNG parsing: IHDR for dimensions + color type, IDAT concatenation for compressed data
- RGBA PNG rejection: unsupported color types rejected at parse boundary with descriptive error messages

## Link Annotation Model (ISO 32000-1 §12.5.6.5)
- Annotation object: `/Type /Annot /Subtype /Link /Rect [x1 y1 x2 y2]`
- URI action: `/A << /Type /Action /S /URI /URI (url) >>`
- Internal link: `/A << /Type /Action /S /GoTo /D [pageRef /Fit] >>`
- `/Annots` array on page dict: `/Annots [ref1 ref2 ...]` — references annotation objects
- URL validation: only `http:`, `https:`, `mailto:` schemes allowed — security boundary
- URL control-char hardening: control characters (U+0000–U+001F, U+007F–U+009F) rejected via `CONTROL_CHARS` regex
- Blocked schemes: `javascript:`, `file:`, `data:` — prevents XSS and local file access
- URL escaping: parentheses `()` and backslashes `\` escaped in PDF string literals
- Tagged mode: `/Link` structure element wraps annotation for PDF/UA accessibility
- Visual rendering: blue text with underline stroke (configurable color)
- Annotation objects emitted after all page+stream objects in PDF assembly
- `annotsByPage` grouping ensures each page references only its own annotations

## BiDi Text Support (UAX #9)
- BiDi resolution integrated at encoding level — `textRuns()` and `ps()` in encoding.ts check `containsRTL()` first
- When RTL detected: `resolveBidiRuns()` produces visual-order runs with embedding levels
- RTL Arabic runs: un-reverse to logical order → `shapeArabicText()` → reverse shaped glyphs for visual order
- RTL Hebrew runs: already reversed by BiDi — encode directly (no positional shaping needed)
- LTR runs: standard encoding path (no BiDi processing)
- Arabic shaping (`shapeArabicText()`) returns glyphs in logical order — must reverse for RTL visual rendering
- Hebrew text detected by `containsHebrew()` — uses RTL ordering without shaping
- Glyph mirroring for brackets/parentheses in RTL context via `MIRROR_MAP`
- CRITICAL: never call `shapeArabicText()` on already-reversed text — always un-reverse to logical first

## PDF Encryption (ISO 32000-1 §7.6)
- Two algorithms: AES-128 (V4/R4, /AESV2) and AES-256 (V5/R6, /AESV3)
- Encryption is mutually exclusive with PDF/A (ISO 19005-1 §6.3.2) — validated at build boundary
- `/Encrypt` dictionary emitted as indirect object before xref table
- Trailer includes `/Encrypt N 0 R` and `/ID [<hex> <hex>]` when encrypted
- AES-CBC with random 16-byte IV prepended to each encrypted stream/string
- PKCS7 padding: full block added even when data is block-aligned (required by ISO 32000-1)
- Per-object key derivation: MD5(fileKey + objNum + genNum + 'sAlT') for R4, fileKey directly for R6
- `emitStreamObj()` helper transparently encrypts streams and updates `/Length`
- `/Length` regex replacement: `/\/Length \d+/` after encryption adjusts to actual encrypted size
- R4: `padPassword()` (32-byte PDF padding), `computeOValueR4()` (Algorithm 3), `computeUValueR4()` (Algorithm 5)
- R6: SHA-256 based, `computeHashR6()` (Algorithm 2.B), `/OE`, `/UE`, `/Perms` values
- Minimal `rc4()` used ONLY for O/U password hash computation (PDF spec requirement for R4)
- Permission bitmask: bits 3-12 per ISO 32000-1 Table 22, high bits set via `0xFFFFF000 | perms`
- `generateDocId()`: 16 random bytes for `/ID` array (same ID repeated for both entries)

## Encryption Integration Pattern
- Both `pdf-builder.ts` and `pdf-document.ts` follow identical encryption integration:
  1. Import encryption functions from `pdf-encrypt.ts`
  2. Mutual exclusivity check at build entry: `if (tagged && encryption) throw`
  3. Initialize `encState` via `initEncryption()` when encryption option present
  4. Define `emitStreamObj(num, dictEntries, streamData)` helper
  5. Replace all direct stream emissions with `emitStreamObj` calls
  6. Emit `/Encrypt` dict object before xref
  7. Update trailer with `/Encrypt` ref and `/ID` array

## FlateDecode Compression (ISO 32000-1 §7.3.8.1)
- Activated by `compress: true` in `PdfLayoutOptions` — backward compatible (default `false`)
- `compressStream(streamData)` applies zlib deflate: binary string → Uint8Array → deflate → binary string
- `emitStreamObj()` in both builders transparently applies compression + encryption in correct order
- Order: raw stream → compress (FlateDecode) → encrypt (AES-CBC) — per ISO 32000-1 §7.3.8
- Compressed streams get `/Filter /FlateDecode` inserted in dictionary and `/Length` updated
- FontFile2 streams: `/Length1` preserved by regex only replacing first `/Length \d+` match
- XMP metadata: always `skipCompress = true` for PDF/A validator compatibility
- ICC profile streams: normal compression applies (not exempt)
- Native zlib: `initNodeCompression()` async init for ESM via `import('node:zlib')` with string indirection
- Stored-block fallback: `deflateStored()` wraps raw data in valid zlib container (no actual compression)
- `setDeflateImpl(fn)` allows custom deflate injection (e.g., WASM-based compressor)
- `adler32()` implements RFC 1950 checksum for stored-block zlib wrapper
- Platform detection: `globalThis['process']?.versions?.node` then CJS `globalThis['require']` or ESM dynamic import
- Security: no `eval()`, no `new Function()` — uses `globalThis['require']` for CJS access

## Header/Footer Template Model
- `PageTemplate` type: `{ left?: string; center?: string; right?: string; fontSize?: number; color?: PdfColor }`
- Placeholder variables: `{page}`, `{pages}`, `{date}`, `{title}` — resolved by `resolveTemplate()` pure function
- `headerTemplate` / `footerTemplate` on `PdfLayoutOptions` — both builders support them
- `HEADER_H = 15` constant in `pdf-layout.ts` — header zone reduces available content height
- Backward compat: `footerText` maps to `{ left: footerText, right: '{page}/{pages}' }`
- `_renderPageTemplate()` (pdf-document.ts) / `_buildPageTemplate()` (pdf-builder.ts) — renders left/center/right at given Y
- Default color from `colors.footer` (`PdfColor`), parsed via `parseColor()`
- Tagged mode: template text wrapped in `/P` structure elements with marked content

## Watermark Model (ISO 32000-1 §7.2.4, §11.6.4.4)
- `WatermarkText`: `{ text; fontSize?: 60; color?: PdfColor; opacity?: 0.15; angle?: -45 }`
- `WatermarkImage`: `{ data: Uint8Array; opacity?: 0.10; width?; height? }`
- `WatermarkOptions`: `{ text?; image?; position?: 'background' | 'foreground' }`
- **ExtGState object**: `<< /Type /ExtGState /ca opacity >>` — non-stroking transparency
- **Text rotation**: `cos(θ) sin(θ) -sin(θ) cos(θ) cx cy Tm` matrix at page center
- **Image centering**: `q W 0 0 H X Y cm /ImW Do Q` with aspect ratio preservation
- **Position**: `'background'` = watermark ops before content stream; `'foreground'` = ops after content
- `validateWatermark()`: PDF/A-1b blocks transparency (ISO 19005-1 §6.4) — throws if opacity < 1.0
- `buildWatermarkState()`: returns `WatermarkState { extGStates, imageXObj, backgroundOps, foregroundOps }`
- Both builders emit ExtGState + optional image XObject as separate indirect objects
- `wmExtraObjs` count added to `baseObjCount` for correct object numbering
- Resource dict includes `/ExtGState << /GS1 N 0 R >>` and optionally `/XObject << /ImW M 0 R >>`
- NOT tagged content — watermarks are decorative, not accessible

## Table of Contents Model
- `TocBlock`: `{ type: 'toc'; title?: string; maxLevel?: 1|2|3; fontSize?: number; indent?: number }`
- **Document builder only** — table builder has no headings concept
- **Multi-pass pagination** (max 3 iterations):
  1. Pass 1: paginate without TOC → collect `HeadingDestination[]` (destName, text, level, pageIndex, y)
  2. Pass 2: estimate TOC height via `_estimateTocHeight()`, re-paginate with TOC height included
  3. Pass 3 (if needed): if heading page assignments shifted, re-paginate one more time
- `_renderToc()`: renders TOC title (bold, larger font), indented entries with dot leaders, right-aligned page numbers
- TOC entries are `/GoTo` annotations: `<< /Type /Annot /Subtype /Link /Rect [...] /Dest /toc_h_N >>`
- Annotations starting with `#` prefix → `/Dest` (internal); others → `/URI` (external)
- **Named destinations** in catalog: `/Dests << /toc_h_0 [pageObj /XYZ x y null] ... >>`
- `/Dests` only emitted when `hasToc && headingDests.length > 0`
- **Tagged mode**: `/TOC` structure element with `/TOCI` children for PDF/UA compliance
- Constants: `DEFAULT_TOC_SIZE=10`, `DEFAULT_TOC_INDENT=15`, `TOC_LINE_HEIGHT=1.6`, `TOC_TITLE_SPACING=8`
- `headingDestIdx` counter tracks heading render order, updates Y positions with actual render coordinates

## SVG Rendering Model (pdf-svg.ts)
- `parseSvg(svgString)`: parses SVG XML → `SvgSegment[]` (path data + style)
- `renderSvgToPdf(segments, width, height, viewBox)`: maps SVG coordinates to PDF path operators
- Supported element types: `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>` — 7 types
- PDF path operators: `m` (moveto), `l` (lineto), `c` (curveto), `re` (rectangle), `h` (closepath), `S` (stroke), `f` (fill)
- ViewBox scaling: SVG coordinates mapped proportionally to PDF points
- `SvgBlock`: `{ type: 'svg', content, width?, height?, align? }` — document block type
- Tagged mode: wrapped in `/Figure` structure element with MCID

## AcroForm Model (pdf-form.ts — ISO 32000-1 §12.7)
- `buildAcroFormDict(fields, fontRef)`: builds `/AcroForm << /Fields [...] /DR << /Font << >> >> >>`
- Field types: text (`/FT /Tx`), checkbox (`/FT /Btn`), radio (`/FT /Btn /Ff`), dropdown (`/FT /Ch`), listbox (`/FT /Ch /Ff`)
- `buildFormField(field, objNum, pageRef)`: builds individual field object with `/T`, `/V`, `/DA`, `/Rect`, `/Ff`
- `buildAppearanceStream(field)`: generates `/AP << /N stream >>` for visual rendering
- Text field appearance streams: `/Tx BMC...EMC` marked content wrapper required (ISO 32000-1 §12.7.3.3)
- Radio button groups: parent-child `/Kids`/`/Parent` hierarchy — parent holds `/V`, children are mutually exclusive (ISO 32000-1 §12.7.4.2.4)
- `RadioGroupContext`: tracks radio groups by name, emits parent objects with `/Kids` array
- `checked` property: `FormFieldBlock.checked?: boolean` for checkbox/radio default state → `/V /Yes /AS /Yes`
- Indirect font refs: `/DR << /Font << /Helv fontObjNum 0 R >> >>` uses actual object number, not inline dict
- `FormFieldBlock`: `{ type: 'formField', fieldType, name, ... }` — document block type
- Tagged mode: form fields wrapped in `/Form` structure element with MCID
- `/AcroForm` dict emitted on Catalog when form fields present

## Digital Signature Model (pdf-signature.ts — ISO 32000-1 §12.8)
- `buildSignatureField(objNum, byteRangeSize)`: builds `/Sig` field with `/ByteRange` placeholder
- Signature includes `/Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached`
- `signPdfBytes(pdfBytes, privateKey, certificate)`: round-trip sign → inject CMS into `/Contents`
- `/ByteRange [0 before after end]`: specifies which bytes are signed (excludes `/Contents` hex)
- CMS SignedData via `crypto/cms.ts`: signed attributes, certificate embedding, digest

## Crypto Module (src/crypto/ — standalone, zero-dependency)
- `sha.ts`: SHA-384, SHA-512, HMAC-SHA-256 — pure JavaScript, no WebCrypto dependency
- `asn1.ts`: ASN.1 DER encoding/decoding: SEQUENCE, INTEGER, OID, OCTET STRING, BIT STRING
- `rsa.ts`: RSA PKCS#1 v1.5 signing/verification with modular exponentiation (BigInt)
- `ecdsa.ts`: ECDSA P-256 (secp256r1) signing/verification
- `x509.ts`: X.509 DER certificate parsing — issuer, subject, validity, public key extraction
- `cms.ts`: CMS SignedData (PKCS#7) builder — signs digest, embeds certificate chain

## Streaming Output Model (pdf-stream-writer.ts)
- `buildPdfStream(objects, trailer)`: AsyncGenerator yielding `Uint8Array` chunks
- `streamPdf(params)` / `streamDocumentPdf(params)`: public streaming API
- Chunk size configurable via `chunkSize` option (default: 65536 bytes)
- Each yield is a self-contained Uint8Array — consumer concatenates or writes to stream
- Supports compression and encryption in streaming mode

## PDF Parser Module (src/parser/ — ISO 32000-1 §7)
- `PdfTokenizer`: lexical scanner — scans one token at a time (lazy, streaming-friendly)
- `parseObject()`: parses all PDF value types (number, string, name, boolean, null, array, dict, stream, ref)
- `parseDictionary()`: convenience for `<< >>` blocks with type guards
- Type guards: `isDict()`, `isArray()`, `isStream()`, `isRef()` — discriminated union
- `parseXref()`: handles table format (`xref\n0 N\n...`) and stream format (`/Type /XRef`), follows `/Prev` chain
- `PdfReader`: high-level reader — `open(bytes)`, `getPage(n)`, `getPageCount()`, `getMetadata()`, `decodeStream()`
- `PdfModifier`: incremental modification — `addPage()`, `removePage()`, `setMetadata()`, `save()` with `/Prev` chain
- Parser types: `PdfValue`, `PdfDict`, `PdfArray`, `PdfStream`, `PdfRef` — type-safe union
- `pdf-inflate.ts`: DEFLATE decompression (native zlib fallback → pure JS inflate)
