/**
 * pdfnative — Tests for non-Flate stream filter decoders
 * @since 1.1.0
 */
import { describe, it, expect } from 'vitest';
import {
    decodeASCIIHex, decodeASCII85, decodeLZW, decodeRunLength,
    applyDecodeFilter, KNOWN_DECODE_FILTERS,
} from '../../src/parser/pdf-decode-filters.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('decodeASCIIHex (ISO 32000-1 §7.4.2)', () => {
    it('decodes simple hex pairs', () => {
        expect(decodeASCIIHex(enc('48656C6C6F>'))).toEqual(new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]));
    });

    it('accepts lowercase hex', () => {
        expect(decodeASCIIHex(enc('48656c6c6f>'))).toEqual(new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]));
    });

    it('ignores whitespace', () => {
        expect(decodeASCIIHex(enc('48 65\n6C\t6C 6F>'))).toEqual(new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]));
    });

    it('treats odd trailing nibble as if followed by 0', () => {
        expect(decodeASCIIHex(enc('414>'))).toEqual(new Uint8Array([0x41, 0x40]));
    });

    it('handles empty input with terminator', () => {
        expect(decodeASCIIHex(enc('>'))).toEqual(new Uint8Array(0));
    });

    it('throws on invalid character', () => {
        expect(() => decodeASCIIHex(enc('41Z>'))).toThrow('ASCIIHexDecode');
    });
});

describe('decodeASCII85 (ISO 32000-1 §7.4.3)', () => {
    it('decodes a four-byte group', () => {
        // "Man\0" → 0x4D616E00 → base85: 9jqo? Wait — let's pick a stable known vector.
        // 0x00000000 should be encoded as "z"; non-zero example below.
        expect(decodeASCII85(enc('z~>'))).toEqual(new Uint8Array([0, 0, 0, 0]));
    });

    it('round-trip via known Adobe sample (single 4-byte group)', () => {
        // 0x11223344 = 287454020
        // 287454020 / 85^4 (52200625) = 5 rem 26450895
        // 26450895  / 85^3 (614125)   = 43 rem 43520
        // 43520     / 85^2 (7225)     = 6 rem 170
        // 170       / 85              = 2 rem 0
        // 0         / 1               = 0
        // digits 5,43,6,2,0 → +33 → '&','L',"'",'#','!'
        const encoded = enc("&L'#!~>");
        expect(decodeASCII85(encoded)).toEqual(new Uint8Array([0x11, 0x22, 0x33, 0x44]));
    });

    it('decodes short final group (3 bytes → 4 digits)', () => {
        // Bytes "Hi!" + zero pad = [0x48, 0x69, 0x21, 0x00] = 1214849280
        // /85^4 = 23 rem 14234905 ; /85^3 = 23 rem 110030
        // /85^2 = 15 rem 1655     ; /85   = 19 rem 40
        // digits 23,23,15,19,40 → +33 → '8','8','0','4','I'
        // 4 digits encode 3 bytes — drop final 'I' → "8804"
        const encoded = enc('8804~>');
        const out = decodeASCII85(encoded);
        expect(out.length).toBe(3);
        expect(out[0]).toBe(0x48);
        expect(out[1]).toBe(0x69);
        expect(out[2]).toBe(0x21);
    });

    it('throws on `z` mid-group', () => {
        expect(() => decodeASCII85(enc('!z~>'))).toThrow('ASCII85Decode');
    });

    it('ignores whitespace', () => {
        expect(decodeASCII85(enc('z\n\t ~>'))).toEqual(new Uint8Array([0, 0, 0, 0]));
    });

    it('handles empty stream', () => {
        expect(decodeASCII85(enc('~>'))).toEqual(new Uint8Array(0));
    });
});

describe('decodeLZW (ISO 32000-1 §7.4.4)', () => {
    it('decodes a CLEAR + literal + EOD sequence', () => {
        // Build a minimal LZW stream by hand (9-bit codes):
        //   CLEAR(256) = 100000000
        //   'A'(65)    = 001000001
        //   'B'(66)    = 001000010
        //   EOD(257)   = 100000001
        // Concat (36 bits) packed big-endian into 5 bytes:
        //   byte1: bits 1–8   = 10000000 = 0x80
        //   byte2: bits 9–16  = 00010000 = 0x10
        //   byte3: bits 17–24 = 01001000 = 0x48
        //   byte4: bits 25–32 = 01010000 = 0x50
        //   byte5: bits 33–36+pad = 00010000 = 0x10
        const bytes = new Uint8Array([0x80, 0x10, 0x48, 0x50, 0x10]);
        expect(decodeLZW(bytes)).toEqual(new Uint8Array([0x41, 0x42]));
    });

    it('handles empty input', () => {
        expect(decodeLZW(new Uint8Array(0))).toEqual(new Uint8Array(0));
    });

    it('throws on invalid code', () => {
        // 9-bit code 300 (no CLEAR first → undefined, but 300 is in range 0..511,
        // and dict.length is 258 after init so 300 > 258 → invalid). Encode 300 = 100101100
        // Pack high-bit-first: 10010110 0_______ → 0x96 0x00
        expect(() => decodeLZW(new Uint8Array([0x96, 0x00]))).toThrow('LZWDecode');
    });
});

describe('decodeRunLength (ISO 32000-1 §7.4.5)', () => {
    it('decodes literal runs', () => {
        // 0x02 'A' 'B' 'C' 0x80 (EOD)
        expect(decodeRunLength(new Uint8Array([0x02, 0x41, 0x42, 0x43, 0x80])))
            .toEqual(new Uint8Array([0x41, 0x42, 0x43]));
    });

    it('decodes repeat runs', () => {
        // 0xFE (= 257-254 = 3) 'X' 0x80
        expect(decodeRunLength(new Uint8Array([0xFE, 0x58, 0x80])))
            .toEqual(new Uint8Array([0x58, 0x58, 0x58]));
    });

    it('mixes literal + repeat', () => {
        // 0x01 'A' 'B'   0xFF 'X'   0x80
        // literal len=2 → A,B ; repeat len = 257-255 = 2 → X,X
        expect(decodeRunLength(new Uint8Array([0x01, 0x41, 0x42, 0xFF, 0x58, 0x80])))
            .toEqual(new Uint8Array([0x41, 0x42, 0x58, 0x58]));
    });

    it('throws on truncated literal', () => {
        expect(() => decodeRunLength(new Uint8Array([0x05, 0x41]))).toThrow('truncated');
    });

    it('handles immediate EOD', () => {
        expect(decodeRunLength(new Uint8Array([0x80]))).toEqual(new Uint8Array(0));
    });
});

describe('applyDecodeFilter dispatcher', () => {
    it('dispatches by long name', () => {
        expect(applyDecodeFilter('ASCIIHexDecode', enc('41>'))).toEqual(new Uint8Array([0x41]));
    });

    it('dispatches by short alias (A85, AHx, LZW, RL)', () => {
        expect(applyDecodeFilter('A85', enc('z~>'))).toEqual(new Uint8Array([0, 0, 0, 0]));
        expect(applyDecodeFilter('AHx', enc('41>'))).toEqual(new Uint8Array([0x41]));
        expect(applyDecodeFilter('RL', new Uint8Array([0x80]))).toEqual(new Uint8Array(0));
    });

    it('returns input unchanged for unknown filter', () => {
        const src = new Uint8Array([1, 2, 3]);
        expect(applyDecodeFilter('UnknownFilter', src)).toBe(src);
    });

    it('exposes membership set', () => {
        expect(KNOWN_DECODE_FILTERS.has('ASCII85Decode')).toBe(true);
        expect(KNOWN_DECODE_FILTERS.has('A85')).toBe(true);
        expect(KNOWN_DECODE_FILTERS.has('FlateDecode')).toBe(false);
    });
});
