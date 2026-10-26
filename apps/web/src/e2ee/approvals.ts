import type {
  CurrentAccount,
  Device,
  PendingDevice,
} from "@crewstead/api-client";
import type { Crypto } from "@crewstead/crypto";
import { fromBase64Url } from "@crewstead/crypto";
import type { InviteSecret } from "./invitations";
import type { PendingApproval } from "./types";

/** One row of the approval list for a device waiting to be authorized. */
export function approvalOf(
  pending: PendingDevice,
  fingerprintOf: (signPublicKey: string) => string,
): PendingApproval {
  return {
    deviceId: pending.device.id,
    accountId: pending.accountId,
    email: pending.email,
    name: pending.device.name,
    signPublicKey: pending.device.signPublicKey,
    boxPublicKey: pending.device.boxPublicKey,
    fingerprint: fingerprintOf(pending.device.signPublicKey),
    ...(pending.device.proof === undefined
      ? {}
      : { proof: pending.device.proof }),
  };
}

/**
 * The devices this browser could approve: the organization's pending ones
 * (administrators only, passed in by the caller) first, then this account's
 * own pending devices. A device shows up once.
 */
export function collectApprovals(input: {
  adminPending: readonly PendingDevice[];
  ownDevices: readonly Device[];
  account: Pick<CurrentAccount, "id" | "email">;
  fingerprintOf: (signPublicKey: string) => string;
}): PendingApproval[] {
  const entries: PendingApproval[] = [];
  const seen = new Set<string>();
  const add = (pending: PendingDevice) => {
    if (seen.has(pending.device.id)) return;
    seen.add(pending.device.id);
    entries.push(approvalOf(pending, input.fingerprintOf));
  };
  for (const pending of input.adminPending) add(pending);
  for (const device of input.ownDevices) {
    if (device.state === "pending") {
      add({
        device,
        accountId: input.account.id,
        email: input.account.email,
      });
    }
  }
  return entries;
}

/**
 * The invitation secret that proves a pending device, if any: same e-mail
 * (case-insensitive) and a proof that verifies against the device's keys.
 */
export function matchInviteSecret(
  entry: PendingApproval,
  secrets: readonly InviteSecret[],
  crypto: Pick<Crypto, "verifyInvitationProof">,
): InviteSecret | undefined {
  if (entry.proof === undefined) return undefined;
  const proof = entry.proof;
  const signPublicKey = fromBase64Url(entry.signPublicKey);
  const boxPublicKey = fromBase64Url(entry.boxPublicKey);
  return secrets.find(
    (secret) =>
      secret.email.toLowerCase() === entry.email.toLowerCase() &&
      crypto.verifyInvitationProof(
        fromBase64Url(secret.secret),
        signPublicKey,
        boxPublicKey,
        proof,
      ),
  );
}
