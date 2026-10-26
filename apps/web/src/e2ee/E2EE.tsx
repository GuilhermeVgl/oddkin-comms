import type { CurrentAccount } from "@crewstead/api-client";
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useEvents, useReloadOn } from "../events";
import type { E2EEApi } from "./types";
import { useApprovals } from "./useApprovals";
import { useContentAccess } from "./useContentAccess";
import { useDeviceActions } from "./useDeviceActions";
import { useHistoryInvites } from "./useHistoryInvites";
import { useRecoveryAdmin } from "./useRecoveryAdmin";
import { useSession } from "./useSession";
import { useSteward } from "./useSteward";
import { useVaultStatus } from "./useVaultStatus";

export type { E2EEApi, Phase, PendingApproval } from "./types";

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

/**
 * Keeps this browser's keys and the device state for the signed-in account and
 * offers them to the screens. The parts live in their own hooks; this one only
 * wires them together and publishes the result.
 */
export function E2EEProvider({
  account,
  children,
}: {
  account: CurrentAccount;
  children: React.ReactNode;
}) {
  const session = useSession(account);
  const { devices, setDevices, approvals, loadApprovals } =
    useApprovals(session);
  const steward = useSteward(session);
  const status = useVaultStatus(session, {
    setDevices,
    loadApprovals,
    steward,
  });
  const { refresh } = status;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useReloadOn(["device.changed"], () => void refresh());
  useEvents((event) => {
    if (event !== "resync" && event.eventType === "key-domain.changed")
      void steward();
  });

  const device = useDeviceActions(session, {
    refresh,
    steward,
    setError: status.setError,
  });
  const content = useContentAccess(session);
  const recovery = useRecoveryAdmin(session, refresh);
  const history = useHistoryInvites(session, status.rootFingerprint);

  const api = useMemo<E2EEApi>(
    () => ({
      phase: status.phase,
      error: status.error,
      persistent: status.persistent,
      rootFingerprint: status.rootFingerprint,
      deviceFingerprint: status.deviceFingerprint,
      devices,
      approvals,
      canApproveWithRoot: status.canApproveWithRoot,
      setupInterrupted: status.setupInterrupted,
      autoManaged: status.autoManaged,
      canBackup:
        session.record.current?.root !== undefined &&
        session.record.current.autoPassphrase !== undefined,
      hasRecoveryIdentity: status.hasRecovery,
      ...history,
      ...device,
      ...content,
      ...recovery,
    }),
    [
      status.phase,
      status.error,
      status.persistent,
      status.rootFingerprint,
      status.deviceFingerprint,
      status.canApproveWithRoot,
      status.setupInterrupted,
      status.autoManaged,
      status.hasRecovery,
      devices,
      approvals,
      session,
      history,
      device,
      content,
      recovery,
    ],
  );

  return <E2EEContext.Provider value={api}>{children}</E2EEContext.Provider>;
}
