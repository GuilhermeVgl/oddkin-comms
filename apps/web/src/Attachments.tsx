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
} from "@crewstead/api-client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { bytes } from "./design/format";
import { Icon } from "./design/icons";
import { toast } from "./design/toast";
import { useOptionalE2EE } from "./e2ee/E2EE";
import {
  describeDownloadFailure,
  downloadEncryptedFile,
  uploadEncryptedFile,
} from "./e2ee/encryptedFiles";
import { resources, type ContentCrypto } from "./e2ee/projectCrypto";
import { useEvents } from "./events";

type Client = ReturnType<typeof createApiClient>;

const MAX_BYTES = 500_000_000;

function notify(message: string) {
  if (message !== "") toast(message, { kind: "err", ms: 5200 });
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
  canUpload = true,
}: {
  client: Client;
  context: UploadContext;
  canUpload?: boolean;
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [allowed, setAllowed] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
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
    const csrf = readCookie(document.cookie, "crewstead_csrf");
    if (file === undefined || csrf === null) return;
    if (file.size === 0 || file.size > MAX_BYTES) {
      notify("Escolha um arquivo de até 500 MB.");
      return;
    }
    setProgress(0);
    notify("");
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
          const name = crypto.encrypt(
            kind,
            resources.attachment(id),
            1,
            file.name,
          );
          encryption = {
            id,
            nameEnc: name.envelope,
            signerDeviceId: name.signerDeviceId,
          };
        }
      }
      const bodyKind = crypto?.fileKind();
      if (
        crypto !== null &&
        bodyKind !== undefined &&
        crypto.isEncrypted(bodyKind)
      ) {
        // Once the files domain has a key the server refuses plaintext bodies.
        if (!crypto.canWrite(bodyKind))
          throw new Error("encryption unavailable");
        await uploadEncryptedFile({
          client,
          token: csrf,
          context,
          file,
          crypto,
          id: encryption?.id ?? window.crypto.randomUUID(),
          nameEncryption: encryption,
          onProgress: setProgress,
        });
      } else {
        await uploadFile(
          client,
          csrf,
          context,
          file,
          setProgress,
          undefined,
          encryption,
        );
      }
      await reload();
    } catch (error) {
      notify(describe(error));
    } finally {
      setProgress(null);
    }
  }

  async function download(item: Attachment) {
    if (item.bodyEncrypted === true) {
      try {
        const crypto = await cryptoFor(false);
        if (crypto === null) throw new Error("locked");
        setProgress(0);
        await downloadEncryptedFile({
          client,
          attachment: item,
          name: names.get(item.id) ?? "arquivo",
          crypto,
          onProgress: setProgress,
        });
        toast("Arquivo decifrado e salvo.", { icon: "check" });
      } catch (error) {
        const failure = describeDownloadFailure(error);
        notify(
          failure === "unsupported"
            ? "Este navegador não consegue gravar arquivos grandes em partes. Use um navegador baseado em Chromium."
            : failure === "locked"
              ? "Desbloqueie este navegador para baixar o arquivo."
              : failure === "invalid"
                ? "O arquivo falhou na verificação e nada foi salvo."
                : "Não foi possível baixar o arquivo agora.",
        );
      } finally {
        setProgress(null);
      }
      return;
    }
    try {
      const url = await getDownloadUrl(client, item.id);
      const link = document.createElement("a");
      link.href = url;
      link.download = names.get(item.id) ?? "arquivo";
      link.rel = "noopener";
      link.click();
    } catch {
      notify("Não foi possível baixar o arquivo agora.");
    }
  }

  async function remove(item: Attachment) {
    const csrf = readCookie(document.cookie, "crewstead_csrf");
    if (csrf === null) return;
    try {
      await deleteAttachment(client, csrf, item.id);
      await reload();
    } catch {
      notify("Você não pode remover este arquivo.");
    }
  }

  if (!allowed) return null;
  return (
    <section aria-label="Arquivos">
      <div className="row" style={{ marginBottom: 8 }}>
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
          onChange={(event) => void handleFile(event)}
          ref={input}
          type="file"
        />
      </div>
      {items === null ? <p className="muted sm">Carregando…</p> : null}
      {items !== null && items.length === 0 && progress === null ? (
        <p className="muted sm">Nenhum anexo.</p>
      ) : null}
      {(items ?? []).map((item) => (
        <div
          className="file"
          key={item.id}
          style={{ margin: "0 0 6px", maxWidth: "none" }}
        >
          <span className="fi">
            <Icon name="file" />
          </span>
          <div className="grow col" style={{ minWidth: 0 }}>
            <span className="nm">{names.get(item.id) ?? item.name}</span>
            <span className="sz">
              {bytes(Number(item.contentSize ?? item.size))} ·{" "}
              {item.uploaderEmail}
              {item.bodyEncrypted === true
                ? " · cifrado de ponta a ponta"
                : item.encrypted
                  ? " · nome cifrado, conteúdo sem cifra"
                  : ""}
            </span>
          </div>
          <button
            className="btn sm"
            onClick={() => void download(item)}
            type="button"
          >
            <Icon name="dl" size="sm" />
            Baixar
          </button>
          <button
            aria-label={`Remover ${names.get(item.id) ?? item.name}`}
            className="btn sm ghost"
            onClick={() => void remove(item)}
            type="button"
          >
            <Icon name="trash" size="sm" />
          </button>
        </div>
      ))}
      {progress !== null ? (
        <div className="file" style={{ maxWidth: "none" }}>
          <span className="fi">
            <Icon name="lock" />
          </span>
          <div className="grow col" style={{ minWidth: 0, gap: 4 }}>
            <span className="nm">Cifrando e enviando…</span>
            <div
              aria-label="Progresso do envio"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(progress * 100)}
              className="prog"
              role="progressbar"
            >
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
