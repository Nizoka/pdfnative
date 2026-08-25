/**
 * PAdES B-B digital signature. The document is built, an invisible
 * signature placeholder is injected (with the CAdES subFilter and the
 * descriptive entries baked in — the /Sig dictionary's byte layout is
 * frozen at placeholder time), then signed. The caller supplies the
 * certificate and RSA key; pdfnative never generates key material.
 *
 * @task Sign a document with a PAdES B-B (ETSI.CAdES.detached) signature
 * @surface library
 * @since 1.7.0
 * @expect signatures.length === 1
 * @expect signatures[0].subFilter === 'ETSI.CAdES.detached'
 * @expect signatures[0].isPlaceholder === false
 */
import { buildDocumentPDFBytes, addSignaturePlaceholder, signPdfBytes, listSignatures } from 'pdfnative';
import type { DocumentParams, PdfSignatureInfo, RsaPrivateKey, X509Certificate } from 'pdfnative';

/** Key material supplied by the caller (e.g. from a PKCS#12 store). */
export interface SignerMaterial {
    readonly cert: X509Certificate;
    readonly key: RsaPrivateKey;
    readonly chain?: readonly X509Certificate[];
}

const params: DocumentParams = {
    title: 'Service agreement',
    blocks: [
        { type: 'heading', text: 'Agreement', level: 1 },
        { type: 'paragraph', text: 'This agreement is executed by digital signature.' },
    ],
    footerText: 'Service agreement',
};

export async function run(signer: SignerMaterial): Promise<{ bytes: Uint8Array; signatures: readonly PdfSignatureInfo[] }> {
    const unsigned = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });

    const placeheld = addSignaturePlaceholder(unsigned, {
        fieldName: 'Author',
        metadata: {
            subFilter: 'ETSI.CAdES.detached',
            reason: 'Approval',
            location: 'London',
            signingTime: new Date('2026-08-25T00:00:00Z'),
        },
    });

    const bytes = signPdfBytes(placeheld, {
        signerCert: signer.cert,
        certChain: signer.chain,
        rsaKey: signer.key,
        algorithm: 'rsa-sha256',
        profile: 'pades',
        signingTime: new Date('2026-08-25T00:00:00Z'),
    });

    return { bytes, signatures: listSignatures(bytes) };
}
