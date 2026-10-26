import type { CallRecord } from "@crewstead/api-client";
import { fmtClock } from "../design/format";
import { Icon } from "../design/icons";
import { describeCall } from "./callRecord";

/** One line in a conversation that says a call happened, and how it went. */
export function CallRecordRow({
  record,
  meEmail,
  canJoin,
  onJoin,
}: {
  record: CallRecord;
  meEmail: string;
  canJoin: boolean;
  onJoin: () => void;
}) {
  const summary = describeCall(record, meEmail);
  return (
    <div
      aria-label={`${summary.title}. ${summary.detail}`}
      className={`callrec ${summary.tone}`}
      role="group"
    >
      <span aria-hidden="true" className="callrec-ic">
        <Icon name="phone" />
      </span>
      <div className="grow col">
        <b>{summary.title}</b>
        <span className="xs muted">{summary.detail}</span>
      </div>
      <time className="xs muted">{fmtClock(record.startedAt)}</time>
      {summary.tone === "live" && canJoin ? (
        <button className="btn sm primary" onClick={onJoin} type="button">
          Entrar
        </button>
      ) : null}
    </div>
  );
}
