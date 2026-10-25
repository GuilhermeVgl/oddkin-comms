import {
  listConversations,
  listDirectContacts,
  listDirectConversations,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type DirectContact,
  type DirectConversation,
  type Notification,
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
import { decryptChannel } from "./e2ee/content";
import { csrfToken } from "./errors";
import { useEvents } from "./events";
import { useWorkspace } from "./workspace";

export type Channel = {
  id: string;
  projectId: string;
  name: string;
  unread: number;
};

type InboxValue = {
  channels: Channel[];
  dms: DirectConversation[];
  contacts: DirectContact[];
  /** Unread messages in every channel and direct conversation. */
  unread: number;
  notifications: Notification[];
  unreadNotifications: number;
  /** Counts up whenever a new unread notification arrives, so the bell can react. */
  bellPulse: number;
  reloadChat: () => Promise<void>;
  markNotification: (id: string) => Promise<void>;
  markAllNotifications: () => Promise<void>;
  /** Clears the unread count of a conversation after it was read. */
  clearUnread: (conversationId: string) => void;
};

const InboxContext = createContext<InboxValue | null>(null);

export function useInbox(): InboxValue {
  const value = useContext(InboxContext);
  if (value === null) throw new Error("InboxProvider is missing");
  return value;
}

/** Channels, direct conversations, unread counts and notifications. */
export function InboxProvider({ children }: { children: React.ReactNode }) {
  const { client, projects } = useWorkspace();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<DirectConversation[]>([]);
  const [contacts, setContacts] = useState<DirectContact[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [bellPulse, setBellPulse] = useState(0);
  const seenUnread = useRef<number | null>(null);

  const reloadChat = useCallback(async () => {
    const lists = await Promise.all(
      (projects ?? []).map(async (state) => {
        try {
          const entries = await listConversations(client, state.project.id);
          return await Promise.all(
            entries.map(async (entry): Promise<Channel> => {
              const named = await decryptChannel(state.crypto, entry);
              return {
                id: named.id,
                projectId: state.project.id,
                name: named.name,
                unread: Number(named.unread),
              };
            }),
          );
        } catch {
          return [];
        }
      }),
    );
    setChannels(lists.flat());
    try {
      const [people, existing] = await Promise.all([
        listDirectContacts(client),
        listDirectConversations(client),
      ]);
      setContacts(people);
      setDms(existing);
    } catch {
      // Keeps the last known list; the next event reloads.
    }
  }, [client, projects]);

  const reloadNotifications = useCallback(async () => {
    try {
      const list = await listNotifications(client);
      setNotifications(list);
      const unread = list.filter((entry) => !entry.read).length;
      if (seenUnread.current !== null && unread > seenUnread.current) {
        setBellPulse((value) => value + 1);
      }
      seenUnread.current = unread;
    } catch {
      // Keeps what is shown.
    }
  }, [client]);

  useEffect(() => {
    void reloadChat();
  }, [reloadChat]);

  useEffect(() => {
    void reloadNotifications();
  }, [reloadNotifications]);

  useEvents((event) => {
    if (event === "resync") {
      void reloadChat();
      void reloadNotifications();
      return;
    }
    if (event.eventType.startsWith("message.")) void reloadChat();
    if (event.eventType === "notification.created") void reloadNotifications();
  });

  const markNotification = useCallback(
    async (id: string) => {
      await markNotificationRead(client, csrfToken(), id).catch(
        () => undefined,
      );
      await reloadNotifications();
    },
    [client, reloadNotifications],
  );

  const markAllNotifications = useCallback(async () => {
    await markAllNotificationsRead(client, csrfToken()).catch(() => undefined);
    await reloadNotifications();
  }, [client, reloadNotifications]);

  const clearUnread = useCallback((conversationId: string) => {
    setChannels((current) =>
      current.map((entry) =>
        entry.id === conversationId ? { ...entry, unread: 0 } : entry,
      ),
    );
    setDms((current) =>
      current.map((entry) =>
        entry.id === conversationId ? { ...entry, unread: 0 } : entry,
      ),
    );
  }, []);

  const value = useMemo<InboxValue>(
    () => ({
      channels,
      dms,
      contacts,
      unread:
        channels.reduce((sum, entry) => sum + entry.unread, 0) +
        dms.reduce((sum, entry) => sum + Number(entry.unread), 0),
      notifications,
      unreadNotifications: notifications.filter((entry) => !entry.read).length,
      bellPulse,
      reloadChat,
      markNotification,
      markAllNotifications,
      clearUnread,
    }),
    [
      channels,
      dms,
      contacts,
      notifications,
      bellPulse,
      reloadChat,
      markNotification,
      markAllNotifications,
      clearUnread,
    ],
  );

  return (
    <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
  );
}
