import {
  CallConflictError,
  ApiStatusError,
  deleteMessage,
  getConversationKeyDomain,
  listActiveCalls,
  listCallHistory,
  listMessages,
  setReadCursor,
  startCall,
  toggleReaction,
  type CallRecord,
  type Message,
  type ProjectMember,
} from "@crewstead/api-client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Attachments } from "../Attachments";
import { confirmDialog } from "../design/confirm";
import { fmtClock, fmtLong } from "../design/format";
import { Icon } from "../design/icons";
import { Menu, useMenu } from "../design/Menu";
import { Modal } from "../design/Modal";
import { nameOf } from "../design/people";
import { Avatar, Banner } from "../design/primitives";
import { Rich } from "../design/rich";
import { blip } from "../design/sound";
import { Duo } from "../design/Sprite";
import { toast } from "../design/toast";
import { useOptionalE2EE } from "../e2ee/E2EE";
import {
  decryptMessages,
  editChannelMessage,
  EncryptionUnavailableError,
  migrateOwnMessages,
  sendChannelMessage,
} from "../e2ee/content";
import type { ContentCrypto } from "../e2ee/projectCrypto";
import { csrfToken } from "../errors";
import { useEvents } from "../events";
import { useInbox } from "../inbox";
import { useCalls } from "../shell/calls";
import { CallRecordRow } from "./CallRecordRow";
import { useWorkspace } from "../workspace";

const POLL_MS = 30_000;
const PAGE = 100;
const EMOJI = [
  "👍",
  "🙌",
  "🎉",
  "👀",
  "✅",
  "🚀",
  "❤️",
  "😄",
  "🤔",
  "🙏",
  "🔥",
  "👏",
];

export type ThreadTarget =
  | {
      kind: "chat";
      id: string;
      title: string;
      subtitle: string;
      members: ProjectMember[];
      crypto: ContentCrypto | null;
      moderator: boolean;
      canSend: boolean;
      canCall: boolean;
      canReact: boolean;
      canUpload: boolean;
    }
  | {
      kind: "dm";
      id: string;
      title: string;
      subtitle: string;
      peerEmail: string;
      peerId: string;
    };

function statusOf(error: unknown): number | null {
  return error instanceof ApiStatusError ? error.status : null;
}

/** The DM's keys: the conversation's own domain, opened while this browser is unlocked. */
function useDmCrypto(id: string, active: boolean) {
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const { client } = useWorkspace();
  const [crypto, setCrypto] = useState<ContentCrypto | null>(null);
  const [keyed, setKeyed] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setCrypto(null);
    if (!active) return undefined;
    getConversationKeyDomain(client, id)
      .then((domain) => alive && setKeyed((domain?.currentGeneration ?? 0) > 0))
      .catch(() => alive && setKeyed(false));
    if (unlocked && e2ee !== null) {
      e2ee
        .openConversation(id, { maintain: true })
        .then((opened) => alive && setCrypto(opened))
        .catch(() => alive && setCrypto(null));
    }
    return () => {
      alive = false;
    };
  }, [client, id, active, unlocked, e2ee, version]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "key-domain.changed")
      setVersion((v) => v + 1);
  });

  return { crypto, keyed, unlocked, refresh: () => setVersion((v) => v + 1) };
}

type Outgoing = {
  id: string;
  body: string;
  replyToId?: string;
  state: "pending" | "failed";
};

export function Thread({
  target,
  me,
  onBack,
}: {
  target: ThreadTarget;
  me: { id: string; email: string };
  onBack: () => void;
}) {
  const { client } = useWorkspace();
  const { channels, dms, clearUnread } = useInbox();
  const { openCall } = useCalls();
  const dm = useDmCrypto(target.id, target.kind === "dm");
  const crypto = target.kind === "chat" ? target.crypto : dm.crypto;
  const kind = target.kind === "chat" ? "chat" : "dm";
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState(false);
  const [mention, setMention] = useState<string | null>(null);
  const [call, setCall] = useState<{
    id: string;
    count: number;
    max: number;
  } | null>(null);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [dmStatus, setDmStatus] = useState("");
  const lastSeq = useRef(0);
  const readSeq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const emoji = useMenu<"compose" | string>();
  const unreadAtOpen = useRef(0);
  const stick = useRef(true);

  const unread =
    target.kind === "chat"
      ? (channels.find((entry) => entry.id === target.id)?.unread ?? 0)
      : Number(dms.find((entry) => entry.id === target.id)?.unread ?? 0);

  useEffect(() => {
    unreadAtOpen.current = unread;
    // Only the count when the conversation was opened matters for the separator.
  }, [target.id]);

  const merge = useCallback((fresh: Message[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of fresh) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.seq - b.seq);
    });
    lastSeq.current = Math.max(
      lastSeq.current,
      fresh[fresh.length - 1]?.seq ?? 0,
    );
  }, []);

  const markRead = useCallback(async () => {
    if (lastSeq.current <= readSeq.current) return;
    readSeq.current = lastSeq.current;
    try {
      await setReadCursor(client, csrfToken(), target.id, lastSeq.current);
      window.setTimeout(() => clearUnread(target.id), 1400);
    } catch {
      readSeq.current = 0;
    }
  }, [client, target.id, clearUnread]);

  // Fetches what is new and re-reads the recent window so edits, deletions and
  // reactions on loaded messages show up.
  const refresh = useCallback(async () => {
    try {
      let after = Math.max(0, lastSeq.current - PAGE);
      for (let page = 0; page < 5; page += 1) {
        const fetched = await listMessages(client, target.id, after);
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
  }, [client, target.id, crypto, kind, merge, markRead]);

  useEffect(() => {
    lastSeq.current = 0;
    readSeq.current = 0;
    setMessages([]);
    setLoaded(false);
    setOutgoing([]);
    setReplyTo(null);
    setEditing(null);
    setQuery("");
    setFiles(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
    // refresh changes with the keys; a key change re-reads without wiping the thread.
  }, [target.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEvents((event) => {
    if (event === "resync" || event.contextId === target.id) void refresh();
  });

  const loadCall = useCallback(async () => {
    listCallHistory(client, target.id)
      .then(setHistory)
      .catch(() => undefined);
    try {
      const active = (await listActiveCalls(client, target.id))[0];
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
  }, [client, target.id]);

  useEffect(() => {
    void loadCall();
  }, [loadCall]);

  useEvents((event) => {
    if (
      event === "resync" ||
      (event.contextId === target.id && event.eventType === "call.changed")
    )
      void loadCall();
  });

  useLayoutEffect(() => {
    const element = box.current;
    if (element !== null && stick.current)
      element.scrollTop = element.scrollHeight;
  }, [messages, outgoing, loaded]);

  const byId = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const members = target.kind === "chat" ? target.members : [];
  const mentionable = useMemo(
    () =>
      new Set(
        members.map((member) => nameOf(member.email).split(" ")[0] ?? ""),
      ),
    [members],
  );
  const canSend = target.kind === "dm" || target.canSend;
  const canReact = target.kind === "dm" || target.canReact;
  const canCall = target.kind === "dm" || target.canCall;

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      toast(
        error instanceof EncryptionUnavailableError || statusOf(error) === 409
          ? "Esta conversa é cifrada. Libere a criptografia deste navegador."
          : statusOf(error) === 403
            ? "Seu perfil não permite isso."
            : "Não foi possível concluir. Tente novamente.",
        { kind: "err" },
      );
    }
    await refresh();
  }

  async function send(retry?: Outgoing) {
    const body = retry?.body ?? draft.trim();
    if (body === "") return;
    // A retry reuses the id, so it can never duplicate the message.
    const id = retry?.id ?? window.crypto.randomUUID();
    const reply = retry === undefined ? replyTo : null;
    const replyId = retry?.replyToId ?? reply?.id;
    const mentionIds = members
      .filter((member) =>
        body.includes(`@${nameOf(member.email).split(" ")[0] ?? ""}`),
      )
      .map((member) => member.accountId);
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
      stick.current = true;
    } else {
      setOutgoing((list) =>
        list.map((entry) =>
          entry.id === id ? { ...entry, state: "pending" } : entry,
        ),
      );
    }
    try {
      await sendChannelMessage(
        client,
        csrfToken(),
        crypto,
        target.id,
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
      setOutgoing((list) =>
        list.map((entry) =>
          entry.id === id ? { ...entry, state: "failed" } : entry,
        ),
      );
      if (
        error instanceof EncryptionUnavailableError ||
        statusOf(error) === 409
      )
        toast(
          "Esta conversa é cifrada. Libere a criptografia deste navegador.",
          { kind: "err" },
        );
    }
  }

  async function startOrJoin() {
    if (call !== null) {
      openCall(call.id);
      return;
    }
    const invitees =
      target.kind === "chat"
        ? target.members
            .filter((member) => member.email !== me.email)
            .map((member) => member.accountId)
        : [];
    try {
      const created = await startCall(client, csrfToken(), target.id, invitees);
      openCall(created.id);
    } catch (error) {
      toast(
        error instanceof CallConflictError
          ? "Já existe uma chamada em andamento ou você está em outra."
          : error instanceof ApiStatusError && error.status === 503
            ? "O servidor de chamadas não está disponível."
            : "Não foi possível iniciar a chamada.",
        { kind: "err" },
      );
    }
  }

  async function enableDm() {
    if (dm.crypto === null) return;
    setDmStatus("Ativando…");
    try {
      await dm.crypto.enable(csrfToken);
      const result = await migrateOwnMessages(
        client,
        csrfToken(),
        dm.crypto,
        target.id,
        me.email,
        "dm",
      );
      setDmStatus("");
      toast(
        `Conversa cifrada. ${result.migrated} mensagens suas antigas foram cifradas.`,
        {
          icon: "shieldOk",
        },
      );
      dm.refresh();
    } catch {
      setDmStatus("");
      toast("Não foi possível ativar. Tente de novo.", { kind: "err" });
    }
  }

  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? messages
      : messages.filter((message) =>
          message.body.toLowerCase().includes(needle),
        );
  const firstUnread =
    unreadAtOpen.current > 0 ? shown.length - unreadAtOpen.current : -1;
  let lastDay = "";
  // Calls sit between the messages, at the moment they started.
  const timeline: (
    | { kind: "message"; message: Message; index: number }
    | { kind: "call"; record: CallRecord }
  )[] = [];
  const records = needle === "" ? [...history].reverse() : [];
  shown.forEach((message, index) => {
    while (
      records[0] !== undefined &&
      records[0].startedAt <= message.createdAt
    ) {
      timeline.push({ kind: "call", record: records.shift() as CallRecord });
    }
    timeline.push({ kind: "message", message, index });
  });
  for (const record of records) timeline.push({ kind: "call", record });

  return (
    <section aria-label="Conversa" className="thread" id="thread">
      <div className="th-h">
        <button
          aria-label="Voltar às conversas"
          className="iconbtn backbtn"
          onClick={onBack}
          type="button"
        >
          <Icon name="left" />
        </button>
        <div className="grow col">
          <h2>{target.title}</h2>
          <span className="xs muted">{target.subtitle}</span>
        </div>
        <span className="avs">
          {target.kind === "chat"
            ? members
                .slice(0, 5)
                .map((member) => (
                  <Avatar
                    email={member.email}
                    id={member.accountId}
                    key={member.accountId}
                    size="sm"
                  />
                ))
            : [
                <Avatar email={me.email} id={me.id} key="me" size="sm" />,
                <Avatar
                  email={target.peerEmail}
                  id={target.peerId}
                  key="peer"
                  size="sm"
                />,
              ]}
        </span>
        <div className="field" style={{ width: 180 }}>
          <input
            aria-label="Buscar nesta conversa"
            className="inp"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nesta conversa"
            style={{ height: 36 }}
            type="search"
            value={query}
          />
        </div>
        <button
          aria-pressed={files}
          className="btn sm"
          onClick={() => setFiles((value) => !value)}
          type="button"
        >
          <Icon name="clip" size="sm" />
          Arquivos
        </button>
        <button
          className="btn sm"
          disabled={!canCall}
          onClick={() => void startOrJoin()}
          title={
            canCall
              ? undefined
              : "Seu perfil neste projeto não permite iniciar chamadas"
          }
          type="button"
        >
          <Icon name="video" size="sm" />
          {call === null
            ? "Iniciar chamada"
            : `Entrar na chamada (${call.count}/${call.max})`}
        </button>
      </div>
      {files ? (
        <div
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <Attachments
            canUpload={target.kind === "dm" || target.canUpload}
            client={client}
            context={{ contextType: "conversation", contextId: target.id }}
          />
        </div>
      ) : null}
      {target.kind === "dm" ? (
        <DmBanner dm={dm} enable={() => void enableDm()} status={dmStatus} />
      ) : null}
      <div
        aria-label="Mensagens"
        aria-live="polite"
        className="msgs"
        id="msgs"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            80;
        }}
        ref={box}
        tabIndex={0}
      >
        {needle !== "" ? (
          <Banner style={{ margin: "4px 0 10px" }}>
            Busca local: só mensagens já sincronizadas. Nada é enviado ao
            servidor.
          </Banner>
        ) : null}
        {timeline.map((entry) => {
          if (entry.kind === "call") {
            const callDay = fmtLong(new Date(entry.record.startedAt));
            const callSeparator = callDay !== lastDay;
            lastDay = callDay;
            return (
              <div key={`call-${entry.record.id}`}>
                {callSeparator ? (
                  <div className="daysep">
                    <span>
                      {new Date(entry.record.startedAt).toDateString() ===
                      new Date().toDateString()
                        ? "Hoje"
                        : callDay}
                    </span>
                  </div>
                ) : null}
                <CallRecordRow
                  canJoin={canCall}
                  meEmail={me.email}
                  onJoin={() => openCall(entry.record.id)}
                  record={entry.record}
                />
              </div>
            );
          }
          const { message, index } = entry;
          const day = fmtLong(new Date(message.createdAt));
          const separator = day !== lastDay;
          lastDay = day;
          const quoted =
            message.replyToId === undefined
              ? undefined
              : byId.get(message.replyToId);
          const mine = message.authorEmail === me.email;
          const reactions = message.reactions.filter(
            (reaction) => reaction.count > 0,
          );
          return (
            <div key={message.id}>
              {separator ? (
                <div className="daysep">
                  <span>
                    {new Date(message.createdAt).toDateString() ===
                    new Date().toDateString()
                      ? "Hoje"
                      : day}
                  </span>
                </div>
              ) : null}
              {needle === "" && index === firstUnread ? (
                <div className="unread" role="separator">
                  <span>Novas mensagens</span>
                </div>
              ) : null}
              <article
                aria-label={`${nameOf(message.authorEmail)}: ${message.body.slice(0, 80)}`}
                className="msg"
                data-mid={message.id}
                tabIndex={0}
              >
                <Avatar
                  email={message.authorEmail}
                  id={message.authorId ?? message.authorEmail}
                  size="lg"
                />
                <div className="mb">
                  <div className="mh">
                    <b>{nameOf(message.authorEmail)}</b>
                    <time>{fmtClock(message.createdAt)}</time>
                    {message.editedAt !== undefined && !message.deleted ? (
                      <span className="ed">(editada)</span>
                    ) : null}
                  </div>
                  {message.replyToId === undefined ? null : quoted ===
                      undefined || quoted.deleted ? (
                    <div className="quote">
                      <Icon name="lock" size="sm" />
                      <span>Mensagem indisponível</span>
                    </div>
                  ) : (
                    <div className="quote">
                      <Icon name="reply" size="sm" />
                      <b>{nameOf(quoted.authorEmail)}</b>
                      <span>{quoted.body}</span>
                    </div>
                  )}
                  {message.deleted ? (
                    <div className="tx muted">Mensagem removida</div>
                  ) : (
                    <div className="tx">
                      <Rich mentions={mentionable} text={message.body} />
                    </div>
                  )}
                  {reactions.length > 0 && !message.deleted ? (
                    <div className="rx">
                      {reactions.map((reaction) => (
                        <button
                          aria-label={`${reaction.emoji} ${reaction.count}, ${
                            reaction.mine ? "remover sua reação" : "reagir"
                          }`}
                          aria-pressed={reaction.mine}
                          disabled={!canReact}
                          key={reaction.emoji}
                          onClick={() => {
                            void act(() =>
                              toggleReaction(
                                client,
                                csrfToken(),
                                message.id,
                                reaction.emoji,
                              ),
                            );
                          }}
                          type="button"
                        >
                          <span>{reaction.emoji}</span>
                          <span className="num">{reaction.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {message.deleted ? null : (
                  <div
                    aria-label="Ações da mensagem"
                    className="tools"
                    role="toolbar"
                  >
                    {canReact ? (
                      <button
                        aria-label="Reagir"
                        onClick={(event) =>
                          emoji.toggle(event.currentTarget, message.id)
                        }
                        type="button"
                      >
                        <Icon name="smile" size="sm" />
                      </button>
                    ) : null}
                    <button
                      aria-label="Responder citando"
                      onClick={() => {
                        setReplyTo(message);
                        area.current?.focus();
                      }}
                      type="button"
                    >
                      <Icon name="reply" size="sm" />
                    </button>
                    {mine ? (
                      <>
                        <button
                          aria-label="Editar"
                          onClick={() => setEditing(message)}
                          type="button"
                        >
                          <Icon name="edit" size="sm" />
                        </button>
                        <DeleteButton
                          message={message}
                          onDelete={() =>
                            act(() =>
                              deleteMessage(client, csrfToken(), message.id),
                            )
                          }
                        />
                      </>
                    ) : target.kind === "chat" && target.moderator ? (
                      <DeleteButton
                        message={message}
                        moderate
                        onDelete={() =>
                          act(() =>
                            deleteMessage(client, csrfToken(), message.id),
                          )
                        }
                      />
                    ) : null}
                  </div>
                )}
              </article>
            </div>
          );
        })}
        {outgoing.map((entry) => (
          <article className={`msg ${entry.state}`} key={entry.id}>
            <Avatar email={me.email} id={me.id} size="lg" />
            <div className="mb">
              <div className="mh">
                <b>{nameOf(me.email)}</b>
                {entry.state === "pending" ? (
                  <span className="mstate">
                    <Icon name="clock" size="sm" />
                    Enviando
                  </span>
                ) : (
                  <span className="mstate" style={{ color: "var(--danger)" }}>
                    <Icon name="alert" size="sm" />
                    Falhou{" "}
                    <button
                      className="btn sm ghost"
                      onClick={() => void send(entry)}
                      style={{ height: 24, padding: "0 6px" }}
                      type="button"
                    >
                      Tentar de novo
                    </button>
                  </span>
                )}
              </div>
              <div className="tx">
                <Rich mentions={mentionable} text={entry.body} />
              </div>
            </div>
          </article>
        ))}
        {loaded &&
        shown.length === 0 &&
        outgoing.length === 0 &&
        timeline.length === 0 ? (
          needle !== "" ? (
            <div className="empty">
              <h3>Nenhum resultado</h3>
              <p>
                Isso não significa que o texto nunca foi dito: só pesquisamos o
                que já foi sincronizado.
              </p>
            </div>
          ) : (
            <div className="empty">
              <div className="emp-sp">
                <Duo pose="wave" scale={3} />
              </div>
              <h3>
                {target.kind === "chat" ? "Canal vazio" : "Conversa vazia"}
              </h3>
              <p>
                Diga olá. Mensagens aqui são cifradas de ponta a ponta quando o
                projeto é cifrado.
              </p>
            </div>
          )
        ) : null}
      </div>
      {canSend ? (
        <form
          aria-label="Escrever mensagem"
          className="composer"
          id="comp"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {replyTo === null ? null : (
            <div className="replybar">
              <Icon name="reply" size="sm" />
              <span
                className="grow"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                Respondendo a <b>{nameOf(replyTo.authorEmail)}</b>:{" "}
                {replyTo.body.slice(0, 70)}
              </span>
              <button
                aria-label="Cancelar resposta"
                className="iconbtn"
                onClick={() => setReplyTo(null)}
                style={{ width: 28, height: 28 }}
                type="button"
              >
                <Icon name="x" size="sm" />
              </button>
            </div>
          )}
          <textarea
            aria-label="Mensagem"
            maxLength={10000}
            onChange={(event) => {
              setDraft(event.target.value);
              const element = event.currentTarget;
              element.style.height = "auto";
              element.style.height = `${Math.min(160, element.scrollHeight)}px`;
              const match = /@([\wà-ú]*)$/i.exec(
                element.value.slice(0, element.selectionStart),
              );
              setMention(match === null ? null : (match[1] ?? ""));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={`Mensagem para ${target.title}`}
            ref={area}
            rows={1}
            value={draft}
          />
          <div className="cb">
            <button
              aria-label="Anexar arquivo"
              className="iconbtn"
              onClick={() => setFiles(true)}
              style={{ width: 34, height: 34 }}
              type="button"
            >
              <Icon name="clip" />
            </button>
            <button
              aria-label="Mencionar pessoa"
              className="iconbtn"
              onClick={() => {
                setDraft(
                  (value) =>
                    `${value}${value !== "" && !/\s$/.test(value) ? " " : ""}@`,
                );
                setMention("");
                area.current?.focus();
              }}
              style={{ width: 34, height: 34 }}
              type="button"
            >
              <Icon name="at" />
            </button>
            <button
              aria-label="Emoji"
              className="iconbtn"
              onClick={(event) => emoji.toggle(event.currentTarget, "compose")}
              style={{ width: 34, height: 34 }}
              type="button"
            >
              <Icon name="smile" />
            </button>
            <span className="xs muted grow" style={{ paddingLeft: 6 }}>
              <Icon name="lock" size="sm" /> Cifrado antes de enviar · Enter
              envia, Shift+Enter quebra linha
            </span>
            <button className="btn primary sm" type="submit">
              <Icon name="send" size="sm" />
              Enviar
            </button>
          </div>
        </form>
      ) : (
        <Banner icon="lock" style={{ margin: "10px 20px 18px" }}>
          Seu perfil neste projeto permite ler, mas não enviar mensagens.
        </Banner>
      )}
      {emoji.state === null ? null : (
        <Menu
          anchor={emoji.state.anchor}
          onClose={emoji.close}
          right={emoji.state.data !== "compose"}
          up={emoji.state.data === "compose"}
        >
          <div className="emoji-grid">
            {EMOJI.map((symbol) => (
              <button
                aria-label={`${emoji.state?.data === "compose" ? "Inserir" : "Reagir com"} ${symbol}`}
                key={symbol}
                onClick={() => {
                  const where = emoji.state?.data;
                  emoji.close();
                  if (where === "compose") {
                    setDraft((value) => value + symbol);
                    area.current?.focus();
                  } else if (where !== undefined) {
                    void act(() =>
                      toggleReaction(client, csrfToken(), where, symbol),
                    );
                  }
                }}
                role="menuitem"
                style={{ padding: 0 }}
                type="button"
              >
                {symbol}
              </button>
            ))}
          </div>
        </Menu>
      )}
      {mention !== null && area.current !== null && target.kind === "chat" ? (
        <MentionMenu
          anchor={area.current}
          members={members.filter(
            (member) =>
              member.email !== me.email &&
              nameOf(member.email)
                .toLowerCase()
                .startsWith(mention.toLowerCase()),
          )}
          onClose={() => setMention(null)}
          onPick={(member) => {
            setDraft((value) =>
              value.replace(
                /@[\wà-ú]*$/i,
                `@${nameOf(member.email).split(" ")[0] ?? ""} `,
              ),
            );
            setMention(null);
            area.current?.focus();
          }}
        />
      ) : null}
      {editing === null ? null : (
        <EditDialog
          message={editing}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            const original = editing;
            setEditing(null);
            void act(() =>
              editChannelMessage(
                client,
                csrfToken(),
                crypto,
                original,
                body,
                kind,
              ),
            );
          }}
        />
      )}
    </section>
  );
}

function DmBanner({
  dm,
  enable,
  status,
}: {
  dm: { keyed: boolean; unlocked: boolean };
  enable: () => void;
  status: string;
}) {
  if (dm.keyed && dm.unlocked) return null;
  if (dm.keyed)
    return (
      <Banner icon="lock" kind="warn" style={{ margin: "10px 20px 0" }}>
        Esta conversa é cifrada. Libere a criptografia deste navegador para ler
        e escrever.
      </Banner>
    );
  if (dm.unlocked)
    return (
      <Banner kind="warn" style={{ margin: "10px 20px 0" }}>
        <b>
          As mensagens desta conversa ainda ficam em texto claro no servidor.
        </b>{" "}
        {status}{" "}
        <button className="btn sm" onClick={enable} type="button">
          Ativar criptografia nesta conversa
        </button>
      </Banner>
    );
  return null;
}

function DeleteButton({
  message,
  moderate = false,
  onDelete,
}: {
  message: Message;
  moderate?: boolean;
  onDelete: () => Promise<void>;
}) {
  return (
    <button
      aria-label={moderate ? "Moderar: remover mensagem" : "Apagar"}
      onClick={() => {
        void confirmDialog({
          title: "Apagar mensagem?",
          body: (
            <p className="muted">
              Ela vira um tombstone: respostas que a citavam passam a mostrar
              “Mensagem indisponível”, sem trecho residual. Cópias em backups
              expiram conforme a retenção.
            </p>
          ),
          ok: "Apagar",
          danger: true,
        }).then(async (ok) => {
          if (ok !== true) return;
          await onDelete();
          toast("Mensagem apagada.", { icon: "trash" });
        });
      }}
      title={message.body.slice(0, 0)}
      type="button"
    >
      <Icon name="trash" size="sm" />
    </button>
  );
}

function EditDialog({
  message,
  onClose,
  onSave,
}: {
  message: Message;
  onClose: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = useState(message.body);
  return (
    <Modal onClose={onClose} width="480px">
      <div className="dh">
        <h2 id="dlgt">Editar mensagem</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim() !== "") onSave(body.trim());
        }}
      >
        <div className="dbd">
          <textarea
            aria-label="Mensagem"
            autoFocus
            className="inp"
            maxLength={10000}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            value={body}
          />
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MentionMenu({
  anchor,
  members,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  members: ProjectMember[];
  onClose: () => void;
  onPick: (member: ProjectMember) => void;
}) {
  if (members.length === 0) return null;
  return (
    <Menu anchor={anchor} focusFirst={false} onClose={onClose} up>
      <div className="mh">Mencionar</div>
      {members.map((member) => (
        <button
          key={member.accountId}
          onClick={() => onPick(member)}
          role="menuitem"
          type="button"
        >
          <Avatar email={member.email} id={member.accountId} size="sm" />
          {nameOf(member.email)}
        </button>
      ))}
    </Menu>
  );
}
