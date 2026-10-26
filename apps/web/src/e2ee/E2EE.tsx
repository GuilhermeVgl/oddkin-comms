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
  setHistoryMode,
  setTrustRoot,
  type CurrentAccount,
  type Device,
  type PendingDevice,
  type RecoveryAuditEntry,
  type RecoveryGap,
} from "@crewstead/api-client";
import {
  createCrypto,
  createKeystore,
  fromBase64Url,
  loadSodium,
  PassphraseError,
  toBase64Url,
  type Crypto,
} from "@crewstead/crypto";
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
import { CallCrypto } from "./callCrypto";
import { ContentCrypto, type Scope } from "./projectCrypto";
import {
  clearProvision,
  dropInviteSecret,
  loadInviteSecrets,
  readProvision,
  sameFingerprint,
  saveInviteSecret,
} from "./invitations";
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
  | "not_enabled" // this person chose (or was invited without) access to history
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
  /** Present when the device registered through an invitation that carries history. */
  proof?: string;
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
  /** An earlier activation stopped half way; the same passphrase finishes it. */
  setupInterrupted: boolean;
  /** This browser was set up by an invitation: no passphrase to type. */
  autoManaged: boolean;
  /**
   * Prepares an invitation that includes history. Null when this browser cannot
   * vouch for it (not the administrator's, or locked).
   */
  beginHistoryInvite(): Promise<{ linkExtra: string; secret: string } | null>;
  rememberHistoryInvite(
    invitationId: string,
    email: string,
    secret: string,
  ): Promise<void>;
  /** Asks to be shown the key step after all (for accounts that chose not to). */
  requestHistoryAccess(): Promise<void>;
  setupOrganization(passphrase: string): Promise<void>;
  setupDevice(passphrase: string, confirmedFingerprint: string): Promise<void>;
  unlock(passphrase: string, remember?: boolean): Promise<boolean>;
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
  openCall(callId: string): Promise<CallCrypto | null>;
  hasRecoveryIdentity: boolean;
  /** Administrative recovery; only the recovery administrator, only while unlocked. */
  recoveryGaps(): Promise<RecoveryGap[]>;
  restoreAccess(): Promise<{ granted: number; failed: number }>;
  rotateRecoveryIdentity(passphrase: string): Promise<void>;
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
  const token = readCookie(document.cookie, "crewstead_csrf");
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
  const [setupInterrupted, setSetupInterrupted] = useState(false);
  const [autoManaged, setAutoManaged] = useState(false);
  const provisioning = useRef(false);

  const runtimeOf = useCallback(async (): Promise<Runtime> => {
    runtime.current ??= await createRuntime();
    return runtime.current;
  }, []);

  const loadApprovals = useCallback(async () => {
    const current = record.current;
    const { vault, crypto, store } = await runtimeOf();
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
        ...(pending.device.proof === undefined
          ? {}
          : { proof: pending.device.proof }),
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
    // A device that proves it knows the secret of an invitation this browser
    // made (and includes history) is approved on the spot: the proof is what
    // tells it apart from a device the server might have invented.
    const root = vault.rootSecretKey();
    if (
      root !== undefined &&
      entries.some((entry) => entry.proof !== undefined)
    ) {
      const secrets = await loadInviteSecrets(store, account.id);
      for (const entry of [...entries]) {
        if (entry.proof === undefined) continue;
        const signPublicKey = fromBase64Url(entry.signPublicKey);
        const boxPublicKey = fromBase64Url(entry.boxPublicKey);
        const match = secrets.find(
          (secret) =>
            secret.email.toLowerCase() === entry.email.toLowerCase() &&
            crypto.verifyInvitationProof(
              fromBase64Url(secret.secret),
              signPublicKey,
              boxPublicKey,
              entry.proof ?? "",
            ),
        );
        if (match === undefined) continue;
        try {
          const certificate = crypto.signDeviceCertificate(root, {
            accountId: entry.accountId,
            deviceId: entry.deviceId,
            signPublicKey,
            boxPublicKey,
          });
          await authorizeDevice(
            client,
            csrf(),
            entry.deviceId,
            toBase64Url(certificate),
          );
          await dropInviteSecret(store, account.id, match.invitationId);
          entries.splice(entries.indexOf(entry), 1);
        } catch {
          // It stays in the list for a manual approval.
        }
      }
    }
    setApprovals(entries);
  }, [client, account, runtimeOf]);

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

  const refresh = useCallback(async () => {
    try {
      const { vault, crypto } = await runtimeOf();
      setPersistent(vault.persistent);
      const stored = await vault.load(account.id);
      record.current = stored;
      setSetupInterrupted(stored?.incomplete === true);
      const root = await getTrustRoot(client);
      setRootFingerprint(
        root === null
          ? null
          : crypto.fingerprint(fromBase64Url(root.signPublicKey)),
      );
      if (stored?.incomplete === true) {
        // Keys exist here but the server steps never finished: resume the setup.
        setDeviceFingerprint(null);
        setPhase("not_configured");
        return;
      }
      setAutoManaged(stored?.autoPassphrase !== undefined);
      if (stored === null && account.historyMode === "auto" && root !== null) {
        // Invited with history: the browser registers itself with the secret from
        // the link, asking for nothing. Without the link it falls back to the manual step.
        const provision = readProvision(account.email);
        if (
          provision !== null &&
          sameFingerprint(
            provision.rootFingerprint,
            crypto.fingerprint(fromBase64Url(root.signPublicKey)),
          ) &&
          !provisioning.current
        ) {
          provisioning.current = true;
          try {
            const keys = crypto.generateDeviceKeys();
            const autoPassphrase = toBase64Url(crypto.generateDomainKey());
            const created = await registerDevice(client, csrf(), {
              name: "Navegador",
              signPublicKey: toBase64Url(keys.signPublicKey),
              boxPublicKey: toBase64Url(keys.boxPublicKey),
              proof: crypto.invitationProof(
                fromBase64Url(provision.secret),
                keys.signPublicKey,
                keys.boxPublicKey,
              ),
            });
            const next: VaultRecord = {
              version: 1,
              accountId: account.id,
              deviceId: created.id,
              deviceName: created.name,
              signPublicKey: toBase64Url(keys.signPublicKey),
              boxPublicKey: toBase64Url(keys.boxPublicKey),
              wrappedDevice: vault.wrapDevice(autoPassphrase, keys),
              pinnedRoot: root.signPublicKey,
              autoPassphrase,
            };
            await vault.save(next);
            clearProvision();
            record.current = next;
            provisioning.current = false;
            await refresh();
            return;
          } catch {
            provisioning.current = false;
          }
        }
      }
      if (stored === null && account.historyMode === "none") {
        setDeviceFingerprint(null);
        setPhase("not_enabled");
        return;
      }
      if (stored === null) {
        setDeviceFingerprint(null);
        setPhase(root === null ? "not_configured" : "needs_device");
        return;
      }
      if (!vault.unlocked && stored.autoPassphrase !== undefined) {
        try {
          await vault.unlock(stored, stored.autoPassphrase);
          vault.rememberInTab(account.id);
          await buildKeyring();
        } catch {
          // Falls through to the passphrase step.
        }
      }
      if (!vault.unlocked && vault.restoreFromTab(stored)) {
        // A reload in the same tab: the keys come back without asking again.
        await buildKeyring();
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
  }, [account, buildKeyring, client, loadApprovals, runtimeOf]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "device.changed")
      void refresh();
  });

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
      setupInterrupted,
      autoManaged,

      async beginHistoryInvite() {
        const { vault, crypto } = await runtimeOf();
        const current = record.current;
        if (
          current === null ||
          current.root === undefined ||
          !vault.unlocked ||
          vault.rootSecretKey() === undefined ||
          rootFingerprint === null
        ) {
          return null;
        }
        const secret = toBase64Url(crypto.generateDomainKey());
        return {
          secret,
          linkExtra: `k=${secret}&rf=${rootFingerprint.replace(/\s/g, "")}`,
        };
      },

      async rememberHistoryInvite(invitationId, email, secret) {
        const { store } = await runtimeOf();
        await saveInviteSecret(store, account.id, {
          invitationId,
          email,
          secret,
          createdAt: Date.now(),
        });
      },

      async requestHistoryAccess() {
        await setHistoryMode(client, csrf(), "ask");
        window.location.reload();
      },

      async setupOrganization(passphrase) {
        setError("");
        const { vault, crypto } = await runtimeOf();
        const token = csrf();
        // The keys are saved, wrapped, BEFORE the server hears about them: the
        // trust root can be set only once, so losing its private half to a
        // reload or a failed request would lock the organization out for good.
        let draft = record.current?.incomplete === true ? record.current : null;
        if (draft === null) {
          const root = crypto.generateDeviceKeys();
          const device = crypto.generateDeviceKeys();
          const recovery = crypto.generateDeviceKeys();
          draft = {
            version: 1,
            incomplete: true,
            accountId: account.id,
            deviceId: "",
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
              deviceId: "",
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
          await vault.save(draft);
          record.current = draft;
        }
        try {
          await vault.unlock(draft, passphrase);
        } catch (failure) {
          if (failure instanceof PassphraseError)
            throw new Error("use the passphrase of the earlier attempt", {
              cause: failure,
            });
          throw failure;
        }
        const rootSecret = vault.rootSecretKey();
        const draftRecovery = draft.recovery;
        if (rootSecret === undefined || draftRecovery === undefined)
          throw new Error("the saved setup is incomplete");
        const serverRoot = await getTrustRoot(client);
        if (serverRoot === null) {
          await setTrustRoot(client, token, draft.pinnedRoot);
        } else if (serverRoot.signPublicKey !== draft.pinnedRoot) {
          throw new Error("the organization already has another trust root");
        }
        // Registering and approving are repeatable: what an earlier attempt did is reused.
        const existing = await listDevices(client);
        const ensureDevice = async (
          signPublicKey: string,
          boxPublicKey: string,
          name: string,
          kind: "device" | "recovery",
        ) => {
          const found = existing.find(
            (entry) => entry.signPublicKey === signPublicKey,
          );
          const id =
            found?.id ??
            (
              await registerDevice(client, token, {
                name,
                kind,
                signPublicKey,
                boxPublicKey,
              })
            ).id;
          if (found === undefined || found.state === "pending") {
            const certificate = crypto.signDeviceCertificate(rootSecret, {
              accountId: account.id,
              deviceId: id,
              signPublicKey: fromBase64Url(signPublicKey),
              boxPublicKey: fromBase64Url(boxPublicKey),
            });
            await authorizeDevice(client, token, id, toBase64Url(certificate));
          }
          return id;
        };
        const deviceId = await ensureDevice(
          draft.signPublicKey,
          draft.boxPublicKey,
          "Este navegador",
          "device",
        );
        const recoveryId = await ensureDevice(
          draftRecovery.signPublicKey,
          draftRecovery.boxPublicKey,
          "Identidade de recuperação",
          "recovery",
        );
        const next: VaultRecord = {
          ...draft,
          deviceId,
          recovery: { ...draftRecovery, deviceId: recoveryId },
        };
        delete next.incomplete;
        await vault.save(next);
        record.current = next;
        await vault.unlock(next, passphrase);
        vault.rememberInTab(account.id);
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

      async unlock(passphrase, remember = true) {
        const { vault } = await runtimeOf();
        const current = record.current;
        if (current === null) return false;
        try {
          await vault.unlock(current, passphrase);
        } catch (failure) {
          if (failure instanceof PassphraseError) return false;
          throw failure;
        }
        if (remember) vault.rememberInTab(account.id);
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

      async openCall() {
        const { crypto, vault } = await runtimeOf();
        const current = record.current;
        const ring = keyring.current;
        if (current === null || ring === null || !vault.unlocked) return null;
        return new CallCrypto(
          client,
          crypto,
          vault,
          ring,
          current.deviceId,
          csrf,
        );
      },

      hasRecoveryIdentity: hasRecovery,

      recoveryGaps: () => listRecoveryGaps(client),

      async restoreAccess() {
        const ring = keyring.current;
        if (ring === null) throw new Error("locked");
        return ring.recoverGaps();
      },

      async rotateRecoveryIdentity(passphrase) {
        const { crypto, vault } = await runtimeOf();
        const current = record.current;
        const ring = keyring.current;
        const root = vault.rootSecretKey();
        const previous = vault.recoveryKeys();
        if (
          current === null ||
          ring === null ||
          root === undefined ||
          previous === undefined
        ) {
          throw new Error("recovery identity is unavailable");
        }
        // Verify the local passphrase before registering a new recovery key.
        vault.unwrapSecret(passphrase, current.wrappedDevice);
        const nextKeys = crypto.generateDeviceKeys();
        const created = await registerDevice(client, csrf(), {
          name: "Identidade de recuperação",
          kind: "recovery",
          signPublicKey: toBase64Url(nextKeys.signPublicKey),
          boxPublicKey: toBase64Url(nextKeys.boxPublicKey),
        });
        const certificate = crypto.signDeviceCertificate(root, {
          accountId: account.id,
          deviceId: created.id,
          signPublicKey: nextKeys.signPublicKey,
          boxPublicKey: nextKeys.boxPublicKey,
        });
        await authorizeDevice(
          client,
          csrf(),
          created.id,
          toBase64Url(certificate),
        );
        const restored = await ring.recoverGaps();
        if (restored.failed !== 0) {
          throw new Error("recovery envelopes could not be copied");
        }
        const next: VaultRecord = {
          ...current,
          recovery: {
            deviceId: created.id,
            signPublicKey: toBase64Url(nextKeys.signPublicKey),
            boxPublicKey: toBase64Url(nextKeys.boxPublicKey),
            wrapped: vault.wrapSecret(
              passphrase,
              new Uint8Array([
                ...nextKeys.signSecretKey,
                ...nextKeys.boxSecretKey,
              ]),
            ),
          },
        };
        await vault.save(next);
        record.current = next;
        await vault.unlock(next, passphrase);
        await buildKeyring();
        await revokeDevice(client, csrf(), previous.deviceId);
        await refresh();
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
      setupInterrupted,
      autoManaged,
      rootFingerprint,
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
