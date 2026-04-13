/**
 * pdfnative — ECDSA P-256 Sign / Verify
 * ======================================
 * Pure BigInt implementation of ECDSA on the NIST P-256 curve (secp256r1).
 * RFC 6979 deterministic k for reproducible signatures without CSPRNG.
 * Zero external dependencies.
 */

import { sha256, hmacSha256 } from './sha.js';
import { bigIntToBytes, bytesToBigInt } from './rsa.js';

// ── P-256 Curve Parameters (FIPS 186-4, SEC 2 §2.7.2) ───────────────

const P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
const A = BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc');
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const GX = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
const GY = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

/** Generator point G. */
const G: EcPoint = { x: GX, y: GY };

// ── Types ────────────────────────────────────────────────────────────

/** Affine EC point. null = point at infinity. */
export type EcPoint = { readonly x: bigint; readonly y: bigint } | null;

/** ECDSA P-256 public key. */
export interface EcPublicKey {
    readonly x: bigint;
    readonly y: bigint;
}

/** ECDSA P-256 private key. */
export interface EcPrivateKey {
    readonly d: bigint;
}

// ── Modular Arithmetic ───────────────────────────────────────────────

function mod(a: bigint, m: bigint): bigint {
    return ((a % m) + m) % m;
}

function modInverse(a: bigint, m: bigint): bigint {
    let [old_r, r] = [mod(a, m), m];
    let [old_s, s] = [1n, 0n];

    while (r !== 0n) {
        const q = old_r / r;
        [old_r, r] = [r, old_r - q * r];
        [old_s, s] = [s, old_s - q * s];
    }

    if (old_r !== 1n) throw new Error('Modular inverse does not exist');
    return ((old_s % m) + m) % m;
}

// ── EC Point Operations ──────────────────────────────────────────────

function pointAdd(p1: EcPoint, p2: EcPoint): EcPoint {
    if (p1 === null) return p2;
    if (p2 === null) return p1;

    if (p1.x === p2.x) {
        if (p1.y === p2.y) return pointDouble(p1);
        return null; // p1 + (-p1) = O
    }

    const lam = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
    const x3 = mod(lam * lam - p1.x - p2.x, P);
    const y3 = mod(lam * (p1.x - x3) - p1.y, P);
    return { x: x3, y: y3 };
}

function pointDouble(p: EcPoint): EcPoint {
    if (p === null) return null;
    if (p.y === 0n) return null;

    const lam = mod((3n * p.x * p.x + A) * modInverse(2n * p.y, P), P);
    const x3 = mod(lam * lam - 2n * p.x, P);
    const y3 = mod(lam * (p.x - x3) - p.y, P);
    return { x: x3, y: y3 };
}

/** Scalar multiplication: k * P using double-and-add. */
function scalarMul(k: bigint, point: EcPoint): EcPoint {
    let result: EcPoint = null;
    let current = point;
    let scalar = mod(k, N);

    while (scalar > 0n) {
        if (scalar & 1n) {
            result = pointAdd(result, current);
        }
        current = pointDouble(current);
        scalar >>= 1n;
    }
    return result;
}

// ── RFC 6979 Deterministic k ─────────────────────────────────────────

function rfc6979k(privateKeyBytes: Uint8Array, hashBytes: Uint8Array): bigint {
    const qLen = 32; // P-256 order is 256 bits

    // Step a: h1 = hash (already provided)
    // Step b: V = 0x01 × 32
    let V: Uint8Array = new Uint8Array(qLen);
    V.fill(0x01);

    // Step c: K = 0x00 × 32
    let K: Uint8Array = new Uint8Array(qLen);

    // Step d: K = HMAC(K, V || 0x00 || int2octets(x) || bits2octets(h1))
    const concat_d = new Uint8Array(qLen + 1 + qLen + qLen);
    concat_d.set(V, 0);
    concat_d[qLen] = 0x00;
    concat_d.set(privateKeyBytes, qLen + 1);
    concat_d.set(hashBytes, qLen + 1 + qLen);
    K = hmacSha256(K, concat_d);

    // Step e: V = HMAC(K, V)
    V = hmacSha256(K, V);

    // Step f: K = HMAC(K, V || 0x01 || int2octets(x) || bits2octets(h1))
    const concat_f = new Uint8Array(qLen + 1 + qLen + qLen);
    concat_f.set(V, 0);
    concat_f[qLen] = 0x01;
    concat_f.set(privateKeyBytes, qLen + 1);
    concat_f.set(hashBytes, qLen + 1 + qLen);
    K = hmacSha256(K, concat_f);

    // Step g: V = HMAC(K, V)
    V = hmacSha256(K, V);

    // Step h: generate k
    for (;;) {
        V = hmacSha256(K, V);
        const k = bytesToBigInt(V);
        if (k >= 1n && k < N) return k;

        // Retry
        const retryConcat = new Uint8Array(qLen + 1);
        retryConcat.set(V, 0);
        retryConcat[qLen] = 0x00;
        K = hmacSha256(K, retryConcat);
        V = hmacSha256(K, V);
    }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Derive the public key from a private key.
 */
export function ecPublicKeyFromPrivate(privateKey: EcPrivateKey): EcPublicKey {
    const point = scalarMul(privateKey.d, G);
    if (point === null) throw new Error('Invalid private key');
    return { x: point.x, y: point.y };
}

/**
 * Sign a message with ECDSA P-256 + SHA-256, using RFC 6979 deterministic k.
 *
 * @param message - Raw message bytes.
 * @param privateKey - EC private key.
 * @returns Signature { r, s } as BigInts.
 */
export function ecdsaSign(message: Uint8Array, privateKey: EcPrivateKey): { r: bigint; s: bigint } {
    const hash = sha256(message);
    return ecdsaSignHash(hash, privateKey);
}

/**
 * Sign a pre-computed SHA-256 hash with ECDSA P-256.
 *
 * @param hash - SHA-256 hash (32 bytes).
 * @param privateKey - EC private key.
 * @returns Signature { r, s } as BigInts.
 */
export function ecdsaSignHash(hash: Uint8Array, privateKey: EcPrivateKey): { r: bigint; s: bigint } {
    if (hash.length !== 32) throw new Error('Expected 32-byte SHA-256 hash');

    const z = bytesToBigInt(hash);
    const privBytes = bigIntToBytes(privateKey.d, 32);
    const k = rfc6979k(privBytes, hash);

    const R = scalarMul(k, G);
    if (R === null) throw new Error('ECDSA: k*G = O');

    const r = mod(R.x, N);
    if (r === 0n) throw new Error('ECDSA: r = 0');

    const kInv = modInverse(k, N);
    let s = mod(kInv * (z + r * privateKey.d), N);
    if (s === 0n) throw new Error('ECDSA: s = 0');

    // Normalize s to low-S form (BIP-62 / RFC 6979 §3.2 note)
    if (s > N / 2n) s = N - s;

    return { r, s };
}

/**
 * Verify an ECDSA P-256 + SHA-256 signature.
 *
 * @param message - Raw message bytes.
 * @param r - Signature r component.
 * @param s - Signature s component.
 * @param publicKey - EC public key.
 * @returns true if signature is valid.
 */
export function ecdsaVerify(message: Uint8Array, r: bigint, s: bigint, publicKey: EcPublicKey): boolean {
    const hash = sha256(message);
    return ecdsaVerifyHash(hash, r, s, publicKey);
}

/**
 * Verify an ECDSA P-256 signature against a pre-computed hash.
 */
export function ecdsaVerifyHash(hash: Uint8Array, r: bigint, s: bigint, publicKey: EcPublicKey): boolean {
    if (hash.length !== 32) return false;
    if (r <= 0n || r >= N) return false;
    if (s <= 0n || s >= N) return false;

    const z = bytesToBigInt(hash);
    const sInv = modInverse(s, N);
    const u1 = mod(z * sInv, N);
    const u2 = mod(r * sInv, N);

    const P1 = scalarMul(u1, G);
    const P2 = scalarMul(u2, { x: publicKey.x, y: publicKey.y });
    const R = pointAdd(P1, P2);

    if (R === null) return false;
    return mod(R.x, N) === r;
}

/**
 * Encode an ECDSA public key as uncompressed point (65 bytes: 0x04 || x || y).
 */
export function encodeEcPublicKey(key: EcPublicKey): Uint8Array {
    const result = new Uint8Array(65);
    result[0] = 0x04;
    const xBytes = bigIntToBytes(key.x, 32);
    const yBytes = bigIntToBytes(key.y, 32);
    result.set(xBytes, 1);
    result.set(yBytes, 33);
    return result;
}

/**
 * Decode an uncompressed EC public key (65 bytes: 0x04 || x || y).
 */
export function decodeEcPublicKey(bytes: Uint8Array): EcPublicKey {
    if (bytes.length !== 65 || bytes[0] !== 0x04) {
        throw new Error('Expected 65-byte uncompressed EC public key (0x04 prefix)');
    }
    return {
        x: bytesToBigInt(bytes.subarray(1, 33)),
        y: bytesToBigInt(bytes.subarray(33, 65)),
    };
}

/**
 * Encode an ECDSA signature { r, s } as DER (for CMS).
 */
export function encodeDerSignature(r: bigint, s: bigint): Uint8Array {
    // Lazy import ASN.1
    const { derSequence, derInteger } = requireAsn1();
    return derSequence(derInteger(r), derInteger(s));
}

/**
 * Decode a DER-encoded ECDSA signature to { r, s }.
 */
export function decodeDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
    const { derDecode, asn1Integer } = requireAsn1();
    const seq = derDecode(der);
    return {
        r: asn1Integer(seq.children[0]),
        s: asn1Integer(seq.children[1]),
    };
}

// Lazy ASN.1 import
let _asn1: typeof import('./asn1.js') | undefined;
function requireAsn1() {
    if (!_asn1) throw new Error('ASN.1 module must be initialized. Call initEcdsaAsn1() first.');
    return _asn1;
}

/** Initialize the ASN.1 dependency for DER signature encoding. */
export function initEcdsaAsn1(asn1Module: typeof import('./asn1.js')): void {
    _asn1 = asn1Module;
}
