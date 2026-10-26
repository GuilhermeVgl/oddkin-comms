import {
  listMessages,
  setReadCursor,
  type Message,
} from "@crewstead/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decryptMessages } from "../../e2ee/content";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import { useEvents } from "../../events";
import { useInbox } from "../../inbox";
import { useWorkspace } from "../../workspace";
import { latestSeq, mergeMessages } from "./timeline";

const POLL_MS = 30_000;
const PAGE = 100;
const MAX_PAGES = 5;

/**
 * The messages of one conversation: loads them, keeps them fresh (events and
 * a slow poll), and tells the server how far the person has read.
 */
export function useMessages(
  conversationId: string,
  crypto: ContentCrypto | null,
  kind: "chat" | "dm",
) {
  const { client } = useWorkspace();
  const { clearUnread } = useInbox();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const lastSeq = useRef(0);
  const readSeq = useRef(0);

  const merge = useCallback((fresh: Message[]) => {
    setMessages((current) => mergeMessages(current, fresh));
    lastSeq.current = latestSeq(lastSeq.current, fresh);
  }, []);

  const markRead = useCallback(async () => {
    if (lastSeq.current <= readSeq.current) return;
    readSeq.current = lastSeq.current;
    try {
      await setReadCursor(client, conversationId, lastSeq.current);
      window.setTimeout(() => clearUnread(conversationId), 1400);
    } catch {
      readSeq.current = 0;
    }
  }, [client, conversationId, clearUnread]);

  // Fetches what is new and re-reads the recent window so edits, deletions and
  // reactions on loaded messages show up.
  const refresh = useCallback(async () => {
    try {
      let after = Math.max(0, lastSeq.current - PAGE);
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const fetched = await listMessages(client, conversationId, after);
        const fresh = await decryptMessages(crypto, fetched, kind);
        merge(fresh);
        if (fresh.length < PAGE) break;
        after = fresh[fresh.length - 1]?.seq ?? after;
      }
      setLoaded(true);
      await markRead();
    } catch {
      setLoaded(true);
    }
  }, [client, conversationId, crypto, kind, merge, markRead]);

  useEffect(() => {
    lastSeq.current = 0;
    readSeq.current = 0;
    setMessages([]);
    setLoaded(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
    // refresh changes with the keys; a key change re-reads without wiping the thread.
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvents((event) => {
    if (event === "resync" || event.contextId === conversationId)
      void refresh();
  });

  return { messages, loaded, refresh };
}
