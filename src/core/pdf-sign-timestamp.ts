/**
 * pdfnative — Timestamped PDF Signing (PAdES B-T, v1.7.0)
 * ========================================================
 * `signPdfBytesWithTimestamp` signs exactly like {@link signPdfBytes} and
 * then obtains an RFC 3161 timestamp over the CMS signature value from an
 * injected {@link TimestampProvider}, embedding the token as the
 * `id-aa-signatureTimeStampToken` unsigned attribute (RFC 3161 App. A).
 * With `profile: 'pades'` + `subFilter: 'ETSI.CAdES.detached'` the result
 * is a PAdES baseline B-T signature (ETSI EN 319 142-1).
 *
 * The engine never touches the network: the provider is a byte transport
 * supplied by the caller (per call or via `setTimestampProvider`). A
 * rejected or tampered TSA response throws — a bad token is never embedded.
 */

import { sha256, sha384, sha512 } from '../crypto/sha.js';
import { buildCmsSignedData } from '../crypto/cms.js';
import type { CmsSignOptions, CmsDigestAlgorithm } from '../crypto/cms.js';
import { parseCmsSignedData, addUnsignedAttribute, buildAttribute } from '../crypto/cms-utils.js';
import { buildTimestampRequest, parseTimestampResponse, parseTimestampToken, verifyTimestampImprint } from '../crypto/rfc3161.js';
import { getTimestampProvider, type TimestampProvider } from '../crypto/timestamp-provider.js';
import {
    findUnsignedPlaceholders, selectPlaceholder, applyByteRange, byteRangeInput, embedContentsHex,
    type PdfSignOptions,
} from './pdf-signature.js';

/** id-aa-signatureTimeStampToken — 1.2.840.113549.1.9.16.2.14 (raw OID bytes). */
const OID_SIGNATURE_TIMESTAMP = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x02, 0x0e]);

/** Options for {@link signPdfBytesWithTimestamp}. */
export interface PdfSignTimestampOptions extends PdfSignOptions {
    /**
     * Per-call timestamp transport; falls back to the global provider
     * installed via `setTimestampProvider`. Required one way or the other.
     */
    readonly timestampProvider?: TimestampProvider;
    /** Digest for the TSA message imprint. Default `'sha256'`. */
    readonly timestampDigestAlgorithm?: CmsDigestAlgorithm;
    /** Optional TSA nonce (echo verified when the TSA returns one). */
    readonly timestampNonce?: bigint;
}

function digestOf(algorithm: CmsDigestAlgorithm, data: Uint8Array): Uint8Array {
    if (algorithm === 'sha384') return sha384(data);
    if (algorithm === 'sha512') return sha512(data);
    return sha256(data);
}

function uint8ToLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

/**
 * Sign a placeholder-carrying PDF and embed an RFC 3161 signature
 * timestamp in the CMS unsigned attributes (PAdES B-T when combined with
 * `profile: 'pades'`). Reserve extra `/Contents` space for the token via
 * `estimateContentsSize(certSizes, algorithm, { timestamp: true })`.
 *
 * @since 1.7.0
 */
export async function signPdfBytesWithTimestamp(
    pdfBytes: Uint8Array,
    options: PdfSignTimestampOptions,
): Promise<Uint8Array> {
    const provider = options.timestampProvider ?? getTimestampProvider();
    if (!provider) {
        throw new Error(
            'signPdfBytesWithTimestamp: no TimestampProvider — pass options.timestampProvider '
            + 'or install one with setTimestampProvider() (the engine never fetches on its own)',
        );
    }
    const algorithm = options.algorithm ?? 'rsa-sha256';
    const digestAlgorithm = options.digestAlgorithm
        ?? (algorithm.endsWith('sha384') ? 'sha384' : algorithm.endsWith('sha512') ? 'sha512' : 'sha256');
    const tsDigest = options.timestampDigestAlgorithm ?? 'sha256';

    // ── 1-3. Locate placeholder, write ByteRange, digest ─────────────
    const pdfString = uint8ToLatin1(pdfBytes);
    const locs = findUnsignedPlaceholders(pdfString);
    if (locs.length === 0) {
        if (pdfString.indexOf('/Contents <') === -1) throw new Error('No /Contents placeholder found in PDF');
        throw new Error('No /ByteRange placeholder found in PDF');
    }
    const loc = selectPlaceholder(pdfBytes, locs, options.fieldName);
    const mutableBytes = new Uint8Array(pdfBytes);
    const { beforeLen, afterStart } = applyByteRange(mutableBytes, loc);
    const dataHash = digestOf(digestAlgorithm, byteRangeInput(mutableBytes, beforeLen, afterStart));

    // ── 4. CMS SignedData ────────────────────────────────────────────
    const cmsOptions: CmsSignOptions = {
        dataHash,
        signerCert: options.signerCert,
        certChain: options.certChain,
        rsaKey: options.rsaKey,
        ecKey: options.ecKey,
        algorithm,
        digestAlgorithm,
        profile: options.profile,
        signingTime: options.signingTime,
        provider: options.provider,
    };
    const cms = buildCmsSignedData(cmsOptions);

    // ── 5. RFC 3161 timestamp over the signature value ───────────────
    const { signatureValue } = parseCmsSignedData(cms);
    const imprint = digestOf(tsDigest, signatureValue);
    const request = buildTimestampRequest(imprint, {
        digestAlgorithm: tsDigest,
        ...(options.timestampNonce !== undefined ? { nonce: options.timestampNonce } : {}),
        certReq: true,
    });
    const responseDer = await provider.getTimestamp(request);
    const response = parseTimestampResponse(responseDer);
    // PKIStatus granted(0) / grantedWithMods(1) are the only acceptable outcomes.
    if ((response.status !== 0 && response.status !== 1) || !response.token) {
        throw new Error(
            `signPdfBytesWithTimestamp: TSA rejected the request (status ${response.status}`
            + `${response.statusString ? `: ${response.statusString}` : ''})`,
        );
    }
    const tstInfo = parseTimestampToken(response.token);
    if (!verifyTimestampImprint(tstInfo, imprint)) {
        throw new Error('signPdfBytesWithTimestamp: TSA token message imprint does not match the signature');
    }
    // RFC 3161 §2.4.2: the token nonce MUST be present (and equal) when the
    // request carried one — an absent nonce is a mismatch, not a pass.
    if (options.timestampNonce !== undefined && tstInfo.nonce !== options.timestampNonce) {
        throw new Error('signPdfBytesWithTimestamp: TSA token nonce mismatch');
    }

    // ── 6. Embed token as unsigned attribute; write /Contents ────────
    const attribute = buildAttribute(OID_SIGNATURE_TIMESTAMP, response.token);
    const cmsWithTimestamp = addUnsignedAttribute(cms, attribute);
    embedContentsHex(mutableBytes, loc, cmsWithTimestamp);

    return mutableBytes;
}
