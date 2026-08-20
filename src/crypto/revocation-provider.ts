/**
 * pdfnative — Pluggable OCSP/CRL Revocation Provider
 * ===================================================
 * pdfnative builds OCSP requests and parses OCSP/CRL responses itself
 * (ocsp.ts / crl.ts) but **never touches the network**: the HTTP
 * round-trips to OCSP responders and CRL distribution points are injected
 * from user land through this interface, keeping the library
 * zero-dependency and runtime-agnostic (Node, Deno, Bun, browsers,
 * workers). URLs are extracted from certificate AIA / CRL DP extensions by
 * the LTV collector and handed to the provider verbatim.
 *
 * @example `fetch()`-based provider (user land)
 * ```ts
 * import { setRevocationProvider } from 'pdfnative';
 *
 * setRevocationProvider({
 *   async fetchOcsp(url, request) {
 *     const res = await fetch(url, {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/ocsp-request' },
 *       body: request,
 *     });
 *     return new Uint8Array(await res.arrayBuffer());
 *   },
 *   async fetchCrl(url) {
 *     const res = await fetch(url);
 *     return new Uint8Array(await res.arrayBuffer());
 *   },
 * });
 * ```
 *
 * @since 1.7.0
 */

/**
 * A pluggable revocation-data transport. Both members are optional: a
 * provider may support only OCSP or only CRL — the LTV collector uses
 * whichever is available and skips the other source.
 */
export interface RevocationProvider {
    /**
     * POST `request` (OCSPRequest DER) to `url` and resolve with the
     * OCSPResponse DER.
     */
    readonly fetchOcsp?: (url: string, request: Uint8Array) => Promise<Uint8Array>;
    /** GET `url` and resolve with the CertificateList (CRL) DER. */
    readonly fetchCrl?: (url: string) => Promise<Uint8Array>;
}

/** Module-level global provider; `null` ⇒ revocation data is unavailable. */
let _revocationProvider: RevocationProvider | null = null;

/**
 * Install (or clear) a global {@link RevocationProvider}. When set, every
 * LTV collection call that does not pass an explicit per-call provider
 * routes its OCSP/CRL round-trips through `provider`. Pass `null` to
 * remove it.
 *
 * A per-call provider option always takes precedence over the global one
 * set here.
 *
 * @param provider The revocation transport, or `null` to remove it.
 * @since 1.7.0
 */
export function setRevocationProvider(provider: RevocationProvider | null): void {
    _revocationProvider = provider;
}

/**
 * The currently-installed global {@link RevocationProvider}, or `null` if
 * none. Primarily for internal dispatch and testing.
 *
 * @since 1.7.0
 */
export function getRevocationProvider(): RevocationProvider | null {
    return _revocationProvider;
}
