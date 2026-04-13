/**
 * Debug script: Generate a signed PDF and inspect the CMS bytes.
 * Run: npx tsx scripts/debug-signature.ts
 */
import { writeFileSync } from 'fs';
import {
    initCrypto,
    derSequence, derSet, derOid, derNull, derInteger, derBitString,
    derUtf8String, derUtcTime, derContextExplicit, derDecode,
    ecPublicKeyFromPrivate, encodeEcPublicKey,
    ecdsaSignHash, ecdsaVerifyHash, encodeDerSignature, sha256,
    bigIntToBytes, buildCmsSignedData,
} from '../src/crypto/index.js';
import type { EcPrivateKey, EcPublicKey, X509Certificate, CmsSignOptions } from '../src/crypto/index.js';
import { buildSigDict, signPdfBytes } from '../src/core/pdf-signature.js';
import type { PdfSignOptions } from '../src/core/pdf-signature.js';

const DEMO_EC_KEY: EcPrivateKey = {
    d: BigInt('0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721'),
};

const OID_CN = new Uint8Array([0x55, 0x04, 0x03]);
const OID_EC_PUBKEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_P256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);

function makeCert(cn: string): X509Certificate {
    const nameDer = derSequence(derSet(derSequence(derOid(OID_CN), derUtf8String(cn))));
    const notBefore = new Date('2024-01-01T00:00:00Z');
    const notAfter = new Date('2034-01-01T00:00:00Z');
    const validity = derSequence(derUtcTime(notBefore), derUtcTime(notAfter));
    const sigAlgDer = derSequence(derOid(OID_ECDSA_SHA256));
    const pubKeyBytes = encodeEcPublicKey(ecPublicKeyFromPrivate(DEMO_EC_KEY));
    const spki = derSequence(
        derSequence(derOid(OID_EC_PUBKEY), derOid(OID_P256)),
        derBitString(pubKeyBytes),
    );
    const tbs = derSequence(
        derContextExplicit(0, derInteger(2n)),
        derInteger(1n),
        sigAlgDer,
        nameDer,
        validity,
        nameDer,
        spki,
    );
    const tbsHash = sha256(tbs);
    const { r, s } = ecdsaSignHash(tbsHash, DEMO_EC_KEY);
    const signatureBytes = encodeDerSignature(r, s);
    const certDer = derSequence(tbs, sigAlgDer, derBitString(signatureBytes));

    return {
        version: 3, serialNumber: 1n, signatureAlgorithm: OID_ECDSA_SHA256,
        issuer: { cn, raw: nameDer }, subject: { cn, raw: nameDer },
        notBefore, notAfter, publicKeyAlgorithm: OID_EC_PUBKEY,
        publicKeyBytes: pubKeyBytes, isCA: false, keyUsage: 0x80,
        tbsCertificateBytes: tbs, signatureBytes, raw: certDer,
    };
}

async function main() {
    await initCrypto();

    // 1. Verify ECDSA key works
    const pubKey: EcPublicKey = ecPublicKeyFromPrivate(DEMO_EC_KEY);
    const testHash = sha256(new Uint8Array([1, 2, 3]));
    const testSig = ecdsaSignHash(testHash, DEMO_EC_KEY);
    const verified = ecdsaVerifyHash(testHash, testSig.r, testSig.s, pubKey);
    console.log('ECDSA key verification:', verified ? 'OK' : 'FAILED');

    const cert = makeCert('Debug Test');
    console.log('Certificate DER:', cert.raw.length, 'bytes');

    // 2. Build CMS and verify its structure byte by byte
    const dummyHash = sha256(new Uint8Array(100));
    const cms = buildCmsSignedData({
        dataHash: dummyHash,
        signerCert: cert,
        ecKey: DEMO_EC_KEY,
        algorithm: 'ecdsa-sha256',
        signingTime: new Date('2024-06-15T12:00:00Z'),
    });
    console.log('CMS:', cms.length, 'bytes');
    console.log('CMS hex (first 100 chars):', Buffer.from(cms).toString('hex').substring(0, 100));

    // 3. Parse CMS and walk the structure
    const root = derDecode(cms);
    console.log('\n=== CMS ContentInfo ===');
    console.log('tag=0x' + root.tag.toString(16), 'totalLen=' + root.totalLength, 'cmsBytes=' + cms.length);
    if (root.totalLength !== cms.length) {
        console.log('⚠️  CMS DER totalLength MISMATCH — trailing bytes exist');
    }

    // 4. Build a signed PDF
    const sigDict = buildSigDict({
        signerCert: cert, ecKey: DEMO_EC_KEY, algorithm: 'ecdsa-sha256',
        name: 'Debug', signingTime: new Date('2024-06-15T12:00:00Z'),
    });

    // Build minimal PDF using byte-accurate offset tracking
    const parts: string[] = [];
    function addPart(s: string) { parts.push(s); }

    addPart('%PDF-1.7\n');
    const obj1Offset = parts.join('').length;
    addPart('1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>\nendobj\n');
    const obj2Offset = parts.join('').length;
    addPart('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    const obj3Offset = parts.join('').length;
    addPart('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> /Annots [4 0 R] >>\nendobj\n');
    const obj4Offset = parts.join('').length;
    addPart('4 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (Sig) /V 5 0 R /Rect [50 750 300 790] /F 132 /P 3 0 R >>\nendobj\n');
    const obj5Offset = parts.join('').length;
    addPart('5 0 obj\n' + sigDict + '\nendobj\n');
    const content = 'BT /F1 12 Tf 50 800 Td (Debug Signature Test) Tj ET';
    const obj6Offset = parts.join('').length;
    addPart('6 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
    const obj7Offset = parts.join('').length;
    addPart('7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    const xrefOffset = parts.join('').length;
    const offsets = [obj1Offset, obj2Offset, obj3Offset, obj4Offset, obj5Offset, obj6Offset, obj7Offset];
    let xref = 'xref\n0 8\n0000000000 65535 f \n';
    for (const o of offsets) { xref += String(o).padStart(10, '0') + ' 00000 n \n'; }
    xref += 'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF';
    addPart(xref);

    const pdfText = parts.join('');
    const pdfBytes = new TextEncoder().encode(pdfText);

    console.log('\n=== PDF Before Signing ===');
    console.log('Size:', pdfBytes.length);

    // Find /Contents position
    const contentsIdx = pdfText.indexOf('/Contents <');
    const ltIdx = pdfText.indexOf('<', contentsIdx);
    const gtIdx = pdfText.indexOf('>', ltIdx + 1);
    console.log('/Contents < at byte:', ltIdx);
    console.log('Hex digits start at byte:', ltIdx + 1);
    console.log('> at byte:', gtIdx);
    console.log('Hex digit count:', gtIdx - ltIdx - 1);

    // Sign it
    const signed = signPdfBytes(pdfBytes, {
        signerCert: cert, ecKey: DEMO_EC_KEY, algorithm: 'ecdsa-sha256',
        name: 'Debug', signingTime: new Date('2024-06-15T12:00:00Z'),
    });

    const signedStr = new TextDecoder('latin1').decode(signed);
    const brMatch = signedStr.match(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/);
    if (brMatch) {
        const [_, s1off, s1len, s2off, s2len] = brMatch.map(Number);
        console.log('\n=== ByteRange Analysis ===');
        console.log('ByteRange:', `[${s1off} ${s1len} ${s2off} ${s2len}]`);
        console.log('Segment 1: bytes[0..' + (s1len - 1) + ']');
        console.log('Segment 2: bytes[' + s2off + '..' + (s2off + s2len - 1) + ']');
        console.log('File size:', signed.length);
        console.log('Coverage:', s1len + s2len, '/', signed.length, 'bytes');
        console.log('Gap bytes:', s2off - s1len, '(should be', gtIdx - ltIdx - 1, 'hex digits)');

        // Check byte at boundaries
        console.log('\nBoundary bytes:');
        console.log('  byte[' + (s1len-1) + '] =', signed[s1len-1], '= char "' + String.fromCharCode(signed[s1len-1]) + '"');
        console.log('  byte[' + s1len + '] =', signed[s1len], '= char "' + String.fromCharCode(signed[s1len]) + '"');
        console.log('  byte[' + (s2off-1) + '] =', signed[s2off-1], '= char "' + String.fromCharCode(signed[s2off-1]) + '"');
        console.log('  byte[' + s2off + '] =', signed[s2off], '= char "' + String.fromCharCode(signed[s2off]) + '"');

        // Verify: coverage = file size?
        const total = s1len + (s2off - s1len) + s2len;
        console.log('\nTotal accounted:', total, total === signed.length ? '✓' : '✗ MISMATCH');

        // Extract CMS from hex
        const hexContent = signedStr.substring(s1len, s2off);
        const lastRealHex = hexContent.search(/0+$/);
        const actualHex = lastRealHex >= 0 ? hexContent.substring(0, lastRealHex) : hexContent;
        console.log('\nCMS hex length:', actualHex.length, '→', actualHex.length / 2, 'binary bytes');

        // Check: is '<' included in segment 1? (should it be?)
        const ltByte = signed[ltIdx]; // '<' = 0x3C
        console.log('\n=== Key Question: Where are < and > relative to ByteRange? ===');
        console.log('< is at byte', ltIdx, '→', ltIdx < s1len ? 'INSIDE segment 1 (hashed)' : 'EXCLUDED (not hashed)');
        console.log('> is at byte', gtIdx, '→', gtIdx >= s2off ? 'INSIDE segment 2 (hashed)' : 'EXCLUDED (not hashed)');
        console.log('');
        console.log('Standard convention (iText/pdfbox): < and > should be EXCLUDED from hash');
        console.log('Our convention: < is', ltIdx < s1len ? 'INCLUDED ⚠️' : 'excluded ✓',
                     ', > is', gtIdx >= s2off ? 'INCLUDED ⚠️' : 'excluded ✓');
    }

    writeFileSync('test-output/debug-signed-v2.pdf', signed);
    console.log('\nWritten to test-output/debug-signed-v2.pdf');
}

main().catch(console.error);
