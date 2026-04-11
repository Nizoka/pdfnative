---
description: "Audit and improve pdfnative for security, ISO compliance, accessibility, and cross-platform compatibility."
agent: "agent"
---
# Compliance Audit

Perform a comprehensive compliance audit of pdfnative.

## Audit Areas

### 1. ISO 32000-1 Compliance
- Verify PDF structure: header, body, xref, trailer
- Validate object numbering and cross-references
- Check stream length accuracy
- Verify font embedding (CIDFont Type2 / Identity-H)
- Validate ToUnicode CMap for text extraction

### 2. Security
- No `eval()`, `Function()`, or dynamic code execution
- No prototype pollution vectors
- Input validation at public API boundaries
- Safe string escaping in PDF operators (no injection)
- No information leakage in error messages

### 3. Accessibility
- PDF metadata: Title, Author, CreationDate present
- Proper font encoding for text extraction (ToUnicode CMap)
- Tagged PDF: structure tree, marked content, /ActualText
- PDF/UA: /TOC + /TOCI for table of contents, /Link for annotations

### 4. Cross-Platform
- Pure JavaScript — no Node.js-specific APIs in core
- Web Worker compatible (structured cloneable data)
- No `Buffer` usage in library code (use `Uint8Array`)
- ESM + CJS dual exports working correctly

### 5. Zero-Dependency Verification
- No runtime `dependencies` in package.json
- No dynamic `require()` or `import()` of external modules
- All font data bundled as data modules

### 6. Watermark & Template Compliance
- Watermark transparency: ExtGState /ca validated against PDF/A-1b (ISO 19005-1 §6.4)
- Watermark validation: `validateWatermark()` enforces mutual exclusion rules
- Header/footer templates: placeholder substitution produces safe PDF strings
- Template backward compat: `footerText` still works alongside new `footerTemplate`

### 7. Table of Contents Compliance
- TOC internal links use `/Dest` (GoTo) — not `/URI`
- Named destinations emitted in `/Dests` catalog dictionary
- Multi-pass pagination converges within 3 iterations
- Tagged mode: `/TOC` and `/TOCI` structure elements for PDF/UA

Report findings with severity (critical/warning/info) and recommended fixes.
