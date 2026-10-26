import { registerDevice, type CurrentAccount } from "@crewstead/api-client";
import { fromBase64Url, toBase64Url, type Crypto } from "@crewstead/crypto";
import type { MutableRefObject } from "react";
import { newDeviceRecord } from "./deviceRecord";
import { clearProvision, readProvision, sameFingerprint } from "./invitations";
import { csrf, type Client } from "./runtime";
import type { Vault, VaultRecord } from "./vault";

/**
 * Invited with history: the browser registers itself with the secret from the
 * link, asking for nothing. Without the link (or when the root differs from
 * the one in the link) it returns null and the manual step takes over, as it
 * does for any failure. `busy` keeps two refreshes from registering twice.
 */
export async function provisionFromInvitation(input: {
  client: Client;
  vault: Vault;
  crypto: Crypto;
  account: Pick<CurrentAccount, "id" | "email">;
  root: { signPublicKey: string };
  busy: MutableRefObject<boolean>;
}): Promise<VaultRecord | null> {
  const { client, vault, crypto, account, root, busy } = input;
  const provision = readProvision(account.email);
  if (
    provision === null ||
    !sameFingerprint(
      provision.rootFingerprint,
      crypto.fingerprint(fromBase64Url(root.signPublicKey)),
    ) ||
    busy.current
  ) {
    return null;
  }
  busy.current = true;
  try {
    const keys = crypto.generateDeviceKeys();
    const autoPassphrase = toBase64Url(crypto.generateDomainKey());
    const created = await registerDevice(client, csrf(), {
      name: "Navegador",
      signPublicKey: toBase64Url(keys.signPublicKey),
      boxPublicKey: toBase64Url(keys.boxPublicKey),
      proof: crypto.invitationProof(
        fromBase64Url(provision.secret),
        keys.signPublicKey,
        keys.boxPublicKey,
      ),
    });
    const next = newDeviceRecord({
      vault,
      accountId: account.id,
      created,
      keys,
      autoPassphrase,
      pinnedRoot: root.signPublicKey,
    });
    await vault.save(next);
    clearProvision();
    return next;
  } catch {
    return null;
  } finally {
    busy.current = false;
  }
}
