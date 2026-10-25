import {
  openDirectConversation,
  type CurrentAccount,
} from "@oddkin/api-client";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../design/icons";
import { nameOf } from "../design/people";
import { Avatar } from "../design/primitives";
import { go } from "../design/router";
import { createStore } from "../design/store";
import { Sprite } from "../design/Sprite";
import { toast } from "../design/toast";
import { csrfToken } from "../errors";
import { useInbox } from "../inbox";
import { Page } from "../shell/Page";
import { can, useWorkspace, type ProjectState } from "../workspace";
import { ChannelsDialog } from "./ChannelsDialog";
import { Thread, type ThreadTarget } from "./Thread";

const last = createStore({ id: "" });

/** Channels per project and direct conversations, with the open thread beside them. */
export function Chat({
  account,
  conversationId,
}: {
  account: CurrentAccount;
  conversationId: string | null;
}) {
  const { projects, current, setCurrentProjectId, client } = useWorkspace();
  const { channels, dms, contacts, reloadChat } = useInbox();
  const remembered = last.use().id;
  const [narrow, setNarrow] = useState(window.innerWidth <= 900);
  const [managing, setManaging] = useState<string | null>(null);

  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 900);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const everyId = useMemo(
    () => new Set([...channels.map((c) => c.id), ...dms.map((d) => d.id)]),
    [channels, dms],
  );
  const selectedId =
    [conversationId, remembered].find(
      (id) => id !== null && id !== "" && everyId.has(id),
    ) ??
    channels.find((entry) => entry.projectId === current?.project.id)?.id ??
    channels[0]?.id ??
    dms[0]?.id ??
    null;

  useEffect(() => {
    if (selectedId !== null) last.set({ id: selectedId });
  }, [selectedId]);

  const channel = channels.find((entry) => entry.id === selectedId);
  const dm = dms.find((entry) => entry.id === selectedId);
  const state =
    channel === undefined
      ? undefined
      : projects?.find((entry) => entry.project.id === channel.projectId);

  useEffect(() => {
    if (channel !== undefined && channel.projectId !== current?.project.id)
      setCurrentProjectId(channel.projectId);
  }, [channel, current, setCurrentProjectId]);

  const target: ThreadTarget | null = useMemo(() => {
    if (channel !== undefined && state !== undefined) {
      return {
        kind: "chat",
        id: channel.id,
        title: `#${channel.name}`,
        subtitle: `${state.project.name} · ${state.members.length} pessoas`,
        members: state.members,
        crypto: state.crypto,
        moderator: state.project.isManager,
        canSend: can(state, "chat.send") && !channel.archived,
        canCall: can(state, "calls.start"),
        canReact: can(state, "chat.send"),
        canUpload: can(state, "files.upload"),
      };
    }
    if (dm !== undefined) {
      return {
        kind: "dm",
        id: dm.id,
        title: nameOf(dm.peerEmail),
        subtitle: "Conversa direta",
        peerEmail: dm.peerEmail,
        peerId: dm.peerId,
      };
    }
    return null;
  }, [channel, state, dm]);

  const pane = conversationId !== null ? "thread" : narrow ? "list" : "thread";
  const [mobilePane, setMobilePane] = useState<"list" | "thread">(pane);
  useEffect(() => setMobilePane(pane), [pane, conversationId]);

  const groups = (projects ?? [])
    .map((entry) => ({
      state: entry,
      items: channels.filter((value) => value.projectId === entry.project.id),
    }))
    .filter((group) => group.items.length > 0);
  const strangers = contacts.filter(
    (contact) => !dms.some((entry) => entry.peerId === contact.accountId),
  );

  async function openContact(accountId: string) {
    try {
      const created = await openDirectConversation(
        client,
        csrfToken(),
        accountId,
      );
      await reloadChat();
      go(`chat/${created.id}`);
    } catch {
      toast("Você não pode conversar com esta pessoa agora.", { kind: "err" });
    }
  }

  const item = (
    id: string,
    icon: React.ReactNode,
    label: string,
    unread: number,
    onClick: () => void,
  ) => (
    <button
      aria-current={id === selectedId ? "true" : undefined}
      className="citem"
      key={id}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
      {unread > 0 ? (
        <span aria-label={`${unread} não lidas`} className="u">
          {unread}
        </span>
      ) : null}
    </button>
  );

  return (
    <Page
      flush
      placeholder="Buscar mensagens…"
      sub="Canais por projeto e conversas diretas, cifrados de ponta a ponta."
      title="Mensagens"
    >
      {selectedId === null && projects !== null ? (
        <div className="empty">
          <div className="emp-sp">
            <Sprite pose="sleep" scale={4} who="capuz" />
          </div>
          <h3>Sem conversas</h3>
          <p>Seu perfil não permite ler canais neste projeto.</p>
        </div>
      ) : (
        <div className="chatwrap" data-pane={mobilePane}>
          <nav aria-label="Conversas" className="clist">
            {groups.map((group) => (
              <div key={group.state.project.id}>
                <h4 className="row">
                  <span className="grow">{group.state.project.name}</span>
                  {group.state.project.isManager ? (
                    <button
                      aria-label={`Gerenciar canais de ${group.state.project.name}`}
                      className="iconbtn"
                      onClick={() => setManaging(group.state.project.id)}
                      type="button"
                    >
                      <Icon name="settings" size="sm" />
                    </button>
                  ) : null}
                </h4>
                {group.items.map((entry) =>
                  item(
                    entry.id,
                    <Icon name="hash" size="sm" />,
                    entry.archived ? `${entry.name} (arquivado)` : entry.name,
                    entry.unread,
                    () => go(`chat/${entry.id}`),
                  ),
                )}
              </div>
            ))}
            <h4>Mensagens diretas</h4>
            {dms.map((entry) =>
              item(
                entry.id,
                <Avatar email={entry.peerEmail} id={entry.peerId} size="sm" />,
                nameOf(entry.peerEmail),
                Number(entry.unread),
                () => go(`chat/${entry.id}`),
              ),
            )}
            {strangers.map((contact) =>
              item(
                `contact-${contact.accountId}`,
                <Avatar
                  email={contact.email}
                  id={contact.accountId}
                  size="sm"
                />,
                nameOf(contact.email),
                0,
                () => void openContact(contact.accountId),
              ),
            )}
            {dms.length === 0 && strangers.length === 0 ? (
              <p className="xs muted" style={{ padding: "6px 10px" }}>
                Sem contatos elegíveis.
              </p>
            ) : null}
            <p className="xs muted" style={{ padding: "12px 10px" }}>
              Contatos vêm de projetos em comum. Não há diretório global.
            </p>
          </nav>
          {target === null ? (
            <section className="thread" />
          ) : (
            <Thread
              key={target.id}
              me={{ id: account.id, email: account.email }}
              onBack={() => setMobilePane("list")}
              target={target}
            />
          )}
        </div>
      )}
      {managing !== null &&
      projects?.find((entry) => entry.project.id === managing) ? (
        <ChannelsDialog
          onClose={() => setManaging(null)}
          state={
            projects.find(
              (entry) => entry.project.id === managing,
            ) as ProjectState
          }
        />
      ) : null}
    </Page>
  );
}
