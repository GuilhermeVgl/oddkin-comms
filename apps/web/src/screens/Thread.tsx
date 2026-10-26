import {
  deleteMessage,
  toggleReaction,
  type Message,
  type ProjectMember,
} from "@crewstead/api-client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Attachments } from "../Attachments";
import { Banner } from "../design/primitives";
import { useMenu } from "../design/Menu";
import { editChannelMessage } from "../e2ee/content";
import { csrfToken } from "../errors";
import { useWorkspace } from "../workspace";
import { mentionNames } from "./mentions";
import { Composer } from "./thread/Composer";
import { DmBanner } from "./thread/DmBanner";
import { EditDialog } from "./thread/EditDialog";
import { EmojiMenu, type EmojiTarget } from "./thread/EmojiMenu";
import { MessageList } from "./thread/MessageList";
import type { MessageActions } from "./thread/MessageRow";
import { ThreadHeader } from "./thread/ThreadHeader";
import {
  buildTimeline,
  filterMessages,
  firstUnreadIndex,
} from "./thread/timeline";
import type { ThreadTarget } from "./thread/types";
import { useAct } from "./thread/useAct";
import { useCallBanner } from "./thread/useCallBanner";
import { useComposer } from "./thread/useComposer";
import { useDmCrypto } from "./thread/useDmCrypto";
import { useEnableDm } from "./thread/useEnableDm";
import { useMessages } from "./thread/useMessages";
import { useStickToBottom } from "./thread/useStickToBottom";
import { useUnreadAtOpen } from "./thread/useUnreadAtOpen";

export type { ThreadTarget } from "./thread/types";

const NO_MEMBERS: ProjectMember[] = [];

/** One conversation: a channel or a direct message, with calls, files and search. */
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
  const chat = target.kind === "chat";
  const kind = chat ? "chat" : "dm";
  const dm = useDmCrypto(target.id, !chat);
  const crypto = chat ? target.crypto : dm.crypto;
  const members = chat ? target.members : NO_MEMBERS;
  const canSend = !chat || target.canSend;
  const canReact = !chat || target.canReact;
  const canCall = !chat || target.canCall;

  const { messages, loaded, refresh } = useMessages(target.id, crypto, kind);
  const act = useAct(refresh);
  const scroll = useStickToBottom();
  const composer = useComposer({
    conversationId: target.id,
    crypto,
    kind,
    members,
    refresh,
    onQueued: scroll.pin,
  });
  const callBanner = useCallBanner(
    target.id,
    members
      .filter((member) => member.email !== me.email)
      .map((member) => member.accountId),
  );
  const enableDm = useEnableDm({
    conversationId: target.id,
    meEmail: me.email,
    crypto: dm.crypto,
    onEnabled: dm.refresh,
  });
  const unreadAtOpen = useUnreadAtOpen(target.id, kind);
  const emoji = useMenu<EmojiTarget>();
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);

  const { reset: resetComposer } = composer;
  useEffect(() => {
    resetComposer();
    setEditing(null);
    setQuery("");
    setFiles(false);
  }, [target.id]);

  const { follow } = scroll;
  useLayoutEffect(follow, [messages, composer.outgoing, loaded, follow]);

  const byId = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const mentionable = useMemo(() => mentionNames(members), [members]);
  const searching = query.trim() !== "";
  const shown = filterMessages(messages, query);
  const timeline = buildTimeline(shown, callBanner.history, {
    searching,
    now: new Date(),
  });

  const actions: MessageActions = {
    openReactions: (message, anchor) => emoji.toggle(anchor, message.id),
    toggleReaction: (message, symbol) =>
      void act(() => toggleReaction(client, csrfToken(), message.id, symbol)),
    reply: (message) => {
      composer.setReplyTo(message);
      area.current?.focus();
    },
    edit: setEditing,
    remove: (message) =>
      act(() => deleteMessage(client, csrfToken(), message.id)),
  };

  function pickEmoji(symbol: string, to: EmojiTarget) {
    if (to === "compose") {
      composer.setDraft((value) => value + symbol);
      area.current?.focus();
    } else {
      void act(() => toggleReaction(client, csrfToken(), to, symbol));
    }
  }

  return (
    <section aria-label="Conversa" className="thread" id="thread">
      <ThreadHeader
        call={callBanner.call}
        canCall={canCall}
        files={files}
        me={me}
        members={members}
        onBack={onBack}
        onCall={() => void callBanner.startOrJoin()}
        onQuery={setQuery}
        onToggleFiles={() => setFiles((value) => !value)}
        query={query}
        target={target}
      />
      {files ? (
        <div className="th-files">
          <Attachments
            canUpload={!chat || target.canUpload}
            client={client}
            context={{ contextType: "conversation", contextId: target.id }}
          />
        </div>
      ) : null}
      {chat ? null : (
        <DmBanner
          dm={dm}
          enable={() => void enableDm.enable()}
          status={enableDm.status}
        />
      )}
      <div
        aria-label="Mensagens"
        aria-live="polite"
        className="msgs"
        id="msgs"
        onScroll={(event) => scroll.onScroll(event.currentTarget)}
        ref={scroll.box}
        tabIndex={0}
      >
        <MessageList
          actions={actions}
          byId={byId}
          canCall={canCall}
          canReact={canReact}
          chat={chat}
          firstUnread={firstUnreadIndex(shown.length, unreadAtOpen)}
          loaded={loaded}
          me={me}
          mentionable={mentionable}
          moderator={chat && target.moderator}
          onOpenCall={callBanner.openCall}
          onRetry={(entry) => void composer.send(entry)}
          outgoing={composer.outgoing}
          searching={searching}
          timeline={timeline}
        />
      </div>
      {canSend ? (
        <Composer
          areaRef={area}
          draft={composer.draft}
          meEmail={me.email}
          mentionPool={members}
          onAttach={() => setFiles(true)}
          onCancelReply={() => composer.setReplyTo(null)}
          onDraft={composer.setDraft}
          onEmoji={(anchor) => emoji.toggle(anchor, "compose")}
          onSend={() => void composer.send()}
          replyTo={composer.replyTo}
          title={target.title}
        />
      ) : (
        <Banner icon="lock" style={{ margin: "10px 20px 18px" }}>
          Seu perfil neste projeto permite ler, mas não enviar mensagens.
        </Banner>
      )}
      {emoji.state === null ? null : (
        <EmojiMenu
          anchor={emoji.state.anchor}
          onClose={emoji.close}
          onPick={pickEmoji}
          target={emoji.state.data}
        />
      )}
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
