import { useMemo, useState } from "react";
import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { Rich } from "../../design/rich";
import { mentionNames } from "../mentions";
import type { DrawerEntry } from "./types";
import { useComments } from "./useComments";

const COMMENT_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

/** The comment list of an activity and the (encrypted) form to add one. */
export function CommentSection({
  entry,
  canComment,
}: {
  entry: DrawerEntry;
  canComment: boolean;
}) {
  const { item, state } = entry;
  const { comments, post } = useComments(item.id, state.crypto);
  const [draft, setDraft] = useState("");
  const mentionable = useMemo(
    () => mentionNames(state.members),
    [state.members],
  );

  return (
    <section>
      <h3 className="h2 dr-cmts-title">Comentários</h3>
      <div className="col gap12" id="cmts">
        {comments === null ? <p className="muted sm">Carregando…</p> : null}
        {comments !== null && comments.length === 0 ? (
          <p className="muted sm">Seja a primeira pessoa a comentar.</p>
        ) : null}
        {(comments ?? []).map((entryComment) => (
          <div className="row dr-cmt" key={entryComment.id}>
            <Avatar
              email={entryComment.authorEmail}
              id={entryComment.authorId ?? entryComment.authorEmail}
              size="lg"
            />
            <div className="grow">
              <div className="row gap8">
                <b>{nameOf(entryComment.authorEmail)}</b>
                <time className="xs muted">
                  {new Date(entryComment.createdAt).toLocaleString(
                    "pt-BR",
                    COMMENT_TIME,
                  )}
                </time>
              </div>
              <div className="dr-cmt-body">
                <Rich mentions={mentionable} text={entryComment.body} />
              </div>
            </div>
          </div>
        ))}
      </div>
      {canComment ? (
        <form
          className="col gap8 dr-cmt-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = draft.trim();
            if (value === "") return;
            void post(value, () => setDraft(""));
          }}
        >
          <textarea
            aria-label="Novo comentário"
            className="inp"
            maxLength={10000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Comente. Use @ para mencionar quem tem acesso ao projeto."
            rows={2}
            value={draft}
          />
          <div className="row">
            <span className="xs muted grow">
              <Icon name="lock" size="sm" /> Cifrado antes de sair do navegador
            </span>
            <button className="btn primary sm" type="submit">
              Comentar
            </button>
          </div>
        </form>
      ) : (
        <p className="muted sm dr-cmt-denied">
          Seu perfil não permite comentar.
        </p>
      )}
    </section>
  );
}
