import type { Attachment } from "@crewstead/api-client";
import { bytes, fmtClock } from "../design/format";
import { Icon } from "../design/icons";
import { displayNameOf } from "../design/people";
import { Avatar } from "../design/primitives";
import { useWorkspace } from "../workspace";
import { attachmentDetail } from "./rules";

/** One attachment: its name, size and who sent it, with download and remove. */
export function AttachmentRow({
  item,
  name,
  onDownload,
  onRemove,
  detail,
}: {
  item: Attachment;
  name: string;
  onDownload: () => void;
  onRemove?: (() => void) | undefined;
  detail?: string | undefined;
}) {
  return (
    <div className="file attach-row">
      <span className="fi">
        <Icon name="file" />
      </span>
      <div className="grow col attach-body">
        <span className="nm">{name}</span>
        <span className="sz">{detail ?? attachmentDetail(item, bytes)}</span>
      </div>
      <button className="btn sm" onClick={onDownload} type="button">
        <Icon name="dl" size="sm" />
        Baixar
      </button>
      {onRemove === undefined ? null : (
        <button
          aria-label={`Remover ${name}`}
          className="btn sm ghost"
          onClick={onRemove}
          type="button"
        >
          <Icon name="trash" size="sm" />
        </button>
      )}
    </div>
  );
}

/** The row shown while a file is being encrypted and sent. */
export function UploadProgress({ progress }: { progress: number }) {
  const percent = Math.round(progress * 100);
  return (
    <div className="file attach-row attach-progress">
      <span className="fi">
        <Icon name="lock" />
      </span>
      <div className="grow col attach-body">
        <span className="nm">Cifrando e enviando…</span>
        <div
          aria-label="Progresso do envio"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          className="prog"
          role="progressbar"
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}

/** A ready attachment occupies the same chronological stream as chat messages. */
export function AttachmentMessageRow({
  item,
  name,
  me,
  moderator,
  onDownload,
  onRemove,
}: {
  item: Attachment;
  name: string;
  me: { id: string; email: string };
  moderator: boolean;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const { people } = useWorkspace();
  const person =
    item.uploaderId === undefined ? undefined : people.get(item.uploaderId);
  const author = displayNameOf(item.uploaderEmail, person?.displayName);
  const removable = moderator || item.uploaderId === me.id;
  return (
    <article
      aria-label={`${author} enviou ${name}`}
      className="msg file-message"
    >
      <Avatar
        email={item.uploaderEmail}
        id={item.uploaderId ?? item.uploaderEmail}
        name={person?.displayName}
        size="lg"
      />
      <div className="mb">
        <div className="mh">
          <b>{author}</b>
          <time>{fmtClock(item.createdAt)}</time>
        </div>
        <AttachmentRow
          item={item}
          name={name}
          onDownload={onDownload}
          onRemove={removable ? onRemove : undefined}
          detail={attachmentDetail(item, bytes, false)}
        />
      </div>
    </article>
  );
}
