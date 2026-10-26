import {
  authorizeDevice,
  registerDevice,
  revokeDevice,
} from "@crewstead/api-client";
import { toBase64Url } from "@crewstead/crypto";
import { recoveryEntry } from "./deviceRecord";
import type { Session } from "./useSession";
import type { VaultRecord } from "./vault";

/**
 * Replaces the recovery identity: registers and authorizes a new one, copies
 * every recovery envelope to it, saves it, and only then revokes the old one.
 * The caller refreshes afterwards.
 */
export async function rotateRecoveryIdentity(session: Session): Promise<void> {
  const { client, account, record, keyring, runtimeOf } = session;
  const { crypto, vault } = await runtimeOf();
  const current = record.current;
  const ring = keyring.current;
  const root = vault.rootSecretKey();
  const previous = vault.recoveryKeys();
  if (
    current === null ||
    ring === null ||
    root === undefined ||
    previous === undefined
  ) {
    throw new Error("recovery identity is unavailable");
  }
  const passphrase = current.autoPassphrase;
  if (passphrase === undefined)
    throw new Error("this browser still has a passphrase of its own");
  const nextKeys = crypto.generateDeviceKeys();
  const created = await registerDevice(client, {
    name: "Identidade de recuperação",
    kind: "recovery",
    signPublicKey: toBase64Url(nextKeys.signPublicKey),
    boxPublicKey: toBase64Url(nextKeys.boxPublicKey),
  });
  const certificate = crypto.signDeviceCertificate(root, {
    accountId: account.id,
    deviceId: created.id,
    signPublicKey: nextKeys.signPublicKey,
    boxPublicKey: nextKeys.boxPublicKey,
  });
  await authorizeDevice(client, created.id, toBase64Url(certificate));
  const restored = await ring.recoverGaps();
  if (restored.failed !== 0) {
    throw new Error("recovery envelopes could not be copied");
  }
  const next: VaultRecord = {
    ...current,
    recovery: recoveryEntry(vault, passphrase, nextKeys, created.id),
  };
  await vault.save(next);
  record.current = next;
  await vault.unlock(next, passphrase);
  await session.buildKeyring();
  await revokeDevice(client, previous.deviceId);
}
