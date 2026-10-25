import {
  declineCall,
  listCallInvitations,
  type CallInvitation,
} from "@oddkin/api-client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { blip } from "../design/sound";
import { toast } from "../design/toast";
import { csrfToken } from "../errors";
import { useEvents } from "../events";
import { CallRoom } from "../screens/Call";
import { nameOf } from "../design/people";
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
  const known = useRef<Set<string> | null>(null);
  const channelList = useRef(channels);
  channelList.current = channels;

  const reload = useCallback(async () => {
    try {
      const list = await listCallInvitations(client);
      setInvitations(list);
      const before = known.current;
      known.current = new Set(list.map((entry) => entry.callId));
      if (before === null) return;
      for (const entry of list) {
        if (before.has(entry.callId)) continue;
        const channel = channelList.current.find(
          (item) => item.id === entry.conversationId,
        );
        const where =
          channel === undefined ? "uma conversa direta" : `#${channel.name}`;
        const who = entry.startedBy === "" ? "Alguém" : nameOf(entry.startedBy);
        blip("ok");
        toast(`${who} está chamando em ${where}.`, {
          icon: "phone",
          ms: 6000,
          act: ["Entrar", () => setOpenId(entry.callId)],
        });
      }
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
