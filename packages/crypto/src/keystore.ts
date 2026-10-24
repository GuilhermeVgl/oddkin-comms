import type sodiumNamespace from "libsodium-wrappers-sumo";
import { fromBase64Url, toBase64Url } from "./encoding";

type Sodium = typeof sodiumNamespace;

/**
 * A secret protected by a passphrase: Argon2id derives the key, XSalsa20-
 * Poly1305 seals it. The passphrase never leaves the device and is not the
 * login password, so the server cannot derive it.
 */
export type WrappedSecret = {
  version: 1;
  salt: string;
  opsLimit: number;
  memLimit: number;
  nonce: string;
  ciphertext: string;
};

export type WrapOptions = {
  /** Cost parameters; defaults are libsodium's "moderate" profile. */
  opsLimit?: number;
  memLimit?: number;
};

const MIN_PASSPHRASE = 12;

export class PassphraseError extends Error {
  constructor(readonly reason: "too_short" | "wrong") {
    super(`passphrase ${reason}`);
  }
}

export function createKeystore(sodium: Sodium) {
  function derive(
    passphrase: string,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
  ) {
    return sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      passphrase.normalize("NFKC"),
      salt,
      opsLimit,
      memLimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  }

  function wrap(
    passphrase: string,
    secret: Uint8Array,
    options: WrapOptions = {},
  ): WrappedSecret {
    if (passphrase.length < MIN_PASSPHRASE)
      throw new PassphraseError("too_short");
    const opsLimit = options.opsLimit ?? sodium.crypto_pwhash_OPSLIMIT_MODERATE;
    const memLimit = options.memLimit ?? sodium.crypto_pwhash_MEMLIMIT_MODERATE;
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const key = derive(passphrase, salt, opsLimit, memLimit);
    const ciphertext = sodium.crypto_secretbox_easy(secret, nonce, key);
    sodium.memzero(key);
    return {
      version: 1,
      salt: toBase64Url(salt),
      opsLimit,
      memLimit,
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(ciphertext),
    };
  }

  /** Throws PassphraseError("wrong") for a wrong passphrase or a modified blob. */
  function unwrap(passphrase: string, wrapped: WrappedSecret): Uint8Array {
    if (wrapped.version !== 1) throw new PassphraseError("wrong");
    const key = derive(
      passphrase,
      fromBase64Url(wrapped.salt),
      wrapped.opsLimit,
      wrapped.memLimit,
    );
    try {
      return sodium.crypto_secretbox_open_easy(
        fromBase64Url(wrapped.ciphertext),
        fromBase64Url(wrapped.nonce),
        key,
      );
    } catch {
      throw new PassphraseError("wrong");
    } finally {
      sodium.memzero(key);
    }
  }

  return { wrap, unwrap };
}
