import { getCall, type Call } from "@crewstead/api-client";
import { useEffect, useState } from "react";
import { useEvents } from "../../events";
import type { Client } from "./environment";

/** The call being joined, kept fresh while the room is open. */
export function useCallState(
  client: Client,
  callId: string,
  onUnavailable: (message: string) => void,
) {
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    getCall(client, callId)
      .then(setCall)
      .catch(() => onUnavailable("Chamada indisponível."));
  }, [client, callId]);

  useEvents((event) => {
    if (
      event !== "resync" &&
      event.eventType === "call.changed" &&
      event.resourceId === callId
    ) {
      getCall(client, callId)
        .then(setCall)
        .catch(() => undefined);
    }
  });

  return { call, setCall };
}
