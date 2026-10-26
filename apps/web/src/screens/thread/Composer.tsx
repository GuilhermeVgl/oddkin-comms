import type { Message, ProjectMember } from "@crewstead/api-client";
import { useState, type RefObject } from "react";
import { Icon } from "../../design/icons";
import { nameOf, firstNameOf } from "../../design/people";
import { MentionMenu } from "./MentionMenu";

const MENTION_AT_END = /@([\wà-ú]*)$/i;

/** The text after the "@" being typed at the caret, or null when none is. */
function mentionQuery(text: string, caret: number): string | null {
  const match = MENTION_AT_END.exec(text.slice(0, caret));
  return match === null ? null : (match[1] ?? "");
}

/** The message box: reply bar, auto-growing textarea, attach/mention/emoji buttons and send. */
export function Composer({
  title,
  draft,
  onDraft,
  replyTo,
  onCancelReply,
  areaRef,
  mentionPool,
  meEmail,
  onSend,
  onAttach,
  onEmoji,
}: {
  title: string;
  draft: string;
  onDraft: (update: string | ((value: string) => string)) => void;
  replyTo: Message | null;
  onCancelReply: () => void;
  areaRef: RefObject<HTMLTextAreaElement | null>;
  /** People that can be mentioned; empty in direct conversations. */
  mentionPool: ProjectMember[];
  meEmail: string;
  onSend: () => void;
  onAttach: () => void;
  onEmoji: (anchor: HTMLElement) => void;
}) {
  const [mention, setMention] = useState<string | null>(null);

  return (
    <>
      <form
        aria-label="Escrever mensagem"
        className="composer"
        id="comp"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        {replyTo === null ? null : (
          <div className="replybar">
            <Icon name="reply" size="sm" />
            <span className="grow replybar-text">
              Respondendo a <b>{nameOf(replyTo.authorEmail)}</b>:{" "}
              {replyTo.body.slice(0, 70)}
            </span>
            <button
              aria-label="Cancelar resposta"
              className="iconbtn replybar-x"
              onClick={onCancelReply}
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
            onDraft(event.target.value);
            const element = event.currentTarget;
            element.style.height = "auto";
            element.style.height = `${Math.min(160, element.scrollHeight)}px`;
            setMention(mentionQuery(element.value, element.selectionStart));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={`Mensagem para ${title}`}
          ref={areaRef}
          rows={1}
          value={draft}
        />
        <div className="cb">
          <button
            aria-label="Anexar arquivo"
            className="iconbtn cb-tool"
            onClick={onAttach}
            type="button"
          >
            <Icon name="clip" />
          </button>
          <button
            aria-label="Mencionar pessoa"
            className="iconbtn cb-tool"
            onClick={() => {
              onDraft(
                (value) =>
                  `${value}${value !== "" && !/\s$/.test(value) ? " " : ""}@`,
              );
              setMention("");
              areaRef.current?.focus();
            }}
            type="button"
          >
            <Icon name="at" />
          </button>
          <button
            aria-label="Emoji"
            className="iconbtn cb-tool"
            onClick={(event) => onEmoji(event.currentTarget)}
            type="button"
          >
            <Icon name="smile" />
          </button>
          <span className="xs muted grow cb-hint">
            <Icon name="lock" size="sm" /> Cifrado antes de enviar · Enter
            envia, Shift+Enter quebra linha
          </span>
          <button className="btn primary sm" type="submit">
            <Icon name="send" size="sm" />
            Enviar
          </button>
        </div>
      </form>
      {mention !== null && areaRef.current !== null ? (
        <MentionMenu
          anchor={areaRef.current}
          members={mentionPool.filter(
            (member) =>
              member.email !== meEmail &&
              nameOf(member.email)
                .toLowerCase()
                .startsWith(mention.toLowerCase()),
          )}
          onClose={() => setMention(null)}
          onPick={(member) => {
            onDraft((value) =>
              value.replace(MENTION_AT_END, `@${firstNameOf(member.email)} `),
            );
            setMention(null);
            areaRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
