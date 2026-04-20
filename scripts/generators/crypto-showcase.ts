/**
 * Crypto primitives showcase — SHA-384/512, RSA, ECDSA, X.509 parsing.
 */

import { resolve } from 'path';
import {
    buildDocumentPDFBytes,
    sha384, sha512, hmacSha256,
} from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // Run crypto operations and display their outputs
    const testData = new TextEncoder().encode('pdfnative crypto showcase');

    const h384 = sha384(testData);
    const h512 = sha512(testData);
    const hmac = hmacSha256(new Uint8Array(32), testData);

    const toHex = (arr: Uint8Array): string =>
        Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

    const params: DocumentParams = {
        title: 'Zero-Dependency Crypto Primitives',
        blocks: [
            { type: 'heading', text: 'Cryptographic Primitives', level: 1 },
            { type: 'paragraph', text: 'pdfnative includes a complete zero-dependency crypto module. All algorithms are implemented in pure TypeScript — no Node.js crypto, no WebCrypto, no external packages.' },

            { type: 'heading', text: 'SHA-384 (FIPS 180-4)', level: 2 },
            { type: 'paragraph', text: `Input: "pdfnative crypto showcase"` },
            { type: 'paragraph', text: `Hash (${h384.length * 8}-bit): ${toHex(h384).substring(0, 64)}...` },
            { type: 'paragraph', text: 'SHA-384 is a truncated SHA-512. Both use 64-bit words simulated as paired 32-bit integers — JavaScript lacks native uint64.' },

            { type: 'heading', text: 'SHA-512 (FIPS 180-4)', level: 2 },
            { type: 'paragraph', text: `Hash (${h512.length * 8}-bit): ${toHex(h512).substring(0, 64)}...` },
            { type: 'paragraph', text: '80 rounds of compression using 64-bit arithmetic on [hi, lo] word pairs. Round constants derived from cube roots of first 80 primes.' },

            { type: 'heading', text: 'HMAC-SHA256 (RFC 2104)', level: 2 },
            { type: 'paragraph', text: `MAC (256-bit): ${toHex(hmac)}` },
            { type: 'paragraph', text: 'HMAC wraps SHA-256 with inner/outer key padding. Used in PDF encryption key derivation (ISO 32000-1 Extension Level 3).' },

            { type: 'heading', text: 'RSA PKCS#1 v1.5 Signatures', level: 2 },
            { type: 'paragraph', text: 'Pure-JS modular exponentiation (BigInt). Signs DigestInfo ASN.1 structure: OID + SHA-256 hash. Used for PDF digital signatures (ISO 32000-1 §12.8).' },
            { type: 'paragraph', text: 'Key operations: rsaSign(privateKey, data) → DER-encoded signature bytes.' },

            { type: 'heading', text: 'ECDSA P-256 Signatures', level: 2 },
            { type: 'paragraph', text: 'Elliptic curve digital signatures over secp256r1 (NIST P-256). Point multiplication, modular inverse via extended Euclidean algorithm.' },
            { type: 'paragraph', text: 'Key operations: ecdsaSign(privateKey, data) → (r, s) signature pair encoded as DER.' },

            { type: 'heading', text: 'X.509 Certificate Parsing', level: 2 },
            { type: 'paragraph', text: 'DER-encoded X.509v3 certificate parser. Extracts subject, issuer, validity period, public key, and signature algorithm. Used to embed signer certificates in CMS SignedData.' },

            { type: 'heading', text: 'CMS SignedData (PKCS#7)', level: 2 },
            { type: 'paragraph', text: 'RFC 5652-compliant CMS builder. Produces detached signatures with SignerInfo, DigestAlgorithm, and embedded X.509 certificate chain. This is what goes into the PDF /Contents of a signature field.' },
        ],
        footerText: 'pdfnative – Zero-Dependency Crypto',
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'crypto', 'crypto-showcase.pdf'), 'crypto/crypto-showcase.pdf', buildDocumentPDFBytes(params));
}
