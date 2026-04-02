/**
 * pdfnative — Core Module Index
 * ================================
 */

export { buildPDF, buildPDFBytes } from './pdf-builder.js';
export { txt, txtR, txtC, txtShaped, txtTagged, txtRTagged, txtCTagged, fmtNum } from './pdf-text.js';
export { toBytes, slugify, downloadBlob } from './pdf-stream.js';
export {
    PG_W, PG_H, DEFAULT_MARGINS, DEFAULT_CW,
    ROW_H, TH_H, INFO_LN, BAL_H, TITLE_LN, FT_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions, resolveLayout,
} from './pdf-layout.js';
export type { StructElement, MCRef, PdfAConfig } from './pdf-tags.js';
export {
    wrapSpan, wrapMarkedContent, escapePdfUtf16,
    createMCIDAllocator, buildStructureTree,
    buildXMPMetadata, buildOutputIntentDict, buildMinimalSRGBProfile,
    resolvePdfAConfig,
} from './pdf-tags.js';
export type { ParsedImage } from './pdf-image.js';
export {
    detectImageFormat, parseJPEG, parsePNG, parseImage,
    buildImageXObject, buildSMaskXObject, buildImageOperators,
} from './pdf-image.js';
export type { LinkAnnotation, InternalLink, Annotation } from './pdf-annot.js';
export { validateURL, buildLinkAnnotation, buildInternalLinkAnnotation, isLinkAnnotation } from './pdf-annot.js';
export { parseColor, isValidPdfRgb, normalizeColors } from './pdf-color.js';
export { deflateSync, deflateStored, compressStream, adler32, uint8ToBinaryString, initNodeCompression, setDeflateImpl } from './pdf-compress.js';

export type { EncryptionState } from './pdf-encrypt.js';
export {
    aesCBC, md5, sha256,
    computePermissions, generateDocId,
    initEncryption, encryptStream, encryptString,
    buildEncryptDict, buildIdArray,
} from './pdf-encrypt.js';
