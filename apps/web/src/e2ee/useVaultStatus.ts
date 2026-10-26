import { getTrustRoot, listDevices, type Device } from "@crewstead/api-client";
import { fromBase64Url } from "@crewstead/crypto";
import { useCallback, useRef, useState } from "react";
import { phaseForDevice, phaseWithoutDevice } from "./phase";
import { provisionFromInvitation } from "./provision";
import type { Phase } from "./types";
import type { Session } from "./useSession";
import type { Vault, VaultRecord } from "./vault";

/** Unlocks a browser that manages its own passphrase, or restores the keys a reload kept in the tab. */
async function restoreUnlock(
  vault: Vault,
  stored: VaultRecord,
  accountId: string,
  buildKeyring: () => Promise<void>,
): Promise<void> {
  if (!vault.unlocked && stored.autoPassphrase !== undefined) {
    try {
      await vault.unlock(stored, stored.autoPassphrase);
      vault.rememberInTab(accountId);
      await buildKeyring();
    } catch {
      // Falls through to the passphrase step.
    }
  }
  if (!vault.unlocked && vault.restoreFromTab(stored)) {
    // A reload in the same tab: the keys come back without asking again.
    await buildKeyring();
  }
}

/**
 * Reads the local device, the server's trust root and device list, and settles
 * which step this browser is at. Every action ends by calling `refresh` again.
 */
export function useVaultStatus(
  session: Session,
  parts: {
    setDevices: (devices: Device[]) => void;
    loadApprovals: () => Promise<void>;
    steward: () => Promise<void>;
  },
) {
  const { client, account, record, runtimeOf, buildKeyring } = session;
  const { setDevices, loadApprovals, steward } = parts;
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [persistent, setPersistent] = useState(true);
  const [rootFingerprint, setRootFingerprint] = useState<string | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(
    null,
  );
  const [canApproveWithRoot, setCanApproveWithRoot] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [setupInterrupted, setSetupInterrupted] = useState(false);
  const [autoManaged, setAutoManaged] = useState(false);
  const provisioning = useRef(false);

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
        const provisioned = await provisionFromInvitation({
          client,
          vault,
          crypto,
          account,
          root,
          busy: provisioning,
        });
        if (provisioned !== null) {
          record.current = provisioned;
          await refresh();
          return;
        }
      }
      if (stored === null) {
        setDeviceFingerprint(null);
        setPhase(phaseWithoutDevice(account.historyMode, root !== null));
        return;
      }
      await restoreUnlock(vault, stored, account.id, buildKeyring);
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
      const next = phaseForDevice(device?.state, vault.unlocked);
      if (next === "revoked") vault.lock();
      if (next === "revoked" || next === "pending_approval") {
        setPhase(next);
        return;
      }
      setCanApproveWithRoot(stored.root !== undefined && vault.unlocked);
      setHasRecovery(stored.recovery !== undefined && vault.unlocked);
      setPhase(next);
      if (vault.unlocked) {
        await loadApprovals();
        void steward();
      }
    } catch {
      setError("Não foi possível verificar a segurança deste dispositivo.");
      setPhase("error");
    }
  }, [account, buildKeyring, client, loadApprovals, runtimeOf, steward]);

  return {
    refresh,
    phase,
    error,
    setError,
    persistent,
    rootFingerprint,
    deviceFingerprint,
    canApproveWithRoot,
    hasRecovery,
    setupInterrupted,
    autoManaged,
  };
}
