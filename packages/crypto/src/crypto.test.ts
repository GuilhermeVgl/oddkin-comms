import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createCrypto,
  CryptoError,
  type Crypto,
  type ContentContext,
} from "./index";

let c: Crypto;
beforeAll(async () => {
  c = await createCrypto(sodium);
});

const context: ContentContext = {
  organizationId: "org-1",
  domainId: "domain-1",
  resourceId: "task-1",
  authorId: "account-1",
  revision: 1,
};
const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function setup() {
  const author = c.generateDeviceKeys();
  const key = c.generateDomainKey();
  const envelope = c.encryptContent({
    key,
    generation: 3,
    context,
    plaintext: text("Título confidencial"),
    signerSecretKey: author.signSecretKey,
  });
  return { author, key, envelope };
}

function open(
  envelope: Uint8Array,
  key: Uint8Array,
  signerPublicKey: Uint8Array,
  ctx: ContentContext = context,
  generations: number[] = [3],
) {
  return c.decryptContent({
    keyForGeneration: (generation) =>
      generations.includes(generation) ? key : undefined,
    context: ctx,
    envelope,
    signerPublicKey,
  });
}

describe("content envelopes", () => {
  it("round-trips a payload with the right key, context and signer", () => {
    const { author, key, envelope } = setup();
    expect(decode(open(envelope, key, author.signPublicKey))).toBe(
      "Título confidencial",
    );
    expect(c.envelopeGeneration(envelope)).toBe(3);
  });

  it("never reuses a nonce for the same key", () => {
    const { author, key } = setup();
    const make = () =>
      c.encryptContent({
        key,
        generation: 3,
        context,
        plaintext: text("x"),
        signerSecretKey: author.signSecretKey,
      });
    expect(make().slice(6, 30)).not.toEqual(make().slice(6, 30));
  });

  it.each([
    ["organization", { organizationId: "org-2" }],
    ["domain", { domainId: "domain-2" }],
    ["resource (record swap)", { resourceId: "task-2" }],
    ["author", { authorId: "account-2" }],
    ["revision (replay of an old revision)", { revision: 2 }],
  ])("rejects an envelope moved to another %s", (_name, change) => {
    const { author, key, envelope } = setup();
    expect(() =>
      open(envelope, key, author.signPublicKey, { ...context, ...change }),
    ).toThrow(CryptoError);
  });

  it("rejects an envelope signed by someone else", () => {
    const { key, envelope } = setup();
    const stranger = c.generateDeviceKeys();
    expect(() => open(envelope, key, stranger.signPublicKey)).toThrow(
      /bad_signature/,
    );
  });

  it("rejects every single-byte modification", () => {
    const { author, key, envelope } = setup();
    for (let index = 0; index < envelope.length; index += 1) {
      const tampered = envelope.slice();
      tampered[index] = (tampered[index] ?? 0) ^ 0x01;
      expect(() => open(tampered, key, author.signPublicKey)).toThrow(
        CryptoError,
      );
    }
  });

  it("rejects truncation and an unknown protocol version", () => {
    const { author, key, envelope } = setup();
    expect(() =>
      open(envelope.slice(0, envelope.length - 1), key, author.signPublicKey),
    ).toThrow(CryptoError);
    expect(() =>
      open(envelope.slice(0, 20), key, author.signPublicKey),
    ).toThrow(/malformed/);
    const wrongVersion = envelope.slice();
    wrongVersion[0] = 2;
    expect(() => open(wrongVersion, key, author.signPublicKey)).toThrow(
      /malformed/,
    );
  });

  it("refuses to decrypt without the key of that generation", () => {
    const { author, key, envelope } = setup();
    expect(() =>
      open(envelope, key, author.signPublicKey, context, []),
    ).toThrow(/unknown_generation/);
  });

  it("does not decrypt with a different key even if correctly signed", () => {
    const author = c.generateDeviceKeys();
    const envelope = c.encryptContent({
      key: c.generateDomainKey(),
      generation: 3,
      context,
      plaintext: text("segredo"),
      signerSecretKey: author.signSecretKey,
    });
    expect(() =>
      open(envelope, c.generateDomainKey(), author.signPublicKey),
    ).toThrow(/decryption_failed/);
  });
});

describe("file streams", () => {
  it("encrypts bounded chunks and detects a moved or modified stream", () => {
    const key = c.generateDomainKey();
    const writer = c.createFileEncryptor(key, context);
    const first = writer.push(text("primeira parte "), false);
    const last = writer.push(text("e a última"), true);
    const reader = c.createFileDecryptor(key, writer.header, context);
    expect(decode(reader.pull(first).plaintext)).toBe("primeira parte ");
    const finished = reader.pull(last);
    expect(decode(finished.plaintext)).toBe("e a última");
    expect(finished.final).toBe(true);

    const tampered = last.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    const tamperedReader = c.createFileDecryptor(key, writer.header, context);
    tamperedReader.pull(first);
    expect(() => tamperedReader.pull(tampered)).toThrow(/decryption_failed/);

    const movedReader = c.createFileDecryptor(key, writer.header, {
      ...context,
      resourceId: "another-file",
    });
    expect(() => movedReader.pull(first)).toThrow(/decryption_failed/);
  });
});

describe("domain key envelopes", () => {
  function share() {
    const sender = c.generateDeviceKeys();
    const recipient = c.generateDeviceKeys();
    const key = c.generateDomainKey();
    const envelope = c.sealDomainKey({
      key,
      domainId: "domain-1",
      generation: 2,
      recipientDeviceId: "device-r",
      recipientBoxPublicKey: recipient.boxPublicKey,
      signerSecretKey: sender.signSecretKey,
    });
    return { sender, recipient, key, envelope };
  }
  const base = {
    domainId: "domain-1",
    generation: 2,
    recipientDeviceId: "device-r",
  };

  it("is opened only by the intended device, sent by the expected sender", () => {
    const { sender, recipient, key, envelope } = share();
    expect(
      c.openDomainKey({
        ...base,
        envelope,
        recipient,
        signerPublicKey: sender.signPublicKey,
      }),
    ).toEqual(key);
    const other = c.generateDeviceKeys();
    expect(() =>
      c.openDomainKey({
        ...base,
        envelope,
        recipient: other,
        signerPublicKey: sender.signPublicKey,
      }),
    ).toThrow(CryptoError);
  });

  it("rejects an envelope the server re-labelled for another domain, generation or device", () => {
    const { sender, recipient, envelope } = share();
    for (const change of [
      { domainId: "domain-2" },
      { generation: 3 },
      { recipientDeviceId: "device-x" },
    ]) {
      expect(() =>
        c.openDomainKey({
          ...base,
          ...change,
          envelope,
          recipient,
          signerPublicKey: sender.signPublicKey,
        }),
      ).toThrow(/bad_signature/);
    }
  });

  it("rejects an envelope injected by someone who is not a trusted sender", () => {
    const { recipient, envelope } = share();
    const server = c.generateDeviceKeys();
    expect(() =>
      c.openDomainKey({
        ...base,
        envelope,
        recipient,
        signerPublicKey: server.signPublicKey,
      }),
    ).toThrow(/bad_signature/);
  });

  it("rejects a sealed box that the server swapped for its own key", () => {
    const { sender, recipient } = share();
    const forgedKey = c.generateDomainKey();
    const forged = c.sealDomainKey({
      key: forgedKey,
      domainId: "domain-1",
      generation: 2,
      recipientDeviceId: "device-r",
      recipientBoxPublicKey: recipient.boxPublicKey,
      signerSecretKey: c.generateDeviceKeys().signSecretKey,
    });
    expect(() =>
      c.openDomainKey({
        ...base,
        envelope: forged,
        recipient,
        signerPublicKey: sender.signPublicKey,
      }),
    ).toThrow(/bad_signature/);
  });
});

describe("device certificates", () => {
  const fields = (keys: ReturnType<Crypto["generateDeviceKeys"]>) => ({
    accountId: "account-1",
    deviceId: "device-1",
    signPublicKey: keys.signPublicKey,
    boxPublicKey: keys.boxPublicKey,
  });

  it("verifies only for the exact device keys and account", () => {
    const root = c.generateDeviceKeys();
    const device = c.generateDeviceKeys();
    const certificate = c.signDeviceCertificate(
      root.signSecretKey,
      fields(device),
    );
    expect(
      c.verifyDeviceCertificate(
        root.signPublicKey,
        fields(device),
        certificate,
      ),
    ).toBe(true);
    expect(
      c.verifyDeviceCertificate(
        root.signPublicKey,
        { ...fields(device), accountId: "account-2" },
        certificate,
      ),
    ).toBe(false);
    const substituted = {
      ...fields(device),
      boxPublicKey: c.generateDeviceKeys().boxPublicKey,
    };
    expect(
      c.verifyDeviceCertificate(root.signPublicKey, substituted, certificate),
    ).toBe(false);
    expect(
      c.verifyDeviceCertificate(
        c.generateDeviceKeys().signPublicKey,
        fields(device),
        certificate,
      ),
    ).toBe(false);
    expect(
      c.verifyDeviceCertificate(
        root.signPublicKey,
        fields(device),
        certificate.slice(0, 10),
      ),
    ).toBe(false);
  });

  it("formats fingerprints for out-of-band comparison", () => {
    const { signPublicKey } = c.generateDeviceKeys();
    expect(c.fingerprint(signPublicKey)).toMatch(
      /^([0-9a-f]{4} ){7}[0-9a-f]{4}$/,
    );
    expect(c.fingerprint(signPublicKey)).toBe(c.fingerprint(signPublicKey));
  });
});
