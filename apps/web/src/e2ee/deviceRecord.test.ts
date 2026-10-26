import { fromBase64Url, toBase64Url, type DeviceKeys } from "@crewstead/crypto";
import { describe, expect, it } from "vitest";
import { newDeviceRecord, newSetupDraft, recoveryEntry } from "./deviceRecord";

function keys(seed: number): DeviceKeys {
  return {
    signPublicKey: new Uint8Array(4).fill(seed),
    signSecretKey: new Uint8Array(4).fill(seed + 1),
    boxPublicKey: new Uint8Array(4).fill(seed + 2),
    boxSecretKey: new Uint8Array(4).fill(seed + 3),
  };
}

/** Records every wrap so tests can see what was sealed under which passphrase. */
function recordingVault() {
  const wraps: { passphrase: string; secret: number[] }[] = [];
  const wrap = (passphrase: string, secret: Uint8Array) => {
    wraps.push({ passphrase, secret: [...secret] });
    return {
      version: 1 as const,
      salt: "s",
      opsLimit: 1,
      memLimit: 1,
      nonce: `n${wraps.length}`,
      ciphertext: "c",
    };
  };
  return {
    wraps,
    vault: {
      wrapDevice: (passphrase: string, device: DeviceKeys) =>
        wrap(
          passphrase,
          new Uint8Array([...device.signSecretKey, ...device.boxSecretKey]),
        ),
      wrapSecret: wrap,
    },
  };
}

describe("newDeviceRecord", () => {
  it("describes a registered device under its own passphrase", () => {
    const { vault, wraps } = recordingVault();
    const record = newDeviceRecord({
      vault,
      accountId: "acc",
      created: { id: "dev-1", name: "Navegador" },
      keys: keys(10),
      autoPassphrase: "pass",
      pinnedRoot: "root-key",
    });
    expect(record).toMatchObject({
      version: 1,
      accountId: "acc",
      deviceId: "dev-1",
      deviceName: "Navegador",
      pinnedRoot: "root-key",
      autoPassphrase: "pass",
      signPublicKey: toBase64Url(keys(10).signPublicKey),
      boxPublicKey: toBase64Url(keys(10).boxPublicKey),
    });
    expect(record.incomplete).toBeUndefined();
    expect(wraps).toEqual([
      { passphrase: "pass", secret: [11, 11, 11, 11, 13, 13, 13, 13] },
    ]);
  });
});

describe("recoveryEntry", () => {
  it("wraps sign then box secrets and keeps the public halves in the clear", () => {
    const { vault, wraps } = recordingVault();
    const entry = recoveryEntry(vault, "pass", keys(20), "rec-1");
    expect(entry.deviceId).toBe("rec-1");
    expect(entry.signPublicKey).toBe(toBase64Url(keys(20).signPublicKey));
    expect(entry.boxPublicKey).toBe(toBase64Url(keys(20).boxPublicKey));
    expect(wraps[0]?.secret).toEqual([21, 21, 21, 21, 23, 23, 23, 23]);
  });
});

describe("newSetupDraft", () => {
  it("draws the passphrase, root, device and recovery keys in that order", () => {
    const { vault, wraps } = recordingVault();
    let pair = 0;
    const order: string[] = [];
    const crypto = {
      generateDomainKey: () => {
        order.push("domain");
        return new Uint8Array(3).fill(9);
      },
      generateDeviceKeys: () => {
        order.push("pair");
        pair += 100;
        return keys(pair);
      },
    };
    const draft = newSetupDraft(vault, crypto, "acc");
    expect(order).toEqual(["domain", "pair", "pair", "pair"]);
    const passphrase = toBase64Url(new Uint8Array(3).fill(9));
    expect(draft).toMatchObject({
      version: 1,
      incomplete: true,
      accountId: "acc",
      deviceId: "",
      autoPassphrase: passphrase,
      pinnedRoot: toBase64Url(keys(100).signPublicKey),
      signPublicKey: toBase64Url(keys(200).signPublicKey),
      root: { publicKey: toBase64Url(keys(100).signPublicKey) },
      recovery: {
        deviceId: "",
        signPublicKey: toBase64Url(keys(300).signPublicKey),
      },
    });
    expect(fromBase64Url(draft.signPublicKey)).toEqual(keys(200).signPublicKey);
    // device, then root secret, then recovery halves, all under one passphrase
    expect(wraps.map((wrap) => wrap.passphrase)).toEqual([
      passphrase,
      passphrase,
      passphrase,
    ]);
    expect(wraps[1]?.secret).toEqual([101, 101, 101, 101]);
  });
});
