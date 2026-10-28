/**
 * Long-term validation from material collected out of band. A signed PDF
 * and flat lists of certificates, OCSP responses and CRLs — fetched by
 * another system, read from an archive, or handed over by the CA — are
 * composed into the `/DSS` with `composeLtvData()`: `match: 'chain'` keeps
 * only what validates each signature (issuers found by verifying
 * signatures, OCSP responses by CertID, CRLs by issuer name), so nothing
 * unrelated lands in the file. No network, no provider: the recipe is the
 * offline half of the LTV pipeline.
 *
 * @task Embed LTV material collected offline into a signed PDF, keeping only what the chain needs
 * @surface library
 * @since 1.9.0
 * @expect signatures.length === 1
 * @expect pdf contains '/DSS'
 * @expect pdf contains '/VRI'
 * @expect data.certificates.length === 2
 */
import { addSignaturePlaceholder, buildDocumentPDFBytes, composeLtvData, embedValidationInfo, listSignatures, signPdfBytes } from 'pdfnative';
import type { ComposeLtvOptions, LtvData, LtvMaterial, PdfSignatureInfo, RsaPrivateKey, X509Certificate } from 'pdfnative';

/** Key material supplied by the caller (e.g. from a PKCS#12 store). */
export interface SignerMaterial {
    readonly cert: X509Certificate;
    readonly key: RsaPrivateKey;
    readonly chain?: readonly X509Certificate[];
}

/** Validation material gathered out of band: DER certificates, OCSP responses, CRLs — the public LtvMaterial shape. */
export type OfflineMaterial = LtvMaterial;

export async function run(signer: SignerMaterial, material: OfflineMaterial): Promise<{ bytes: Uint8Array; signatures: readonly PdfSignatureInfo[]; data: LtvData }> {
    const signingTime = new Date('2026-10-23T00:00:00Z');
    const unsigned = buildDocumentPDFBytes(
        { title: 'Service agreement', blocks: [{ type: 'paragraph', text: 'Signed, then made verifiable for the long term.' }] },
        { creationDate: signingTime },
    );
    const placeheld = addSignaturePlaceholder(unsigned, {
        fieldName: 'Author',
        metadata: { subFilter: 'ETSI.CAdES.detached', reason: 'Approval', signingTime },
    });
    const signed = signPdfBytes(placeheld, {
        signerCert: signer.cert,
        certChain: signer.chain,
        rsaKey: signer.key,
        algorithm: 'rsa-sha256',
        profile: 'pades',
        signingTime,
    });

    // Only the material that validates this document's signature is kept: 'chain' keeps the
    // certificates of the signer's chain and the OCSP responses and CRLs that answer for them
    // (ocspResponseMatchesCertificate decides which response answers for which certificate).
    const options: ComposeLtvOptions = { match: 'chain' };
    const data = composeLtvData(signed, material, options);
    const bytes = embedValidationInfo(signed, data);
    return { bytes, signatures: listSignatures(bytes), data };
}
