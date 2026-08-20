/**
 * Tests for the LTV provider registries (1.7.0) —
 * setTimestampProvider/getTimestampProvider and
 * setRevocationProvider/getRevocationProvider — mirroring the
 * crypto-provider registry contract: default null, install, clear, and
 * per-call precedence over the global instance.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    setTimestampProvider, getTimestampProvider,
    type TimestampProvider,
} from '../../src/crypto/timestamp-provider.js';
import {
    setRevocationProvider, getRevocationProvider,
    type RevocationProvider,
} from '../../src/crypto/revocation-provider.js';

afterEach(() => {
    setTimestampProvider(null);
    setRevocationProvider(null);
});

// ── Timestamp provider registry ──────────────────────────────────────

describe('setTimestampProvider / getTimestampProvider', () => {
    it('defaults to no provider', () => {
        expect(getTimestampProvider()).toBeNull();
    });

    it('installs and clears a global provider', () => {
        const provider: TimestampProvider = {
            getTimestamp: (request) => Promise.resolve(request),
        };
        setTimestampProvider(provider);
        expect(getTimestampProvider()).toBe(provider);
        setTimestampProvider(null);
        expect(getTimestampProvider()).toBeNull();
    });

    it('replacing the provider swaps the instance', () => {
        const a: TimestampProvider = { getTimestamp: () => Promise.resolve(new Uint8Array([1])) };
        const b: TimestampProvider = { getTimestamp: () => Promise.resolve(new Uint8Array([2])) };
        setTimestampProvider(a);
        setTimestampProvider(b);
        expect(getTimestampProvider()).toBe(b);
    });

    it('per-call precedence pattern: an explicit provider wins over the global', async () => {
        const globalCalls: Uint8Array[] = [];
        const callCalls: Uint8Array[] = [];
        setTimestampProvider({
            getTimestamp: (req) => { globalCalls.push(req); return Promise.resolve(new Uint8Array()); },
        });
        const perCall: TimestampProvider = {
            getTimestamp: (req) => { callCalls.push(req); return Promise.resolve(new Uint8Array()); },
        };

        // The dispatch shape used by the core layer: per-call ?? global.
        const withPerCall: TimestampProvider | undefined = perCall;
        const effective = withPerCall ?? getTimestampProvider();
        await effective!.getTimestamp(new Uint8Array([0x30]));
        expect(callCalls).toHaveLength(1);
        expect(globalCalls).toHaveLength(0);

        const withoutPerCall: TimestampProvider | undefined = undefined;
        const fallback = withoutPerCall ?? getTimestampProvider();
        await fallback!.getTimestamp(new Uint8Array([0x30]));
        expect(globalCalls).toHaveLength(1);
    });
});

// ── Revocation provider registry ─────────────────────────────────────

describe('setRevocationProvider / getRevocationProvider', () => {
    it('defaults to no provider', () => {
        expect(getRevocationProvider()).toBeNull();
    });

    it('installs and clears a global provider', () => {
        const provider: RevocationProvider = {
            fetchOcsp: (_url, request) => Promise.resolve(request),
            fetchCrl: () => Promise.resolve(new Uint8Array()),
        };
        setRevocationProvider(provider);
        expect(getRevocationProvider()).toBe(provider);
        setRevocationProvider(null);
        expect(getRevocationProvider()).toBeNull();
    });

    it('accepts partial providers (OCSP-only / CRL-only)', () => {
        const ocspOnly: RevocationProvider = { fetchOcsp: () => Promise.resolve(new Uint8Array()) };
        setRevocationProvider(ocspOnly);
        expect(getRevocationProvider()?.fetchOcsp).toBeDefined();
        expect(getRevocationProvider()?.fetchCrl).toBeUndefined();

        const crlOnly: RevocationProvider = { fetchCrl: () => Promise.resolve(new Uint8Array()) };
        setRevocationProvider(crlOnly);
        expect(getRevocationProvider()?.fetchCrl).toBeDefined();
        expect(getRevocationProvider()?.fetchOcsp).toBeUndefined();
    });

    it('per-call precedence pattern: an explicit provider wins over the global', async () => {
        let globalHits = 0;
        let callHits = 0;
        setRevocationProvider({ fetchCrl: () => { globalHits++; return Promise.resolve(new Uint8Array()); } });
        const perCall: RevocationProvider = { fetchCrl: () => { callHits++; return Promise.resolve(new Uint8Array()); } };

        const withPerCall: RevocationProvider | undefined = perCall;
        const effective = withPerCall ?? getRevocationProvider();
        await effective!.fetchCrl!('http://mock.invalid/crl.der');
        expect(callHits).toBe(1);
        expect(globalHits).toBe(0);

        const withoutPerCall: RevocationProvider | undefined = undefined;
        const fallback = withoutPerCall ?? getRevocationProvider();
        await fallback!.fetchCrl!('http://mock.invalid/crl.der');
        expect(globalHits).toBe(1);
    });
});
