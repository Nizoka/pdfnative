/**
 * pdfnative — Pluggable Signature Crypto Provider
 * ================================================
 * pdfnative ships its own pure-TypeScript RSA (PKCS#1 v1.5) and ECDSA (P-256)
 * implementations so that signing works in any runtime with **zero
 * dependencies**. Those pure-JS primitives are built on JavaScript `BigInt`
 * arithmetic, which V8/SpiderMonkey do **not** execute in constant time — see
 * the timing-side-channel caveat in `SECURITY.md`.
 *
 * For high-security, high-frequency server pipelines (a backend signing many
 * PDFs/s with one key under adversarial timing observation), this module lets
 * you inject a hardware-backed, **constant-time** signer — Node.js
 * `node:crypto` or a Web Crypto wrapper — without giving up the zero-dependency
 * default. The pure-JS path remains the fallback when no provider is set.
 *
 * The provider produces the raw CMS signature value over the **DER-encoded
 * signed attributes** (`tbs`, "to be signed"), matching the requested
 * algorithm:
 *  - `'rsa-sha256'`  → RSASSA-PKCS1-v1_5 signature over `SHA-256(tbs)`.
 *  - `'ecdsa-sha256'`→ a **DER-encoded** ECDSA (P-256) signature over
 *    `SHA-256(tbs)` (i.e. `SEQUENCE { r INTEGER, s INTEGER }`).
 *
 * @example Node.js `node:crypto` (constant-time, hardware-backed)
 * ```ts
 * import { setCryptoProvider } from 'pdfnative';
 * import { createSign, createPrivateKey } from 'node:crypto';
 *
 * const key = createPrivateKey(pemPrivateKey);
 * setCryptoProvider({
 *   sign(tbs, algorithm) {
 *     // node:crypto hashes `tbs` internally and returns a DER ECDSA sig.
 *     return new Uint8Array(createSign('sha256').update(tbs).sign(key));
 *   },
 * });
 * ```
 *
 * @since 1.4.0
 */

import type { SignatureAlgorithm } from './cms.js';

/**
 * A pluggable signer that replaces pdfnative's pure-JS RSA/ECDSA math with a
 * native, constant-time implementation.
 */
export interface CryptoProvider {
    /**
     * Sign the DER-encoded CMS SignedAttributes (`tbs`) and return the raw
     * signature value to embed in the CMS `SignerInfo`.
     *
     * The implementation MUST hash `tbs` with SHA-256 internally (native
     * `crypto.sign('sha256', …)` does this for you) and produce a signature
     * matching `algorithm`:
     *  - `'rsa-sha256'`   → RSASSA-PKCS1-v1_5 over `SHA-256(tbs)`.
     *  - `'ecdsa-sha256'` → DER-encoded ECDSA-P256 over `SHA-256(tbs)`.
     */
    readonly sign: (tbs: Uint8Array, algorithm: SignatureAlgorithm) => Uint8Array;
}

/** Module-level global provider; `null` ⇒ use the built-in pure-JS signer. */
let _cryptoProvider: CryptoProvider | null = null;

/**
 * Install (or clear) a global signature {@link CryptoProvider}. When set, every
 * `signPdfBytes()` call that does not pass an explicit per-call provider routes
 * its signature math through `provider` instead of pdfnative's pure-JS RSA/ECDSA
 * primitives. Pass `null` to restore the zero-dependency default.
 *
 * A per-call `PdfSignOptions.provider` always takes precedence over the global
 * one set here.
 *
 * @param provider The native signer, or `null` to revert to pure-JS.
 * @since 1.4.0
 */
export function setCryptoProvider(provider: CryptoProvider | null): void {
    _cryptoProvider = provider;
}

/**
 * The currently-installed global {@link CryptoProvider}, or `null` if none.
 * Primarily for internal dispatch and testing.
 *
 * @since 1.4.0
 */
export function getCryptoProvider(): CryptoProvider | null {
    return _cryptoProvider;
}
