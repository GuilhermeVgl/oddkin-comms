import type { Attachment } from "@crewstead/api-client";
import { bytes } from "../design/format";
import { Icon } from "../design/icons";
import { attachmentDetail } from "./rules";

/** One attachment: its name, size and who sent it, with download and remove. */
export function AttachmentRow({
  item,
  name,
  onDownload,
  onRemove,
}: {
  item: Attachment;
  name: string;
  onDownload: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="file attach-row">
      <span className="fi">
        <Icon name="file" />
      </span>
      <div className="grow col attach-body">
        <span className="nm">{name}</span>
        <span className="sz">{attachmentDetail(item, bytes)}</span>
      </div>
      <button className="btn sm" onClick={onDownload} type="button">
        <Icon name="dl" size="sm" />
        Baixar
      </button>
      <button
        aria-label={`Remover ${name}`}
        className="btn sm ghost"
        onClick={onRemove}
        type="button"
      >
        <Icon name="trash" size="sm" />
      </button>
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
