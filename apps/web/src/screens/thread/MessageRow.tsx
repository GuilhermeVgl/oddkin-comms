import type { Message } from "@crewstead/api-client";
import { fmtClock } from "../../design/format";
import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { Rich } from "../../design/rich";
import { DeleteButton } from "./DeleteButton";

/** What the message toolbar and reactions can do; the thread decides how. */
export type MessageActions = {
  openReactions: (message: Message, anchor: HTMLElement) => void;
  toggleReaction: (message: Message, emoji: string) => void;
  reply: (message: Message) => void;
  edit: (message: Message) => void;
  remove: (message: Message) => Promise<void>;
};

function Quote({ quoted }: { quoted: Message | undefined }) {
  if (quoted === undefined || quoted.deleted)
    return (
      <div className="quote">
        <Icon name="lock" size="sm" />
        <span>Mensagem indisponível</span>
      </div>
    );
  return (
    <div className="quote">
      <Icon name="reply" size="sm" />
      <b>{nameOf(quoted.authorEmail)}</b>
      <span>{quoted.body}</span>
    </div>
  );
}

function Reactions({
  message,
  canReact,
  actions,
}: {
  message: Message;
  canReact: boolean;
  actions: MessageActions;
}) {
  const reactions = message.reactions.filter((reaction) => reaction.count > 0);
  if (reactions.length === 0 || message.deleted) return null;
  return (
    <div className="rx">
      {reactions.map((reaction) => (
        <button
          aria-label={`${reaction.emoji} ${reaction.count}, ${
            reaction.mine ? "remover sua reação" : "reagir"
          }`}
          aria-pressed={reaction.mine}
          disabled={!canReact}
          key={reaction.emoji}
          onClick={() => actions.toggleReaction(message, reaction.emoji)}
          type="button"
        >
          <span>{reaction.emoji}</span>
          <span className="num">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}

function Tools({
  message,
  mine,
  moderator,
  canReact,
  actions,
}: {
  message: Message;
  mine: boolean;
  moderator: boolean;
  canReact: boolean;
  actions: MessageActions;
}) {
  const remove = () => actions.remove(message);
  return (
    <div aria-label="Ações da mensagem" className="tools" role="toolbar">
      {canReact ? (
        <button
          aria-label="Reagir"
          onClick={(event) =>
            actions.openReactions(message, event.currentTarget)
          }
          type="button"
        >
          <Icon name="smile" size="sm" />
        </button>
      ) : null}
      <button
        aria-label="Responder citando"
        onClick={() => actions.reply(message)}
        type="button"
      >
        <Icon name="reply" size="sm" />
      </button>
      {mine ? (
        <>
          <button
            aria-label="Editar"
            onClick={() => actions.edit(message)}
            type="button"
          >
            <Icon name="edit" size="sm" />
          </button>
          <DeleteButton onDelete={remove} />
        </>
      ) : moderator ? (
        <DeleteButton moderate onDelete={remove} />
      ) : null}
    </div>
  );
}

/** One message: author, time, quoted reply, body, reactions and the hover toolbar. */
export function MessageRow({
  message,
  quoted,
  mine,
  moderator,
  canReact,
  mentionable,
  actions,
}: {
  message: Message;
  quoted: Message | undefined;
  mine: boolean;
  moderator: boolean;
  canReact: boolean;
  mentionable: Set<string>;
  actions: MessageActions;
}) {
  return (
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
        {message.replyToId === undefined ? null : <Quote quoted={quoted} />}
        {message.deleted ? (
          <div className="tx muted">Mensagem removida</div>
        ) : (
          <div className="tx">
            <Rich mentions={mentionable} text={message.body} />
          </div>
        )}
        <Reactions actions={actions} canReact={canReact} message={message} />
      </div>
      {message.deleted ? null : (
        <Tools
          actions={actions}
          canReact={canReact}
          message={message}
          mine={mine}
          moderator={moderator}
        />
      )}
    </article>
  );
}
