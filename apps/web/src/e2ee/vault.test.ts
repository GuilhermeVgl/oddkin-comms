import {
  createCrypto,
  createKeystore,
  loadSodium,
  toBase64Url,
  type Crypto,
} from "@crewstead/crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { memoryStore } from "./storage";
import { Vault, type VaultRecord } from "./vault";

let crypto: Crypto;
let keystore: ReturnType<typeof createKeystore>;
beforeAll(async () => {
  const sodium = await loadSodium();
  crypto = await createCrypto(sodium);
  keystore = createKeystore(sodium);
});

// The vault only needs window.sessionStorage; a Map stands in for it.
function fakeSessionStorage() {
  const values = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  };
  return values;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const OPTIONS = { opsLimit: 1, memLimit: 8192 * 1024 };

function newVault() {
  return new Vault(crypto, keystore, memoryStore());
}

function makeRecord(vault: Vault, passphrase: string, withRoot: boolean) {
  const device = crypto.generateDeviceKeys();
  const root = crypto.generateDeviceKeys();
  const record: VaultRecord = {
    version: 1,
    accountId: "account-1",
    deviceId: "device-1",
    deviceName: "Navegador",
    signPublicKey: toBase64Url(device.signPublicKey),
    boxPublicKey: toBase64Url(device.boxPublicKey),
    wrappedDevice: vault.wrapDevice(passphrase, device, OPTIONS),
    pinnedRoot: toBase64Url(root.signPublicKey),
  };
  if (withRoot) {
    record.root = {
      publicKey: toBase64Url(root.signPublicKey),
      wrapped: vault.wrapSecret(passphrase, root.signSecretKey, OPTIONS),
    };
  }
  return { record, device, root };
}

describe("remembering the unlock in one tab", () => {
  it("brings the keys back after a reload without the passphrase", async () => {
    const stored = fakeSessionStorage();
    const first = newVault();
    const { record, device, root } = makeRecord(
      first,
      "a long passphrase",
      true,
    );
    await first.unlock(record, "a long passphrase");
    first.rememberInTab(record.accountId);
    expect(stored.size).toBe(1);

    const afterReload = newVault();
    expect(afterReload.unlocked).toBe(false);
    expect(afterReload.restoreFromTab(record)).toBe(true);
    expect(afterReload.deviceKeys().signSecretKey).toEqual(
      device.signSecretKey,
    );
    expect(afterReload.rootSecretKey()).toEqual(root.signSecretKey);
  });

  it("forgets everything on lock, so logout leaves nothing behind", async () => {
    const stored = fakeSessionStorage();
    const vault = newVault();
    const { record } = makeRecord(vault, "a long passphrase", false);
    await vault.unlock(record, "a long passphrase");
    vault.rememberInTab(record.accountId);
    vault.lock();
    expect(stored.size).toBe(0);
    expect(newVault().restoreFromTab(record)).toBe(false);
  });

  it("forgets after a reload too: lock still clears what was restored", async () => {
    const stored = fakeSessionStorage();
    const first = newVault();
    const { record } = makeRecord(first, "a long passphrase", false);
    await first.unlock(record, "a long passphrase");
    first.rememberInTab(record.accountId);
    const second = newVault();
    expect(second.restoreFromTab(record)).toBe(true);
    second.lock();
    expect(stored.size).toBe(0);
  });

  it("refuses secrets that do not belong to this device and drops them", async () => {
    const stored = fakeSessionStorage();
    const vault = newVault();
    const mine = makeRecord(vault, "a long passphrase", false);
    await vault.unlock(mine.record, "a long passphrase");
    vault.rememberInTab(mine.record.accountId);
    // Another device (for example after the browser was reset) takes the same account slot.
    const other = makeRecord(newVault(), "another passphrase", false);
    const reloaded = newVault();
    expect(
      reloaded.restoreFromTab({ ...other.record, accountId: "account-1" }),
    ).toBe(false);
    expect(reloaded.unlocked).toBe(false);
    expect(stored.size).toBe(0);
  });

  it("does nothing, and does not fail, when sessionStorage is unavailable", async () => {
    const vault = newVault();
    const { record } = makeRecord(vault, "a long passphrase", false);
    await vault.unlock(record, "a long passphrase");
    expect(() => vault.rememberInTab(record.accountId)).not.toThrow();
    expect(newVault().restoreFromTab(record)).toBe(false);
  });
});

describe("one password for the person", () => {
  it("rewraps a record from its own passphrase to a random one and the keys survive", async () => {
    const vault = newVault();
    const { record, device, root } = makeRecord(
      vault,
      "old passphrase here",
      true,
    );
    const moved = vault.rewrap(
      record,
      "old passphrase here",
      "new random wrapper",
      OPTIONS,
    );
    const reader = newVault();
    await reader.unlock(moved, "new random wrapper");
    expect(reader.deviceKeys().signSecretKey).toEqual(device.signSecretKey);
    expect(reader.rootSecretKey()).toEqual(root.signSecretKey);
    // The old passphrase no longer opens it.
    await expect(
      newVault().unlock(moved, "old passphrase here"),
    ).rejects.toThrow();
  });

  it("writes a backup that only its recovery key opens, never the browser's own wrapper", async () => {
    const vault = newVault();
    const base = makeRecord(vault, "browser wrapper", true);
    const record = { ...base.record, autoPassphrase: "browser wrapper" };
    const key = Vault.newRecoveryKey((length) => crypto.randomBytes(length));
    const file = JSON.parse(vault.exportBackup(record, key, OPTIONS)) as {
      root: { wrapped: Parameters<Vault["unwrapSecret"]>[1] };
    };
    expect(vault.unwrapSecret(key, file.root.wrapped)).toEqual(
      base.root.signSecretKey,
    );
    expect(() =>
      vault.unwrapSecret("browser wrapper", file.root.wrapped),
    ).toThrow();
  });

  it("refuses to back up a browser that still has a passphrase of its own", () => {
    const vault = newVault();
    const { record } = makeRecord(vault, "a passphrase", true);
    expect(() => vault.exportBackup(record, "KEY", OPTIONS)).toThrow();
  });

  it("makes recovery keys people can write down, different every time", () => {
    const one = Vault.newRecoveryKey((length) => crypto.randomBytes(length));
    const two = Vault.newRecoveryKey((length) => crypto.randomBytes(length));
    expect(one).toMatch(/^([A-HJKMNP-Z2-9]{5}-){4}[A-HJKMNP-Z2-9]{5}$/);
    expect(one).not.toEqual(two);
  });
});
