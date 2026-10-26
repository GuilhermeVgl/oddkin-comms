import type sodiumNamespace from "libsodium-wrappers-sumo";
import {
  concat,
  fromBase64Url,
  lengthPrefixed,
  readU32,
  toBase64Url,
  u32,
  utf8,
} from "./encoding";

export { fromBase64Url, toBase64Url } from "./encoding";
export {
  createKeystore,
  PassphraseError,
  type WrappedSecret,
} from "./keystore";
export { createChainVerifier, type DirectoryRecord } from "./chain";

type Sodium = typeof sodiumNamespace;

export const PROTOCOL_VERSION = 1;
const SUITE_XCHACHA20_POLY1305 = 1;
const HEADER_LENGTH = 2 + 4 + 24;
const SIGNATURE_LENGTH = 64;
const KEY_LENGTH = 32;

export type CryptoErrorCode =
  | "malformed"
  | "bad_signature"
  | "unknown_generation"
  | "decryption_failed"
  | "context_mismatch";

/** Deliberately uninformative: callers must not learn which byte was wrong. */
export class CryptoError extends Error {
  constructor(readonly code: CryptoErrorCode) {
    super(`crypto failure: ${code}`);
  }
}

export type DeviceKeys = {
  signPublicKey: Uint8Array;
  signSecretKey: Uint8Array;
  boxPublicKey: Uint8Array;
  boxSecretKey: Uint8Array;
};

/** Everything an encrypted record is bound to; swapping any field breaks decryption. */
export type ContentContext = {
  organizationId: string;
  domainId: string;
  resourceId: string;
  authorId: string;
  revision: number;
};

export type DeviceCertificateFields = {
  accountId: string;
  deviceId: string;
  signPublicKey: Uint8Array;
  boxPublicKey: Uint8Array;
};

export type SealedDomainKey = { sealed: Uint8Array; signature: Uint8Array };

export type FileEncryptor = {
  /** Public stream header; it is bound into the signed file manifest. */
  header: Uint8Array;
  push(chunk: Uint8Array, final: boolean): Uint8Array;
};

export type FileDecryptor = {
  pull(chunk: Uint8Array): { plaintext: Uint8Array; final: boolean };
};

export type CryptoOptions = {
  /** Replace the random source. Tests only: production uses libsodium's CSPRNG. */
  randomBytes?: (length: number) => Uint8Array;
};

function contentAad(context: ContentContext): Uint8Array {
  return lengthPrefixed(
    utf8("crewstead/v1/content"),
    utf8(context.organizationId),
    utf8(context.domainId),
    utf8(context.resourceId),
    utf8(context.authorId),
    utf8(String(context.revision)),
  );
}

export function deviceCertificateBytes(
  fields: DeviceCertificateFields,
): Uint8Array {
  return lengthPrefixed(
    utf8("crewstead/v1/device-cert"),
    utf8(fields.accountId),
    utf8(fields.deviceId),
    fields.signPublicKey,
    fields.boxPublicKey,
  );
}

export function keyEnvelopeSignatureBytes(input: {
  recipientDeviceId: string;
  domainId: string;
  generation: number;
  sealed: Uint8Array;
}): Uint8Array {
  return lengthPrefixed(
    utf8("crewstead/v1/key-sig"),
    utf8(input.recipientDeviceId),
    utf8(input.domainId),
    u32(input.generation),
    input.sealed,
  );
}

export async function createCrypto(
  sodium: Sodium,
  options: CryptoOptions = {},
) {
  await sodium.ready;
  const random =
    options.randomBytes ?? ((length: number) => sodium.randombytes_buf(length));

  function generateDeviceKeys(): DeviceKeys {
    const sign = sodium.crypto_sign_keypair();
    const box = sodium.crypto_box_keypair();
    return {
      signPublicKey: sign.publicKey,
      signSecretKey: sign.privateKey,
      boxPublicKey: box.publicKey,
      boxSecretKey: box.privateKey,
    };
  }

  function generateDomainKey(): Uint8Array {
    return random(KEY_LENGTH);
  }

  /**
   * Creates the sequential XChaCha20-Poly1305 stream used by a file worker.
   * Every chunk is bound to the same record context. Callers persist the
   * returned header in a signed manifest and send only the ciphertext chunks.
   */
  function createFileEncryptor(
    key: Uint8Array,
    context: ContentContext,
  ): FileEncryptor {
    if (key.length !== sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES)
      throw new CryptoError("malformed");
    const { state, header } =
      sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    const aad = contentAad(context);
    let complete = false;
    return {
      header,
      push(chunk, final) {
        if (complete) throw new CryptoError("malformed");
        complete = final;
        return sodium.crypto_secretstream_xchacha20poly1305_push(
          state,
          chunk,
          aad,
          final
            ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
            : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        );
      },
    };
  }

  /** Opens chunks in order and rejects moved, modified or truncated streams. */
  function createFileDecryptor(
    key: Uint8Array,
    header: Uint8Array,
    context: ContentContext,
  ): FileDecryptor {
    if (
      key.length !== sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES ||
      header.length !== sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES
    ) {
      throw new CryptoError("malformed");
    }
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
      header,
      key,
    );
    const aad = contentAad(context);
    let complete = false;
    return {
      pull(chunk) {
        if (complete) throw new CryptoError("malformed");
        const opened = sodium.crypto_secretstream_xchacha20poly1305_pull(
          state,
          chunk,
          aad,
        );
        if (opened === false) throw new CryptoError("decryption_failed");
        complete =
          opened.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
        return { plaintext: opened.message, final: complete };
      },
    };
  }

  /** Signed by the trust root or an already authorized device of the same account. */
  function signDeviceCertificate(
    signerSecretKey: Uint8Array,
    fields: DeviceCertificateFields,
  ) {
    return sodium.crypto_sign_detached(
      deviceCertificateBytes(fields),
      signerSecretKey,
    );
  }

  function verifyDeviceCertificate(
    signerPublicKey: Uint8Array,
    fields: DeviceCertificateFields,
    certificate: Uint8Array,
  ): boolean {
    try {
      return sodium.crypto_sign_verify_detached(
        certificate,
        deviceCertificateBytes(fields),
        signerPublicKey,
      );
    } catch {
      return false;
    }
  }

  function fingerprint(publicKey: Uint8Array): string {
    const digest = sodium.crypto_generichash(16, publicKey, null);
    return sodium.to_hex(digest).replace(/(.{4})(?=.)/g, "$1 ");
  }

  /**
   * Encrypts a small payload with the domain key of `generation`, binds it to
   * its context and signs it with the author's device key.
   */
  function encryptContent(input: {
    key: Uint8Array;
    generation: number;
    context: ContentContext;
    plaintext: Uint8Array;
    signerSecretKey: Uint8Array;
  }): Uint8Array {
    if (input.key.length !== KEY_LENGTH) throw new CryptoError("malformed");
    const nonce = random(24);
    const header = concat(
      new Uint8Array([PROTOCOL_VERSION, SUITE_XCHACHA20_POLY1305]),
      u32(input.generation),
      nonce,
    );
    const aad = contentAad(input.context);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      input.plaintext,
      lengthPrefixed(header.subarray(0, 6), aad),
      null,
      nonce,
      input.key,
    );
    const signature = sodium.crypto_sign_detached(
      lengthPrefixed(utf8("crewstead/v1/content-sig"), header, aad, ciphertext),
      input.signerSecretKey,
    );
    return concat(header, ciphertext, signature);
  }

  function envelopeGeneration(envelope: Uint8Array): number {
    if (envelope.length < HEADER_LENGTH + 16 + SIGNATURE_LENGTH)
      throw new CryptoError("malformed");
    if (
      envelope[0] !== PROTOCOL_VERSION ||
      envelope[1] !== SUITE_XCHACHA20_POLY1305
    ) {
      throw new CryptoError("malformed");
    }
    return readU32(envelope, 2);
  }

  /** Verifies the author's signature first, then decrypts. Returns plaintext only if both hold. */
  function decryptContent(input: {
    keyForGeneration: (generation: number) => Uint8Array | undefined;
    context: ContentContext;
    envelope: Uint8Array;
    signerPublicKey: Uint8Array;
  }): Uint8Array {
    const generation = envelopeGeneration(input.envelope);
    const header = input.envelope.subarray(0, HEADER_LENGTH);
    const ciphertext = input.envelope.subarray(
      HEADER_LENGTH,
      input.envelope.length - SIGNATURE_LENGTH,
    );
    const signature = input.envelope.subarray(
      input.envelope.length - SIGNATURE_LENGTH,
    );
    const aad = contentAad(input.context);
    let signed: boolean;
    try {
      signed = sodium.crypto_sign_verify_detached(
        signature,
        lengthPrefixed(
          utf8("crewstead/v1/content-sig"),
          header,
          aad,
          ciphertext,
        ),
        input.signerPublicKey,
      );
    } catch {
      signed = false;
    }
    if (!signed) throw new CryptoError("bad_signature");
    const key = input.keyForGeneration(generation);
    if (key === undefined) throw new CryptoError("unknown_generation");
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        lengthPrefixed(header.subarray(0, 6), aad),
        header.subarray(6),
        key,
      );
    } catch {
      throw new CryptoError("decryption_failed");
    }
  }

  /** Seals a domain key for one device and signs the result as the sending device. */
  function sealDomainKey(input: {
    key: Uint8Array;
    domainId: string;
    generation: number;
    recipientDeviceId: string;
    recipientBoxPublicKey: Uint8Array;
    signerSecretKey: Uint8Array;
  }): SealedDomainKey {
    const payload = lengthPrefixed(
      utf8("crewstead/v1/key"),
      utf8(input.domainId),
      u32(input.generation),
      input.key,
    );
    const sealed = sodium.crypto_box_seal(payload, input.recipientBoxPublicKey);
    const signature = sodium.crypto_sign_detached(
      keyEnvelopeSignatureBytes({
        recipientDeviceId: input.recipientDeviceId,
        domainId: input.domainId,
        generation: input.generation,
        sealed,
      }),
      input.signerSecretKey,
    );
    return { sealed, signature };
  }

  /** Opens a sealed domain key after checking who sent it and what it is for. */
  function openDomainKey(input: {
    envelope: SealedDomainKey;
    domainId: string;
    generation: number;
    recipientDeviceId: string;
    recipient: Pick<DeviceKeys, "boxPublicKey" | "boxSecretKey">;
    signerPublicKey: Uint8Array;
  }): Uint8Array {
    let signed: boolean;
    try {
      signed = sodium.crypto_sign_verify_detached(
        input.envelope.signature,
        keyEnvelopeSignatureBytes({
          recipientDeviceId: input.recipientDeviceId,
          domainId: input.domainId,
          generation: input.generation,
          sealed: input.envelope.sealed,
        }),
        input.signerPublicKey,
      );
    } catch {
      signed = false;
    }
    if (!signed) throw new CryptoError("bad_signature");
    let payload: Uint8Array;
    try {
      payload = sodium.crypto_box_seal_open(
        input.envelope.sealed,
        input.recipient.boxPublicKey,
        input.recipient.boxSecretKey,
      );
    } catch {
      throw new CryptoError("decryption_failed");
    }
    const expected = lengthPrefixed(
      utf8("crewstead/v1/key"),
      utf8(input.domainId),
      u32(input.generation),
      payload.subarray(payload.length - KEY_LENGTH),
    );
    if (
      payload.length !== expected.length ||
      !sodium.memcmp(payload, expected)
    ) {
      throw new CryptoError("context_mismatch");
    }
    return payload.slice(payload.length - KEY_LENGTH);
  }

  return {
    generateDeviceKeys,
    generateDomainKey,
    createFileEncryptor,
    createFileDecryptor,
    signDeviceCertificate,
    verifyDeviceCertificate,
    fingerprint,
    encryptContent,
    decryptContent,
    sealDomainKey,
    openDomainKey,
    envelopeGeneration,
    toBase64Url,
    fromBase64Url,
  };
}

export type Crypto = Awaited<ReturnType<typeof createCrypto>>;

/** Loads libsodium lazily so the code only ships when encryption is used. */
export async function loadSodium(): Promise<Sodium> {
  return (await import("libsodium-wrappers-sumo")).default;
}

export * from "./files";
