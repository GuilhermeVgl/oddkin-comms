import {
  authorizeDevice,
  listDevices,
  listPendingDevices,
  type Device,
} from "@crewstead/api-client";
import { fromBase64Url, toBase64Url, type Crypto } from "@crewstead/crypto";
import { useCallback, useState } from "react";
import { collectApprovals, matchInviteSecret } from "./approvals";
import { dropInviteSecret, loadInviteSecrets } from "./invitations";
import { csrf, type Client } from "./runtime";
import type { KeyValueStore } from "./storage";
import type { PendingApproval } from "./types";
import type { Session } from "./useSession";

/**
 * A device that proves it knows the secret of an invitation this browser
 * made (and includes history) is approved on the spot: the proof is what
 * tells it apart from a device the server might have invented. Returns the
 * entries still waiting for a manual approval.
 */
async function approveInvitedDevices(
  entries: PendingApproval[],
  input: {
    client: Client;
    accountId: string;
    root: Uint8Array | undefined;
    crypto: Crypto;
    store: KeyValueStore;
  },
): Promise<PendingApproval[]> {
  const { client, accountId, root, crypto, store } = input;
  if (root === undefined || !entries.some((entry) => entry.proof !== undefined))
    return entries;
  const secrets = await loadInviteSecrets(store, accountId);
  const remaining = [...entries];
  for (const entry of entries) {
    const match = matchInviteSecret(entry, secrets, crypto);
    if (match === undefined) continue;
    try {
      const certificate = crypto.signDeviceCertificate(root, {
        accountId: entry.accountId,
        deviceId: entry.deviceId,
        signPublicKey: fromBase64Url(entry.signPublicKey),
        boxPublicKey: fromBase64Url(entry.boxPublicKey),
      });
      await authorizeDevice(
        client,
        csrf(),
        entry.deviceId,
        toBase64Url(certificate),
      );
      await dropInviteSecret(store, accountId, match.invitationId);
      remaining.splice(remaining.indexOf(entry), 1);
    } catch {
      // It stays in the list for a manual approval.
    }
  }
  return remaining;
}

/** This account's devices and the ones waiting for this browser to approve them. */
export function useApprovals(session: Session) {
  const { client, account, record, runtimeOf } = session;
  const [devices, setDevices] = useState<Device[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);

  const loadApprovals = useCallback(async () => {
    const current = record.current;
    const { vault, crypto, store } = await runtimeOf();
    if (current === null || !vault.unlocked) {
      setApprovals([]);
      return;
    }
    const mine = await listDevices(client);
    setDevices(mine);
    const adminPending = account.isAdmin
      ? await listPendingDevices(client)
      : [];
    const entries = collectApprovals({
      adminPending,
      ownDevices: mine,
      account,
      fingerprintOf: (signPublicKey) => vault.fingerprint(signPublicKey),
    });
    setApprovals(
      await approveInvitedDevices(entries, {
        client,
        accountId: account.id,
        root: vault.rootSecretKey(),
        crypto,
        store,
      }),
    );
  }, [client, account, runtimeOf]);

  return { devices, setDevices, approvals, loadApprovals };
}
