import {
  ApiStatusError,
  type Attachment,
  type UploadContext,
  type UploadNameEncryption,
} from "@crewstead/api-client";
import type { DownloadFailure } from "../e2ee/encryptedFiles";
import type { DomainKind } from "../e2ee/keyring";
import type { ContentCrypto, EncryptedField } from "../e2ee/projectCrypto";

export const MAX_BYTES = 500_000_000;

/** Files must be non-empty and at most 500 MB. */
export function isUploadSizeAllowed(size: number): boolean {
  return size !== 0 && size <= MAX_BYTES;
}

export function describeUploadError(error: unknown): string {
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

export function describeDownloadError(failure: DownloadFailure): string {
  if (failure === "unsupported")
    return "Este navegador não consegue gravar arquivos grandes em partes. Use um navegador baseado em Chromium.";
  if (failure === "locked")
    return "Desbloqueie este navegador para baixar o arquivo.";
  if (failure === "invalid")
    return "O arquivo falhou na verificação e nada foi salvo.";
  return "Não foi possível baixar o arquivo agora.";
}

/** The key domain that protects names here: a project's work, a channel's chat, or a DM. */
export function nameDomainKind(
  contextType: UploadContext["contextType"],
  hasDmDomain: boolean,
): DomainKind {
  if (contextType === "work_item") return "work";
  return hasDmDomain ? "dm" : "chat";
}

export type NameSource =
  | { text: string }
  | {
      decrypt: {
        authorId: string;
        signerDeviceId: string;
        envelope: NonNullable<Attachment["nameEnc"]>;
      };
    };

/**
 * Where an attachment's name comes from: the text itself (plain, or a note that
 * the browser must be unlocked), or the sealed name to decrypt.
 */
export function nameSource(
  item: Pick<
    Attachment,
    "encrypted" | "name" | "nameEnc" | "contentAuthorId" | "signerDeviceId"
  >,
  canDecrypt: boolean,
): NameSource {
  if (!item.encrypted) return { text: item.name };
  if (
    !canDecrypt ||
    item.nameEnc === undefined ||
    item.contentAuthorId === undefined ||
    item.signerDeviceId === undefined
  ) {
    return { text: "Nome cifrado (desbloqueie este navegador)" };
  }
  return {
    decrypt: {
      authorId: item.contentAuthorId,
      signerDeviceId: item.signerDeviceId,
      envelope: item.nameEnc,
    },
  };
}

/** "size · uploader" plus a note on what is encrypted. */
export function attachmentDetail(
  item: Pick<
    Attachment,
    "size" | "contentSize" | "uploaderEmail" | "bodyEncrypted" | "encrypted"
  >,
  formatBytes: (size: number) => string,
): string {
  const suffix =
    item.bodyEncrypted === true
      ? " · cifrado de ponta a ponta"
      : item.encrypted
        ? " · nome cifrado, conteúdo sem cifra"
        : "";
  return `${formatBytes(Number(item.contentSize ?? item.size))} · ${item.uploaderEmail}${suffix}`;
}

type Sealer = Pick<ContentCrypto, "isEncrypted" | "canWrite" | "encrypt">;

/**
 * Encrypts the file name when its domain already has a key, under a new
 * attachment id. Null when names here are still plain; throws when they must
 * be encrypted but this device cannot write.
 */
export function sealFileName(
  crypto: Sealer | null,
  kind: DomainKind,
  resource: (id: string) => string,
  fileName: string,
  newId: () => string,
): UploadNameEncryption | undefined {
  if (crypto === null || !crypto.isEncrypted(kind)) return undefined;
  if (!crypto.canWrite(kind)) throw new Error("encryption unavailable");
  const id = newId();
  const name: EncryptedField = crypto.encrypt(kind, resource(id), 1, fileName);
  return {
    id,
    nameEnc: name.envelope,
    signerDeviceId: name.signerDeviceId,
  };
}

/**
 * Once the files domain has a key the server refuses plaintext bodies. True
 * when the body must be encrypted; throws when it must but this device cannot.
 */
export function mustEncryptBody(
  crypto: Pick<ContentCrypto, "fileKind" | "isEncrypted" | "canWrite"> | null,
): boolean {
  if (crypto === null) return false;
  const kind = crypto.fileKind();
  if (!crypto.isEncrypted(kind)) return false;
  if (!crypto.canWrite(kind)) throw new Error("encryption unavailable");
  return true;
}
