---
description: "Use when designing public API, adding exports, modifying function signatures, updating src/index.ts, or planning breaking changes. Covers API stability, backward compatibility, and documentation standards."
applyTo: "src/index.ts"
---
# API Design Standards

## Public API Rules
- All public symbols exported from `src/index.ts` — single entry point
- Every exported function must have a JSDoc comment with `@param` and `@returns`
- Type exports use `export type { ... }` — zero runtime cost
- Never export internal helpers — if it's not in `src/index.ts`, it's private

## Backward Compatibility
- No breaking changes within a major version
- Adding new optional parameters: always add at the end, with sensible defaults
- New features: new functions > new parameters on existing functions
- Deprecation: mark with `@deprecated` JSDoc, keep for at least one minor version

## Function Signature Conventions
- Options object pattern for functions with >3 parameters
- Required params first, optional config object last: `fn(data, options?)`
- Return types: always explicit, never inferred for public API
- Overloads: use TypeScript overload signatures for type-safe variants

## Naming Conventions
- Functions: `verbNoun` — `buildPDF`, `loadFontData`, `shapeThaiText`
- Types: `PascalCase` — `PdfParams`, `FontEntry`, `ShapedGlyph`
- Constants: `UPPER_SNAKE` — `PG_W`, `ROW_H`, `WORKER_THRESHOLD`
- Internal helpers: `_prefixed` or unexported

## Export Categories (maintain grouping in index.ts)
1. Types (type-only exports) — includes `PageTemplate`, `WatermarkText`, `WatermarkImage`, `WatermarkOptions`, `TocBlock`
2. Core — PDF Builder (table-centric)
3. Core — Document Builder (`buildDocumentPDF`, `buildDocumentPDFBytes`, `wrapText`)
4. Core — Image Support (`parseImage`, `buildImageXObject`, `buildImageOperators`, `ParsedImage`)
5. Core — Link Annotations (`validateURL`, `buildLinkAnnotation`, `buildInternalLinkAnnotation`, `isLinkAnnotation`, `LinkAnnotation`, `InternalLink`, `Annotation`)
6. Core — Color Utilities (`parseColor`, `isValidPdfRgb`, `normalizeColors`)
7. Core — Watermark (`WatermarkState`, `validateWatermark`, `buildWatermarkState`)
8. Core — Layout (`PG_W`, `PG_H`, `HEADER_H`, `PAGE_SIZES`, `resolveTemplate`, `resolveLayout`, `computeColumnPositions`)
9. Core — Tagged PDF & PDF/A (`resolvePdfAConfig`, `buildEmbeddedFiles`, `validateAttachments`, `PDF_A_CONFORMANCE_TARGETS`, `PdfAConfig`, `PdfAConformanceTarget`) — structure-tree/XMP internals (`buildStructureTree`, `buildXMPMetadata`, `wrapSpan`, `StructElement`, `MCRef`) are private, never re-export them
10. Core — Stream Compression (`initNodeCompression`, `setDeflateImpl`) — `deflateSync`/`deflateStored`/`compressStream`/`adler32`/`uint8ToBinaryString` are private
11. Fonts — Encoding & Loading
12. Shaping — Thai & Multi-Script (`detectCharLang`, `detectFallbackLangs`, `splitTextByFont`, `needsUnicodeFont`)
13. Shaping — BiDi & Arabic/Hebrew (`resolveBidiRuns`, `containsRTL`, `normalizeBidiEmbeddings`, `stripBidiControls`, `shapeArabicText`, `containsArabic`, `containsHebrew`, `BidiRun`) — `BidiType` is private
14. Worker — Off-Thread Generation
15. Core — SVG Rendering (`parseSvgPath`, `renderSvg`, `SvgSegment`, `SvgRenderOptions`)
16. Core — AcroForm & Charts (`buildFormWidget`, `buildAcroFormDict`, `buildAppearanceStreamDict`, `buildRadioGroupParent`, `defaultFieldHeight`, `RadioGroupContext`, `FormFieldType`, `FormField`; form fill: `readFormFields`, `fillForm`, `flattenForm`; charts: `renderChartBlock`, `estimateChartHeight`, `niceTicks`, `ChartBlock`)
17. Core — Digital Signatures (`buildSigDict`, `signPdfBytes`, `estimateContentsSize`, `addSignaturePlaceholder`, `PdfSignOptions`, `SigDictMetadata`)
18. Core — Streaming (`buildPDFStream`, `buildDocumentPDFStream`, `buildPDFStreamTrue`, `buildDocumentPDFStreamTrue`, `buildPDFStreamPageByPage`, `buildDocumentPDFStreamPageByPage`, `streamToFile`, `StreamOptions`)
19. Crypto — Primitives (`sha384`, `sha512`, `hmacSha256`, `rsaSign`, `ecdsaSign`, `parseCertificate`, `buildCmsSignedData`, `setCryptoProvider`)
20. Parser — Read & Modify (`openPdf`/`PdfReader`, `createModifier`/`PdfModifier`, `createTokenizer`/`PdfTokenizer`, `parseValue`, `parseIndirectObject`, `parseXrefTable`, `PdfValue`, `ParsedDict`, `PdfRef`, `extractText`, `readFormFields`-family lives in core, `mergePdfs`/`splitPdf`/`extractPages` + streaming variants, `validatePdfUA`, decode filters, `PdfModifier.updateMetadata` (v1.7.0))
21. Core — LTV / PAdES (v1.7.0: `signPdfBytesWithTimestamp`, `collectValidationInfo`, `embedValidationInfo`, `addValidationInfo`, `addDocumentTimestamp`, `listSignatures`, `vriKeyForContents`, `buildDocTimeStampDict`; injected transports: `setTimestampProvider`/`getTimestampProvider`, `setRevocationProvider`/`getRevocationProvider`, `TimestampProvider`, `RevocationProvider` — the engine itself never opens a socket)
22. Core — Print Production (v1.7.0: `layout.print` page boxes + `bleed` shorthand + `marks`, `/Trapped` metadata with XMP parity, custom OutputIntent ICC, `/UserUnit`, print-dialog `viewerPreferences`: `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`)
23. Core — PDF/A Diagnostics (v1.7.0: `strict`, `onDiagnostic`, `PdfDiagnostic`, `PdfDiagnosticCode` — codes `PDFA_NO_FONT_ENTRIES`, `PDFA_UNEMBEDDED_FORM_FONT`, `PDFA_DEVICE_CMYK_IMAGE`)

## Parser Option-Type Precedent
- Parser-module option/result types live in the module itself (`MergeOptions`,
  `OpenPdfOptions`, `ExtractTextOptions`, `ParsedFormField`), NOT in
  `src/types/pdf-types.ts`
- Encryption re-use: `MergeOptions.encrypt` reuses the builder's
  `EncryptionOptions` shape (`ownerPassword`/`userPassword`/`permissions`/
  `algorithm`) — never invent a parallel option shape for the same concept
- Internal key material (e.g. `getDecryptionContext`) is exported from its
  module for sibling use but NEVER re-exported from `src/index.ts`

## Documentation Requirements
- README Quick Start must work as-is (copy-paste ready)
- API Reference table in README for every public function
- Code examples for non-obvious usage (font registration, worker setup)
- Changelog entry for every user-visible change
