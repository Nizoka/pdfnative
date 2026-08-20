/**
 * pdfnative — Pluggable RFC 3161 Timestamp Provider
 * ==================================================
 * pdfnative builds and parses RFC 3161 structures itself (rfc3161.ts) but
 * **never touches the network**: the single HTTP round-trip to a Time
 * Stamping Authority is injected from user land through this interface,
 * keeping the library zero-dependency and runtime-agnostic (Node, Deno,
 * Bun, browsers, workers).
 *
 * The provider receives a DER-encoded `TimeStampReq` and must resolve with
 * the TSA's DER-encoded `TimeStampResp` — typically a `fetch()` POST with
 * `Content-Type: application/timestamp-query`.
 *
 * @example `fetch()`-based provider (user land)
 * ```ts
 * import { setTimestampProvider } from 'pdfnative';
 *
 * setTimestampProvider({
 *   async getTimestamp(request) {
 *     const res = await fetch('https://tsa.example.com/tsr', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/timestamp-query' },
 *       body: request,
 *     });
 *     return new Uint8Array(await res.arrayBuffer());
 *   },
 * });
 * ```
 *
 * @since 1.7.0
 */

/**
 * A pluggable RFC 3161 transport: sends a DER `TimeStampReq` to a TSA and
 * resolves with the DER `TimeStampResp`. Transport-level failures should
 * reject; protocol-level rejections (PKIStatus ≠ granted) are surfaced by
 * `parseTimestampResponse()` on the resolved bytes.
 */
export interface TimestampProvider {
    /** Send `request` (TimeStampReq DER) and resolve with the TimeStampResp DER. */
    readonly getTimestamp: (request: Uint8Array) => Promise<Uint8Array>;
}

/** Module-level global provider; `null` ⇒ timestamping is unavailable. */
let _timestampProvider: TimestampProvider | null = null;

/**
 * Install (or clear) a global {@link TimestampProvider}. When set, every
 * timestamping call that does not pass an explicit per-call provider routes
 * its TSA round-trip through `provider`. Pass `null` to remove it.
 *
 * A per-call provider option always takes precedence over the global one
 * set here.
 *
 * @param provider The TSA transport, or `null` to remove it.
 * @since 1.7.0
 */
export function setTimestampProvider(provider: TimestampProvider | null): void {
    _timestampProvider = provider;
}

/**
 * The currently-installed global {@link TimestampProvider}, or `null` if
 * none. Primarily for internal dispatch and testing.
 *
 * @since 1.7.0
 */
export function getTimestampProvider(): TimestampProvider | null {
    return _timestampProvider;
}
