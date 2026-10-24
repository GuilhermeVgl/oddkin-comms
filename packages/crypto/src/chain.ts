import type { Crypto } from "./index";
import { fromBase64Url } from "./index";

/** The public record of a device as the directory serves it. */
export type DirectoryRecord = {
  deviceId: string;
  accountId: string;
  signPublicKey: string;
  boxPublicKey: string;
  certificate: string;
  authorizerDeviceId?: string | undefined;
};

const MAX_DEPTH = 4;

/**
 * Walks certificate chains: a device is trusted only if its certificate was
 * signed by the pinned root, or by a device of the same account that is itself
 * trusted. The server only transports records; it never decides who is trusted.
 */
export function createChainVerifier(
  crypto: Crypto,
  pinnedRoot: Uint8Array,
  resolve: (deviceId: string) => Promise<DirectoryRecord | undefined>,
) {
  const verified = new Map<string, boolean>();

  async function trusted(record: DirectoryRecord, depth = 0): Promise<boolean> {
    const known = verified.get(record.deviceId);
    if (known !== undefined) return known;
    if (depth > MAX_DEPTH) return false;
    const fields = {
      accountId: record.accountId,
      deviceId: record.deviceId,
      signPublicKey: fromBase64Url(record.signPublicKey),
      boxPublicKey: fromBase64Url(record.boxPublicKey),
    };
    const certificate = fromBase64Url(record.certificate);
    let result: boolean;
    if (record.authorizerDeviceId === undefined) {
      result = crypto.verifyDeviceCertificate(pinnedRoot, fields, certificate);
    } else {
      const authorizer = await resolve(record.authorizerDeviceId);
      result =
        authorizer !== undefined &&
        authorizer.accountId === record.accountId &&
        crypto.verifyDeviceCertificate(
          fromBase64Url(authorizer.signPublicKey),
          fields,
          certificate,
        ) &&
        (await trusted(authorizer, depth + 1));
    }
    verified.set(record.deviceId, result);
    return result;
  }

  return { trusted };
}
