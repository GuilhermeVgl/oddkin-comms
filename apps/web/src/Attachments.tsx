import {
  ApiStatusError,
  createApiClient,
  deleteAttachment,
  getDownloadUrl,
  listAttachments,
  readCookie,
  uploadFile,
  type Attachment,
  type UploadContext,
  type UploadNameEncryption,
} from "@oddkin/api-client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalE2EE } from "./e2ee/E2EE";
import { resources, type ContentCrypto } from "./e2ee/projectCrypto";
import { useEvents } from "./events";

type Client = ReturnType<typeof createApiClient>;

const MAX_BYTES = 500_000_000;

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function describe(error: unknown): string {
  if (error instanceof ApiStatusError) {
    if (error.status === 503)
      return "O armazenamento de arquivos não está configurado.";
    if (error.status === 507) return "A cota de armazenamento acabou.";
    if (error.status === 409)
      return "Já existe um envio em andamento. Aguarde terminar.";
    if (error.status === 403) return "Seu perfil não permite enviar arquivos.";
  }
  return "Não foi possível enviar o arquivo. Tente novamente.";
}

export function Attachments({
  client,
  context,
}: {
  client: Client;
  context: UploadContext;
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [allowed, setAllowed] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const e2ee = useOptionalE2EE();

  const { contextType, contextId } = context;
  const cryptoFor = useCallback(
    async (maintain: boolean): Promise<ContentCrypto | null> => {
      if (e2ee === null) return null;
      if (contextType === "work_item") {
        return context.projectId === undefined
          ? null
          : e2ee.openProject(context.projectId, { maintain });
      }
      return e2ee.openConversation(contextId, { maintain });
    },
    [context.projectId, contextId, contextType, e2ee],
  );

  const domainKind = useCallback(
    (crypto: ContentCrypto) =>
      contextType === "work_item"
        ? "work"
        : crypto.domain("dm") === undefined
          ? "chat"
          : "dm",
    [contextType],
  );

  const displayNames = useCallback(
    async (rows: Attachment[], crypto: ContentCrypto | null) => {
      const next = new Map<string, string>();
      for (const item of rows) {
        if (!item.encrypted) {
          next.set(item.id, item.name);
          continue;
        }
        if (
          crypto === null ||
          item.nameEnc === undefined ||
          item.contentAuthorId === undefined ||
          item.signerDeviceId === undefined
        ) {
          next.set(item.id, "Nome cifrado (desbloqueie este navegador)");
          continue;
        }
        const result = await crypto.decrypt(domainKind(crypto), {
          resource: resources.attachment(item.id),
          revision: 1,
          authorId: item.contentAuthorId,
          signerDeviceId: item.signerDeviceId,
          envelope: item.nameEnc,
        });
        next.set(
          item.id,
          result.ok ? result.text : "Nome cifrado indisponível",
        );
      }
      return next;
    },
    [domainKind],
  );

  const reload = useCallback(async () => {
    try {
      const rows = await listAttachments(client, { contextType, contextId });
      setItems(rows);
      setNames(await displayNames(rows, await cryptoFor(false)));
      setAllowed(true);
    } catch (error) {
      setAllowed(!(error instanceof ApiStatusError && error.status === 403));
      setItems([]);
    }
  }, [client, contextType, contextId, cryptoFor, displayNames]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (event === "resync") void reload();
  });

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const csrf = readCookie(document.cookie, "oddkin_csrf");
    if (file === undefined || csrf === null) return;
    if (file.size === 0 || file.size > MAX_BYTES) {
      setMessage("Escolha um arquivo de até 500 MB.");
      return;
    }
    setProgress(0);
    setMessage("");
    try {
      const crypto = await cryptoFor(true);
      let encryption: UploadNameEncryption | undefined;
      if (crypto !== null) {
        const kind = domainKind(crypto);
        if (crypto.isEncrypted(kind)) {
          if (!crypto.canWrite(kind)) {
            throw new Error("encryption unavailable");
          }
          const id = window.crypto.randomUUID();
          const name = crypto.encrypt(kind, resources.attachment(id), 1, file.name);
          encryption = { id, nameEnc: name.envelope, signerDeviceId: name.signerDeviceId };
        }
      }
      await uploadFile(client, csrf, context, file, setProgress, undefined, encryption);
      await reload();
    } catch (error) {
      setMessage(describe(error));
    } finally {
      setProgress(null);
    }
  }

  async function download(item: Attachment) {
    try {
      const url = await getDownloadUrl(client, item.id);
      const link = document.createElement("a");
      link.href = url;
      link.download = names.get(item.id) ?? "arquivo";
      link.rel = "noopener";
      link.click();
    } catch {
      setMessage("Não foi possível baixar o arquivo agora.");
    }
  }

  async function remove(item: Attachment) {
    const csrf = readCookie(document.cookie, "oddkin_csrf");
    if (csrf === null) return;
    try {
      await deleteAttachment(client, csrf, item.id);
      await reload();
    } catch {
      setMessage("Você não pode remover este arquivo.");
    }
  }

  if (!allowed) return null;
  return (
    <section className="attachments" aria-label="Arquivos">
      <h4>Arquivos</h4>
      {items === null ? <p>Carregando…</p> : null}
      {items !== null && items.length === 0 ? (
        <p className="empty-note">Nenhum arquivo.</p>
      ) : null}
      <ul>
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <button
              className="text-button"
              onClick={() => void download(item)}
              type="button"
            >
              {names.get(item.id) ?? item.name}
            </button>{" "}
            <span>
              {formatSize(item.size)} · {item.uploaderEmail}
            </span>{" "}
            <button
              className="text-button"
              onClick={() => void remove(item)}
              type="button"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
      <label className="file-button">
        <input
          aria-label="Enviar arquivo"
          disabled={progress !== null}
          onChange={(event) => void handleFile(event)}
          ref={input}
          type="file"
        />
      </label>
      {progress !== null ? (
        <progress aria-label="Progresso do envio" max={1} value={progress} />
      ) : null}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </section>
  );
}
