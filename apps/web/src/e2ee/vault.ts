import {
  fromBase64Url,
  toBase64Url,
  type Crypto,
  type DeviceKeys,
  type WrappedSecret,
  createKeystore,
} from "@crewstead/crypto";
import type { KeyValueStore } from "./storage";

type Keystore = ReturnType<typeof createKeystore>;

/** Everything persisted about this browser's device. Secrets are always wrapped. */
export type VaultRecord = {
  version: 1;
  accountId: string;
  deviceId: string;
  deviceName: string;
  signPublicKey: string;
  boxPublicKey: string;
  wrappedDevice: WrappedSecret;
  /** The trust-root fingerprint this browser accepted; the server cannot change it. */
  pinnedRoot: string;
  /** Present only on the administrator's browser. */
  root?: { publicKey: string; wrapped: WrappedSecret };
  recovery?: {
    deviceId: string;
    signPublicKey: string;
    boxPublicKey: string;
    wrapped: WrappedSecret;
  };
};

export type RecoveryKeys = {
  deviceId: string;
  boxPublicKey: Uint8Array;
  boxSecretKey: Uint8Array;
};

export type UnlockedSecrets = {
  device: DeviceKeys;
  rootSecretKey?: Uint8Array;
  recovery?: RecoveryKeys;
};

const keyFor = (accountId: string) => `vault:${accountId}`;

function isRecord(value: unknown): value is VaultRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { deviceId?: unknown }).deviceId === "string"
  );
}

/**
 * Holds the device's keys. Secret material exists in memory only between
 * unlock() and lock(); on disk it is wrapped by a passphrase that is not the
 * login password. It is never put in React state, URLs or logs.
 */
export class Vault {
  private secrets: UnlockedSecrets | null = null;

  constructor(
    private readonly crypto: Crypto,
    private readonly keystore: Keystore,
    private readonly store: KeyValueStore,
  ) {}

  get persistent(): boolean {
    return this.store.persistent;
  }

  async load(accountId: string): Promise<VaultRecord | null> {
    const stored = await this.store.get(keyFor(accountId));
    return isRecord(stored) && stored.accountId === accountId ? stored : null;
  }

  async save(record: VaultRecord): Promise<void> {
    await this.store.put(keyFor(record.accountId), record);
  }

  async erase(accountId: string): Promise<void> {
    this.lock();
    await this.store.remove(keyFor(accountId));
  }

  get unlocked(): boolean {
    return this.secrets !== null;
  }

  /** Wraps the device secrets under the passphrase. */
  wrapDevice(
    passphrase: string,
    keys: DeviceKeys,
    options?: { opsLimit: number; memLimit: number },
  ) {
    return this.keystore.wrap(
      passphrase,
      new Uint8Array([...keys.signSecretKey, ...keys.boxSecretKey]),
      options,
    );
  }

  wrapSecret(
    passphrase: string,
    secret: Uint8Array,
    options?: { opsLimit: number; memLimit: number },
  ) {
    return this.keystore.wrap(passphrase, secret, options);
  }

  unwrapSecret(passphrase: string, wrapped: WrappedSecret): Uint8Array {
    return this.keystore.unwrap(passphrase, wrapped);
  }

  /** Throws PassphraseError when the passphrase is wrong. */
  async unlock(record: VaultRecord, passphrase: string): Promise<void> {
    const raw = this.keystore.unwrap(passphrase, record.wrappedDevice);
    const device: DeviceKeys = {
      signPublicKey: fromBase64Url(record.signPublicKey),
      signSecretKey: raw.slice(0, 64),
      boxPublicKey: fromBase64Url(record.boxPublicKey),
      boxSecretKey: raw.slice(64, 96),
    };
    const next: UnlockedSecrets = { device };
    if (record.root !== undefined) {
      next.rootSecretKey = this.keystore.unwrap(
        passphrase,
        record.root.wrapped,
      );
    }
    if (record.recovery !== undefined) {
      const raw = this.keystore.unwrap(passphrase, record.recovery.wrapped);
      next.recovery = {
        deviceId: record.recovery.deviceId,
        boxPublicKey: fromBase64Url(record.recovery.boxPublicKey),
        boxSecretKey: raw.slice(64, 96),
      };
    }
    this.secrets = next;
  }

  lock(): void {
    this.secrets = null;
  }

  deviceKeys(): DeviceKeys {
    if (this.secrets === null) throw new Error("vault is locked");
    return this.secrets.device;
  }

  /** Present only on the recovery administrator's browser, and only while unlocked. */
  recoveryKeys(): RecoveryKeys | undefined {
    return this.secrets?.recovery;
  }

  rootSecretKey(): Uint8Array | undefined {
    return this.secrets?.rootSecretKey;
  }

  fingerprint(publicKeyBase64: string): string {
    return this.crypto.fingerprint(fromBase64Url(publicKeyBase64));
  }

  exportBackup(record: VaultRecord): string {
    // Wrapped material only: useless without the passphrase.
    return JSON.stringify(
      {
        format: "crewstead-recovery-backup",
        version: 1,
        root: record.root,
        recovery: record.recovery,
        pinnedRoot: record.pinnedRoot,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );
  }

  static encode(bytes: Uint8Array): string {
    return toBase64Url(bytes);
  }
}
