import type { UploadContext } from "@crewstead/api-client";
import React, { useRef } from "react";
import { AttachmentRow, UploadProgress } from "./attachments/AttachmentRows";
import { useAttachmentList } from "./attachments/useAttachmentList";
import { useAttachmentTransfer } from "./attachments/useAttachmentTransfer";
import { Icon } from "./design/icons";
import type { Client } from "./e2ee/runtime";

export function Attachments({
  client,
  context,
  canUpload = true,
}: {
  client: Client;
  context: UploadContext;
  canUpload?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useAttachmentList(client, context);
  const { items, names, allowed } = list;
  const transfer = useAttachmentTransfer({
    client,
    context,
    names,
    reload: list.reload,
    cryptoFor: list.cryptoFor,
    domainKind: list.domainKind,
  });
  const { progress } = transfer;

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) void transfer.upload(file);
  }

  if (!allowed) return null;
  return (
    <section aria-label="Arquivos">
      <div className="row attach-head">
        <h3 className="h2 grow">Anexos</h3>
        {canUpload ? (
          <button
            className="btn sm"
            disabled={progress !== null}
            onClick={() => input.current?.click()}
            type="button"
          >
            <Icon name="clip" size="sm" />
            Anexar arquivo
          </button>
        ) : null}
        <input
          aria-label="Enviar arquivo"
          hidden
          onChange={handleFile}
          ref={input}
          type="file"
        />
      </div>
      {items === null ? <p className="muted sm">Carregando…</p> : null}
      {items !== null && items.length === 0 && progress === null ? (
        <p className="muted sm">Nenhum anexo.</p>
      ) : null}
      {(items ?? []).map((item) => (
        <AttachmentRow
          item={item}
          key={item.id}
          name={names.get(item.id) ?? item.name}
          onDownload={() => void transfer.download(item)}
          onRemove={() => void transfer.remove(item)}
        />
      ))}
      {progress !== null ? <UploadProgress progress={progress} /> : null}
    </section>
  );
}
