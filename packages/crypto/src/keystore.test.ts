import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createChainVerifier,
  createCrypto,
  createKeystore,
  PassphraseError,
  toBase64Url,
  type Crypto,
  type DirectoryRecord,
} from "./index";

let c: Crypto;
let keystore: ReturnType<typeof createKeystore>;
// Cheap parameters keep the suite fast; production uses libsodium's moderate profile.
const cheap = { opsLimit: 2, memLimit: 8 * 1024 * 1024 };

beforeAll(async () => {
  await sodium.ready;
  c = await createCrypto(sodium);
  keystore = createKeystore(sodium);
});

describe("passphrase keystore", () => {
  it("round-trips a secret and rejects wrong passphrases", () => {
    const secret = sodium.randombytes_buf(64);
    const wrapped = keystore.wrap(
      "correct horse battery staple",
      secret,
      cheap,
    );
    expect(keystore.unwrap("correct horse battery staple", wrapped)).toEqual(
      secret,
    );
    expect(() =>
      keystore.unwrap("another passphrase entirely", wrapped),
    ).toThrow(PassphraseError);
  });

  it("refuses short passphrases and detects tampering", () => {
    expect(() => keystore.wrap("short", new Uint8Array(32), cheap)).toThrow(
      /too_short/,
    );
    const wrapped = keystore.wrap(
      "correct horse battery staple",
      new Uint8Array(32),
      cheap,
    );
    const flipped = {
      ...wrapped,
      ciphertext: toBase64Url(
        Uint8Array.from(
          sodium.from_base64(
            wrapped.ciphertext,
            sodium.base64_variants.URLSAFE_NO_PADDING,
          ),
          (b, i) => (i === 0 ? b ^ 1 : b),
        ),
      ),
    };
    expect(() =>
      keystore.unwrap("correct horse battery staple", flipped),
    ).toThrow(PassphraseError);
  });

  it("uses a fresh salt and nonce every time and never stores the secret in clear", () => {
    const secret = new Uint8Array(32).fill(7);
    const a = keystore.wrap("correct horse battery staple", secret, cheap);
    const b = keystore.wrap("correct horse battery staple", secret, cheap);
    expect(a.salt).not.toBe(b.salt);
    expect(a.nonce).not.toBe(b.nonce);
    expect(JSON.stringify(a)).not.toContain(toBase64Url(secret));
  });
});

describe("certificate chains", () => {
  function record(
    id: string,
    account: string,
    keys: ReturnType<Crypto["generateDeviceKeys"]>,
    signerSecret: Uint8Array,
    authorizer?: string,
  ): DirectoryRecord {
    const certificate = c.signDeviceCertificate(signerSecret, {
      accountId: account,
      deviceId: id,
      signPublicKey: keys.signPublicKey,
      boxPublicKey: keys.boxPublicKey,
    });
    return {
      deviceId: id,
      accountId: account,
      signPublicKey: toBase64Url(keys.signPublicKey),
      boxPublicKey: toBase64Url(keys.boxPublicKey),
      certificate: toBase64Url(certificate),
      authorizerDeviceId: authorizer,
    };
  }

  it("trusts root-signed devices and devices vouched for by a trusted device of the same account", async () => {
    const root = c.generateDeviceKeys();
    const first = c.generateDeviceKeys();
    const second = c.generateDeviceKeys();
    const firstRecord = record("d1", "a1", first, root.signSecretKey);
    const secondRecord = record("d2", "a1", second, first.signSecretKey, "d1");
    const directory = new Map([
      ["d1", firstRecord],
      ["d2", secondRecord],
    ]);
    const chain = createChainVerifier(c, root.signPublicKey, async (id) =>
      directory.get(id),
    );
    expect(await chain.trusted(firstRecord)).toBe(true);
    expect(await chain.trusted(secondRecord)).toBe(true);
  });

  it("rejects a device that the server added with its own key", async () => {
    const root = c.generateDeviceKeys();
    const intruder = c.generateDeviceKeys();
    const forgedRoot = c.generateDeviceKeys();
    const forged = record("d9", "a1", intruder, forgedRoot.signSecretKey);
    const chain = createChainVerifier(
      c,
      root.signPublicKey,
      async () => undefined,
    );
    expect(await chain.trusted(forged)).toBe(false);
  });

  it("rejects an authorizer from another account and an authorizer whose own chain is broken", async () => {
    const root = c.generateDeviceKeys();
    const other = c.generateDeviceKeys();
    const device = c.generateDeviceKeys();
    const otherRecord = record("o1", "a2", other, root.signSecretKey);
    const crossAccount = record("d3", "a1", device, other.signSecretKey, "o1");
    const orphan = c.generateDeviceKeys();
    const orphanRecord = record(
      "x1",
      "a1",
      orphan,
      c.generateDeviceKeys().signSecretKey,
    );
    const child = record("d4", "a1", device, orphan.signSecretKey, "x1");
    const directory = new Map([
      ["o1", otherRecord],
      ["x1", orphanRecord],
    ]);
    const chain = createChainVerifier(c, root.signPublicKey, async (id) =>
      directory.get(id),
    );
    expect(await chain.trusted(crossAccount)).toBe(false);
    expect(await chain.trusted(child)).toBe(false);
  });

  it("stops on cycles", async () => {
    const root = c.generateDeviceKeys();
    const a = c.generateDeviceKeys();
    const b = c.generateDeviceKeys();
    const aRecord = record("a", "acc", a, b.signSecretKey, "b");
    const bRecord = record("b", "acc", b, a.signSecretKey, "a");
    const directory = new Map([
      ["a", aRecord],
      ["b", bRecord],
    ]);
    const chain = createChainVerifier(c, root.signPublicKey, async (id) =>
      directory.get(id),
    );
    expect(await chain.trusted(aRecord)).toBe(false);
  });
});
