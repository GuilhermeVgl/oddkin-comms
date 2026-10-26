import { useCallback } from "react";
import { toastError } from "../../design/toast";
import { actFailureMessage } from "./failures";

/** Runs a reaction, edit or deletion, reports a failure, and re-reads the conversation. */
export function useAct(refresh: () => Promise<void>) {
  return useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        toastError(actFailureMessage(error));
      }
      await refresh();
    },
    [refresh],
  );
}
