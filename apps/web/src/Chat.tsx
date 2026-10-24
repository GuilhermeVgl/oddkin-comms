import {
  createApiClient,
  deleteMessage,
  editMessage,
  listConversations,
  listMessages,
  readCookie,
  sendMessage,
  setReadCursor,
  toggleReaction,
  type Conversation,
  type Message,
  type ProjectMember,
} from "@oddkin/api-client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Attachments } from "./Attachments";
import { CallBar } from "./Calls";
import { useEvents } from "./events";

type Client = ReturnType<typeof createApiClient>;

const FALLBACK_POLL_MS = 30_000;
const PAGE = 100;
const QUICK_REACTIONS = ["👍", "❤️", "🎉"];

function token(): string | null {
  return readCookie(document.cookie, "oddkin_csrf");
}

function statusOf(cause: unknown): number | null {
  return typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    typeof cause.status === "number"
    ? cause.status
    : null;
}

export function ProjectChat({
  client,
  projectId,
  me,
  moderator,
  members,
}: {
  client: Client;
  projectId: string;
  me: string;
  moderator: boolean;
  members: ProjectMember[];
}) {
  const [channels, setChannels] = useState<Conversation[] | null>(null);
  const [status, setStatus] = useState<"ok" | "forbidden" | "error">("ok");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    listConversations(client, projectId)
      .then((list) => active && setChannels(list))
      .catch((cause: unknown) => {
        if (!active) return;
        setStatus(statusOf(cause) === 403 ? "forbidden" : "error");
        setChannels([]);
      });
    return () => {
      active = false;
    };
  }, [client, projectId, reload]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "message.created") {
      setReload((value) => value + 1);
    }
  });

  if (status === "forbidden") return null;
  const channel = channels?.[0];
  return (
    <section className="chat" aria-labelledby="chat-title">
      <h3 id="chat-title">
        Conversa {channel ? `#${channel.name}` : ""}
        {channel && channel.unread > 0 ? (
          <span className="badge" aria-label={`${channel.unread} não lidas`}>
            {channel.unread}
          </span>
        ) : null}
      </h3>
      {channels === null ? <p>Carregando…</p> : null}
      {status === "error" ? (
        <p className="empty-note">Não foi possível abrir a conversa.</p>
      ) : null}
      {channel ? (
        <ConversationView
          client={client}
          conversationId={channel.id}
          me={me}
          members={members}
          moderator={moderator}
        />
      ) : null}
    </section>
  );
}

export function ConversationView({
  client,
  conversationId,
  me,
  moderator,
  members = [],
}: {
  client: Client;
  conversationId: string;
  me: string;
  moderator: boolean;
  members?: ProjectMember[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const lastSeq = useRef(0);
  const readSeq = useRef(0);

  const merge = useCallback((fresh: Message[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of fresh) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
    const newest = fresh[fresh.length - 1]?.seq ?? 0;
    lastSeq.current = Math.max(lastSeq.current, newest);
  }, []);

  const markRead = useCallback(async () => {
    const csrf = token();
    if (csrf === null || lastSeq.current <= readSeq.current) return;
    readSeq.current = lastSeq.current;
    try {
      await setReadCursor(client, csrf, conversationId, lastSeq.current);
    } catch {
      readSeq.current = 0;
    }
  }, [client, conversationId]);

  // Fetches everything new, and re-reads the recent window so edits,
  // deletions and reactions to already-loaded messages show up.
  const refresh = useCallback(async () => {
    try {
      let after = Math.max(0, lastSeq.current - PAGE);
      for (let page = 0; page < 5; page += 1) {
        const fresh = await listMessages(client, conversationId, after);
        merge(fresh);
        if (fresh.length < PAGE) break;
        after = fresh[fresh.length - 1]?.seq ?? after;
      }
      await markRead();
    } catch {
      // The last known messages stay on screen; the next event or poll retries.
    }
  }, [client, conversationId, merge, markRead]);

  useEffect(() => {
    lastSeq.current = 0;
    readSeq.current = 0;
    setMessages([]);
    void refresh();
    const timer = window.setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEvents((event) => {
    if (event === "resync" || event.contextId === conversationId) {
      void refresh();
    }
  });

  async function act(action: (csrf: string) => Promise<unknown>) {
    const csrf = token();
    if (csrf === null) return;
    try {
      await action(csrf);
      setError("");
    } catch (cause) {
      setError(
        statusOf(cause) === 403
          ? "Você não tem permissão para isso."
          : "Não foi possível concluir. Tente novamente.",
      );
    }
    await refresh();
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing !== null) {
      const { id, body } = editing;
      await act((csrf) => editMessage(client, csrf, id, body));
      setEditing(null);
      return;
    }
    // A retry after a failure reuses the same id, so it cannot duplicate.
    const mutationId = pending ?? crypto.randomUUID();
    setPending(mutationId);
    const mentionIds = members
      .filter((member) => draft.includes(`@${member.email}`))
      .map((member) => member.accountId);
    await act(async (csrf) => {
      await sendMessage(client, csrf, conversationId, draft, mutationId, {
        ...(replyTo === null ? {} : { replyToId: replyTo.id }),
        ...(mentionIds.length === 0 ? {} : { mentionIds }),
      });
      setDraft("");
      setReplyTo(null);
      setPending(null);
    });
  }

  const byId = new Map(messages.map((message) => [message.id, message]));
  return (
    <div className="conversation">
      <ol aria-live="polite" className="messages">
        {messages.length === 0 ? (
          <li className="empty-note">Nenhuma mensagem ainda.</li>
        ) : null}
        {messages.map((message) => {
          const quoted =
            message.replyToId === undefined
              ? undefined
              : byId.get(message.replyToId);
          const mine = message.authorEmail === me;
          return (
            <li key={message.id}>
              <strong>{message.authorEmail}</strong>
              <span>
                {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {message.editedAt !== undefined && !message.deleted
                  ? " · editada"
                  : ""}
              </span>
              {message.replyToId !== undefined ? (
                <blockquote>
                  {quoted === undefined || quoted.deleted
                    ? "Mensagem indisponível"
                    : quoted.body}
                </blockquote>
              ) : null}
              {message.deleted ? (
                <p className="empty-note">Mensagem removida</p>
              ) : (
                <p>{message.body}</p>
              )}
              {!message.deleted ? (
                <div className="message-actions">
                  {message.reactions.map((reaction) => (
                    <button
                      aria-pressed={reaction.mine}
                      className="reaction"
                      key={reaction.emoji}
                      onClick={() =>
                        void act((csrf) =>
                          toggleReaction(
                            client,
                            csrf,
                            message.id,
                            reaction.emoji,
                          ),
                        )
                      }
                      type="button"
                    >
                      {reaction.emoji} {reaction.count}
                    </button>
                  ))}
                  {QUICK_REACTIONS.filter(
                    (emoji) =>
                      !message.reactions.some((entry) => entry.emoji === emoji),
                  ).map((emoji) => (
                    <button
                      aria-label={`Reagir com ${emoji}`}
                      className="reaction reaction--add"
                      key={emoji}
                      onClick={() =>
                        void act((csrf) =>
                          toggleReaction(client, csrf, message.id, emoji),
                        )
                      }
                      type="button"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    className="text-button"
                    onClick={() => setReplyTo(message)}
                    type="button"
                  >
                    Responder
                  </button>
                  {mine ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        setEditing({ id: message.id, body: message.body })
                      }
                      type="button"
                    >
                      Editar
                    </button>
                  ) : null}
                  {mine || moderator ? (
                    <button
                      className="text-button"
                      onClick={() =>
                        void act((csrf) =>
                          deleteMessage(client, csrf, message.id),
                        )
                      }
                      type="button"
                    >
                      Apagar
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {replyTo !== null ? (
        <p className="reply-banner">
          Respondendo a {replyTo.authorEmail}: {replyTo.body}{" "}
          <button
            className="text-button"
            onClick={() => setReplyTo(null)}
            type="button"
          >
            Cancelar
          </button>
        </p>
      ) : null}
      <form
        className="inline-form"
        onSubmit={(event) => void handleSend(event)}
      >
        <label className="visually-hidden" htmlFor={`draft-${conversationId}`}>
          Mensagem
        </label>
        <input
          id={`draft-${conversationId}`}
          maxLength={10000}
          onChange={(event) =>
            editing === null
              ? setDraft(event.target.value)
              : setEditing({ ...editing, body: event.target.value })
          }
          placeholder={
            editing === null ? "Escreva uma mensagem" : "Editando mensagem"
          }
          required
          value={editing === null ? draft : editing.body}
        />
        <button type="submit">{editing === null ? "Enviar" : "Salvar"}</button>
        {editing !== null ? (
          <button
            className="text-button"
            onClick={() => setEditing(null)}
            type="button"
          >
            Cancelar
          </button>
        ) : null}
      </form>
      <p aria-live="polite" className="form-message">
        {error}
      </p>
      <CallBar
        client={client}
        conversationId={conversationId}
        isDirect={members.length === 0}
        me={me}
        members={members}
      />
      <Attachments
        client={client}
        context={{ contextType: "conversation", contextId: conversationId }}
      />
    </div>
  );
}
