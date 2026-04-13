/**
 * pdfnative — SHA-384, SHA-512, HMAC-SHA256
 * ==========================================
 * SHA-2 64-bit variants using paired 32-bit words (FIPS 180-4 §6.4).
 * HMAC-SHA256 per RFC 2104 wrapping the existing sha256() from pdf-encrypt.
 *
 * SHA-384/512 use 64-bit words. JavaScript lacks native uint64, so we
 * represent each 64-bit word as [hi: number, lo: number] (both uint32).
 */

import { sha256 } from '../core/pdf-encrypt.js';

export { sha256 };

// ── SHA-512 round constants (first 80 primes, cube roots, fractional parts) ──

const K512_HI = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    0xca273ece, 0xd186b8c7, 0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
    0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c, 0x5fcb6fab, 0x6c44198c,
]);

const K512_LO = new Uint32Array([
    0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019, 0xaf194f9b, 0xda6d8118,
    0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2, 0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694,
    0x9ef14ad2, 0x384f25e3, 0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
    0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725, 0xe003826f, 0x0a0e6e70,
    0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df, 0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b,
    0x4cf10364, 0xbc423001, 0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
    0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb, 0x7763e373, 0xd6b2b8a3,
    0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec, 0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b,
    0xea26619c, 0x21c0c207, 0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
    0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a, 0x3ad6faec, 0x4a475817,
]);

// ── 64-bit arithmetic helpers (paired uint32) ────────────────────────

function add64(ah: number, al: number, bh: number, bl: number): [number, number] {
    const lo = (al + bl) >>> 0;
    const hi = (ah + bh + (lo < al ? 1 : 0)) >>> 0;
    return [hi, lo];
}

function rotr64(h: number, l: number, n: number): [number, number] {
    if (n < 32) {
        return [(h >>> n | l << (32 - n)) >>> 0, (l >>> n | h << (32 - n)) >>> 0];
    }
    const m = n - 32;
    return [(l >>> m | h << (32 - m)) >>> 0, (h >>> m | l << (32 - m)) >>> 0];
}

function shr64(h: number, l: number, n: number): [number, number] {
    if (n < 32) {
        return [(h >>> n) >>> 0, (l >>> n | h << (32 - n)) >>> 0];
    }
    return [0, (h >>> (n - 32)) >>> 0];
}

// ── SHA-512 core ─────────────────────────────────────────────────────

function sha512Core(input: Uint8Array, iv: number[], outputLen: number): Uint8Array {
    const len = input.length;
    const totalBits = len * 8;
    // Padding: 1 + padLen + 16 bytes (128-bit length)
    const padLen = ((111 - (len % 128)) + 128) % 128;
    const padded = new Uint8Array(len + 1 + padLen + 16);
    padded.set(input);
    padded[len] = 0x80;
    // Length as 128-bit big-endian (we only support up to 2^53 bits)
    const dv = new DataView(padded.buffer);
    // High 64 bits = 0 for practical input sizes
    dv.setUint32(padded.length - 4, totalBits >>> 0, false);
    // For inputs > 512 MB, handle high bits
    if (totalBits > 0xFFFFFFFF) {
        dv.setUint32(padded.length - 8, Math.floor(totalBits / 0x100000000) >>> 0, false);
    }

    // Working state: 8 × 64-bit words as [hi, lo] pairs
    let h0h = iv[0] >>> 0, h0l = iv[1] >>> 0;
    let h1h = iv[2] >>> 0, h1l = iv[3] >>> 0;
    let h2h = iv[4] >>> 0, h2l = iv[5] >>> 0;
    let h3h = iv[6] >>> 0, h3l = iv[7] >>> 0;
    let h4h = iv[8] >>> 0, h4l = iv[9] >>> 0;
    let h5h = iv[10] >>> 0, h5l = iv[11] >>> 0;
    let h6h = iv[12] >>> 0, h6l = iv[13] >>> 0;
    let h7h = iv[14] >>> 0, h7l = iv[15] >>> 0;

    // Message schedule: 80 × [hi, lo]
    const Wh = new Uint32Array(80);
    const Wl = new Uint32Array(80);

    for (let off = 0; off < padded.length; off += 128) {
        // Load 16 message words
        for (let j = 0; j < 16; j++) {
            Wh[j] = dv.getUint32(off + j * 8, false);
            Wl[j] = dv.getUint32(off + j * 8 + 4, false);
        }

        // Expand to 80 words
        for (let j = 16; j < 80; j++) {
            // σ0(W[j-15]) = ROTR(1) ^ ROTR(8) ^ SHR(7)
            const [r1h, r1l] = rotr64(Wh[j - 15], Wl[j - 15], 1);
            const [r8h, r8l] = rotr64(Wh[j - 15], Wl[j - 15], 8);
            const [s7h, s7l] = shr64(Wh[j - 15], Wl[j - 15], 7);
            const s0h = (r1h ^ r8h ^ s7h) >>> 0;
            const s0l = (r1l ^ r8l ^ s7l) >>> 0;

            // σ1(W[j-2]) = ROTR(19) ^ ROTR(61) ^ SHR(6)
            const [r19h, r19l] = rotr64(Wh[j - 2], Wl[j - 2], 19);
            const [r61h, r61l] = rotr64(Wh[j - 2], Wl[j - 2], 61);
            const [s6h, s6l] = shr64(Wh[j - 2], Wl[j - 2], 6);
            const s1h = (r19h ^ r61h ^ s6h) >>> 0;
            const s1l = (r19l ^ r61l ^ s6l) >>> 0;

            // W[j] = W[j-16] + σ0 + W[j-7] + σ1
            let [th, tl] = add64(Wh[j - 16], Wl[j - 16], s0h, s0l);
            [th, tl] = add64(th, tl, Wh[j - 7], Wl[j - 7]);
            [Wh[j], Wl[j]] = add64(th, tl, s1h, s1l);
        }

        let ah = h0h, al = h0l;
        let bh = h1h, bl = h1l;
        let ch = h2h, cl = h2l;
        let dh = h3h, dl = h3l;
        let eh = h4h, el = h4l;
        let fh = h5h, fl = h5l;
        let gh = h6h, gl = h6l;
        let hh = h7h, hl = h7l;

        for (let j = 0; j < 80; j++) {
            // Σ1(e) = ROTR(14) ^ ROTR(18) ^ ROTR(41)
            const [e14h, e14l] = rotr64(eh, el, 14);
            const [e18h, e18l] = rotr64(eh, el, 18);
            const [e41h, e41l] = rotr64(eh, el, 41);
            const S1h = (e14h ^ e18h ^ e41h) >>> 0;
            const S1l = (e14l ^ e18l ^ e41l) >>> 0;

            // Ch(e,f,g) = (e & f) ^ (~e & g)
            const chH = ((eh & fh) ^ (~eh & gh)) >>> 0;
            const chL = ((el & fl) ^ (~el & gl)) >>> 0;

            // temp1 = h + Σ1 + Ch + K[j] + W[j]
            let [t1h, t1l] = add64(hh, hl, S1h, S1l);
            [t1h, t1l] = add64(t1h, t1l, chH, chL);
            [t1h, t1l] = add64(t1h, t1l, K512_HI[j], K512_LO[j]);
            [t1h, t1l] = add64(t1h, t1l, Wh[j], Wl[j]);

            // Σ0(a) = ROTR(28) ^ ROTR(34) ^ ROTR(39)
            const [a28h, a28l] = rotr64(ah, al, 28);
            const [a34h, a34l] = rotr64(ah, al, 34);
            const [a39h, a39l] = rotr64(ah, al, 39);
            const S0h = (a28h ^ a34h ^ a39h) >>> 0;
            const S0l = (a28l ^ a34l ^ a39l) >>> 0;

            // Maj(a,b,c) = (a & b) ^ (a & c) ^ (b & c)
            const majH = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0;
            const majL = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;

            // temp2 = Σ0 + Maj
            const [t2h, t2l] = add64(S0h, S0l, majH, majL);

            hh = gh; hl = gl;
            gh = fh; gl = fl;
            fh = eh; fl = el;
            [eh, el] = add64(dh, dl, t1h, t1l);
            dh = ch; dl = cl;
            ch = bh; cl = bl;
            bh = ah; bl = al;
            [ah, al] = add64(t1h, t1l, t2h, t2l);
        }

        [h0h, h0l] = add64(h0h, h0l, ah, al);
        [h1h, h1l] = add64(h1h, h1l, bh, bl);
        [h2h, h2l] = add64(h2h, h2l, ch, cl);
        [h3h, h3l] = add64(h3h, h3l, dh, dl);
        [h4h, h4l] = add64(h4h, h4l, eh, el);
        [h5h, h5l] = add64(h5h, h5l, fh, fl);
        [h6h, h6l] = add64(h6h, h6l, gh, gl);
        [h7h, h7l] = add64(h7h, h7l, hh, hl);
    }

    const full = packState([h0h, h0l, h1h, h1l, h2h, h2l, h3h, h3l, h4h, h4l, h5h, h5l, h6h, h6l, h7h, h7l]);
    return outputLen === 64 ? full : full.subarray(0, outputLen);
}

function packState(words: number[]): Uint8Array {
    const out = new Uint8Array(words.length * 4);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < words.length; i++) {
        dv.setUint32(i * 4, words[i] >>> 0, false);
    }
    return out;
}

// ── SHA-512 IV (FIPS 180-4 §5.3.5) ──────────────────────────────────

const SHA512_IV = [
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b,
    0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f,
    0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
];

// ── SHA-384 IV (FIPS 180-4 §5.3.4) ──────────────────────────────────

const SHA384_IV = [
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507,
    0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511,
    0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
];

/** SHA-512 hash (FIPS 180-4). Returns 64-byte digest. */
export function sha512(input: Uint8Array): Uint8Array {
    return sha512Core(input, SHA512_IV, 64);
}

/** SHA-384 hash (FIPS 180-4). Returns 48-byte digest. */
export function sha384(input: Uint8Array): Uint8Array {
    return sha512Core(input, SHA384_IV, 48);
}

// ── HMAC-SHA256 (RFC 2104) ───────────────────────────────────────────

/** HMAC-SHA256. Key can be any length; messages can be any length. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
    const blockSize = 64;

    // If key > block size, hash it first
    let k = key.length > blockSize ? sha256(key) : key;

    // Pad key to block size
    const kPad = new Uint8Array(blockSize);
    kPad.set(k);

    // ipad = key XOR 0x36
    const ipad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) ipad[i] = kPad[i] ^ 0x36;

    // opad = key XOR 0x5C
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) opad[i] = kPad[i] ^ 0x5c;

    // inner = SHA256(ipad || message)
    const inner = new Uint8Array(blockSize + message.length);
    inner.set(ipad);
    inner.set(message, blockSize);
    const innerHash = sha256(inner);

    // outer = SHA256(opad || innerHash)
    const outer = new Uint8Array(blockSize + 32);
    outer.set(opad);
    outer.set(innerHash, blockSize);
    return sha256(outer);
}
