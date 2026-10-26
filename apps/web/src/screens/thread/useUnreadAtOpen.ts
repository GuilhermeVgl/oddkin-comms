import { useEffect, useRef } from "react";
import { useInbox } from "../../inbox";

/**
 * How many messages were unread when the conversation was opened. Only that
 * count matters for the "Novas mensagens" separator, so later changes are ignored.
 */
export function useUnreadAtOpen(
  conversationId: string,
  kind: "chat" | "dm",
): number {
  const { channels, dms } = useInbox();
  const unread =
    kind === "chat"
      ? (channels.find((entry) => entry.id === conversationId)?.unread ?? 0)
      : Number(dms.find((entry) => entry.id === conversationId)?.unread ?? 0);
  const atOpen = useRef(0);
  useEffect(() => {
    atOpen.current = unread;
  }, [conversationId]);
  return atOpen.current;
}
