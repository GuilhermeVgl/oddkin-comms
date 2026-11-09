import {
  deleteAttachment,
  getDownloadUrl,
  uploadFile,
  type Attachment,
  type UploadContext,
} from "@crewstead/api-client";
import { useState } from "react";
import { toast, toastError } from "../design/toast";
import {
  describeDownloadFailure,
  downloadEncryptedFile,
  uploadEncryptedFile,
} from "../e2ee/encryptedFiles";
import { decryptStream } from "../e2ee/fileTransfer";
import type { DomainKind } from "../e2ee/keyring";
import { resources, type ContentCrypto } from "../e2ee/projectCrypto";
import type { Client } from "../e2ee/runtime";
import {
  describeDownloadError,
  describeUploadError,
  isUploadSizeAllowed,
  mustEncryptBody,
  sealFileName,
} from "./rules";

function notify(message: string) {
  if (message !== "") toastError(message, { ms: 5200 });
}

// shortcut: 12 MiB per preview, stream-decrypt when larger image previews are needed.
const MAX_IMAGE_PREVIEW_BYTES = 12 << 20;

/** Uploading, downloading and removing attachments, with the progress of the current transfer. */
export function useAttachmentTransfer(input: {
  client: Client;
  context: UploadContext;
  names: Map<string, string>;
  reload: () => Promise<void>;
  cryptoFor: (maintain: boolean) => Promise<ContentCrypto | null>;
  domainKind: (crypto: ContentCrypto) => DomainKind;
}) {
  const { client, context, names, reload, cryptoFor, domainKind } = input;
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(file: File) {
    if (!isUploadSizeAllowed(file.size)) {
      notify("Escolha um arquivo de até 500 MB.");
      return;
    }
    setProgress(0);
    try {
      const crypto = await cryptoFor(true);
      const encryption =
        crypto === null
          ? undefined
          : sealFileName(
              crypto,
              domainKind(crypto),
              resources.attachment,
              file.name,
              () => window.crypto.randomUUID(),
            );
      if (crypto !== null && mustEncryptBody(crypto)) {
        // Once the files domain has a key the server refuses plaintext bodies.
        await uploadEncryptedFile({
          client,
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
          context,
          file,
          setProgress,
          undefined,
          encryption,
        );
      }
      await reload();
    } catch (error) {
      notify(describeUploadError(error));
    } finally {
      setProgress(null);
    }
  }

  async function downloadSealed(item: Attachment) {
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
      notify(describeDownloadError(describeDownloadFailure(error)));
    } finally {
      setProgress(null);
    }
  }

  async function download(item: Attachment) {
    if (item.bodyEncrypted === true) {
      await downloadSealed(item);
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

  /** A browser-safe URL for an image in the conversation. */
  async function preview(item: Attachment): Promise<string | null> {
    if (!item.contentType.startsWith("image/")) return null;
    if (Number(item.contentSize ?? item.size) > MAX_IMAGE_PREVIEW_BYTES)
      return null;
    const url = await getDownloadUrl(client, item.id);
    if (item.bodyEncrypted !== true) return url;
    const uploaderId = item.uploaderId;
    const signerDeviceId = item.bodySignerDeviceId;
    if (uploaderId === undefined || signerDeviceId === undefined)
      throw new Error("malformed encrypted attachment");
    const crypto = await cryptoFor(false);
    if (crypto === null) throw new Error("locked");
    const response = await fetch(url);
    if (!response.ok || response.body === null)
      throw new Error(`download rejected (${response.status})`);
    const chunks: Uint8Array[] = [];
    await decryptStream({
      body: response.body,
      sink: {
        write: async (chunk: Uint8Array) => void chunks.push(chunk),
        close: async () => undefined,
        abort: async () => {
          chunks.length = 0;
        },
      },
      openHead: (head: Uint8Array) =>
        crypto.openFileHead({
          attachmentId: item.id,
          uploaderId,
          signerDeviceId,
          head,
        }),
    });
    return URL.createObjectURL(
      new Blob(chunks as BlobPart[], { type: item.contentType }),
    );
  }

  async function remove(item: Attachment) {
    try {
      await deleteAttachment(client, item.id);
      await reload();
    } catch {
      notify("Você não pode remover este arquivo.");
    }
  }

  return { progress, upload, download, preview, remove };
}
