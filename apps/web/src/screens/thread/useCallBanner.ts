import {
  listActiveCalls,
  listCallHistory,
  startCall,
  type CallRecord,
} from "@crewstead/api-client";
import { useCallback, useEffect, useState } from "react";
import { toastError } from "../../design/toast";
import { csrfToken } from "../../errors";
import { useEvents } from "../../events";
import { useCalls } from "../../shell/calls";
import { useWorkspace } from "../../workspace";
import { callFailureMessage } from "./failures";

export type ActiveCall = { id: string; count: number; max: number };

/**
 * The call running in a conversation (for the "join" button), its history
 * (for the records inside the thread) and the action that starts or joins one.
 * `invitees` are the accounts rung when a new call starts.
 */
export function useCallBanner(conversationId: string, invitees: string[]) {
  const { client } = useWorkspace();
  const { openCall } = useCalls();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);

  const load = useCallback(async () => {
    listCallHistory(client, conversationId)
      .then(setHistory)
      .catch(() => undefined);
    try {
      const active = (await listActiveCalls(client, conversationId))[0];
      setCall(
        active === undefined
          ? null
          : {
              id: active.id,
              count: active.participants.length,
              max: active.maxParticipants,
            },
      );
    } catch {
      setCall(null);
    }
  }, [client, conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEvents((event) => {
    if (
      event === "resync" ||
      (event.contextId === conversationId && event.eventType === "call.changed")
    )
      void load();
  });

  async function startOrJoin() {
    if (call !== null) {
      openCall(call.id);
      return;
    }
    try {
      const created = await startCall(
        client,
        csrfToken(),
        conversationId,
        invitees,
      );
      openCall(created.id);
    } catch (error) {
      toastError(callFailureMessage(error));
    }
  }

  return { call, history, startOrJoin, openCall };
}
