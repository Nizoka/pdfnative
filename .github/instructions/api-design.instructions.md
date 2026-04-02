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
1. Types (type-only exports)
2. Core — PDF Builder (table-centric)
3. Core — Document Builder (`buildDocumentPDF`, `buildDocumentPDFBytes`, `wrapText`)
4. Core — Image Support (`parseImage`, `buildImageXObject`, `buildImageOperators`, `ParsedImage`)
5. Core — Link Annotations (`validateURL`, `buildLinkAnnotation`, `buildInternalLinkAnnotation`, `isLinkAnnotation`, `LinkAnnotation`, `InternalLink`, `Annotation`)
6. Core — Layout
7. Core — Tagged PDF & PDF/A (`StructElement`, `MCRef`, `wrapSpan`, `buildStructureTree`, `buildXMPMetadata`, etc.)
8. Core — Stream Compression (`initNodeCompression`, `setDeflateImpl`, `deflateSync`, `deflateStored`, `compressStream`, `adler32`, `uint8ToBinaryString`)
9. Fonts — Encoding & Loading
10. Shaping — Thai & Multi-Script
11. Shaping — BiDi & Arabic/Hebrew (`resolveBidiRuns`, `containsRTL`, `shapeArabicText`, `containsArabic`, `containsHebrew`, `BidiType`, `BidiRun`)
12. Worker — Off-Thread Generation

## Documentation Requirements
- README Quick Start must work as-is (copy-paste ready)
- API Reference table in README for every public function
- Code examples for non-obvious usage (font registration, worker setup)
- Changelog entry for every user-visible change
