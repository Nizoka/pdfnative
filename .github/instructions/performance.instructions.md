---
description: "Use when optimizing performance, profiling hot paths, reducing allocations, or benchmarking PDF generation speed. Covers zero-copy patterns, caching strategies, and memory efficiency."
---
# Performance Engineering Standards

## Hot Path Identification
- **Text rendering loop**: `txt()`, `txtR()`, `txtC()`, `txtShaped()` — called per-cell per-row
- **Tagged text variants**: `txtTagged()`, `txtRTagged()`, `txtCTagged()` — same as above plus BDC/EMC wrapping
- **Glyph encoding**: `cmap` lookup + hex string building — called per-character
- **Width calculation**: Helvetica/CIDFont width accumulation — called per-cell for truncation
- **Page assembly**: content stream concatenation — called per-page
- **Tagged mode overhead**: MCID allocation, structure tree building, /ActualText hex encoding — per-cell cost in tagged mode
- **Image parsing**: JPEG SOF scanning and PNG IDAT concatenation — called per image block
- **Image byte conversion**: `uint8ToByteString()` chunk loop — called per image (IO-bound, not CPU-bound)
- **Stream compression**: `compressStream()` / `deflateSync()` — called per stream object when `compress: true`; native zlib is fast, stored-block fallback is O(n) memcopy

## Zero-Allocation Patterns
- Reuse string buffers via array accumulation + `.join('')`
- Pre-compute layout values (column positions, margins) — compute once, use everywhere
- Direct property access for font metrics: `fontData.widths[gid]` not `Map.get()`
- Avoid spread operator `...` in hot loops (creates new objects)
- Prefer `for` loops over `.map()/.filter()/.reduce()` in rendering paths

## Memory Efficiency
- TTF subsetting: use `DataView` over shared `ArrayBuffer` — no copies
- Font base64: decode once into byte string, cache in font registry
- Glyph hex encoding: pre-build lookup table for 0x0000–0xFFFF if needed
- Stream assembly: build as string[] array, single `.join('')` at the end

## Caching Strategy
- Font data: cached by lang key in font registry (permanent per session)
- Encoding context: created once per `buildPDF` call, reused for all text
- Column positions: computed once in `resolveLayout()`, passed through entire render

## Benchmarking Rules
- Benchmark before AND after any change to core rendering
- Test with realistic data: 500+ rows, mixed scripts, multiple fonts
- Measure: total generation time, peak memory, output file size
- Use `performance.now()` for high-resolution timing
- Run multiple iterations (minimum 100) to account for JIT warmup

## Size Optimization
- Tree-shaking: `sideEffects: false` — no module-level side effects
- Font subsetting: only embed glyphs actually used (dramatic size reduction)
- Avoid importing font data modules unless the script is detected in content
- Worker bundle: `noExternal: [/.*/]` — self-contained, no runtime imports
- FlateDecode compression: `compress: true` reduces output size by 70–90% for text-heavy PDFs
- Native zlib (`initNodeCompression()`) gives best compression ratio; stored-block fallback adds ~0.3% overhead
- Compression and encryption can be combined — compress first for optimal ratio (ISO 32000-1 §7.3.8)
