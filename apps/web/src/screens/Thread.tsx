import {
  deleteMessage,
  toggleReaction,
  type Message,
  type ProjectMember,
} from "@crewstead/api-client";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { UploadProgress } from "../attachments/AttachmentRows";
import { useAttachmentList } from "../attachments/useAttachmentList";
import { useAttachmentTransfer } from "../attachments/useAttachmentTransfer";
import { Banner } from "../design/primitives";
import { useMenu } from "../design/Menu";
import { editChannelMessage } from "../e2ee/content";
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
  embedded = false,
}: {
  target: ThreadTarget;
  me: { id: string; email: string };
  onBack?: () => void;
  embedded?: boolean;
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

  const { messages, loaded, refresh } = useMessages(
    target.id,
    crypto,
    kind,
    chat || dm.ready,
  );
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
  const filePicker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Message | null>(null);
  const attachmentContext = useMemo(
    () => ({
      contextType: "conversation" as const,
      contextId: target.id,
      ...(chat ? { projectId: target.projectId } : {}),
    }),
    [chat, target.id, chat ? target.projectId : null],
  );
  const attachmentList = useAttachmentList(client, attachmentContext);
  const attachmentTransfer = useAttachmentTransfer({
    client,
    context: attachmentContext,
    names: attachmentList.names,
    reload: attachmentList.reload,
    cryptoFor: attachmentList.cryptoFor,
    domainKind: attachmentList.domainKind,
  });

  const { reset: resetComposer } = composer;
  useEffect(() => {
    resetComposer();
    setEditing(null);
    setQuery("");
  }, [target.id]);

  const { follow } = scroll;
  useLayoutEffect(follow, [
    messages,
    composer.outgoing,
    loaded,
    attachmentList.items,
    attachmentTransfer.progress,
    follow,
  ]);

  const byId = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const mentionable = useMemo(() => mentionNames(members), [members]);
  const searching = query.trim() !== "";
  const shown = filterMessages(messages, query);
  const attachmentNeedle = query.trim().toLocaleLowerCase();
  const shownAttachments = (attachmentList.items ?? [])
    .map((item) => ({
      item,
      name: attachmentList.names.get(item.id) ?? item.name,
    }))
    .filter(
      ({ name }) =>
        !searching || name.toLocaleLowerCase().includes(attachmentNeedle),
    );
  const timeline = buildTimeline(shown, shownAttachments, callBanner.history, {
    searching,
    now: new Date(),
  });

  function upload(file: File | undefined) {
    if (file !== undefined) void attachmentTransfer.upload(file);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    upload(event.target.files?.[0]);
    event.target.value = "";
  }

  function uploadFiles(files: FileList) {
    upload(files[0]);
  }

  const actions: MessageActions = {
    openReactions: (message, anchor) => emoji.toggle(anchor, message.id),
    toggleReaction: (message, symbol) =>
      void act(() => toggleReaction(client, message.id, symbol)),
    reply: (message) => {
      composer.setReplyTo(message);
      area.current?.focus();
    },
    edit: setEditing,
    remove: (message) => act(() => deleteMessage(client, message.id)),
  };

  function pickEmoji(symbol: string, to: EmojiTarget) {
    if (to === "compose") {
      composer.setDraft((value) => value + symbol);
      area.current?.focus();
    } else {
      void act(() => toggleReaction(client, to, symbol));
    }
  }

  return (
    <section
      aria-label={embedded ? `Mensagens de ${target.title}` : "Conversa"}
      className={`thread${embedded ? " embedded" : ""}`}
      id={embedded ? undefined : "thread"}
    >
      {embedded ? null : (
        <ThreadHeader
          call={callBanner.call}
          canCall={canCall}
          me={me}
          members={members}
          onBack={onBack ?? (() => undefined)}
          onCall={() => void callBanner.startOrJoin()}
          onQuery={setQuery}
          query={query}
          target={target}
        />
      )}
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
        id={embedded ? undefined : "msgs"}
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
          loaded={loaded && attachmentList.items !== null}
          me={me}
          mentionable={mentionable}
          moderator={chat && target.moderator}
          onOpenCall={callBanner.openCall}
          onRetry={(entry) => void composer.send(entry)}
          onDownloadAttachment={(id) => {
            const item = attachmentList.items?.find((entry) => entry.id === id);
            if (item !== undefined) void attachmentTransfer.download(item);
          }}
          onRemoveAttachment={(id) => {
            const item = attachmentList.items?.find((entry) => entry.id === id);
            if (item !== undefined) void attachmentTransfer.remove(item);
          }}
          onPreviewAttachment={attachmentTransfer.preview}
          outgoing={composer.outgoing}
          searching={searching}
          timeline={timeline}
        />
        {attachmentTransfer.progress === null ? null : (
          <div className="attachment-outgoing">
            <UploadProgress progress={attachmentTransfer.progress} />
          </div>
        )}
      </div>
      {canSend ? (
        <>
          {!embedded && (!chat || target.canUpload) ? (
            <input
              aria-label="Enviar arquivo"
              disabled={attachmentTransfer.progress !== null}
              hidden
              onChange={handleFile}
              ref={filePicker}
              type="file"
            />
          ) : null}
          <Composer
            attachments={!embedded && (!chat || target.canUpload)}
            areaRef={area}
            draft={composer.draft}
            formId={embedded ? "call-composer" : "comp"}
            meEmail={me.email}
            mentionPool={members}
            onAttach={() => filePicker.current?.click()}
            onCancelReply={() => composer.setReplyTo(null)}
            onDraft={composer.setDraft}
            onEmoji={(anchor) => emoji.toggle(anchor, "compose")}
            onFiles={uploadFiles}
            onSend={() => void composer.send()}
            replyTo={composer.replyTo}
            title={target.title}
          />
        </>
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
              editChannelMessage(client, crypto, original, body, kind),
            );
          }}
        />
      )}
    </section>
  );
}
