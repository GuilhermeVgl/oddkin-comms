import {
  authorizeDevice,
  getTrustRoot,
  listDevices,
  registerDevice,
  setTrustRoot,
  type Device,
} from "@crewstead/api-client";
import { fromBase64Url, toBase64Url, type Crypto } from "@crewstead/crypto";
import { newSetupDraft } from "./deviceRecord";
import { type Client } from "./runtime";
import type { Session } from "./useSession";
import type { VaultRecord } from "./vault";

type DeviceSpec = {
  signPublicKey: string;
  boxPublicKey: string;
  name: string;
  kind: "device" | "recovery";
};

/**
 * Registers a device unless an earlier attempt already did, and has the trust
 * root authorize it unless that was done too. Returns the device's id.
 */
async function ensureDevice(input: {
  client: Client;
  crypto: Crypto;
  rootSecret: Uint8Array;
  accountId: string;
  existing: readonly Device[];
  spec: DeviceSpec;
}): Promise<string> {
  const { client, crypto, rootSecret, accountId, existing, spec } = input;
  const found = existing.find(
    (entry) => entry.signPublicKey === spec.signPublicKey,
  );
  const id =
    found?.id ??
    (
      await registerDevice(client, {
        name: spec.name,
        kind: spec.kind,
        signPublicKey: spec.signPublicKey,
        boxPublicKey: spec.boxPublicKey,
      })
    ).id;
  if (found === undefined || found.state === "pending") {
    const certificate = crypto.signDeviceCertificate(rootSecret, {
      accountId,
      deviceId: id,
      signPublicKey: fromBase64Url(spec.signPublicKey),
      boxPublicKey: fromBase64Url(spec.boxPublicKey),
    });
    await authorizeDevice(client, id, toBase64Url(certificate));
  }
  return id;
}

/**
 * Creates the organization's keys in this browser, then tells the server.
 * Safe to repeat after any failure: what an earlier attempt did is reused.
 */
export async function setupOrganization(session: Session): Promise<void> {
  const { client, account, record, runtimeOf } = session;
  const { vault, crypto } = await runtimeOf();
  // The keys are saved, wrapped, BEFORE the server hears about them: the
  // trust root can be set only once, so losing its private half to a
  // reload or a failed request would lock the organization out for good.
  let draft =
    record.current?.incomplete === true &&
    record.current.autoPassphrase !== undefined
      ? record.current
      : null;
  if (draft === null) {
    draft = newSetupDraft(vault, crypto, account.id);
    await vault.save(draft);
    record.current = draft;
  }
  const passphrase = draft.autoPassphrase;
  if (passphrase === undefined) throw new Error("the saved setup is unusable");
  await vault.unlock(draft, passphrase);
  const rootSecret = vault.rootSecretKey();
  const draftRecovery = draft.recovery;
  if (rootSecret === undefined || draftRecovery === undefined)
    throw new Error("the saved setup is incomplete");
  const serverRoot = await getTrustRoot(client);
  if (serverRoot === null) {
    await setTrustRoot(client, draft.pinnedRoot);
  } else if (serverRoot.signPublicKey !== draft.pinnedRoot) {
    throw new Error("the organization already has another trust root");
  }
  // Registering and approving are repeatable: what an earlier attempt did is reused.
  const existing = await listDevices(client);
  const shared = {
    client,
    crypto,
    rootSecret,
    accountId: account.id,
    existing,
  };
  const deviceId = await ensureDevice({
    ...shared,
    spec: {
      signPublicKey: draft.signPublicKey,
      boxPublicKey: draft.boxPublicKey,
      name: "Este navegador",
      kind: "device",
    },
  });
  const recoveryId = await ensureDevice({
    ...shared,
    spec: {
      signPublicKey: draftRecovery.signPublicKey,
      boxPublicKey: draftRecovery.boxPublicKey,
      name: "Identidade de recuperação",
      kind: "recovery",
    },
  });
  const next: VaultRecord = {
    ...draft,
    deviceId,
    recovery: { ...draftRecovery, deviceId: recoveryId },
  };
  delete next.incomplete;
  await vault.save(next);
  record.current = next;
  await vault.unlock(next, passphrase);
  vault.rememberInTab(account.id);
  await session.buildKeyring();
}
