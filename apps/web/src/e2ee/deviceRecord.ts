import { toBase64Url, type Crypto, type DeviceKeys } from "@crewstead/crypto";
import type { Vault, VaultRecord } from "./vault";

type Wrapper = Pick<Vault, "wrapDevice" | "wrapSecret">;

/** Both private halves of a key pair, in the order the vault stores them. */
function privateHalves(keys: DeviceKeys): Uint8Array {
  return new Uint8Array([...keys.signSecretKey, ...keys.boxSecretKey]);
}

/** The vault record of a browser that just registered its own device. */
export function newDeviceRecord(input: {
  vault: Pick<Vault, "wrapDevice">;
  accountId: string;
  created: { id: string; name: string };
  keys: DeviceKeys;
  autoPassphrase: string;
  pinnedRoot: string;
}): VaultRecord {
  const { keys } = input;
  return {
    version: 1,
    accountId: input.accountId,
    deviceId: input.created.id,
    deviceName: input.created.name,
    signPublicKey: toBase64Url(keys.signPublicKey),
    boxPublicKey: toBase64Url(keys.boxPublicKey),
    wrappedDevice: input.vault.wrapDevice(input.autoPassphrase, keys),
    pinnedRoot: input.pinnedRoot,
    autoPassphrase: input.autoPassphrase,
  };
}

/** The recovery identity as the vault keeps it: public halves plus the wrapped private ones. */
export function recoveryEntry(
  vault: Pick<Vault, "wrapSecret">,
  passphrase: string,
  keys: DeviceKeys,
  deviceId: string,
): NonNullable<VaultRecord["recovery"]> {
  return {
    deviceId,
    signPublicKey: toBase64Url(keys.signPublicKey),
    boxPublicKey: toBase64Url(keys.boxPublicKey),
    wrapped: vault.wrapSecret(passphrase, privateHalves(keys)),
  };
}

/**
 * The first save of an organization setup: fresh trust root, device and
 * recovery identity, all wrapped under one random passphrase, flagged
 * incomplete until the server steps finish. Keys are drawn in a fixed order
 * (passphrase, root, device, recovery).
 */
export function newSetupDraft(
  vault: Wrapper,
  crypto: Pick<Crypto, "generateDomainKey" | "generateDeviceKeys">,
  accountId: string,
): VaultRecord {
  const passphrase = toBase64Url(crypto.generateDomainKey());
  const root = crypto.generateDeviceKeys();
  const device = crypto.generateDeviceKeys();
  const recovery = crypto.generateDeviceKeys();
  return {
    version: 1,
    incomplete: true,
    accountId,
    autoPassphrase: passphrase,
    deviceId: "",
    deviceName: "Este navegador",
    signPublicKey: toBase64Url(device.signPublicKey),
    boxPublicKey: toBase64Url(device.boxPublicKey),
    wrappedDevice: vault.wrapDevice(passphrase, device),
    pinnedRoot: toBase64Url(root.signPublicKey),
    root: {
      publicKey: toBase64Url(root.signPublicKey),
      wrapped: vault.wrapSecret(passphrase, root.signSecretKey),
    },
    recovery: recoveryEntry(vault, passphrase, recovery, ""),
  };
}
