import type { Message, ProjectMember } from "@crewstead/api-client";
import { useState } from "react";
import { blip } from "../../design/sound";
import { toastError } from "../../design/toast";
import { sendChannelMessage } from "../../e2ee/content";
import type { ContentCrypto } from "../../e2ee/projectCrypto";
import { useWorkspace } from "../../workspace";
import { mentionedAccountIds } from "../mentions";
import { sendFailureMessage } from "./failures";
import { setOutgoingState, type Outgoing } from "./outgoing";

/** The message being written, the reply it quotes and the messages still on their way. */
export function useComposer({
  conversationId,
  crypto,
  kind,
  members,
  refresh,
  onQueued,
}: {
  conversationId: string;
  crypto: ContentCrypto | null;
  kind: "chat" | "dm";
  members: ProjectMember[];
  refresh: () => Promise<void>;
  /** Called when a new message is queued, so the list can scroll down. */
  onQueued: () => void;
}) {
  const { client } = useWorkspace();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);

  function reset() {
    setOutgoing([]);
    setReplyTo(null);
  }

  async function send(retry?: Outgoing) {
    const body = retry?.body ?? draft.trim();
    if (body === "") return;
    // A retry reuses the id, so it can never duplicate the message.
    const id = retry?.id ?? window.crypto.randomUUID();
    const replyId =
      retry?.replyToId ?? (retry === undefined ? replyTo?.id : undefined);
    const mentionIds = mentionedAccountIds(members, body);
    if (retry === undefined) {
      setOutgoing((list) => [
        ...list,
        {
          id,
          body,
          ...(replyId === undefined ? {} : { replyToId: replyId }),
          state: "pending",
        },
      ]);
      setDraft("");
      setReplyTo(null);
      onQueued();
    } else {
      setOutgoing((list) => setOutgoingState(list, id, "pending"));
    }
    try {
      await sendChannelMessage(
        client,
        crypto,
        conversationId,
        {
          body,
          mutationId: id,
          ...(replyId === undefined ? {} : { replyToId: replyId }),
          ...(mentionIds.length === 0 ? {} : { mentionIds }),
        },
        kind,
      );
      setOutgoing((list) => list.filter((entry) => entry.id !== id));
      blip("ok");
      await refresh();
    } catch (error) {
      setOutgoing((list) => setOutgoingState(list, id, "failed"));
      const message = sendFailureMessage(error);
      if (message !== null) toastError(message);
    }
  }

  return { draft, setDraft, replyTo, setReplyTo, outgoing, send, reset };
}
