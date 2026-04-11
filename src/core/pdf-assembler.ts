/**
 * pdfnative — PDF Binary Assembler
 * ===================================
 * Shared low-level PDF binary assembly primitives used by both
 * the table builder (pdf-builder.ts) and document builder (pdf-document.ts).
 *
 * Handles object emission, stream compression/encryption, xref table,
 * and trailer generation — the identical parts of PDF assembly.
 */

import { compressStream } from './pdf-compress.js';
import { encryptStream, buildEncryptDict, buildIdArray, type EncryptionState } from './pdf-encrypt.js';

// ── PDF Writer ───────────────────────────────────────────────────────

/**
 * Low-level PDF binary writer with offset tracking.
 * Created via `createPdfWriter()`. Provides `emit`, `emitObj`, and `emitStreamObj`.
 */
export interface PdfWriter {
    /** Append raw string to PDF output and advance byte offset. */
    readonly emit: (str: string) => void;
    /** Emit a PDF indirect object (`num 0 obj ... endobj`). */
    readonly emitObj: (num: number, content: string) => void;
    /** Emit a stream object with optional compression and encryption. */
    readonly emitStreamObj: (num: number, dictEntries: string, streamData: string, skipCompress?: boolean) => void;
    /** Current byte offset in the output. */
    readonly offset: () => number;
    /** Adjust the tracked byte offset by a delta (for in-place catalog rewrites). */
    readonly adjustOffset: (delta: number) => void;
    /** Per-object byte offsets for xref table. */
    readonly objOffsets: number[];
    /** Accumulated output parts. Join with '' for final PDF string. */
    readonly parts: string[];
}

/**
 * Create a PDF binary writer with offset-tracked emission.
 *
 * @param compress - Whether to FlateDecode-compress streams
 * @param encState - Encryption state (null if no encryption)
 * @returns PdfWriter with emit/emitObj/emitStreamObj
 */
export function createPdfWriter(compress: boolean, encState: EncryptionState | null): PdfWriter {
    const parts: string[] = [];
    let _offset = 0;
    const objOffsets: number[] = [];

    function emit(str: string): void {
        parts.push(str);
        _offset += str.length;
    }

    function emitObj(num: number, content: string): void {
        objOffsets[num] = _offset;
        emit(`${num} 0 obj\n${content}\nendobj\n\n`);
    }

    /**
     * Emit a stream object with optional compression and encryption.
     * Order: compress → encrypt (ISO 32000-1 §7.3.8).
     */
    function emitStreamObj(num: number, dictEntries: string, streamData: string, skipCompress?: boolean): void {
        let data = streamData;
        let dict = dictEntries;

        // Step 1: Compress (before encryption)
        if (compress && !skipCompress) {
            const compressed = compressStream(data);
            dict = dict.replace(/\/Length \d+/, `/Filter /FlateDecode /Length ${compressed.length}`);
            data = compressed;
        }

        // Step 2: Encrypt (after compression)
        if (encState) {
            const encrypted = encryptStream(data, encState, num, 0);
            emitObj(num, `${dict.replace(/\/Length \d+/, `/Length ${encrypted.length}`)} >>\nstream\n${encrypted}\nendstream`);
        } else {
            emitObj(num, `${dict} >>\nstream\n${data}\nendstream`);
        }
    }

    return { emit, emitObj, emitStreamObj, offset: () => _offset, adjustOffset: (d: number) => { _offset += d; }, objOffsets, parts };
}

// ── Xref & Trailer ──────────────────────────────────────────────────

/**
 * Write the xref table, trailer, startxref, and %%EOF to finalize a PDF.
 * If encryption is active, the encryption dict object is emitted first.
 *
 * @param w - PDF writer
 * @param totalObjs - Total number of objects emitted so far
 * @param infoObjNum - Object number of the /Info dictionary
 * @param encState - Encryption state (null if no encryption)
 * @returns Final totalObjs count (may increase if encryption dict was added)
 */
export function writeXrefTrailer(
    w: PdfWriter,
    totalObjs: number,
    infoObjNum: number,
    encState: EncryptionState | null,
): number {
    let encryptObjNum = 0;
    if (encState) {
        encryptObjNum = totalObjs + 1;
        w.emitObj(encryptObjNum, buildEncryptDict(encState));
        totalObjs = encryptObjNum;
    }

    const xrefOffset = w.offset();
    w.emit('xref\n');
    w.emit(`0 ${totalObjs + 1}\n`);
    w.emit('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjs; i++) {
        if (w.objOffsets[i] >= 10_000_000_000) throw new Error('PDF exceeds maximum xref offset (10 GB)');
        w.emit(`${String(w.objOffsets[i]).padStart(10, '0')} 00000 n \n`);
    }

    w.emit('trailer\n');
    if (encState) {
        w.emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R /Encrypt ${encryptObjNum} 0 R /ID ${buildIdArray(encState.docId)} >>\n`);
    } else {
        w.emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R >>\n`);
    }
    w.emit('startxref\n');
    w.emit(`${xrefOffset}\n`);
    w.emit('%%EOF');

    return totalObjs;
}
