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
  /** Set while the organization setup is half done (keys saved, server steps pending). */
  incomplete?: true;
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
const tabKeyFor = (accountId: string) => `crewstead.tab-unlock:${accountId}`;

type TabSecrets = {
  sign: string;
  box: string;
  root?: string;
  recoveryDeviceId?: string;
  recoveryBox?: string;
};

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
  private tabAccount: string | null = null;

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
    try {
      window.sessionStorage.removeItem(tabKeyFor(accountId));
    } catch {
      // Nothing to clear.
    }
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
    this.forgetTab();
  }

  /**
   * Keeps the unlocked secrets for this tab only, so a reload does not ask for
   * the passphrase again. sessionStorage dies with the tab; lock(), logout and
   * erase() clear it. Script running in the page could read the secrets from
   * memory anyway, so this adds no reach beyond that.
   */
  rememberInTab(accountId: string): void {
    const secrets = this.secrets;
    if (secrets === null) return;
    const value: TabSecrets = {
      sign: toBase64Url(secrets.device.signSecretKey),
      box: toBase64Url(secrets.device.boxSecretKey),
    };
    if (secrets.rootSecretKey !== undefined)
      value.root = toBase64Url(secrets.rootSecretKey);
    if (secrets.recovery !== undefined) {
      value.recoveryDeviceId = secrets.recovery.deviceId;
      value.recoveryBox = toBase64Url(secrets.recovery.boxSecretKey);
    }
    try {
      window.sessionStorage.setItem(
        tabKeyFor(accountId),
        JSON.stringify(value),
      );
      this.tabAccount = accountId;
    } catch {
      // Without sessionStorage the passphrase is asked again after a reload.
    }
  }

  /** Restores secrets remembered by this tab, if they still belong to this device. */
  restoreFromTab(record: VaultRecord): boolean {
    try {
      const raw = window.sessionStorage.getItem(tabKeyFor(record.accountId));
      if (raw === null) return false;
      const value = JSON.parse(raw) as TabSecrets;
      const sign = fromBase64Url(value.sign);
      const box = fromBase64Url(value.box);
      const signPublicKey = fromBase64Url(record.signPublicKey);
      // The secret half of an Ed25519 key ends with its public key.
      const matches =
        sign.length === 64 &&
        box.length === 32 &&
        sign.slice(32).every((byte, index) => byte === signPublicKey[index]);
      if (!matches) {
        window.sessionStorage.removeItem(tabKeyFor(record.accountId));
        return false;
      }
      const next: UnlockedSecrets = {
        device: {
          signPublicKey,
          signSecretKey: sign,
          boxPublicKey: fromBase64Url(record.boxPublicKey),
          boxSecretKey: box,
        },
      };
      if (value.root !== undefined)
        next.rootSecretKey = fromBase64Url(value.root);
      if (
        record.recovery !== undefined &&
        value.recoveryBox !== undefined &&
        value.recoveryDeviceId === record.recovery.deviceId
      ) {
        next.recovery = {
          deviceId: record.recovery.deviceId,
          boxPublicKey: fromBase64Url(record.recovery.boxPublicKey),
          boxSecretKey: fromBase64Url(value.recoveryBox),
        };
      }
      this.secrets = next;
      this.tabAccount = record.accountId;
      return true;
    } catch {
      return false;
    }
  }

  private forgetTab(): void {
    if (this.tabAccount === null) return;
    try {
      window.sessionStorage.removeItem(tabKeyFor(this.tabAccount));
    } catch {
      // Nothing to clear.
    }
    this.tabAccount = null;
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
