/**
 * pdfnative — Document Timestamps (PAdES B-LTA, v1.7.0)
 * ======================================================
 * `addDocumentTimestamp` appends a document-timestamp revision per
 * ISO 32000-2 §12.8.5: a signature field whose dictionary is
 * `/Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161`
 * with a bare RFC 3161 TimeStampToken as `/Contents` — no `/M`, `/Name`
 * or `/Reason` (the token itself is the time assertion). Applied on top
 * of a B-LT document (signature + timestamp + /DSS) it completes the
 * PAdES B-LTA archival profile; re-timestamping before the TSA
 * certificate expires extends the archival chain indefinitely.
 *
 * The token transport is the injected {@link TimestampProvider} — the
 * engine never fetches on its own.
 */

import { sha256, sha384, sha512 } from '../crypto/sha.js';
import type { CmsDigestAlgorithm } from '../crypto/cms.js';
import { buildTimestampRequest, parseTimestampResponse, parseTimestampToken, verifyTimestampImprint } from '../crypto/rfc3161.js';
import { getTimestampProvider, type TimestampProvider } from '../crypto/timestamp-provider.js';
import { addSignaturePlaceholder } from './pdf-sig-placeholder.js';
import { listSignatures } from './pdf-sig-utils.js';
import {
    findUnsignedPlaceholders, applyByteRange, byteRangeInput, embedContentsHex,
} from './pdf-signature.js';

/** Options for {@link addDocumentTimestamp}. */
export interface AddDocumentTimestampOptions {
    /** Per-call transport; falls back to the global `setTimestampProvider`. */
    readonly timestampProvider?: TimestampProvider;
    /**
     * Reserved bytes for the TimeStampToken. Default `12288` — ample for a
     * token carrying the TSA certificate chain.
     */
    readonly placeholderBytes?: number;
    /**
     * `/T` field name. Default `'DocTimeStamp1'`, auto-suffixed
     * (`DocTimeStamp2`, …) when the name is already taken by an earlier
     * timestamp — re-timestamping is the normal B-LTA maintenance flow.
     */
    readonly fieldName?: string;
    /** Digest for the TSA message imprint. Default `'sha256'`. */
    readonly digestAlgorithm?: CmsDigestAlgorithm;
    /** Optional TSA nonce (echo verified when returned). */
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
 * Append a document-timestamp revision covering every byte of the current
 * document (all earlier revisions stay byte-identical).
 *
 * @since 1.7.0
 */
export async function addDocumentTimestamp(
    pdfBytes: Uint8Array,
    options: AddDocumentTimestampOptions = {},
): Promise<Uint8Array> {
    const provider = options.timestampProvider ?? getTimestampProvider();
    if (!provider) {
        throw new Error(
            'addDocumentTimestamp: no TimestampProvider — pass options.timestampProvider '
            + 'or install one with setTimestampProvider() (the engine never fetches on its own)',
        );
    }
    const digestAlgorithm = options.digestAlgorithm ?? 'sha256';
    const placeholderBytes = options.placeholderBytes ?? 12288;

    // Unique field name (auto-suffix over existing timestamp fields).
    let fieldName = options.fieldName;
    if (!fieldName) {
        const existing = new Set(listSignatures(pdfBytes).map(s => s.fieldName));
        let n = 1;
        while (existing.has(`DocTimeStamp${n}`)) n++;
        fieldName = `DocTimeStamp${n}`;
    }

    // 1) Placeholder revision: a DocTimeStamp signature field. The sig
    //    dictionary intentionally has no /M — ISO 32000-2 §12.8.5 defines
    //    the token's genTime as the document's time assertion.
    const withPlaceholder = addSignaturePlaceholder(pdfBytes, {
        placeholderBytes,
        fieldName,
        allowMultiple: true,
        docTimeStamp: true,
    });

    // 2) ByteRange + digest over the whole revision.
    const pdfString = uint8ToLatin1(withPlaceholder);
    const locs = findUnsignedPlaceholders(pdfString);
    if (locs.length === 0) throw new Error('addDocumentTimestamp: placeholder injection failed');
    // The DocTimeStamp placeholder is the one just appended — the last.
    const loc = locs[locs.length - 1];
    const mutableBytes = new Uint8Array(withPlaceholder);
    const { beforeLen, afterStart } = applyByteRange(mutableBytes, loc);
    const imprint = digestOf(digestAlgorithm, byteRangeInput(mutableBytes, beforeLen, afterStart));

    // 3) RFC 3161 round-trip.
    const request = buildTimestampRequest(imprint, {
        digestAlgorithm,
        ...(options.timestampNonce !== undefined ? { nonce: options.timestampNonce } : {}),
        certReq: true,
    });
    const responseDer = await provider.getTimestamp(request);
    const response = parseTimestampResponse(responseDer);
    if ((response.status !== 0 && response.status !== 1) || !response.token) {
        throw new Error(
            `addDocumentTimestamp: TSA rejected the request (status ${response.status}`
            + `${response.statusString ? `: ${response.statusString}` : ''})`,
        );
    }
    const tstInfo = parseTimestampToken(response.token);
    if (!verifyTimestampImprint(tstInfo, imprint)) {
        throw new Error('addDocumentTimestamp: TSA token message imprint does not match the document');
    }
    if (options.timestampNonce !== undefined && tstInfo.nonce !== undefined
        && tstInfo.nonce !== options.timestampNonce) {
        throw new Error('addDocumentTimestamp: TSA token nonce mismatch');
    }

    // 4) The bare TimeStampToken IS the /Contents value (no CMS wrapper).
    embedContentsHex(mutableBytes, loc, response.token);
    return mutableBytes;
}
