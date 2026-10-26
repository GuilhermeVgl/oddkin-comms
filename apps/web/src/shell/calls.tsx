import {
  declineCall,
  listCallInvitations,
  type CallInvitation,
} from "@crewstead/api-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "../design/toast";
import { csrfToken } from "../errors";
import { useEvents } from "../events";
import { CallRoom } from "../screens/Call";
import { IncomingCalls } from "./IncomingCalls";
import { useInbox } from "../inbox";
import { useWorkspace } from "../workspace";

type CallsValue = {
  invitations: CallInvitation[];
  openCall: (callId: string) => void;
  decline: (callId: string) => Promise<void>;
};

const CallsContext = createContext<CallsValue | null>(null);

export function useCalls(): CallsValue {
  const value = useContext(CallsContext);
  if (value === null) throw new Error("CallsProvider is missing");
  return value;
}

/** Call invitations wherever the person is, and the full-screen call stage. */
export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { client } = useWorkspace();
  const { channels } = useInbox();
  const [invitations, setInvitations] = useState<CallInvitation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const channelList = useRef(channels);
  channelList.current = channels;

  const reload = useCallback(async () => {
    try {
      const list = await listCallInvitations(client);
      setInvitations(list);
    } catch {
      // The next event reloads.
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (
      event === "resync" ||
      event.eventType === "call.invited" ||
      event.eventType === "call.changed"
    ) {
      void reload();
    }
  });

  const decline = useCallback(
    async (callId: string) => {
      await declineCall(client, csrfToken(), callId).catch(() => undefined);
      await reload();
      toast("Convite recusado.");
    },
    [client, reload],
  );

  const value = useMemo<CallsValue>(
    () => ({ invitations, openCall: setOpenId, decline }),
    [invitations, decline],
  );

  return (
    <CallsContext.Provider value={value}>
      {children}
      <IncomingCalls
        busy={openId !== null}
        invitations={invitations.filter((entry) => entry.callId !== openId)}
        onAnswer={setOpenId}
        onDecline={(callId) => void decline(callId)}
        where={(conversationId) => {
          const channel = channelList.current.find(
            (item) => item.id === conversationId,
          );
          return channel === undefined ? "conversa direta" : `#${channel.name}`;
        }}
      />
      {openId === null ? null : (
        <CallRoom
          callId={openId}
          client={client}
          onClose={() => {
            setOpenId(null);
            void reload();
          }}
        />
      )}
    </CallsContext.Provider>
  );
}
