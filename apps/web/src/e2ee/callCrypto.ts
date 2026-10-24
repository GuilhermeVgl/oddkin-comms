import {
  ApiStatusError,
  listCallKeyDevices,
  listCallKeyEnvelopes,
  publishCallKey,
  type Call,
  type DirectoryDevice,
  type createApiClient,
} from "@oddkin/api-client";
import { CryptoError, fromBase64Url, toBase64Url, type Crypto } from "@oddkin/crypto";
import type { Keyring } from "./keyring";
import type { Vault } from "./vault";

type Client = ReturnType<typeof createApiClient>;

/**
 * Opens and rotates an ephemeral shared media key. The server receives only
 * sealed envelopes and cannot replay one under another call or generation.
 */
export class CallCrypto {
  constructor(
    private readonly client: Client,
    private readonly crypto: Crypto,
    private readonly vault: Vault,
    private readonly keyring: Keyring,
    readonly deviceId: string,
    private readonly csrf: () => string,
  ) {}

  private readonly keys = new Map<string, Map<number, Uint8Array>>();

  private cache(callId: string): Map<number, Uint8Array> {
    let keys = this.keys.get(callId);
    if (keys === undefined) {
      keys = new Map();
      this.keys.set(callId, keys);
    }
    return keys;
  }

  private async open(callId: string, generation: number): Promise<Uint8Array | null> {
    const known = this.cache(callId);
    const cached = known.get(generation);
    if (cached !== undefined) return cached;
    const envelope = (await listCallKeyEnvelopes(this.client, callId)).find(
      (candidate) =>
        candidate.generation === generation &&
        candidate.recipientDeviceId === this.deviceId,
    );
    if (envelope === undefined) return null;
    const signer = await this.keyring.trusted(envelope.signerDeviceId);
    if (signer === undefined) return null;
    try {
      const key = this.crypto.openDomainKey({
        envelope: {
          sealed: fromBase64Url(envelope.sealed),
          signature: fromBase64Url(envelope.signature),
        },
        domainId: `call:${callId}`,
        generation,
        recipientDeviceId: this.deviceId,
        recipient: this.vault.deviceKeys(),
        signerPublicKey: fromBase64Url(signer.signPublicKey),
      });
      known.set(generation, key);
      return key;
    } catch (error) {
      if (error instanceof CryptoError) return null;
      throw error;
    }
  }

  private async seal(
    callId: string,
    generation: number,
    key: Uint8Array,
    devices: DirectoryDevice[],
  ) {
    const signerSecretKey = this.vault.deviceKeys().signSecretKey;
    return Promise.all(
      devices.map(async (device) => {
        if ((await this.keyring.trusted(device.deviceId)) === undefined)
          throw new Error("untrusted call device");
        const envelope = this.crypto.sealDomainKey({
          key,
          domainId: `call:${callId}`,
          generation,
          recipientDeviceId: device.deviceId,
          recipientBoxPublicKey: fromBase64Url(device.boxPublicKey),
          signerSecretKey,
        });
        return {
          recipientDeviceId: device.deviceId,
          sealed: toBase64Url(envelope.sealed),
          signature: toBase64Url(envelope.signature),
        };
      }),
    );
  }

  /** Returns the active key, electing this device to publish a missing rotation. */
  async keyFor(call: Call): Promise<Uint8Array> {
    if (call.keyGeneration > 0) {
      const current = await this.open(call.id, call.keyGeneration);
      if (current !== null && call.keyState === "ok") return current;
    }
    const generation = call.keyGeneration + 1;
    const key = this.crypto.generateDomainKey();
    const recipients = await listCallKeyDevices(this.client, call.id);
    const envelopes = await this.seal(call.id, generation, key, recipients);
    try {
      await publishCallKey(
        this.client,
        this.csrf(),
        call.id,
        generation,
        this.deviceId,
        envelopes,
      );
      this.cache(call.id).set(generation, key);
      return key;
    } catch (error) {
      // A second participant often wins this harmless election. Open its
      // envelope instead; never fall back to plaintext media.
      if (!(error instanceof ApiStatusError) || error.status !== 409) throw error;
      const winner = await this.open(call.id, generation);
      if (winner !== null) return winner;
      throw new Error("media key rotation is still pending");
    }
  }
}
