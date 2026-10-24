import {
  createApiClient,
  authorizeDevice,
  getTrustRoot,
  listDevices,
  listRecoveryAudit,
  listRecoveryGaps,
  listPendingDevices,
  readCookie,
  registerDevice,
  revokeDevice,
  setTrustRoot,
  type CurrentAccount,
  type Device,
  type PendingDevice,
  type RecoveryAuditEntry,
  type RecoveryGap,
} from "@oddkin/api-client";
import {
  createCrypto,
  createKeystore,
  fromBase64Url,
  loadSodium,
  PassphraseError,
  toBase64Url,
  type Crypto,
} from "@oddkin/crypto";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEvents } from "../events";
import { Keyring } from "./keyring";
import { ContentCrypto, type Scope } from "./projectCrypto";
import { browserStore, type KeyValueStore } from "./storage";
import { Vault, type VaultRecord } from "./vault";

type Client = ReturnType<typeof createApiClient>;

export type Phase =
  | "loading"
  | "not_configured" // the organization has no trust root yet
  | "needs_device" // trust root exists, this browser has no device
  | "pending_approval"
  | "locked"
  | "unlocked"
  | "revoked"
  | "error";

export type PendingApproval = {
  deviceId: string;
  accountId: string;
  email: string;
  name: string;
  signPublicKey: string;
  boxPublicKey: string;
  fingerprint: string;
};

export type E2EEApi = {
  phase: Phase;
  error: string;
  persistent: boolean;
  rootFingerprint: string | null;
  deviceFingerprint: string | null;
  devices: Device[];
  approvals: PendingApproval[];
  canApproveWithRoot: boolean;
  setupOrganization(passphrase: string): Promise<void>;
  setupDevice(passphrase: string, confirmedFingerprint: string): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  approve(approval: PendingApproval): Promise<void>;
  revoke(deviceId: string): Promise<void>;
  backup(): string | null;
  resetThisBrowser(): Promise<void>;
  openScope(
    scope: Scope,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openProject(
    projectId: string,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openConversation(
    conversationId: string,
    options?: { maintain?: boolean },
  ): Promise<ContentCrypto | null>;
  openOrganization(options?: {
    maintain?: boolean;
  }): Promise<ContentCrypto | null>;
  hasRecoveryIdentity: boolean;
  /** Administrative recovery; only the recovery administrator, only while unlocked. */
  recoveryGaps(): Promise<RecoveryGap[]>;
  restoreAccess(): Promise<{ granted: number; failed: number }>;
  recoveryAudit(): Promise<RecoveryAuditEntry[]>;
};

const E2EEContext = createContext<E2EEApi | null>(null);

export function useE2EE(): E2EEApi {
  const value = useContext(E2EEContext);
  if (value === null) throw new Error("E2EEProvider is missing");
  return value;
}

/** Same as useE2EE but tolerates a missing provider (tests, unauthenticated screens). */
export function useOptionalE2EE(): E2EEApi | null {
  return useContext(E2EEContext);
}

type Runtime = { crypto: Crypto; vault: Vault; store: KeyValueStore };

async function createRuntime(): Promise<Runtime> {
  const sodium = await loadSodium();
  const crypto = await createCrypto(sodium);
  const store = await browserStore();
  return {
    crypto,
    vault: new Vault(crypto, createKeystore(sodium), store),
    store,
  };
}

function csrf(): string {
  const token = readCookie(document.cookie, "oddkin_csrf");
  if (token === null) throw new Error("missing csrf cookie");
  return token;
}

export function E2EEProvider({
  account,
  children,
}: {
  account: CurrentAccount;
  children: React.ReactNode;
}) {
  const client = useMemo<Client>(() => createApiClient(""), []);
  const runtime = useRef<Runtime | null>(null);
  const record = useRef<VaultRecord | null>(null);
  const keyring = useRef<Keyring | null>(null);
  const projects = useRef(new Map<string, ContentCrypto>());
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [rootFingerprint, setRootFingerprint] = useState<string | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(
    null,
  );
  const [devices, setDevices] = useState<Device[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [canApproveWithRoot, setCanApproveWithRoot] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);

  const runtimeOf = useCallback(async (): Promise<Runtime> => {
    runtime.current ??= await createRuntime();
    return runtime.current;
  }, []);

  const loadApprovals = useCallback(async () => {
    const current = record.current;
    const { vault } = await runtimeOf();
    if (current === null || !vault.unlocked) {
      setApprovals([]);
      return;
    }
    const mine = await listDevices(client);
    setDevices(mine);
    const entries: PendingApproval[] = [];
    const seen = new Set<string>();
    const add = (pending: PendingDevice) => {
      if (seen.has(pending.device.id)) return;
      seen.add(pending.device.id);
      entries.push({
        deviceId: pending.device.id,
        accountId: pending.accountId,
        email: pending.email,
        name: pending.device.name,
        signPublicKey: pending.device.signPublicKey,
        boxPublicKey: pending.device.boxPublicKey,
        fingerprint: vault.fingerprint(pending.device.signPublicKey),
      });
    };
    if (account.isAdmin) {
      for (const pending of await listPendingDevices(client)) add(pending);
    }
    for (const device of mine) {
      if (device.state === "pending") {
        add({ device, accountId: account.id, email: account.email });
      }
    }
    setApprovals(entries);
  }, [client, account, runtimeOf]);

  const refresh = useCallback(async () => {
    try {
      const { vault, crypto } = await runtimeOf();
      setPersistent(vault.persistent);
      const stored = await vault.load(account.id);
      record.current = stored;
      const root = await getTrustRoot(client);
      setRootFingerprint(
        root === null
          ? null
          : crypto.fingerprint(fromBase64Url(root.signPublicKey)),
      );
      if (stored === null) {
        setDeviceFingerprint(null);
        setPhase(root === null ? "not_configured" : "needs_device");
        return;
      }
      if (root !== null && root.signPublicKey !== stored.pinnedRoot) {
        setError(
          "A chave de confiança do servidor mudou. Não use este navegador até conferir com a administração.",
        );
        setPhase("error");
        return;
      }
      setDeviceFingerprint(vault.fingerprint(stored.signPublicKey));
      const mine = await listDevices(client);
      setDevices(mine);
      const device = mine.find((entry) => entry.id === stored.deviceId);
      if (device === undefined || device.state === "revoked") {
        vault.lock();
        setPhase("revoked");
        return;
      }
      if (device.state === "pending") {
        setPhase("pending_approval");
        return;
      }
      setCanApproveWithRoot(stored.root !== undefined && vault.unlocked);
      setHasRecovery(stored.recovery !== undefined && vault.unlocked);
      setPhase(vault.unlocked ? "unlocked" : "locked");
      if (vault.unlocked) await loadApprovals();
    } catch {
      setError("Não foi possível verificar a segurança deste dispositivo.");
      setPhase("error");
    }
  }, [account.id, client, loadApprovals, runtimeOf]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "device.changed")
      void refresh();
  });

  const buildKeyring = useCallback(async () => {
    const { vault, crypto } = await runtimeOf();
    const current = record.current;
    if (current === null) throw new Error("no device");
    keyring.current = new Keyring({
      client,
      crypto,
      vault,
      pinnedRoot: fromBase64Url(current.pinnedRoot),
      accountId: account.id,
      deviceId: current.deviceId,
      csrf,
    });
    projects.current.clear();
  }, [account.id, client, runtimeOf]);

  const api = useMemo<E2EEApi>(
    () => ({
      phase,
      error,
      persistent,
      rootFingerprint,
      deviceFingerprint,
      devices,
      approvals,
      canApproveWithRoot,

      async setupOrganization(passphrase) {
        setError("");
        const { vault, crypto } = await runtimeOf();
        const token = csrf();
        const root = crypto.generateDeviceKeys();
        const device = crypto.generateDeviceKeys();
        const recovery = crypto.generateDeviceKeys();
        await setTrustRoot(client, token, toBase64Url(root.signPublicKey));
        const register = async (
          keys: typeof device,
          name: string,
          kind: "device" | "recovery",
        ) => {
          const created = await registerDevice(client, token, {
            name,
            kind,
            signPublicKey: toBase64Url(keys.signPublicKey),
            boxPublicKey: toBase64Url(keys.boxPublicKey),
          });
          const certificate = crypto.signDeviceCertificate(root.signSecretKey, {
            accountId: account.id,
            deviceId: created.id,
            signPublicKey: keys.signPublicKey,
            boxPublicKey: keys.boxPublicKey,
          });
          await authorizeDevice(
            client,
            token,
            created.id,
            toBase64Url(certificate),
          );
          return created.id;
        };
        const deviceId = await register(device, "Este navegador", "device");
        const recoveryId = await register(
          recovery,
          "Identidade de recuperação",
          "recovery",
        );
        const next: VaultRecord = {
          version: 1,
          accountId: account.id,
          deviceId,
          deviceName: "Este navegador",
          signPublicKey: toBase64Url(device.signPublicKey),
          boxPublicKey: toBase64Url(device.boxPublicKey),
          wrappedDevice: vault.wrapDevice(passphrase, device),
          pinnedRoot: toBase64Url(root.signPublicKey),
          root: {
            publicKey: toBase64Url(root.signPublicKey),
            wrapped: vault.wrapSecret(passphrase, root.signSecretKey),
          },
          recovery: {
            deviceId: recoveryId,
            signPublicKey: toBase64Url(recovery.signPublicKey),
            boxPublicKey: toBase64Url(recovery.boxPublicKey),
            wrapped: vault.wrapSecret(
              passphrase,
              new Uint8Array([
                ...recovery.signSecretKey,
                ...recovery.boxSecretKey,
              ]),
            ),
          },
        };
        await vault.save(next);
        record.current = next;
        await vault.unlock(next, passphrase);
        await buildKeyring();
        await refresh();
      },

      async setupDevice(passphrase, confirmedFingerprint) {
        setError("");
        const { vault, crypto } = await runtimeOf();
        const root = await getTrustRoot(client);
        if (root === null) throw new Error("not configured");
        const shown = crypto.fingerprint(fromBase64Url(root.signPublicKey));
        if (
          confirmedFingerprint.replace(/\s/g, "").toLowerCase() !==
          shown.replace(/\s/g, "")
        ) {
          throw new Error("fingerprint mismatch");
        }
        const keys = crypto.generateDeviceKeys();
        const created = await registerDevice(client, csrf(), {
          name: "Navegador",
          signPublicKey: toBase64Url(keys.signPublicKey),
          boxPublicKey: toBase64Url(keys.boxPublicKey),
        });
        const next: VaultRecord = {
          version: 1,
          accountId: account.id,
          deviceId: created.id,
          deviceName: created.name,
          signPublicKey: toBase64Url(keys.signPublicKey),
          boxPublicKey: toBase64Url(keys.boxPublicKey),
          wrappedDevice: vault.wrapDevice(passphrase, keys),
          pinnedRoot: root.signPublicKey,
        };
        await vault.save(next);
        record.current = next;
        await refresh();
      },

      async unlock(passphrase) {
        const { vault } = await runtimeOf();
        const current = record.current;
        if (current === null) return false;
        try {
          await vault.unlock(current, passphrase);
        } catch (failure) {
          if (failure instanceof PassphraseError) return false;
          throw failure;
        }
        await buildKeyring();
        await refresh();
        return true;
      },

      lock() {
        void runtimeOf().then(({ vault }) => {
          vault.lock();
          keyring.current = null;
          projects.current.clear();
          void refresh();
        });
      },

      async approve(approval) {
        const { vault, crypto } = await runtimeOf();
        const current = record.current;
        if (current === null) return;
        const fields = {
          accountId: approval.accountId,
          deviceId: approval.deviceId,
          signPublicKey: fromBase64Url(approval.signPublicKey),
          boxPublicKey: fromBase64Url(approval.boxPublicKey),
        };
        const root = vault.rootSecretKey();
        const ownAccount = approval.accountId === account.id;
        if (root !== undefined) {
          await authorizeDevice(
            client,
            csrf(),
            approval.deviceId,
            toBase64Url(crypto.signDeviceCertificate(root, fields)),
          );
        } else if (ownAccount) {
          const certificate = crypto.signDeviceCertificate(
            vault.deviceKeys().signSecretKey,
            fields,
          );
          await authorizeDevice(
            client,
            csrf(),
            approval.deviceId,
            toBase64Url(certificate),
            current.deviceId,
          );
        } else {
          throw new Error("this browser cannot approve that device");
        }
        await refresh();
      },

      async revoke(deviceId) {
        await revokeDevice(client, csrf(), deviceId);
        await refresh();
      },

      backup() {
        const current = record.current;
        if (
          current === null ||
          runtime.current === null ||
          current.root === undefined
        )
          return null;
        return runtime.current.vault.exportBackup(current);
      },

      async resetThisBrowser() {
        const { vault } = await runtimeOf();
        await vault.erase(account.id);
        keyring.current = null;
        projects.current.clear();
        await refresh();
      },

      async openScope(scope, options) {
        const { crypto, vault } = await runtimeOf();
        const current = record.current;
        const ring = keyring.current;
        if (current === null || ring === null || !vault.unlocked) return null;
        const cacheKey =
          scope.type === "project"
            ? `p:${scope.projectId}`
            : scope.type === "conversation"
              ? `c:${scope.conversationId}`
              : "org";
        let opened = projects.current.get(cacheKey);
        if (opened === undefined) {
          opened = new ContentCrypto(
            scope,
            client,
            crypto,
            vault,
            ring,
            account.id,
            current.deviceId,
          );
          projects.current.set(cacheKey, opened);
        }
        await opened.refresh(options?.maintain ?? false);
        return opened;
      },

      openProject(projectId, options) {
        return this.openScope({ type: "project", projectId }, options);
      },

      openConversation(conversationId, options) {
        return this.openScope(
          { type: "conversation", conversationId },
          options,
        );
      },

      openOrganization(options) {
        return this.openScope({ type: "organization" }, options);
      },

      hasRecoveryIdentity: hasRecovery,

      recoveryGaps: () => listRecoveryGaps(client),

      async restoreAccess() {
        const ring = keyring.current;
        if (ring === null) throw new Error("locked");
        return ring.recoverGaps();
      },

      recoveryAudit: () => listRecoveryAudit(client),
    }),
    [
      phase,
      error,
      persistent,
      rootFingerprint,
      deviceFingerprint,
      devices,
      approvals,
      canApproveWithRoot,
      hasRecovery,
      account,
      client,
      runtimeOf,
      refresh,
      buildKeyring,
    ],
  );

  return <E2EEContext.Provider value={api}>{children}</E2EEContext.Provider>;
}
