import { readFileSync, writeFileSync } from "node:fs";
import sodium from "libsodium-wrappers-sumo";
import { describe, expect, it } from "vitest";
import {
  createCrypto,
  CryptoError,
  fromBase64Url,
  toBase64Url,
  type ContentContext,
} from "./index";

const path = new URL("../vectors.json", import.meta.url);
const b64 = toBase64Url;

// Fixed keys and nonce so every implementation can reproduce the same bytes.
// These are synthetic test keys and never used anywhere else.
function seeded(label: string): Uint8Array {
  return sodium.crypto_generichash(32, label, null);
}

async function build() {
  await sodium.ready;
  let counter = 0;
  const c = await createCrypto(sodium, {
    randomBytes: (length) => {
      counter += 1;
      return sodium.crypto_generichash(
        length,
        `vector-random-${counter}`,
        null,
      );
    },
  });
  const root = sodium.crypto_sign_seed_keypair(seeded("root-signing"));
  const sender = sodium.crypto_sign_seed_keypair(seeded("sender-signing"));
  const recipientBox = sodium.crypto_box_seed_keypair(seeded("recipient-box"));
  const deviceSign = sodium.crypto_sign_seed_keypair(seeded("device-signing"));
  const deviceBox = sodium.crypto_box_seed_keypair(seeded("device-box"));

  const certificateFields = {
    accountId: "00000000-0000-4000-8000-0000000000a1",
    deviceId: "00000000-0000-4000-8000-0000000000d1",
    signPublicKey: deviceSign.publicKey,
    boxPublicKey: deviceBox.publicKey,
  };
  const certificate = c.signDeviceCertificate(
    root.privateKey,
    certificateFields,
  );

  const context: ContentContext = {
    organizationId: "00000000-0000-4000-8000-0000000000f1",
    domainId: "00000000-0000-4000-8000-0000000000e1",
    resourceId: "00000000-0000-4000-8000-0000000000b1",
    authorId: certificateFields.accountId,
    revision: 7,
  };
  const key = c.generateDomainKey();
  const plaintext = "Título da atividade — ação";
  const envelope = c.encryptContent({
    key,
    generation: 4,
    context,
    plaintext: new TextEncoder().encode(plaintext),
    signerSecretKey: sender.privateKey,
  });

  const recipientDeviceId = "00000000-0000-4000-8000-0000000000d2";
  const sealed = c.sealDomainKey({
    key,
    domainId: context.domainId,
    generation: 4,
    recipientDeviceId,
    recipientBoxPublicKey: recipientBox.publicKey,
    signerSecretKey: sender.privateKey,
  });

  return {
    c,
    vectors: {
      protocolVersion: 1,
      note: "Synthetic test vectors for the Crewstead envelope protocol v1. Regenerate with UPDATE_VECTORS=1.",
      rootSignPublicKey: b64(root.publicKey),
      senderSignPublicKey: b64(sender.publicKey),
      deviceCertificate: {
        accountId: certificateFields.accountId,
        deviceId: certificateFields.deviceId,
        signPublicKey: b64(deviceSign.publicKey),
        boxPublicKey: b64(deviceBox.publicKey),
        certificate: b64(certificate),
      },
      contentEnvelope: {
        context,
        generation: 4,
        domainKey: b64(key),
        plaintext,
        envelope: b64(envelope),
      },
      keyEnvelope: {
        domainId: context.domainId,
        generation: 4,
        recipientDeviceId,
        recipientBoxPublicKey: b64(recipientBox.publicKey),
        recipientBoxSecretKey: b64(recipientBox.privateKey),
        domainKey: b64(key),
        sealed: b64(sealed.sealed),
        signature: b64(sealed.signature),
      },
    },
    parts: { sender, recipientBox, context, key },
  };
}

describe("protocol vectors", () => {
  it("match the committed file (UPDATE_VECTORS=1 regenerates it)", async () => {
    const { vectors } = await build();
    if (process.env["UPDATE_VECTORS"] === "1") {
      writeFileSync(path, `${JSON.stringify(vectors, null, 2)}\n`);
    }
    const stored = JSON.parse(readFileSync(path, "utf8")) as typeof vectors;
    // crypto_box_seal draws a fresh ephemeral key, so the sealed bytes and the
    // signature over them are checked by opening them (next test), not by equality.
    const comparable = (value: typeof vectors) => ({
      ...value,
      keyEnvelope: { ...value.keyEnvelope, sealed: "", signature: "" },
    });
    expect(comparable(stored)).toEqual(comparable(vectors));
  });

  it("open with an independent instance of the library", async () => {
    const stored = JSON.parse(readFileSync(path, "utf8")) as Awaited<
      ReturnType<typeof build>
    >["vectors"];
    const c = await createCrypto(sodium);
    const root = fromBase64Url(stored.rootSignPublicKey);
    const device = stored.deviceCertificate;
    expect(
      c.verifyDeviceCertificate(
        root,
        {
          accountId: device.accountId,
          deviceId: device.deviceId,
          signPublicKey: fromBase64Url(device.signPublicKey),
          boxPublicKey: fromBase64Url(device.boxPublicKey),
        },
        fromBase64Url(device.certificate),
      ),
    ).toBe(true);

    const content = stored.contentEnvelope;
    const domainKey = fromBase64Url(content.domainKey);
    const plaintext = c.decryptContent({
      keyForGeneration: (generation) =>
        generation === content.generation ? domainKey : undefined,
      context: content.context,
      envelope: fromBase64Url(content.envelope),
      signerPublicKey: fromBase64Url(stored.senderSignPublicKey),
    });
    expect(new TextDecoder().decode(plaintext)).toBe(content.plaintext);

    const keyVector = stored.keyEnvelope;
    const opened = c.openDomainKey({
      envelope: {
        sealed: fromBase64Url(keyVector.sealed),
        signature: fromBase64Url(keyVector.signature),
      },
      domainId: keyVector.domainId,
      generation: keyVector.generation,
      recipientDeviceId: keyVector.recipientDeviceId,
      recipient: {
        boxPublicKey: fromBase64Url(keyVector.recipientBoxPublicKey),
        boxSecretKey: fromBase64Url(keyVector.recipientBoxSecretKey),
      },
      signerPublicKey: fromBase64Url(stored.senderSignPublicKey),
    });
    expect(b64(opened)).toBe(keyVector.domainKey);
  });

  it("fail for the documented negative cases", async () => {
    const stored = JSON.parse(readFileSync(path, "utf8")) as Awaited<
      ReturnType<typeof build>
    >["vectors"];
    const c = await createCrypto(sodium);
    const content = stored.contentEnvelope;
    const domainKey = fromBase64Url(content.domainKey);
    const attempt = (change: Partial<ContentContext>) => () =>
      c.decryptContent({
        keyForGeneration: () => domainKey,
        context: { ...content.context, ...change },
        envelope: fromBase64Url(content.envelope),
        signerPublicKey: fromBase64Url(stored.senderSignPublicKey),
      });
    expect(attempt({ revision: 8 })).toThrow(CryptoError);
    expect(
      attempt({ resourceId: "00000000-0000-4000-8000-0000000000b2" }),
    ).toThrow(CryptoError);
  });
});
