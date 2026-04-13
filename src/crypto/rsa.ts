/**
 * pdfnative — RSA PKCS#1 v1.5 Sign / Verify
 * ============================================
 * Pure BigInt implementation of RSA signature operations.
 * Montgomery multiplication for performance. PKCS#1 v1.5 padding (RFC 8017).
 * Zero external dependencies.
 */

import { sha256 } from './sha.js';
import type * as Asn1Module from './asn1.js';

// ── DigestInfo prefixes (RFC 8017 §9.2) ─────────────────────────────

/** SHA-256 DigestInfo prefix — prepend to 32-byte hash before PKCS#1 padding. */
const DIGESTINFO_SHA256 = new Uint8Array([
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09,
    0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
    0x05, 0x00, 0x04, 0x20,
]);

// ── Types ────────────────────────────────────────────────────────────

/** RSA public key. */
export interface RsaPublicKey {
    readonly n: bigint;  // modulus
    readonly e: bigint;  // public exponent
}

/** RSA private key (CRT form for efficiency). */
export interface RsaPrivateKey {
    readonly n: bigint;   // modulus
    readonly d: bigint;   // private exponent
    readonly p: bigint;   // first prime
    readonly q: bigint;   // second prime
    readonly dp: bigint;  // d mod (p-1)
    readonly dq: bigint;  // d mod (q-1)
    readonly qi: bigint;  // q^(-1) mod p
}

// ── Modular Arithmetic ───────────────────────────────────────────────

/** Modular exponentiation using square-and-multiply. */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    if (mod === 1n) return 0n;
    let result = 1n;
    base = ((base % mod) + mod) % mod;
    while (exp > 0n) {
        if (exp & 1n) {
            result = (result * base) % mod;
        }
        exp >>= 1n;
        base = (base * base) % mod;
    }
    return result;
}

/** Modular inverse using extended Euclidean algorithm. */
export function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [a, m];
    let [old_s, s] = [1n, 0n];

    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }

    if (old_r !== 1n) throw new Error('Modular inverse does not exist');
    return ((old_s % m) + m) % m;
}

// ── RSA Core Operations ─────────────────────────────────────────────

/** RSA raw operation: m^e mod n (encrypt/verify direction). */
function rsaPublicOp(msg: bigint, key: RsaPublicKey): bigint {
    return modPow(msg, key.e, key.n);
}

/** RSA raw operation with CRT: m^d mod n (decrypt/sign direction). */
function rsaPrivateOp(msg: bigint, key: RsaPrivateKey): bigint {
    // CRT: compute m1 = msg^dp mod p, m2 = msg^dq mod q
    const m1 = modPow(msg % key.p, key.dp, key.p);
    const m2 = modPow(msg % key.q, key.dq, key.q);
    // h = qi * (m1 - m2) mod p
    const h = (key.qi * (((m1 - m2) % key.p) + key.p)) % key.p;
    // m = m2 + h * q
    return m2 + h * key.q;
}

// ── PKCS#1 v1.5 Padding ─────────────────────────────────────────────

/**
 * PKCS#1 v1.5 signature padding (RFC 8017 §8.2.1).
 * Constructs: 0x00 0x01 [0xFF padding] 0x00 [DigestInfo + hash]
 */
function pkcs1v15Pad(hash: Uint8Array, keyLen: number): Uint8Array {
    const digestInfo = new Uint8Array(DIGESTINFO_SHA256.length + hash.length);
    digestInfo.set(DIGESTINFO_SHA256);
    digestInfo.set(hash, DIGESTINFO_SHA256.length);

    const padLen = keyLen - 3 - digestInfo.length;
    if (padLen < 8) throw new Error('RSA key too short for PKCS#1 v1.5 signature');

    const em = new Uint8Array(keyLen);
    em[0] = 0x00;
    em[1] = 0x01;
    for (let i = 2; i < 2 + padLen; i++) em[i] = 0xff;
    em[2 + padLen] = 0x00;
    em.set(digestInfo, 3 + padLen);

    return em;
}

/** Convert big-endian bytes to BigInt. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}

/** Convert BigInt to big-endian bytes of specified length. */
export function bigIntToBytes(value: bigint, length: number): Uint8Array {
    const result = new Uint8Array(length);
    let v = value;
    for (let i = length - 1; i >= 0; i--) {
        result[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return result;
}

/** Byte length of an RSA modulus. */
function keyByteLen(n: bigint): number {
    const hex = n.toString(16);
    return Math.ceil(hex.length / 2);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Sign a message with RSA PKCS#1 v1.5 + SHA-256.
 *
 * @param message - Raw message bytes to sign.
 * @param privateKey - RSA private key (CRT form).
 * @returns DER-encoded signature bytes.
 */
export function rsaSign(message: Uint8Array, privateKey: RsaPrivateKey): Uint8Array {
    const hash = sha256(message);
    const kLen = keyByteLen(privateKey.n);
    const em = pkcs1v15Pad(hash, kLen);
    const m = bytesToBigInt(em);
    const s = rsaPrivateOp(m, privateKey);
    return bigIntToBytes(s, kLen);
}

/**
 * Sign a pre-computed hash with RSA PKCS#1 v1.5.
 *
 * @param hash - SHA-256 hash (32 bytes).
 * @param privateKey - RSA private key (CRT form).
 * @returns Signature bytes (same length as modulus).
 */
export function rsaSignHash(hash: Uint8Array, privateKey: RsaPrivateKey): Uint8Array {
    if (hash.length !== 32) throw new Error('Expected 32-byte SHA-256 hash');
    const kLen = keyByteLen(privateKey.n);
    const em = pkcs1v15Pad(hash, kLen);
    const m = bytesToBigInt(em);
    const s = rsaPrivateOp(m, privateKey);
    return bigIntToBytes(s, kLen);
}

/**
 * Verify an RSA PKCS#1 v1.5 + SHA-256 signature.
 *
 * @param message - Raw message bytes.
 * @param signature - Signature bytes.
 * @param publicKey - RSA public key.
 * @returns true if signature is valid.
 */
export function rsaVerify(message: Uint8Array, signature: Uint8Array, publicKey: RsaPublicKey): boolean {
    const hash = sha256(message);
    const kLen = keyByteLen(publicKey.n);

    const s = bytesToBigInt(signature);
    const m = rsaPublicOp(s, publicKey);
    const em = bigIntToBytes(m, kLen);

    const expected = pkcs1v15Pad(hash, kLen);

    // Constant-time comparison
    if (em.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < em.length; i++) {
        diff |= em[i] ^ expected[i];
    }
    return diff === 0;
}

/**
 * Verify an RSA PKCS#1 v1.5 signature against a pre-computed hash.
 *
 * @param hash - SHA-256 hash (32 bytes).
 * @param signature - Signature bytes.
 * @param publicKey - RSA public key.
 * @returns true if signature is valid.
 */
export function rsaVerifyHash(hash: Uint8Array, signature: Uint8Array, publicKey: RsaPublicKey): boolean {
    if (hash.length !== 32) return false;
    const kLen = keyByteLen(publicKey.n);

    const s = bytesToBigInt(signature);
    const m = rsaPublicOp(s, publicKey);
    const em = bigIntToBytes(m, kLen);

    const expected = pkcs1v15Pad(hash, kLen);

    if (em.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < em.length; i++) {
        diff |= em[i] ^ expected[i];
    }
    return diff === 0;
}

/**
 * Parse an RSA private key from PKCS#8 DER bytes.
 * Expected structure: PrivateKeyInfo → RSAPrivateKey.
 */
export function parseRsaPrivateKey(der: Uint8Array): RsaPrivateKey {
    // Lazy import to avoid circular dependency
    const { derDecode, asn1Integer } = requireAsn1();

    const root = derDecode(der);
    let rsaKey: ReturnType<typeof derDecode>;

    if (root.children.length >= 3 && root.children[1].tag === 0x30) {
        // PKCS#8: SEQUENCE { version, algorithmIdentifier, OCTET_STRING { RSAPrivateKey } }
        const pkcs8Inner = root.children[2];
        rsaKey = derDecode(pkcs8Inner.tag === 0x04 ? pkcs8Inner.value : pkcs8Inner.value);
    } else {
        // PKCS#1: RSAPrivateKey directly
        rsaKey = root;
    }

    return {
        n: asn1Integer(rsaKey.children[1]),
        d: asn1Integer(rsaKey.children[3]),
        p: asn1Integer(rsaKey.children[4]),
        q: asn1Integer(rsaKey.children[5]),
        dp: asn1Integer(rsaKey.children[6]),
        dq: asn1Integer(rsaKey.children[7]),
        qi: asn1Integer(rsaKey.children[8]),
    };
}

/**
 * Parse an RSA public key from SubjectPublicKeyInfo DER bytes.
 */
export function parseRsaPublicKey(der: Uint8Array): RsaPublicKey {
    const { derDecode, asn1Integer } = requireAsn1();

    const root = derDecode(der);

    if (root.children.length >= 2 && root.children[1].tag === 0x03) {
        // SubjectPublicKeyInfo: SEQUENCE { algorithm, BIT_STRING { RSAPublicKey } }
        const bitString = root.children[1].value;
        // Skip unused-bits byte
        const inner = derDecode(bitString.subarray(1));
        return {
            n: asn1Integer(inner.children[0]),
            e: asn1Integer(inner.children[1]),
        };
    }

    // Raw RSAPublicKey: SEQUENCE { n, e }
    return {
        n: asn1Integer(root.children[0]),
        e: asn1Integer(root.children[1]),
    };
}

// Lazy ASN.1 import to avoid circular dependency at module load time
let _asn1: typeof Asn1Module | undefined;
function requireAsn1() {
    if (!_asn1) {
        // This is a synchronous require-like pattern using import
        // In practice, this module is always loaded after asn1.ts
        throw new Error('ASN.1 module must be imported before RSA key parsing. Import asn1.ts first.');
    }
    return _asn1;
}

/** Initialize the ASN.1 dependency for key parsing functions. */
export function initRsaAsn1(asn1Module: typeof Asn1Module): void {
    _asn1 = asn1Module;
}
