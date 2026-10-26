import { useCallback, useRef } from "react";
import { listReadableDomains, needsMaintenance } from "./steward";
import type { Session } from "./useSession";

/**
 * Hands the keys to devices that were approved but still lack them, and
 * rotates after a revocation, in every project, conversation and the sprint
 * domain this device can read. Without it a new device is approved yet sees
 * nothing until someone happens to open each screen.
 *
 * A call made while a pass is running asks for one more pass instead of
 * running alongside it.
 */
export function useSteward(session: Session) {
  const { client, keyring, runtimeOf } = session;
  const stewarding = useRef(false);
  const stewardAgain = useRef(false);
  return useCallback(async () => {
    const ring = keyring.current;
    const { vault } = await runtimeOf();
    if (ring === null || !vault.unlocked) return;
    if (stewarding.current) {
      stewardAgain.current = true;
      return;
    }
    stewarding.current = true;
    try {
      do {
        stewardAgain.current = false;
        for (const domain of await listReadableDomains(client)) {
          if (!needsMaintenance(domain)) continue;
          // Another steward may have acted first; the next event looks again.
          await ring.maintain(domain).catch(() => undefined);
        }
      } while (stewardAgain.current);
    } finally {
      stewarding.current = false;
    }
  }, [client, runtimeOf]);
}
