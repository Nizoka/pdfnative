/**
 * Tests for the 1.7.0 ASN.1 LTV primitives — derSetOf (X.690 §11.6
 * canonical ordering), derGeneralizedTime, derBoolean, derIA5String and
 * the shared asn1Time decoder.
 */

import { describe, it, expect } from 'vitest';
import {
    derSetOf, derSet, derGeneralizedTime, derBoolean, derIA5String,
    derUtcTime, derInteger, derOctetString, derDecode, asn1Time, asn1String,
    ASN1_SET, ASN1_BOOLEAN, ASN1_IA5_STRING, ASN1_GENERALIZED_TIME,
} from '../../src/crypto/asn1.js';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('derSetOf — X.690 §11.6 canonical ordering', () => {
    it('sorts elements into ascending lexicographic byte order', () => {
        const a = new Uint8Array([0x04, 0x01, 0xff]);   // OCTET STRING ff
        const b = new Uint8Array([0x02, 0x01, 0x05]);   // INTEGER 5
        const set = derSetOf(a, b);
        expect(set[0]).toBe(ASN1_SET);
        // INTEGER (0x02...) sorts before OCTET STRING (0x04...)
        expect(toHex(set)).toBe('310602010504' + '01ff');
    });

    it('orders by length byte when tags are equal (shorter TLV first)', () => {
        const long = derOctetString(new Uint8Array(40));   // 04 28 ...
        const short = derOctetString(new Uint8Array(4));   // 04 04 ...
        const set = derSetOf(long, short);
        // Second byte 0x04 < 0x28 → short element first.
        expect(set[2]).toBe(0x04);
        expect(set[3]).toBe(0x04);
    });

    it('places a shorter element that is a prefix of a longer one first', () => {
        const shorter = new Uint8Array([0x05, 0x00]);
        const longer = new Uint8Array([0x05, 0x00, 0x00]); // not valid DER, but exercises the comparator
        const set = derSetOf(longer, shorter);
        expect(Array.from(set)).toEqual([0x31, 0x05, 0x05, 0x00, 0x05, 0x00, 0x00]);
    });

    it('keeps an already-sorted input byte-identical to derSet', () => {
        const a = derInteger(1n);
        const b = derOctetString(new Uint8Array([1, 2, 3]));
        expect(toHex(derSetOf(a, b))).toBe(toHex(derSet(a, b)));
    });

    it('is byte-identical to derSet for a single element', () => {
        const only = derInteger(42n);
        expect(toHex(derSetOf(only))).toBe(toHex(derSet(only)));
    });

    it('sorts three CMS-style attributes by their length bytes', () => {
        // Mimics the real signed-attribute fix: content-type (len 0x18),
        // signing-time (len 0x1c), message-digest (len 0x2f) — declaration
        // order used to be content-type, message-digest, signing-time.
        // (OCTET STRING stand-ins so the decoder does not recurse.)
        const contentType = derOctetString(new Uint8Array(0x18));
        const messageDigest = derOctetString(new Uint8Array(0x2f));
        const signingTime = derOctetString(new Uint8Array(0x1c));
        const set = derSetOf(contentType, messageDigest, signingTime);
        const decoded = derDecode(set);
        expect(decoded.children.map((c) => c.totalLength)).toEqual([0x1a, 0x1e, 0x31]);
    });
});

describe('derGeneralizedTime', () => {
    it('encodes YYYYMMDDHHMMSSZ in UTC', () => {
        const der = derGeneralizedTime(new Date(Date.UTC(2026, 1, 1, 12, 30, 45)));
        expect(der[0]).toBe(ASN1_GENERALIZED_TIME);
        expect(asn1String(derDecode(der))).toBe('20260201123045Z');
    });

    it('encodes a pre-2000 date', () => {
        const der = derGeneralizedTime(new Date(Date.UTC(1999, 11, 31, 23, 59, 59)));
        expect(asn1String(derDecode(der))).toBe('19991231235959Z');
    });

    it('drops fractional seconds (DER-restricted form)', () => {
        const der = derGeneralizedTime(new Date('2030-06-15T08:09:10.123Z'));
        expect(asn1String(derDecode(der))).toBe('20300615080910Z');
    });
});

describe('derBoolean', () => {
    it('encodes TRUE as 0xFF (X.690 §11.1)', () => {
        expect(Array.from(derBoolean(true))).toEqual([ASN1_BOOLEAN, 0x01, 0xff]);
    });

    it('encodes FALSE as 0x00', () => {
        expect(Array.from(derBoolean(false))).toEqual([ASN1_BOOLEAN, 0x01, 0x00]);
    });
});

describe('derIA5String', () => {
    it('encodes an ASCII URL', () => {
        const der = derIA5String('http://mock.invalid/ocsp');
        expect(der[0]).toBe(ASN1_IA5_STRING);
        expect(asn1String(derDecode(der))).toBe('http://mock.invalid/ocsp');
    });
});

describe('asn1Time', () => {
    it('round-trips a UTCTime (2000-2049 pivot)', () => {
        const date = new Date(Date.UTC(2026, 7, 20, 10, 0, 0));
        expect(asn1Time(derDecode(derUtcTime(date))).getTime()).toBe(date.getTime());
    });

    it('applies the 50-cutoff for two-digit years (99 → 1999)', () => {
        const date = new Date(Date.UTC(1999, 0, 2, 3, 4, 5));
        expect(asn1Time(derDecode(derUtcTime(date))).getTime()).toBe(date.getTime());
    });

    it('round-trips a GeneralizedTime beyond 2049', () => {
        const date = new Date(Date.UTC(2055, 4, 6, 7, 8, 9));
        expect(asn1Time(derDecode(derGeneralizedTime(date))).getTime()).toBe(date.getTime());
    });

    it('throws on a non-time tag', () => {
        expect(() => asn1Time(derDecode(derInteger(1n)))).toThrow('Unexpected time tag');
    });
});
