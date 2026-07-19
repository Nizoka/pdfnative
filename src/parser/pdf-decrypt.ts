/**
 * pdfnative — Standard Security Handler reader/decryptor
 * =========================================================
 * Password authentication and transparent object decryption for encrypted
 * PDFs (ISO 32000-1 §7.6 / ISO 32000-2 §7.6), closing the round-trip with
 * the pdfnative writer.
 *
 * Supported: AES-256 (V5/R6), AES-128 (V4/R4 `/AESV2`), RC4 (V4 `/CFM /V2`,
 * V2/R3, V1/R2 legacy), crypt-filter dispatch (`/StmF` / `/StrF` /
 * `/Identity`), `/EncryptMetadata false`, user and owner passwords.
 *
 * Unsupported (throws {@link PdfEncryptionUnsupportedError}): public-key
 * handlers (`/Adobe.PPKLite`…), the deprecated R5 revision, and unknown
 * crypt-filter methods.
 *
 * @since 1.6.0
 */

import {
    aesCBCDecrypt, aesECBDecrypt, computeHashR6, computeKeyR4,
    encodePasswordUTF8, md5, padPassword, PDF_PADDING, rc4,
} from '../core/pdf-encrypt.js';
import { isArray, isDict, isName, isStream, dictGetName, dictGetNum, nameValue } from './pdf-object-parser.js';
import type { PdfDict, PdfStream, PdfValue } from './pdf-object-parser.js';

// ── Errors ───────────────────────────────────────────────────────────

/** Thrown when a password is missing or rejected. */
export class PdfPasswordError extends Error {
    readonly code = 'PDF_WRONG_PASSWORD';
    constructor(message: string) {
        super(message);
        this.name = 'PdfPasswordError';
    }
}

/** Thrown when the document uses an encryption scheme pdfnative cannot read. */
export class PdfEncryptionUnsupportedError extends Error {
    readonly code = 'PDF_ENCRYPTION_UNSUPPORTED';
    /** The `/Filter` name of the security handler. */
    readonly filter: string;
    /** The `/V` (algorithm version) entry, when present. */
    readonly v: number | undefined;
    /** The `/R` (revision) entry, when present. */
    readonly r: number | undefined;
    constructor(message: string, filter: string, v?: number, r?: number) {
        super(message);
        this.name = 'PdfEncryptionUnsupportedError';
        this.filter = filter;
        this.v = v;
        this.r = r;
    }
}

// ── Context ──────────────────────────────────────────────────────────

/** Crypt-filter method resolved for streams or strings. */
export type CryptFilterMethod = 'V2' | 'AESV2' | 'AESV3' | 'Identity';

/**
 * Everything needed to decrypt the objects of one document, produced by a
 * successful {@link authenticate} call.
 */
export interface DecryptionContext {
    /** Security-handler revision (2, 3, 4 or 6). */
    readonly revision: 2 | 3 | 4 | 6;
    /** File encryption key (5–16 bytes for R2–R4, 32 bytes for R6). */
    readonly key: Uint8Array;
    /** Crypt-filter method applied to streams. */
    readonly stmCFM: CryptFilterMethod;
    /** Crypt-filter method applied to strings. */
    readonly strCFM: CryptFilterMethod;
    /** Whether the `/Metadata` stream is encrypted. */
    readonly encryptMetadata: boolean;
    /** Which password authenticated. */
    readonly authenticatedAs: 'user' | 'owner';
    /** Human-readable algorithm label (surfaced on `reader.encryption`). */
    readonly algorithm: 'rc4-40' | 'rc4-128' | 'aes128' | 'aes256';
}

// ── Byte/string helpers ──────────────────────────────────────────────

/** Parser strings are raw binary (one char per byte). */
function strToBytes(s: string): Uint8Array {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
}

function bytesToStr(b: Uint8Array): string {
    let s = '';
    const CHUNK = 8192;
    for (let i = 0; i < b.length; i += CHUNK) {
        s += String.fromCharCode(...b.subarray(i, Math.min(i + CHUNK, b.length)));
    }
    return s;
}

function bytesEqual(a: Uint8Array, b: Uint8Array, len: number): boolean {
    if (a.length < len || b.length < len) return false;
    let diff = 0;
    for (let i = 0; i < len; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

function dictGetStringBytes(dict: PdfDict, key: string): Uint8Array | null {
    const v = dict.get(key);
    return typeof v === 'string' ? strToBytes(v) : null;
}

// ── Encrypt-dict parsing ─────────────────────────────────────────────

interface ParsedEncryptDict {
    readonly filter: string;
    readonly v: number;
    readonly r: number;
    readonly keyLenBytes: number;
    readonly o: Uint8Array;
    readonly u: Uint8Array;
    readonly oe: Uint8Array | null;
    readonly ue: Uint8Array | null;
    readonly perms: Uint8Array | null;
    readonly p: number;
    readonly encryptMetadata: boolean;
    readonly stmCFM: CryptFilterMethod;
    readonly strCFM: CryptFilterMethod;
}

/** Resolve a `/StmF` / `/StrF` filter name against the `/CF` dictionary. */
function resolveCryptFilter(
    encryptDict: PdfDict,
    which: 'StmF' | 'StrF',
    resolve: (val: PdfValue) => PdfValue,
): CryptFilterMethod {
    const name = dictGetName(encryptDict, which) ?? 'Identity';
    if (name === 'Identity') return 'Identity';

    const cf = resolve(encryptDict.get('CF') ?? null);
    if (!isDict(cf)) return 'Identity';
    const filterDict = resolve(cf.get(name) ?? null);
    if (!isDict(filterDict)) return 'Identity';

    const cfm = dictGetName(filterDict, 'CFM') ?? 'None';
    if (cfm === 'V2' || cfm === 'AESV2' || cfm === 'AESV3') return cfm;
    if (cfm === 'None') return 'Identity';
    throw new PdfEncryptionUnsupportedError(
        `pdfnative: unsupported crypt filter method /CFM /${cfm} — only /V2 (RC4), /AESV2, /AESV3 and /Identity can be decrypted`,
        'Standard',
    );
}

function parseEncryptDict(
    encryptDict: PdfDict,
    resolve: (val: PdfValue) => PdfValue,
): ParsedEncryptDict {
    const filter = dictGetName(encryptDict, 'Filter') ?? '';
    if (filter !== 'Standard') {
        throw new PdfEncryptionUnsupportedError(
            `pdfnative: unsupported security handler /Filter /${filter || '(none)'} — only the Standard Security Handler (password-based) can be decrypted`,
            filter,
        );
    }

    const v = dictGetNum(encryptDict, 'V') ?? 0;
    const r = dictGetNum(encryptDict, 'R') ?? 0;

    const o = dictGetStringBytes(encryptDict, 'O');
    const u = dictGetStringBytes(encryptDict, 'U');
    if (!o || !u) {
        throw new PdfEncryptionUnsupportedError(
            'pdfnative: malformed /Encrypt dictionary — missing /O or /U entry',
            filter, v, r,
        );
    }

    const p = dictGetNum(encryptDict, 'P') ?? -1;
    const emVal = encryptDict.get('EncryptMetadata');
    const encryptMetadata = typeof emVal === 'boolean' ? emVal : true;

    let keyLenBytes: number;
    let stmCFM: CryptFilterMethod;
    let strCFM: CryptFilterMethod;

    if (v === 1) {
        keyLenBytes = 5;
        stmCFM = strCFM = 'V2';
    } else if (v === 2) {
        const lengthBits = dictGetNum(encryptDict, 'Length') ?? 40;
        keyLenBytes = Math.max(5, Math.min(16, Math.floor(lengthBits / 8)));
        stmCFM = strCFM = 'V2';
    } else if (v === 4) {
        const lengthBits = dictGetNum(encryptDict, 'Length') ?? 128;
        keyLenBytes = Math.max(5, Math.min(16, Math.floor(lengthBits / 8)));
        stmCFM = resolveCryptFilter(encryptDict, 'StmF', resolve);
        strCFM = resolveCryptFilter(encryptDict, 'StrF', resolve);
    } else if (v === 5) {
        keyLenBytes = 32;
        stmCFM = resolveCryptFilter(encryptDict, 'StmF', resolve);
        strCFM = resolveCryptFilter(encryptDict, 'StrF', resolve);
        if (r === 5) {
            throw new PdfEncryptionUnsupportedError(
                'pdfnative: the deprecated AES-256 revision 5 (Adobe ExtensionLevel 3 draft) is not supported — re-save the document with R6 encryption',
                filter, v, r,
            );
        }
    } else {
        throw new PdfEncryptionUnsupportedError(
            `pdfnative: unsupported encryption algorithm version /V ${v}`,
            filter, v, r,
        );
    }

    return {
        filter, v, r, keyLenBytes, o, u,
        oe: dictGetStringBytes(encryptDict, 'OE'),
        ue: dictGetStringBytes(encryptDict, 'UE'),
        perms: dictGetStringBytes(encryptDict, 'Perms'),
        p, encryptMetadata, stmCFM, strCFM,
    };
}

// ── R2–R4 authentication (ISO 32000-1 Algorithms 2–7) ────────────────

/** Compute the Algorithm 4/5 `/U` candidate for a given file key. */
function computeUCandidate(key: Uint8Array, docId: Uint8Array, revision: number): Uint8Array {
    if (revision === 2) {
        // Algorithm 4: RC4(padding) with the file key.
        return rc4(new Uint8Array(PDF_PADDING), key);
    }
    // Algorithm 5: MD5(padding + ID), RC4 chain with XORed keys.
    const buf = new Uint8Array(PDF_PADDING.length + docId.length);
    buf.set(PDF_PADDING);
    buf.set(docId, PDF_PADDING.length);
    let result = rc4(md5(buf), key);
    for (let i = 1; i <= 19; i++) {
        const mutated = new Uint8Array(key.length);
        for (let j = 0; j < key.length; j++) mutated[j] = key[j] ^ i;
        result = rc4(result, mutated);
    }
    return result;
}

/** Try to authenticate `paddedPwd` as the user password (Algorithm 6). */
function tryUserKeyLegacy(
    paddedPwd: Uint8Array,
    enc: ParsedEncryptDict,
    docId: Uint8Array,
): Uint8Array | null {
    const key = computeKeyR4(paddedPwd, enc.o, enc.p, docId, enc.keyLenBytes, enc.r, enc.encryptMetadata);
    const candidate = computeUCandidate(key, docId, enc.r);
    const compareLen = enc.r === 2 ? 32 : 16;
    return bytesEqual(candidate, enc.u, compareLen) ? key : null;
}

/** Recover the padded user password from `/O` with the owner password (Algorithm 7). */
function recoverUserPwdFromOwner(paddedOwnerPwd: Uint8Array, enc: ParsedEncryptDict): Uint8Array {
    let hash = md5(paddedOwnerPwd);
    if (enc.r >= 3) {
        for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, enc.keyLenBytes));
    }
    const rc4Key = hash.subarray(0, enc.keyLenBytes);

    let decrypted: Uint8Array = new Uint8Array(enc.o.subarray(0, 32));
    if (enc.r === 2) {
        decrypted = rc4(decrypted, rc4Key);
    } else {
        for (let i = 19; i >= 0; i--) {
            const mutated = new Uint8Array(rc4Key.length);
            for (let j = 0; j < rc4Key.length; j++) mutated[j] = rc4Key[j] ^ i;
            decrypted = rc4(decrypted, mutated);
        }
    }
    return decrypted;
}

function authenticateLegacy(
    enc: ParsedEncryptDict,
    docId: Uint8Array,
    password: string,
): DecryptionContext {
    if (enc.r !== 2 && enc.r !== 3 && enc.r !== 4) {
        throw new PdfEncryptionUnsupportedError(
            `pdfnative: unsupported Standard Security Handler revision /R ${enc.r}`,
            enc.filter, enc.v, enc.r,
        );
    }

    const algorithm: DecryptionContext['algorithm'] =
        enc.stmCFM === 'AESV2' || enc.strCFM === 'AESV2' ? 'aes128'
            : enc.keyLenBytes === 5 ? 'rc4-40' : 'rc4-128';

    const base = {
        revision: enc.r,
        stmCFM: enc.stmCFM,
        strCFM: enc.strCFM,
        encryptMetadata: enc.encryptMetadata,
        algorithm,
    } as const;

    // User password first (also covers the common empty-password case).
    const userKey = tryUserKeyLegacy(padPassword(password), enc, docId);
    if (userKey) return { ...base, key: userKey, authenticatedAs: 'user' };

    // Owner password: recover the padded user password from /O, then Algorithm 6.
    const recovered = recoverUserPwdFromOwner(padPassword(password), enc);
    const ownerKey = tryUserKeyLegacy(recovered, enc, docId);
    if (ownerKey) return { ...base, key: ownerKey, authenticatedAs: 'owner' };

    throw wrongPassword(password);
}

// ── R6 authentication (ISO 32000-2 Algorithm 2.A) ────────────────────

const ZERO_IV = new Uint8Array(16);

function authenticateR6(enc: ParsedEncryptDict, password: string): DecryptionContext {
    if (enc.u.length < 48 || enc.o.length < 48 || !enc.ue || !enc.oe) {
        throw new PdfEncryptionUnsupportedError(
            'pdfnative: malformed AES-256 /Encrypt dictionary — /U, /O, /UE or /OE missing or too short',
            enc.filter, enc.v, enc.r,
        );
    }
    const pwd = encodePasswordUTF8(password);
    const u48 = enc.u.subarray(0, 48);
    const o48 = enc.o.subarray(0, 48);

    // The spec-compliant hash first; the 'legacy' variant reproduces the
    // SHA-256-only rotation of pdfnative ≤ 1.5.0 so those documents stay
    // readable.
    for (const variant of ['spec', 'legacy'] as const) {
        // User password (Algorithm 2.A steps b–c).
        const uHash = computeHashR6(pwd, u48.subarray(32, 40), null, variant);
        if (bytesEqual(uHash, u48, 32)) {
            const ueKey = computeHashR6(pwd, u48.subarray(40, 48), null, variant);
            const fileKey = aesCBCDecrypt(enc.ue, ueKey, ZERO_IV, 'none').subarray(0, 32);
            return finishR6(enc, fileKey, 'user');
        }

        // Owner password (steps d–e; the hash covers the full 48-byte /U).
        const oHash = computeHashR6(pwd, o48.subarray(32, 40), u48, variant);
        if (bytesEqual(oHash, o48, 32)) {
            const oeKey = computeHashR6(pwd, o48.subarray(40, 48), u48, variant);
            const fileKey = aesCBCDecrypt(enc.oe, oeKey, ZERO_IV, 'none').subarray(0, 32);
            return finishR6(enc, fileKey, 'owner');
        }
    }

    throw wrongPassword(password);
}

function finishR6(
    enc: ParsedEncryptDict,
    fileKey: Uint8Array,
    authenticatedAs: 'user' | 'owner',
): DecryptionContext {
    // /Perms is a soft integrity check: when it decrypts to the expected
    // 'adb' marker we honour its EncryptMetadata byte; otherwise we keep the
    // dictionary values (lenient — mainstream viewers do the same).
    let encryptMetadata = enc.encryptMetadata;
    if (enc.perms && enc.perms.length >= 16) {
        const perms = aesECBDecrypt(enc.perms, fileKey);
        if (perms[9] === 0x61 && perms[10] === 0x64 && perms[11] === 0x62) {
            encryptMetadata = perms[8] === 0x54; // 'T'
        }
    }
    return {
        revision: 6,
        key: fileKey,
        stmCFM: enc.stmCFM,
        strCFM: enc.strCFM,
        encryptMetadata,
        authenticatedAs,
        algorithm: 'aes256',
    };
}

function wrongPassword(password: string): PdfPasswordError {
    return new PdfPasswordError(
        password === ''
            ? 'pdfnative: this PDF is encrypted and requires a password — pass { password } to open it'
            : 'pdfnative: the supplied password was rejected by this PDF’s security handler',
    );
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Authenticate a password against a document's `/Encrypt` dictionary and
 * derive the file decryption key.
 *
 * @param encryptDict - The resolved `/Encrypt` dictionary (NOT decrypted)
 * @param idFirst - First element of the trailer `/ID` array (empty for R6)
 * @param password - User or owner password (empty string tries the common
 *                   no-user-password case)
 * @param resolve - Value resolver for indirect refs inside the dict
 * @throws {PdfPasswordError} when the password is missing or wrong
 * @throws {PdfEncryptionUnsupportedError} for non-Standard handlers, R5, or
 *         unknown crypt-filter methods
 */
export function authenticate(
    encryptDict: PdfDict,
    idFirst: Uint8Array,
    password: string,
    resolve: (val: PdfValue) => PdfValue = v => v,
): DecryptionContext {
    const enc = parseEncryptDict(encryptDict, resolve);
    return enc.v === 5 ? authenticateR6(enc, password) : authenticateLegacy(enc, idFirst, password);
}

/** Derive the per-object key (R≤4) or return the file key (R6). */
function objectKey(ctx: DecryptionContext, num: number, gen: number, aes: boolean): Uint8Array {
    if (ctx.revision === 6) return ctx.key;

    const buf = new Uint8Array(ctx.key.length + 5 + (aes ? 4 : 0));
    let off = 0;
    buf.set(ctx.key, off); off += ctx.key.length;
    buf[off++] = num & 0xFF;
    buf[off++] = (num >> 8) & 0xFF;
    buf[off++] = (num >> 16) & 0xFF;
    buf[off++] = gen & 0xFF;
    buf[off++] = (gen >> 8) & 0xFF;
    if (aes) {
        buf[off++] = 0x73; buf[off++] = 0x41; buf[off++] = 0x6C; buf[off++] = 0x54; // 'sAlT'
    }
    return md5(buf).subarray(0, Math.min(ctx.key.length + 5, 16));
}

function decryptBytes(
    ctx: DecryptionContext,
    cfm: CryptFilterMethod,
    data: Uint8Array,
    num: number,
    gen: number,
): Uint8Array {
    if (cfm === 'Identity' || data.length === 0) return data;
    if (cfm === 'V2') {
        return rc4(data, objectKey(ctx, num, gen, false));
    }
    // AESV2 / AESV3: payload is IV(16) + ciphertext.
    if (data.length <= 16) return new Uint8Array(0);
    const key = objectKey(ctx, num, gen, true);
    return aesCBCDecrypt(data.subarray(16), key, data.subarray(0, 16), 'pkcs7');
}

/**
 * Decrypt a PDF string (raw binary JS string) belonging to object `num gen`.
 */
export function decryptString(ctx: DecryptionContext, raw: string, num: number, gen: number): string {
    if (ctx.strCFM === 'Identity' || raw.length === 0) return raw;
    return bytesToStr(decryptBytes(ctx, ctx.strCFM, strToBytes(raw), num, gen));
}

/**
 * Decrypt stream payload bytes belonging to object `num gen`.
 */
export function decryptStreamData(ctx: DecryptionContext, data: Uint8Array, num: number, gen: number): Uint8Array {
    return decryptBytes(ctx, ctx.stmCFM, data, num, gen);
}

// ── Object-graph decryption walker ───────────────────────────────────

/** True for streams that ISO 32000 exempts from encryption. */
function isExemptStream(dict: PdfDict, ctx: DecryptionContext): boolean {
    const type = dictGetName(dict, 'Type');
    if (type === 'XRef') return true; // §7.5.8.2 — never encrypted
    if (type === 'Metadata' && !ctx.encryptMetadata) return true;
    // An explicit /Crypt filter naming /Identity leaves the stream plaintext.
    const filter = dict.get('Filter');
    const names: string[] = [];
    if (isName(filter)) names.push(filter.value);
    else if (isArray(filter)) for (const f of filter) { const n = nameValue(f); if (n) names.push(n); }
    if (names.includes('Crypt')) return true; // decode parms default to /Identity
    return false;
}

/** True for dictionaries whose /Contents must stay raw (signature values, §7.6.2). */
function isSignatureDict(dict: PdfDict): boolean {
    const type = dictGetName(dict, 'Type');
    return type === 'Sig' || type === 'DocTimeStamp' || dict.has('ByteRange');
}

/**
 * Recursively decrypt every string and stream payload inside a freshly
 * parsed top-level object. Dicts and arrays are mutated in place; stream
 * values are replaced (their `data` is readonly), so the caller must use the
 * returned value.
 *
 * @param ctx - Decryption context from {@link authenticate}
 * @param val - The parsed object value
 * @param num - Object number (per-object key derivation)
 * @param gen - Generation number
 */
export function decryptObjectValue(ctx: DecryptionContext, val: PdfValue, num: number, gen: number): PdfValue {
    return walk(ctx, val, num, gen, 0, false);
}

const MAX_WALK_DEPTH = 100;

function walk(
    ctx: DecryptionContext,
    val: PdfValue,
    num: number,
    gen: number,
    depth: number,
    skipStrings: boolean,
): PdfValue {
    if (depth > MAX_WALK_DEPTH || val === null || typeof val !== 'object' && typeof val !== 'string') {
        return val;
    }
    if (typeof val === 'string') {
        return skipStrings ? val : decryptString(ctx, val, num, gen);
    }
    if (isArray(val)) {
        for (let i = 0; i < val.length; i++) {
            val[i] = walk(ctx, val[i], num, gen, depth + 1, skipStrings);
        }
        return val;
    }
    if (isDict(val)) {
        const sig = isSignatureDict(val);
        for (const [k, v] of val) {
            // Signature /Contents holds the raw CMS blob and is written
            // outside encryption so /ByteRange stays valid (§7.6.2 note 3).
            const skip = skipStrings || (sig && k === 'Contents');
            val.set(k, walk(ctx, v, num, gen, depth + 1, skip));
        }
        return val;
    }
    if (isStream(val)) {
        walk(ctx, val.dict, num, gen, depth + 1, skipStrings);
        if (isExemptStream(val.dict, ctx)) return val;
        return { type: 'stream', dict: val.dict, data: decryptStreamData(ctx, val.data, num, gen) } satisfies PdfStream;
    }
    return val;
}
