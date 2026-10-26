import {
  CryptoError,
  createChainVerifier,
  fromBase64Url,
  toBase64Url,
  type Crypto,
  type DirectoryRecord,
} from "@crewstead/crypto";
import {
  createKeyDomain,
  getDeviceRecord,
  grantKeyEnvelopes,
  grantRecoveryEnvelopes,
  listRecoveryEnvelopes,
  listRecoveryGaps,
  listAuthorizedDevices,
  listKeyDomains,
  listKeyRecipients,
  listMyKeyEnvelopes,
  publishKeyGeneration,
  type createApiClient,
  type DirectoryDevice,
  type EnvelopeInput,
  type KeyDomain,
  type RecoveryGap,
} from "@crewstead/api-client";
import type { Vault } from "./vault";

type Client = ReturnType<typeof createApiClient>;
export type DomainKind = "work" | "chat" | "dm" | "sprint" | "files";

/** A device the server listed whose certificate chain does not reach the pinned root. */
export class UntrustedDeviceError extends Error {
  constructor(readonly deviceId: string) {
    super(`device ${deviceId} is not trusted`);
  }
}

export type KeyringDeps = {
  client: Client;
  crypto: Crypto;
  vault: Vault;
  pinnedRoot: Uint8Array;
  accountId: string;
  deviceId: string;
  csrf: () => string;
};

function toRecord(device: DirectoryDevice): DirectoryRecord {
  return {
    deviceId: device.deviceId,
    accountId: device.accountId,
    signPublicKey: device.signPublicKey,
    boxPublicKey: device.boxPublicKey,
    certificate: device.certificate,
    authorizerDeviceId: device.authorizerDeviceId,
  };
}

/**
 * Domain keys of this device: opens the envelopes addressed to it, checks who
 * sent them against the pinned trust root, and (as a "steward") publishes new
 * generations or history grants when the server reports they are needed.
 */
export class Keyring {
  private readonly records = new Map<
    string,
    Promise<DirectoryDevice | undefined>
  >();
  private readonly keys = new Map<string, Map<number, Uint8Array>>();
  private readonly chain;

  constructor(private readonly deps: KeyringDeps) {
    this.chain = createChainVerifier(
      deps.crypto,
      deps.pinnedRoot,
      async (id) => {
        const record = await this.record(id);
        return record === undefined ? undefined : toRecord(record);
      },
    );
  }

  record(deviceId: string): Promise<DirectoryDevice | undefined> {
    let cached = this.records.get(deviceId);
    if (cached === undefined) {
      cached = getDeviceRecord(this.deps.client, deviceId);
      this.records.set(deviceId, cached);
    }
    return cached;
  }

  /** The public record of a device, only if its certificate chain is trusted. */
  async trusted(deviceId: string): Promise<DirectoryDevice | undefined> {
    const record = await this.record(deviceId);
    return record !== undefined && (await this.chain.trusted(toRecord(record)))
      ? record
      : undefined;
  }

  keyFor(domainId: string, generation: number): Uint8Array | undefined {
    return this.keys.get(domainId)?.get(generation);
  }

  /** Opens every envelope addressed to this device (or its recovery identity) that is not yet cached. */
  async loadKeys(domain: KeyDomain): Promise<void> {
    const known = this.keys.get(domain.id) ?? new Map<number, Uint8Array>();
    this.keys.set(domain.id, known);
    await this.openEnvelopes(
      domain,
      await listMyKeyEnvelopes(this.deps.client, domain.id),
      known,
    );
  }

  private async openEnvelopes(
    domain: KeyDomain,
    envelopes: Awaited<ReturnType<typeof listMyKeyEnvelopes>>,
    known: Map<number, Uint8Array>,
  ): Promise<void> {
    const recovery = this.deps.vault.recoveryKeys();
    for (const envelope of envelopes) {
      if (known.has(envelope.generation)) continue;
      const own = envelope.recipientDeviceId === this.deps.deviceId;
      const asRecovery =
        recovery !== undefined &&
        envelope.recipientDeviceId === recovery.deviceId;
      if (!own && !asRecovery) continue;
      const signer = await this.trusted(envelope.signerDeviceId);
      if (signer === undefined) continue;
      try {
        known.set(
          envelope.generation,
          this.deps.crypto.openDomainKey({
            envelope: {
              sealed: fromBase64Url(envelope.sealed),
              signature: fromBase64Url(envelope.signature),
            },
            domainId: domain.id,
            generation: envelope.generation,
            recipientDeviceId: envelope.recipientDeviceId,
            recipient:
              own || recovery === undefined
                ? this.deps.vault.deviceKeys()
                : recovery,
            signerPublicKey: fromBase64Url(signer.signPublicKey),
          }),
        );
      } catch (error) {
        if (!(error instanceof CryptoError)) throw error;
        // An envelope that does not open or verify is ignored, never trusted.
      }
    }
  }

  /**
   * Restores access using the recovery identity: for every authorized device
   * that lacks a generation, re-seals it with the key the recovery identity
   * holds and posts it to the audited recovery endpoint.
   */
  async recoverGaps(
    onlyDeviceId?: string,
  ): Promise<{ granted: number; failed: number }> {
    const gaps = (await listRecoveryGaps(this.deps.client)).filter(
      (gap) =>
        onlyDeviceId === undefined || gap.device.deviceId === onlyDeviceId,
    );
    const byTarget = new Map<string, RecoveryGap[]>();
    for (const gap of gaps) {
      const key = `${gap.domainId}:${gap.generation}`;
      byTarget.set(key, [...(byTarget.get(key) ?? []), gap]);
    }
    let granted = 0;
    let failed = 0;
    const opened = new Map<string, Map<number, Uint8Array>>();
    for (const group of byTarget.values()) {
      const first = group[0];
      if (first === undefined) continue;
      try {
        let known = opened.get(first.domainId);
        if (known === undefined) {
          known = new Map();
          opened.set(first.domainId, known);
          const placeholder = { id: first.domainId } as KeyDomain;
          await this.openEnvelopes(
            placeholder,
            await listRecoveryEnvelopes(this.deps.client, first.domainId),
            known,
          );
        }
        const key = known.get(first.generation);
        if (key === undefined)
          throw new Error(
            "the recovery identity holds no key for this generation",
          );
        await grantRecoveryEnvelopes(
          this.deps.client,
          this.deps.csrf(),
          first.domainId,
          first.generation,
          this.deps.deviceId,
          await this.seal(
            group.map((gap) => gap.device),
            key,
            first.domainId,
            first.generation,
          ),
        );
        granted += group.length;
      } catch {
        failed += group.length;
      }
    }
    return { granted, failed };
  }

  private async seal(
    devices: DirectoryDevice[],
    key: Uint8Array,
    domainId: string,
    generation: number,
  ): Promise<EnvelopeInput[]> {
    const signerSecretKey = this.deps.vault.deviceKeys().signSecretKey;
    const envelopes: EnvelopeInput[] = [];
    for (const device of devices) {
      if ((await this.trusted(device.deviceId)) === undefined)
        throw new UntrustedDeviceError(device.deviceId);
      const sealed = this.deps.crypto.sealDomainKey({
        key,
        domainId,
        generation,
        recipientDeviceId: device.deviceId,
        recipientBoxPublicKey: fromBase64Url(device.boxPublicKey),
        signerSecretKey,
      });
      envelopes.push({
        recipientDeviceId: device.deviceId,
        sealed: toBase64Url(sealed.sealed),
        signature: toBase64Url(sealed.signature),
      });
    }
    return envelopes;
  }

  /** Creates the missing domains of a project (internal members only; others skip). */
  async ensureDomains(projectId: string): Promise<KeyDomain[]> {
    let domains = await listKeyDomains(this.deps.client, projectId);
    for (const kind of ["work", "chat", "files"] as const) {
      if (!domains.some((domain) => domain.kind === kind)) {
        try {
          await createKeyDomain(
            this.deps.client,
            this.deps.csrf(),
            projectId,
            kind,
          );
        } catch {
          // Someone else created it first, or this person may not create domains.
        }
      }
    }
    domains = await listKeyDomains(this.deps.client, projectId);
    return domains;
  }

  /**
   * Does what a domain needs: publish the first generation, rotate after a
   * revocation, or hand history to devices that joined later. Returns what it did.
   */
  async maintain(
    domain: KeyDomain,
  ): Promise<"nothing" | "published" | "granted"> {
    await this.loadKeys(domain);
    const deviceId = this.deps.deviceId;
    if (
      domain.currentGeneration === 0 ||
      domain.state === "rotation_required"
    ) {
      const generation = domain.currentGeneration + 1;
      const key = this.deps.crypto.generateDomainKey();
      const authorized = await listAuthorizedDevices(
        this.deps.client,
        domain.id,
      );
      const envelopes = await this.seal(authorized, key, domain.id, generation);
      await publishKeyGeneration(
        this.deps.client,
        this.deps.csrf(),
        domain.id,
        generation,
        deviceId,
        envelopes,
      );
      this.keys.get(domain.id)?.set(generation, key);
      return "published";
    }
    if (domain.state !== "pending_keys") return "nothing";
    const authorized = await listAuthorizedDevices(this.deps.client, domain.id);
    const recipients = await listKeyRecipients(this.deps.client, domain.id);
    let granted = false;
    for (
      let generation = 1;
      generation <= domain.currentGeneration;
      generation += 1
    ) {
      const key = this.keyFor(domain.id, generation);
      if (key === undefined) continue;
      const holders = new Set(
        recipients
          .filter((r) => r.generation === generation)
          .map((r) => r.deviceId),
      );
      const missing = authorized.filter(
        (device) => !holders.has(device.deviceId),
      );
      if (missing.length === 0) continue;
      await grantKeyEnvelopes(
        this.deps.client,
        this.deps.csrf(),
        domain.id,
        generation,
        deviceId,
        await this.seal(missing, key, domain.id, generation),
      );
      granted = true;
    }
    return granted ? "granted" : "nothing";
  }
}
