import { Icon } from "../../design/icons";
import { nameOf } from "../../design/people";
import { Avatar } from "../../design/primitives";
import { Rich } from "../../design/rich";
import type { Outgoing } from "./outgoing";

/** A message still on its way (or failed, with a retry button). */
export function OutgoingRow({
  entry,
  me,
  mentionable,
  onRetry,
}: {
  entry: Outgoing;
  me: { id: string; email: string };
  mentionable: Set<string>;
  onRetry: () => void;
}) {
  return (
    <article className={`msg ${entry.state}`}>
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
            <span className="mstate danger">
              <Icon name="alert" size="sm" />
              Falhou{" "}
              <button
                className="btn sm ghost mretry"
                onClick={onRetry}
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
  );
}
