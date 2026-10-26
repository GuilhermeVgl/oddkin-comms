import {
  abortUpload,
  completeUpload,
  createApiClient,
  createUpload,
  getDownloadUrl,
  presignUploadPart,
  type Attachment,
  type UploadContext,
  type UploadNameEncryption,
} from "@crewstead/api-client";
import { CryptoError, MAX_FILE_BYTES } from "@crewstead/crypto";
import {
  chooseSink,
  decryptStream,
  sendEncryptedParts,
  TransferError,
} from "./fileTransfer";
import type { ContentCrypto } from "./projectCrypto";

type Client = ReturnType<typeof createApiClient>;

/** Encrypts a file in the browser and sends it straight to the bucket in parts. */
export async function uploadEncryptedFile(input: {
  client: Client;
  token: string;
  context: UploadContext;
  file: File;
  crypto: ContentCrypto;
  /** The attachment id, shared with the encrypted name when there is one. */
  id: string;
  nameEncryption?: UploadNameEncryption | undefined;
  onProgress: (fraction: number) => void;
  put?: typeof fetch;
}): Promise<Attachment> {
  const { file } = input;
  if (file.size < 1 || file.size > MAX_FILE_BYTES)
    throw new Error("file size out of range");
  const { sealer, signerDeviceId } = input.crypto.fileSealer(
    input.id,
    file.size,
  );
  const session = await createUpload(
    input.client,
    input.token,
    input.context,
    { name: file.name, type: "", size: sealer.encryptedSize },
    input.nameEncryption,
    { id: input.id, signerDeviceId },
  );
  const put = input.put ?? fetch;
  try {
    const etags = await sendEncryptedParts({
      file,
      sealer,
      partSize: session.partSize,
      partCount: session.partCount,
      onProgress: input.onProgress,
      transport: {
        async put(partNumber, body) {
          // A fresh URL per attempt; the same bytes are sent again.
          const url = await presignUploadPart(
            input.client,
            session.id,
            partNumber,
          );
          const response = await put(url, { method: "PUT", body });
          const etag = response.headers.get("ETag");
          if (!response.ok || etag === null)
            throw new Error(`part ${partNumber} rejected (${response.status})`);
          return etag;
        },
      },
    });
    return await completeUpload(
      input.client,
      input.token,
      session.id,
      etags.map((etag, index) => ({ partNumber: index + 1, etag })),
    );
  } catch (error) {
    await abortUpload(input.client, input.token, session.id).catch(
      () => undefined,
    );
    throw error;
  }
}

type BrowserFiles = Window &
  typeof globalThis & {
    showSaveFilePicker?: Parameters<typeof chooseSink>[1]["showSaveFilePicker"];
  };

function browserSink(name: string) {
  const win = window as BrowserFiles;
  const storage = navigator.storage as
    | (StorageManager & {
        getDirectory?: Parameters<typeof chooseSink>[1]["getDirectory"];
      })
    | undefined;
  return chooseSink(name, {
    showSaveFilePicker: win.showSaveFilePicker?.bind(window),
    getDirectory: storage?.getDirectory?.bind(storage),
    deliver(file, fileName) {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.rel = "noopener";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}

export type DownloadFailure = "unsupported" | "invalid" | "locked" | "network";

export function describeDownloadFailure(error: unknown): DownloadFailure {
  if (error instanceof TransferError)
    return error.reason === "unsupported" ? "unsupported" : "invalid";
  if (error instanceof CryptoError)
    return error.code === "unknown_generation" ? "locked" : "invalid";
  if (error instanceof DOMException && error.name === "AbortError")
    return "network";
  return "network";
}

/**
 * Downloads and decrypts an attachment as a stream. Where the plaintext goes is
 * chosen first (while the click still counts), so a browser that cannot write
 * large files in parts says so before any byte is fetched.
 */
export async function downloadEncryptedFile(input: {
  client: Client;
  attachment: Attachment;
  name: string;
  crypto: ContentCrypto;
  onProgress?: ((fraction: number) => void) | undefined;
}): Promise<void> {
  const { attachment } = input;
  if (
    attachment.uploaderId === undefined ||
    attachment.bodySignerDeviceId === undefined
  ) {
    throw new CryptoError("malformed");
  }
  const uploaderId = attachment.uploaderId;
  const signerDeviceId = attachment.bodySignerDeviceId;
  const sink = await browserSink(input.name);
  try {
    const url = await getDownloadUrl(input.client, attachment.id);
    const response = await fetch(url);
    if (!response.ok || response.body === null)
      throw new Error(`download rejected (${response.status})`);
    await decryptStream({
      body: response.body,
      sink,
      onProgress: input.onProgress,
      openHead: (head) =>
        input.crypto.openFileHead({
          attachmentId: attachment.id,
          uploaderId,
          signerDeviceId,
          head,
        }),
    });
  } catch (error) {
    await sink.abort().catch(() => undefined);
    throw error;
  }
}
