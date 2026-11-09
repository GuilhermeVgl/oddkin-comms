import {
  ApiStatusError,
  EncryptionError,
  type Attachment,
  type UploadContext,
  type UploadNameEncryption,
} from "@crewstead/api-client";
import type { DownloadFailure } from "../e2ee/encryptedFiles";
import type { DomainKind } from "../e2ee/keyring";
import type { ContentCrypto, EncryptedField } from "../e2ee/projectCrypto";

export const MAX_BYTES = 500_000_000;

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

export function previewImageType(
  contentType: string,
  name: string,
): string | null {
  if (Object.values(imageTypes).includes(contentType)) return contentType;
  if (contentType !== "application/octet-stream" && contentType !== "")
    return null;
  return imageTypes[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export type AttachmentCryptoScope =
  { type: "project"; id: string } | { type: "conversation"; id: string };

/** Channels share their project's chat/files domains; only DMs own a conversation domain. */
export function attachmentCryptoScope(
  context: UploadContext,
): AttachmentCryptoScope {
  if (context.projectId !== undefined) {
    return { type: "project", id: context.projectId };
  }
  return { type: "conversation", id: context.contextId };
}

/** Files must be non-empty and at most 500 MB. */
export function isUploadSizeAllowed(size: number): boolean {
  return size !== 0 && size <= MAX_BYTES;
}

export function describeUploadError(error: unknown): string {
  if (error instanceof EncryptionError) {
    if (error.code === "rotation_required")
      return "A chave dos arquivos está sendo renovada. Tente novamente em instantes.";
    if (error.code === "encryption_required")
      return "Este canal exige arquivos cifrados. Desbloqueie este navegador e tente novamente.";
    if (error.code === "stale_generation")
      return "A chave dos arquivos mudou. Tente enviar novamente.";
    if (error.code === "domain_unavailable")
      return "A criptografia dos arquivos ainda está sendo preparada. Tente novamente em instantes.";
    if (error.code === "bad_envelope")
      return "O arquivo cifrado falhou na verificação. Atualize a página e tente novamente.";
  }
  if (error instanceof ApiStatusError) {
    if (error.status === 503)
      return "O armazenamento de arquivos não está configurado.";
    if (error.status === 507) return "A cota de armazenamento acabou.";
    if (error.status === 409)
      return "O canal ou projeto mudou e não aceita este envio. Atualize a página e tente novamente.";
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
  includeUploader = true,
): string {
  const suffix =
    item.bodyEncrypted === true
      ? " · cifrado de ponta a ponta"
      : item.encrypted
        ? " · nome cifrado, conteúdo sem cifra"
        : "";
  const uploader = includeUploader ? ` · ${item.uploaderEmail}` : "";
  return `${formatBytes(Number(item.contentSize ?? item.size))}${uploader}${suffix}`;
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
