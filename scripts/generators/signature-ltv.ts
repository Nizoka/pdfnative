/**
 * LTV signature showcase — PAdES B-B / B-T / B-LT / B-LTA (v1.7.0).
 *
 * Runs the complete long-term-validation pipeline offline against the
 * deterministic mock PKI (scripts/helpers/mock-pki.ts): real CMS
 * signatures, real RFC 3161 timestamp tokens, real OCSP/CRL structures —
 * zero network, exactly as the injected-provider architecture intends.
 * Open the outputs in Adobe Reader with the mock root trusted to see the
 * levels build up to "LTV enabled".
 */

import { resolve } from 'path';
import {
    buildDocumentPDFBytes, addSignaturePlaceholder, signPdfBytes,
    signPdfBytesWithTimestamp, addValidationInfo, addDocumentTimestamp,
    estimateContentsSize, listSignatures,
} from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { createMockPki, createMockTimestampProvider, createMockRevocationProvider } from '../helpers/mock-pki.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const pki = createMockPki();
    const tsa = createMockTimestampProvider(pki);
    const revocation = createMockRevocationProvider(pki);

    const doc = (level: string, detail: string): DocumentParams => ({
        title: `PAdES ${level}`,
        blocks: [
            { type: 'heading', text: `PAdES ${level}`, level: 1 },
            { type: 'paragraph', text: detail },
            { type: 'paragraph', text: 'Signed with the pdfnative mock PKI (root CA -> signer, TSA with id-kp-timeStamping, OCSP responder with ocsp-nocheck). Providers are injected - the engine never fetches on its own.' },
        ],
        footerText: 'pdfnative - LTV showcase',
    });

    const signOpts = {
        signerCert: pki.signerCert,
        certChain: [pki.rootCert],
        rsaKey: pki.signerKey,
        profile: 'pades' as const,
    };
    const placeholderOpts = {
        metadata: { subFilter: 'ETSI.CAdES.detached' as const, reason: 'LTV showcase' },
        placeholderBytes: estimateContentsSize([2048, 2048], 'rsa-sha256', { timestamp: true }),
    };

    // ── B-B: CAdES signature (ESS signing-certificate-v2) ────────────
    const bb = signPdfBytes(
        addSignaturePlaceholder(buildDocumentPDFBytes(doc('B-B', 'Baseline signature: CMS with the ESS signing-certificate-v2 attribute, /SubFilter ETSI.CAdES.detached.')), placeholderOpts),
        signOpts,
    );
    ctx.writeSafe(resolve(ctx.outputDir, 'signature', 'signature-pades-bb.pdf'), 'signature/signature-pades-bb.pdf', bb);

    // ── B-T: + RFC 3161 signature timestamp ──────────────────────────
    const bt = await signPdfBytesWithTimestamp(
        addSignaturePlaceholder(buildDocumentPDFBytes(doc('B-T', 'Baseline + an RFC 3161 signature timestamp embedded as the id-aa-signatureTimeStampToken unsigned attribute.')), placeholderOpts),
        { ...signOpts, timestampProvider: tsa },
    );
    ctx.writeSafe(resolve(ctx.outputDir, 'signature', 'signature-pades-bt.pdf'), 'signature/signature-pades-bt.pdf', bt);

    // ── B-LT: + /DSS validation material ─────────────────────────────
    const blt = await addValidationInfo(bt, { revocationProvider: revocation });
    ctx.writeSafe(resolve(ctx.outputDir, 'signature', 'signature-pades-blt.pdf'), 'signature/signature-pades-blt.pdf', blt);

    // ── B-LTA: + document timestamp ──────────────────────────────────
    const blta = await addDocumentTimestamp(blt, { timestampProvider: tsa });
    ctx.writeSafe(resolve(ctx.outputDir, 'signature', 'signature-pades-blta.pdf'), 'signature/signature-pades-blta.pdf', blta);

    // ── Multi-signature: two fields signed sequentially ──────────────
    const one = signPdfBytes(
        addSignaturePlaceholder(buildDocumentPDFBytes(doc('multi-signature', 'Two signature fields signed sequentially: Author first, Reviewer second - the first CMS stays byte-identical.')), { fieldName: 'Author' }),
        signOpts,
    );
    const multi = signPdfBytes(
        addSignaturePlaceholder(one, { fieldName: 'Reviewer', allowMultiple: true }),
        { ...signOpts, fieldName: 'Reviewer' },
    );
    ctx.writeSafe(resolve(ctx.outputDir, 'signature', 'signature-multi.pdf'), 'signature/signature-multi.pdf', multi);

    // Sanity: the B-LTA file carries a signature + a document timestamp.
    const summary = listSignatures(blta);
    if (summary.length !== 2 || !summary.some(s => s.isDocTimestamp)) {
        throw new Error('signature-ltv: unexpected B-LTA signature inventory');
    }
}
