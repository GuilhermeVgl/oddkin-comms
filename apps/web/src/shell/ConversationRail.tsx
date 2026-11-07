import { openDirectConversation } from "@crewstead/api-client";
import { useMemo } from "react";
import { Icon } from "../design/icons";
import { displayNameOf, nameOf } from "../design/people";
import { Avatar } from "../design/primitives";
import { go, useRoute } from "../design/router";
import { toast } from "../design/toast";
import { useInbox } from "../inbox";
import { ChannelList } from "../screens/ChannelList";
import { useWorkspace } from "../workspace";
import { useCalls } from "./calls";

/** Slack-like persistent rail: calls, project channels and direct messages. */
export function ConversationRail() {
  const route = useRoute();
  const { projects, client } = useWorkspace();
  const { channels, dms, contacts, reloadChat } = useInbox();
  const calls = useCalls();
  const selectedId = route.name === "chat" ? route.arg : null;
  const groups = (projects ?? [])
    .map((state) => ({
      state,
      items: channels.filter((entry) => entry.projectId === state.project.id),
    }))
    .filter((group) => group.items.length > 0 || group.state.project.isManager);
  const strangers = contacts.filter(
    (contact) => !dms.some((entry) => entry.peerId === contact.accountId),
  );
  const callWhere = useMemo(
    () =>
      new Map([
        ...channels.map((entry) => [entry.id, `#${entry.name}`] as const),
        ...dms.map((entry) => [entry.id, nameOf(entry.peerEmail)] as const),
      ]),
    [channels, dms],
  );

  async function openContact(accountId: string) {
    try {
      const created = await openDirectConversation(client, accountId);
      await reloadChat();
      go(`chat/${created.id}`);
    } catch {
      toast("Você não pode conversar com esta pessoa agora.", { kind: "err" });
    }
  }

  return (
    <aside aria-label="Conversas e chamadas" className="conversation-rail">
      <div className="rail-title">
        <div>
          <h2>Conversas</h2>
          <span>Mensagens e chamadas</span>
        </div>
        <button
          aria-label="Abrir mensagens"
          className="iconbtn mini"
          onClick={() => go("chat")}
          type="button"
        >
          <Icon name="chat" size="sm" />
        </button>
      </div>
      {calls.invitations.length > 0 ? (
        <section aria-label="Chamadas recebidas" className="rail-calls">
          <h3>Chamadas</h3>
          {calls.invitations.map((entry) => (
            <div className="rail-call" key={entry.callId}>
              <span className="rail-call-pulse">
                <Icon name="phone" size="sm" />
              </span>
              <div className="grow col">
                <b>{nameOf(entry.startedBy || "Alguém")}</b>
                <span>
                  {callWhere.get(entry.conversationId) ?? "Conversa direta"}
                </span>
              </div>
              <button
                aria-label="Recusar chamada"
                className="cghost"
                onClick={() => void calls.decline(entry.callId)}
                type="button"
              >
                <Icon name="x" size="sm" />
              </button>
              <button
                aria-label="Atender chamada"
                className="cghost rail-answer"
                onClick={() => calls.openCall(entry.callId)}
                type="button"
              >
                <Icon name="phone" size="sm" />
              </button>
            </div>
          ))}
        </section>
      ) : null}
      <nav aria-label="Conversas" className="rail-scroll">
        {groups.map((group) => (
          <ChannelList
            key={group.state.project.id}
            onOpen={(id) => go(`chat/${id}`)}
            selectedId={selectedId}
            state={group.state}
          />
        ))}
        <h4>Mensagens diretas</h4>
        {dms.map((entry) => (
          <button
            aria-current={entry.id === selectedId ? "true" : undefined}
            className="citem"
            key={entry.id}
            onClick={() => go(`chat/${entry.id}`)}
            type="button"
          >
            <Avatar
              email={entry.peerEmail}
              id={entry.peerId}
              name={entry.peerDisplayName}
              size="sm"
            />
            <span>{displayNameOf(entry.peerEmail, entry.peerDisplayName)}</span>
            {Number(entry.unread) > 0 ? (
              <span aria-label={`${entry.unread} não lidas`} className="u">
                {entry.unread}
              </span>
            ) : null}
          </button>
        ))}
        {strangers.map((contact) => (
          <button
            className="citem"
            key={contact.accountId}
            onClick={() => void openContact(contact.accountId)}
            type="button"
          >
            <Avatar
              email={contact.email}
              id={contact.accountId}
              name={contact.displayName}
              size="sm"
            />
            <span>{displayNameOf(contact.email, contact.displayName)}</span>
          </button>
        ))}
        {dms.length === 0 && strangers.length === 0 ? (
          <p className="rail-empty">Sem contatos elegíveis.</p>
        ) : null}
      </nav>
    </aside>
  );
}
