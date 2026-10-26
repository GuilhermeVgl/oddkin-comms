import {
  authorizeDevice,
  getTrustRoot,
  registerDevice,
  revokeDevice,
} from "@crewstead/api-client";
import { fromBase64Url, PassphraseError, toBase64Url } from "@crewstead/crypto";
import { useMemo } from "react";
import { newDeviceRecord } from "./deviceRecord";
import { csrf } from "./runtime";
import { setupOrganization } from "./setupOrganization";
import type { E2EEApi, PendingApproval } from "./types";
import type { Session } from "./useSession";
import { Vault } from "./vault";

export type DeviceActions = Pick<
  E2EEApi,
  | "setupOrganization"
  | "setupDevice"
  | "unlock"
  | "lock"
  | "approve"
  | "revoke"
  | "createBackup"
  | "resetThisBrowser"
>;

/** Registering this browser, unlocking it, approving other devices and leaving. */
export function useDeviceActions(
  session: Session,
  parts: {
    refresh: () => Promise<void>;
    steward: () => Promise<void>;
    setError: (message: string) => void;
  },
): DeviceActions {
  const { refresh, steward, setError } = parts;
  return useMemo(() => {
    const { client, account, runtime, record, keyring, scopes, runtimeOf } =
      session;

    async function setupDevice() {
      setError("");
      const { vault, crypto } = await runtimeOf();
      // The organization's key is pinned the first time this browser sees it;
      // its fingerprint stays in Settings for anyone who wants to compare.
      const root = await getTrustRoot(client);
      if (root === null) throw new Error("not configured");
      const keys = crypto.generateDeviceKeys();
      const autoPassphrase = toBase64Url(crypto.generateDomainKey());
      const created = await registerDevice(client, csrf(), {
        name: "Navegador",
        signPublicKey: toBase64Url(keys.signPublicKey),
        boxPublicKey: toBase64Url(keys.boxPublicKey),
      });
      const next = newDeviceRecord({
        vault,
        accountId: account.id,
        created,
        keys,
        autoPassphrase,
        pinnedRoot: root.signPublicKey,
      });
      await vault.save(next);
      record.current = next;
      await refresh();
    }

    async function unlock(passphrase: string, remember = true) {
      const { vault } = await runtimeOf();
      const current = record.current;
      if (current === null) return false;
      try {
        await vault.unlock(current, passphrase);
      } catch (failure) {
        if (failure instanceof PassphraseError) return false;
        throw failure;
      }
      if (current.autoPassphrase === undefined) {
        // A browser set up with a passphrase of its own: from now on it needs none.
        const crypto = (await runtimeOf()).crypto;
        const autoPassphrase = toBase64Url(crypto.generateDomainKey());
        const converted = {
          ...vault.rewrap(current, passphrase, autoPassphrase),
          autoPassphrase,
        };
        await vault.save(converted);
        record.current = converted;
      }
      if (remember) vault.rememberInTab(account.id);
      await session.buildKeyring();
      await refresh();
      return true;
    }

    async function approve(approval: PendingApproval) {
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
      // The approval is the explicit act: the recovery identity (when this
      // browser holds it) also restores that device's history, and the
      // stewards hand over the keys they hold. Both are logged by the server.
      if (root !== undefined && keyring.current !== null) {
        await keyring.current
          .recoverGaps(approval.deviceId)
          .catch(() => undefined);
      }
      void steward();
      await refresh();
    }

    return {
      async setupOrganization() {
        setError("");
        await setupOrganization(session);
        await refresh();
      },
      setupDevice,
      unlock,

      lock() {
        void runtimeOf().then(({ vault }) => {
          vault.lock();
          keyring.current = null;
          scopes.current.clear();
          void refresh();
        });
      },

      approve,

      async revoke(deviceId: string) {
        await revokeDevice(client, csrf(), deviceId);
        await refresh();
      },

      createBackup() {
        const current = record.current;
        if (
          current === null ||
          runtime.current === null ||
          current.root === undefined
        )
          return null;
        const { vault, crypto } = runtime.current;
        const recoveryKey = Vault.newRecoveryKey((length) =>
          crypto.randomBytes(length),
        );
        return {
          recoveryKey,
          content: vault.exportBackup(current, recoveryKey),
        };
      },

      async resetThisBrowser() {
        const { vault } = await runtimeOf();
        await vault.erase(account.id);
        keyring.current = null;
        scopes.current.clear();
        await refresh();
      },
    };
  }, [session, refresh, steward, setError]);
}
