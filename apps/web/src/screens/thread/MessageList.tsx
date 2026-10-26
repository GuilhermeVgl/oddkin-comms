import type { Message } from "@crewstead/api-client";
import { Banner } from "../../design/primitives";
import { Duo } from "../../design/Sprite";
import { CallRecordRow } from "../CallRecordRow";
import { DaySeparator } from "./DaySeparator";
import { MessageRow, type MessageActions } from "./MessageRow";
import { OutgoingRow } from "./OutgoingRow";
import type { Outgoing } from "./outgoing";
import type { TimelineEntry } from "./timeline";

function EmptyThread({
  searching,
  chat,
}: {
  searching: boolean;
  chat: boolean;
}) {
  if (searching)
    return (
      <div className="empty">
        <h3>Nenhum resultado</h3>
        <p>
          Isso não significa que o texto nunca foi dito: só pesquisamos o que já
          foi sincronizado.
        </p>
      </div>
    );
  return (
    <div className="empty">
      <div className="emp-sp">
        <Duo pose="wave" scale={3} />
      </div>
      <h3>{chat ? "Canal vazio" : "Conversa vazia"}</h3>
      <p>
        Diga olá. Mensagens aqui são cifradas de ponta a ponta quando o projeto
        é cifrado.
      </p>
    </div>
  );
}

/** Messages and call records with day separators, then the unsent messages, or an empty state. */
export function MessageList({
  timeline,
  byId,
  searching,
  firstUnread,
  me,
  chat,
  moderator,
  canReact,
  canCall,
  loaded,
  outgoing,
  mentionable,
  actions,
  onOpenCall,
  onRetry,
}: {
  timeline: TimelineEntry[];
  byId: Map<string, Message>;
  searching: boolean;
  firstUnread: number;
  me: { id: string; email: string };
  chat: boolean;
  moderator: boolean;
  canReact: boolean;
  canCall: boolean;
  loaded: boolean;
  outgoing: Outgoing[];
  mentionable: Set<string>;
  actions: MessageActions;
  onOpenCall: (callId: string) => void;
  onRetry: (entry: Outgoing) => void;
}) {
  return (
    <>
      {searching ? (
        <Banner style={{ margin: "4px 0 10px" }}>
          Busca local: só mensagens já sincronizadas. Nada é enviado ao
          servidor.
        </Banner>
      ) : null}
      {timeline.map((entry) => {
        if (entry.kind === "call")
          return (
            <div key={`call-${entry.record.id}`}>
              {entry.day === null ? null : <DaySeparator label={entry.day} />}
              <CallRecordRow
                canJoin={canCall}
                meEmail={me.email}
                onJoin={() => onOpenCall(entry.record.id)}
                record={entry.record}
              />
            </div>
          );
        const { message, index } = entry;
        return (
          <div key={message.id}>
            {entry.day === null ? null : <DaySeparator label={entry.day} />}
            {!searching && index === firstUnread ? (
              <div className="unread" role="separator">
                <span>Novas mensagens</span>
              </div>
            ) : null}
            <MessageRow
              actions={actions}
              canReact={canReact}
              mentionable={mentionable}
              message={message}
              mine={message.authorEmail === me.email}
              moderator={moderator}
              quoted={
                message.replyToId === undefined
                  ? undefined
                  : byId.get(message.replyToId)
              }
            />
          </div>
        );
      })}
      {outgoing.map((entry) => (
        <OutgoingRow
          entry={entry}
          key={entry.id}
          me={me}
          mentionable={mentionable}
          onRetry={() => onRetry(entry)}
        />
      ))}
      {loaded && outgoing.length === 0 && timeline.length === 0 ? (
        <EmptyThread chat={chat} searching={searching} />
      ) : null}
    </>
  );
}
