/**
 * Digital signature showcase — RSA and ECDSA signed PDFs.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import {
    initCrypto,
    derSequence, derSet, derOid, derNull, derInteger, derBitString,
    derUtf8String, derUtcTime, derContextExplicit,
    ecPublicKeyFromPrivate, encodeEcPublicKey,
    rsaSignHash, ecdsaSignHash, encodeDerSignature, sha256,
    bigIntToBytes,
} from '../../src/crypto/index.js';
import type { RsaPrivateKey, EcPrivateKey, X509Certificate } from '../../src/crypto/index.js';
import { buildSigDict, signPdfBytes } from '../../src/core/pdf-signature.js';
import type { PdfSignOptions } from '../../src/core/pdf-signature.js';

// ── Demo key material ────────────────────────────────────────────────

// Pre-generated RSA-2048 private key (FOR DEMO ONLY — not for production use)
const DEMO_RSA_KEY: RsaPrivateKey = {
    n: BigInt('0xCEC9322E0B3E05374ED6C2730D5EFBB1620446BE465C289A8099CBC56E84C059CEF01636B1FC205FF1A70802451469871A562D5944FCB01DBD42CE78D05A2DF77DD17B83EA3DBC585C444D8F73F9167A357DE7A5A2982CADCB9F7989E4DD71BFF6C6A1DAB9FD688C7BFE0E0833FC52E4DAE3AE6C853B9407597371C899B9D1768A3BB95AFDF1BB6AD81B70AFB0AF41A3F3BB394B5CB0F414C639CE1E2D672C961F3DDA29C1A7C586EED20142D41BD21A97F0AE94918D6884262BEECFFC12EA01FB766906713619C084A202F1DF10C36BE797AB7F6D69E2909E4512350FC46B4BD9A498CD6A21CF4DFC9D0A7A2B7219189984AE1DABFCBA1B2C9C531FFAE6803F'),
    d: BigInt('0x2F64C10ACC88D42EC8419D0CB6626D42400DD11DD62EFB35A5B32ACECCEF7EB72CF3E502137B145FC7A44EA679501886962413F2CB94990B9C0CB950EC2D232F6405782DD47C732E7F5B54C47B7CA108D0BF52EE92D57A5CE0756F55047DFF4BCDE4E5289AFDB6B0394B975B072AFFBE7413997CCB6588D03CAAA2A6B5F9290E01FC61D6C4624B4D866066ADC0B44F7AC9740378787E6FB727CBC6591595C4871124CC48C28C93DD542A9FC30E5A725207174BD4BA647FD31FD51D9CB0CD02EC9F3463B6AB21C146D3C31A2B8E2F11F2BF4EA9D720A7CEAACDD9114F6054B9B4B438530931261C027EFBFC89D22646A492C09637E2ECEE828002181C050065'),
    p: BigInt('0xFBF8E7302E17165FB769FD2B4AC18D0B4C36EA72CCCDABAD93A847AB6206D37DC291FF8ECF0B57F3271F019EBF14FE8B0943628EE102A8DE451387D7C4682E241747912D6481F8EEDAE4641722DE15EBE78F874C3CDA4214F0DBD5232345600010060AE77F71F52230A9A72DBF52FFD4F37C110A44385C2EAB6A55CAC3296023'),
    q: BigInt('0xD21762B9624743DC65B8519AAE3D7BA4770E9DB6DD402AC00CF53B7536171B0BCDEEEED68B92837C18C1564441AC236CDC14E1F0E8009A779F3F61B5D0603FACA6D25091C10620BE6DE92E16C0582A386D21F35F42205E1A597F6C908237D7A1BEC01A33E82C672F51FFE3B8A207B8F2ECDEA7D3C874A20620A79265E3B11335'),
    dp: BigInt('0x0F9E07C646B50B9FF7204C9EC84D62CE9674B8E750A656C3B56932B7FEA569AA5BCAECCA0F2F26CE5D5860A354389AE64736B3FF2317251C51AFBA35B768B5A36B05F68B97B52E96AF5E848DA28D9D5237D1FF92CC1AC309C53BFAE3E8A5BE2382DABD064831E9FDAA8279682E79987DBC71AE24B2C1C384E8FEF83E4F065B7D'),
    dq: BigInt('0x50C616F9E99436BE0D09D1AE23E195A104F9449FE2EEE1C0D6FA8E32A16A3EC6CA155C1476B30D04704C1D0BBF281CB2A4E70E7B5DE7A57BEA6926FB0D338427B037DA2C3FC7485D8ECA8122D42ED184C248B45662892944FE35E49AA6C62B8C8F57327BD47F05E906A0D87FCB2426F297297FE30805F7A95D72AFF1A69A1525'),
    qi: BigInt('0x0A2D3C827C08F4D5743BD09C0316CA2A3DD19874916C9C8E30EEF6154357B0366AB7C6C8CB75A748F068D95CA820EDA34754432CF6C34EC96094DC45D6EF28B626562950D1A5981CBCE90123D7A8DF5F55E132D4A1BAFD41CECBB27C69CC7AB72A647BBB270408589A472C1C5D6918CC1CA9C9DE9463AA25CBFE13D7E3F3550B'),
};

// Pre-generated ECDSA P-256 private key (FOR DEMO ONLY)
const DEMO_EC_KEY: EcPrivateKey = {
    d: BigInt('0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721'),
};

// Well-known OIDs for certificate construction
const OID_CN = new Uint8Array([0x55, 0x04, 0x03]);
const OID_RSA_ENCRYPTION = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
const OID_SHA256_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
const OID_EC_PUBKEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_P256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);

/**
 * Build a valid self-signed X.509 v3 certificate for demo purposes.
 * Produces structurally correct DER that Adobe Reader can parse.
 */
function makeDemoCert(cn: string, alg: 'rsa' | 'ec'): X509Certificate {
    // ── Name (issuer = subject for self-signed) ──────────────────
    const nameDer = derSequence(
        derSet(
            derSequence(
                derOid(OID_CN),
                derUtf8String(cn),
            ),
        ),
    );

    // ── Validity ─────────────────────────────────────────────────
    const notBefore = new Date('2024-01-01T00:00:00Z');
    const notAfter = new Date('2034-01-01T00:00:00Z');
    const validity = derSequence(derUtcTime(notBefore), derUtcTime(notAfter));

    // ── SubjectPublicKeyInfo + SignatureAlgorithm ─────────────────
    let spki: Uint8Array;
    let sigAlgDer: Uint8Array;
    let sigAlgOid: Uint8Array;
    let pubKeyBytes: Uint8Array;

    if (alg === 'rsa') {
        sigAlgOid = OID_SHA256_RSA;
        sigAlgDer = derSequence(derOid(OID_SHA256_RSA), derNull());
        const rsaPubKeyDer = derSequence(
            derInteger(DEMO_RSA_KEY.n),
            derInteger(65537n),
        );
        pubKeyBytes = bigIntToBytes(DEMO_RSA_KEY.n, 256);
        spki = derSequence(
            derSequence(derOid(OID_RSA_ENCRYPTION), derNull()),
            derBitString(rsaPubKeyDer),
        );
    } else {
        sigAlgOid = OID_ECDSA_SHA256;
        sigAlgDer = derSequence(derOid(OID_ECDSA_SHA256));
        pubKeyBytes = encodeEcPublicKey(ecPublicKeyFromPrivate(DEMO_EC_KEY));
        spki = derSequence(
            derSequence(derOid(OID_EC_PUBKEY), derOid(OID_P256)),
            derBitString(pubKeyBytes),
        );
    }

    // ── TBSCertificate ───────────────────────────────────────────
    const tbs = derSequence(
        derContextExplicit(0, derInteger(2n)),  // version v3
        derInteger(1n),                          // serialNumber
        sigAlgDer,                               // signature algorithm
        nameDer,                                 // issuer
        validity,                                // validity
        nameDer,                                 // subject
        spki,                                    // subjectPublicKeyInfo
    );

    // ── Sign TBS ─────────────────────────────────────────────────
    const tbsHash = sha256(tbs);
    let signatureBytes: Uint8Array;

    if (alg === 'rsa') {
        signatureBytes = rsaSignHash(tbsHash, DEMO_RSA_KEY);
    } else {
        const { r, s } = ecdsaSignHash(tbsHash, DEMO_EC_KEY);
        signatureBytes = encodeDerSignature(r, s);
    }

    // ── Assemble Certificate DER ─────────────────────────────────
    const certDer = derSequence(tbs, sigAlgDer, derBitString(signatureBytes));

    return {
        version: 3,
        serialNumber: 1n,
        signatureAlgorithm: sigAlgOid,
        issuer: { cn, raw: nameDer },
        subject: { cn, raw: nameDer },
        notBefore,
        notAfter,
        publicKeyAlgorithm: alg === 'rsa' ? OID_RSA_ENCRYPTION : OID_EC_PUBKEY,
        publicKeyBytes: pubKeyBytes,
        isCA: false,
        keyUsage: 0x80,
        tbsCertificateBytes: tbs,
        signatureBytes,
        raw: certDer,
    };
}

// ── Minimal PDF with signature placeholder ───────────────────────────

function buildMinimalSignedPdf(sigDict: string, title: string): Uint8Array {
    // Build a minimal valid PDF with a signature field
    const lines: string[] = [];
    const offsets: number[] = [];
    let pos = 0;

    function emit(s: string): void { lines.push(s); pos += s.length + 1; }
    function markObj(): void { offsets.push(pos); }

    emit('%PDF-1.7');
    emit('');

    // Obj 1: Catalog
    markObj();
    emit('1 0 obj');
    emit('<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>');
    emit('endobj');
    emit('');

    // Obj 2: Pages
    markObj();
    emit('2 0 obj');
    emit('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    emit('endobj');
    emit('');

    // Obj 3: Page
    markObj();
    emit('3 0 obj');
    emit('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> /Annots [4 0 R] >>');
    emit('endobj');
    emit('');

    // Obj 4: Signature Field (Widget Annotation)
    markObj();
    emit('4 0 obj');
    emit('<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V 5 0 R /Rect [50 750 300 790] /F 132 /P 3 0 R >>');
    emit('endobj');
    emit('');

    // Obj 5: Signature Value
    markObj();
    emit('5 0 obj');
    emit(sigDict);
    emit('endobj');
    emit('');

    // Obj 6: Page content stream
    const content = `BT /F1 16 Tf 50 800 Td (${title}) Tj ET BT /F1 10 Tf 50 720 Td (This document has been digitally signed using pdfnative.) Tj ET BT /F1 10 Tf 50 700 Td (The signature is a PKCS#7 detached CMS SignedData structure.) Tj ET BT /F1 10 Tf 50 680 Td (ISO 32000-1 \\247 12.8 compliant.) Tj ET`;
    markObj();
    emit('6 0 obj');
    emit(`<< /Length ${content.length} >>`);
    emit('stream');
    emit(content);
    emit('endstream');
    emit('endobj');
    emit('');

    // Obj 7: Font
    markObj();
    emit('7 0 obj');
    emit('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    emit('endobj');
    emit('');

    // Obj 8: Info
    markObj();
    emit('8 0 obj');
    emit(`<< /Title (${title}) /Producer (pdfnative) >>`);
    emit('endobj');
    emit('');

    // Xref
    const xrefPos = pos;
    emit('xref');
    emit(`0 ${offsets.length + 1}`);
    emit('0000000000 65535 f ');
    for (const o of offsets) {
        emit(`${String(o).padStart(10, '0')} 00000 n `);
    }
    emit('');
    emit('trailer');
    emit(`<< /Size ${offsets.length + 1} /Root 1 0 R /Info 8 0 R >>`);
    emit('startxref');
    emit(String(xrefPos));
    emit('%%EOF');

    return new TextEncoder().encode(lines.join('\n'));
}

export async function generate(ctx: GenerateContext): Promise<void> {
    await initCrypto();

    // ── RSA-signed PDF ───────────────────────────────────────────
    {
        const cert = makeDemoCert('pdfnative RSA Demo', 'rsa');
        const sigDict = buildSigDict({
            signerCert: cert,
            rsaKey: DEMO_RSA_KEY,
            algorithm: 'rsa-sha256',
            name: 'pdfnative RSA Demo',
            reason: 'Sample digital signature',
            location: 'pdfnative test suite',
            signingTime: new Date('2024-06-15T12:00:00Z'),
        });

        const pdfBytes = buildMinimalSignedPdf(sigDict, 'RSA Digital Signature Demo');
        const signOptions: PdfSignOptions = {
            signerCert: cert,
            rsaKey: DEMO_RSA_KEY,
            algorithm: 'rsa-sha256',
            name: 'pdfnative RSA Demo',
            reason: 'Sample digital signature',
            location: 'pdfnative test suite',
            signingTime: new Date('2024-06-15T12:00:00Z'),
        };

        const signed = signPdfBytes(pdfBytes, signOptions);
        ctx.writeSafe(resolve(ctx.outputDir, 'digital-signature-rsa.pdf'), 'digital-signature-rsa.pdf', signed);
    }

    // ── ECDSA-signed PDF ─────────────────────────────────────────
    {
        const cert = makeDemoCert('pdfnative ECDSA Demo', 'ec');
        const sigDict = buildSigDict({
            signerCert: cert,
            ecKey: DEMO_EC_KEY,
            algorithm: 'ecdsa-sha256',
            name: 'pdfnative ECDSA Demo',
            reason: 'Sample ECDSA signature',
            location: 'pdfnative test suite',
            signingTime: new Date('2024-06-15T12:00:00Z'),
        });

        const pdfBytes = buildMinimalSignedPdf(sigDict, 'ECDSA Digital Signature Demo');
        const signOptions: PdfSignOptions = {
            signerCert: cert,
            ecKey: DEMO_EC_KEY,
            algorithm: 'ecdsa-sha256',
            name: 'pdfnative ECDSA Demo',
            reason: 'Sample ECDSA signature',
            location: 'pdfnative test suite',
            signingTime: new Date('2024-06-15T12:00:00Z'),
        };

        const signed = signPdfBytes(pdfBytes, signOptions);
        ctx.writeSafe(resolve(ctx.outputDir, 'digital-signature-ecdsa.pdf'), 'digital-signature-ecdsa.pdf', signed);
    }

    // ── Documentation PDF (unsigned, describes capabilities) ─────
    {
        const params: DocumentParams = {
            title: 'Digital Signature Capabilities',
            blocks: [
                { type: 'heading', text: 'Digital Signature Support', level: 1 },
                { type: 'paragraph', text: 'pdfnative provides zero-dependency digital signature support compliant with ISO 32000-1 §12.8. All cryptographic primitives are implemented in pure TypeScript with no external dependencies.' },

                { type: 'heading', text: 'Supported Algorithms', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'RSA PKCS#1 v1.5 with SHA-256 (rsa-sha256)',
                    'ECDSA P-256 with SHA-256 (ecdsa-sha256)',
                    'SHA-256, SHA-384, SHA-512 hash functions',
                    'HMAC-SHA256 for message authentication',
                ] },

                { type: 'heading', text: 'Cryptographic Modules', level: 2 },
                { type: 'table', headers: ['Module', 'Description'], rows: [
                    { cells: ['sha.ts', 'SHA-256/384/512 + HMAC-SHA256 (FIPS 180-4)'], type: '', pointed: false },
                    { cells: ['asn1.ts', 'Full ASN.1 DER encoder/decoder'], type: '', pointed: false },
                    { cells: ['rsa.ts', 'RSA PKCS#1 v1.5 sign/verify with BigInt'], type: '', pointed: false },
                    { cells: ['ecdsa.ts', 'ECDSA P-256 with RFC 6979 deterministic k'], type: '', pointed: false },
                    { cells: ['x509.ts', 'X.509 certificate parser (RFC 5280)'], type: '', pointed: false },
                    { cells: ['cms.ts', 'CMS/PKCS#7 SignedData builder (RFC 5652)'], type: '', pointed: false },
                    { cells: ['pdf-signature.ts', 'PDF ByteRange + CMS embedding'], type: '', pointed: false },
                ] },

                { type: 'heading', text: 'Signature Flow', level: 2 },
                { type: 'list', style: 'numbered', items: [
                    'Build PDF with /Contents placeholder and /ByteRange template',
                    'Compute actual ByteRange offsets from final PDF layout',
                    'Hash the two ByteRange segments (before + after placeholder)',
                    'Build CMS SignedData with signed attributes (content-type, message-digest, signing-time)',
                    'Hex-encode CMS and embed into /Contents placeholder',
                ] },

                { type: 'heading', text: 'Standards Compliance', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'ISO 32000-1 §12.8 — Digital Signatures',
                    'RFC 5652 — CMS (Cryptographic Message Syntax)',
                    'RFC 5280 — X.509 Certificate Profile',
                    'FIPS 180-4 — Secure Hash Standard (SHA-2)',
                    'FIPS 186-4 — Digital Signature Standard (ECDSA)',
                    'RFC 6979 — Deterministic DSA/ECDSA',
                ] },
            ],
        };

        const bytes = buildDocumentPDFBytes(params);
        ctx.writeSafe(resolve(ctx.outputDir, 'digital-signature-info.pdf'), 'digital-signature-info.pdf', bytes);
    }
}
