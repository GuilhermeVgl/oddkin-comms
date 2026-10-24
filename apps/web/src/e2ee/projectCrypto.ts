import {
  CryptoError,
  fromBase64Url,
  toBase64Url,
  type Crypto,
} from "@oddkin/crypto";
import {
  listKeyDomains,
  type KeyDomain,
  type createApiClient,
} from "@oddkin/api-client";
import type { DomainKind, Keyring } from "./keyring";
import type { Vault } from "./vault";

type Client = ReturnType<typeof createApiClient>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bindings between a ciphertext and the record it belongs to (mirrors the server). */
export const resources = {
  workItem: (id: string, field: "title" | "desc") => `wi:${id}:${field}`,
  epic: (id: string, field: "title" | "desc") => `ep:${id}:${field}`,
  comment: (id: string) => `wc:${id}`,
  message: (mutationId: string) => `msg:${mutationId}`,
};

export type EncryptedField = { envelope: string; signerDeviceId: string };

export type DecryptInput = {
  resource: string;
  revision: number;
  authorId: string;
  signerDeviceId: string;
  envelope: string;
};

export type DecryptResult =
  | { ok: true; text: string }
  | { ok: false; reason: "locked" | "no_key" | "untrusted" | "invalid" };

/** Encrypts and decrypts the content of one project; the two key domains are work and chat. */
export class ProjectCrypto {
  private domains = new Map<DomainKind, KeyDomain>();

  constructor(
    readonly projectId: string,
    private readonly client: Client,
    private readonly crypto: Crypto,
    private readonly vault: Vault,
    private readonly keyring: Keyring,
    private readonly accountId: string,
    private readonly deviceId: string,
  ) {}

  /**
   * Re-reads the domains and loads the keys. With `maintain`, also acts as a
   * steward for domains that already have a generation: rotation after a
   * revocation, history for devices that joined later. It never turns
   * encryption on by itself; that is an explicit, project-wide decision.
   */
  async refresh(maintain: boolean): Promise<void> {
    let domains = await listKeyDomains(this.client, this.projectId);
    if (maintain) {
      for (const domain of domains) {
        if (domain.currentGeneration === 0) continue;
        try {
          if ((await this.keyring.maintain(domain)) !== "nothing") {
            domains = await listKeyDomains(this.client, this.projectId);
          }
        } catch {
          // Another steward may have acted first; the next event refreshes again.
        }
      }
    }
    this.domains = new Map(domains.map((domain) => [domain.kind, domain]));
    for (const domain of domains) {
      if (domain.currentGeneration > 0) await this.keyring.loadKeys(domain);
    }
  }

  /**
   * Turns encryption on for the project: creates the domains and publishes
   * generation 1. From then on the server refuses plaintext for this project.
   */
  async enable(): Promise<void> {
    for (const domain of await this.keyring.ensureDomains(this.projectId)) {
      if (domain.currentGeneration === 0) await this.keyring.maintain(domain);
    }
    await this.refresh(false);
  }

  domain(kind: DomainKind): KeyDomain | undefined {
    return this.domains.get(kind);
  }

  /** True once the server refuses plaintext for this kind of content. */
  isEncrypted(kind: DomainKind): boolean {
    return (this.domains.get(kind)?.currentGeneration ?? 0) > 0;
  }

  /** True when this device can write encrypted content now. */
  canWrite(kind: DomainKind): boolean {
    const domain = this.domains.get(kind);
    return (
      domain !== undefined &&
      domain.writable &&
      this.vault.unlocked &&
      this.keyring.keyFor(domain.id, domain.currentGeneration) !== undefined
    );
  }

  encrypt(
    kind: DomainKind,
    resource: string,
    revision: number,
    text: string,
  ): EncryptedField {
    const domain = this.domains.get(kind);
    const key =
      domain === undefined
        ? undefined
        : this.keyring.keyFor(domain.id, domain.currentGeneration);
    if (domain === undefined || key === undefined)
      throw new Error("no key for this domain");
    const envelope = this.crypto.encryptContent({
      key,
      generation: domain.currentGeneration,
      context: {
        organizationId: domain.organizationId,
        domainId: domain.id,
        resourceId: resource,
        authorId: this.accountId,
        revision,
      },
      plaintext: encoder.encode(text),
      signerSecretKey: this.vault.deviceKeys().signSecretKey,
    });
    return { envelope: toBase64Url(envelope), signerDeviceId: this.deviceId };
  }

  async decrypt(kind: DomainKind, input: DecryptInput): Promise<DecryptResult> {
    const domain = this.domains.get(kind);
    if (!this.vault.unlocked) return { ok: false, reason: "locked" };
    if (domain === undefined) return { ok: false, reason: "no_key" };
    const signer = await this.keyring.trusted(input.signerDeviceId);
    if (signer === undefined) return { ok: false, reason: "untrusted" };
    try {
      const plaintext = this.crypto.decryptContent({
        keyForGeneration: (generation) =>
          this.keyring.keyFor(domain.id, generation),
        context: {
          organizationId: domain.organizationId,
          domainId: domain.id,
          resourceId: input.resource,
          authorId: input.authorId,
          revision: input.revision,
        },
        envelope: fromBase64Url(input.envelope),
        signerPublicKey: fromBase64Url(signer.signPublicKey),
      });
      return { ok: true, text: decoder.decode(plaintext) };
    } catch (error) {
      if (error instanceof CryptoError) {
        return {
          ok: false,
          reason: error.code === "unknown_generation" ? "no_key" : "invalid",
        };
      }
      throw error;
    }
  }
}
