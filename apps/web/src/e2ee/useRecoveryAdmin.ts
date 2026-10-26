import { listRecoveryAudit, listRecoveryGaps } from "@crewstead/api-client";
import { useMemo } from "react";
import { rotateRecoveryIdentity } from "./rotateRecovery";
import type { E2EEApi } from "./types";
import type { Session } from "./useSession";

export type RecoveryAdmin = Pick<
  E2EEApi,
  "recoveryGaps" | "restoreAccess" | "rotateRecoveryIdentity" | "recoveryAudit"
>;

/** Administrative recovery: only the recovery administrator, only while unlocked. */
export function useRecoveryAdmin(
  session: Session,
  refresh: () => Promise<void>,
): RecoveryAdmin {
  return useMemo(
    () => ({
      recoveryGaps: () => listRecoveryGaps(session.client),

      async restoreAccess() {
        const ring = session.keyring.current;
        if (ring === null) throw new Error("locked");
        return ring.recoverGaps();
      },

      async rotateRecoveryIdentity() {
        await rotateRecoveryIdentity(session);
        await refresh();
      },

      recoveryAudit: () => listRecoveryAudit(session.client),
    }),
    [session, refresh],
  );
}
