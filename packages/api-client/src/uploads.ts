import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type Attachment = Schemas["Attachment"];
export type UploadSession = Schemas["Upload"];
export type UploadContext = {
  contextType: "work_item" | "conversation";
  contextId: string;
  /** Required for a work-item attachment whose name is encrypted. */
  projectId?: string;
};

export type UploadNameEncryption = {
  id: string;
  nameEnc: string;
  signerDeviceId: string;
};

export async function createUpload(
  client: Client,
  token: string,
  context: UploadContext,
  file: { name: string; type: string; size: number },
  encryption?: UploadNameEncryption,
  /** For an encrypted body: the client-chosen id and the signing device; `file.size` is then the encrypted size. */
  body?: { id: string; signerDeviceId: string },
): Promise<UploadSession> {
  const { data, response } = await client.POST("/api/v1/uploads", {
    body: {
      ...context,
      ...(encryption === undefined
        ? { name: file.name }
        : {
            id: encryption.id,
            nameEnc: encryption.nameEnc,
            signerDeviceId: encryption.signerDeviceId,
          }),
      ...(body === undefined
        ? {}
        : {
            bodyEncrypted: true,
            id: body.id,
            signerDeviceId: body.signerDeviceId,
          }),
      size: file.size,
      ...(file.type === "" ? {} : { contentType: file.type }),
    },
    headers: csrf(token),
  });
  return ensure("createUpload", response, data, 201);
}

export async function presignUploadPart(
  client: Client,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const { data, response } = await client.GET(
    "/api/v1/uploads/{uploadId}/parts/{partNumber}",
    { params: { path: { uploadId, partNumber } } },
  );
  return ensure("presignUploadPart", response, data, 200).url;
}

export async function completeUpload(
  client: Client,
  token: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<Attachment> {
  const { data, response } = await client.POST(
    "/api/v1/uploads/{uploadId}/complete",
    {
      params: { path: { uploadId } },
      body: { parts },
      headers: csrf(token),
    },
  );
  return ensure("completeUpload", response, data, 200);
}

export async function abortUpload(
  client: Client,
  token: string,
  uploadId: string,
): Promise<void> {
  await client.POST("/api/v1/uploads/{uploadId}/abort", {
    params: { path: { uploadId } },
    headers: csrf(token),
  });
}

export async function listAttachments(
  client: Client,
  context: UploadContext,
): Promise<Attachment[]> {
  if (context.contextType === "work_item") {
    const { data, response } = await client.GET(
      "/api/v1/work-items/{workItemId}/attachments",
      { params: { path: { workItemId: context.contextId } } },
    );
    return ensure("listAttachments", response, data, 200);
  }
  const { data, response } = await client.GET(
    "/api/v1/conversations/{conversationId}/attachments",
    { params: { path: { conversationId: context.contextId } } },
  );
  return ensure("listAttachments", response, data, 200);
}

export async function getDownloadUrl(
  client: Client,
  attachmentId: string,
): Promise<string> {
  const { data, response } = await client.GET(
    "/api/v1/attachments/{attachmentId}/download",
    { params: { path: { attachmentId } } },
  );
  return ensure("getDownloadUrl", response, data, 200).url;
}

export async function deleteAttachment(
  client: Client,
  token: string,
  attachmentId: string,
): Promise<void> {
  const { response } = await client.DELETE(
    "/api/v1/attachments/{attachmentId}",
    { params: { path: { attachmentId } }, headers: csrf(token) },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "deleteAttachment");
  }
}

const CONCURRENT_PARTS = 2;
const PART_ATTEMPTS = 3;

/**
 * Uploads a file in parts straight to the bucket. Only one part-sized slice is
 * read at a time per worker, so the file is never loaded whole into memory.
 */
export async function uploadFile(
  client: Client,
  token: string,
  context: UploadContext,
  file: File,
  onProgress: (fraction: number) => void,
  putPart: typeof fetch = fetch,
  encryption?: UploadNameEncryption,
): Promise<Attachment> {
  const session = await createUpload(client, token, context, file, encryption);
  const etags = new Array<string>(session.partCount);
  let next = 0;
  let finished = 0;

  async function worker(): Promise<void> {
    while (next < session.partCount) {
      const index = next;
      next += 1;
      const slice = file.slice(
        index * session.partSize,
        (index + 1) * session.partSize,
      );
      let lastError: unknown = null;
      for (let attempt = 0; attempt < PART_ATTEMPTS; attempt += 1) {
        try {
          // A fresh URL per attempt; identical bytes are re-sent on retry.
          const url = await presignUploadPart(client, session.id, index + 1);
          const response = await putPart(url, { method: "PUT", body: slice });
          const etag = response.headers.get("ETag");
          if (!response.ok || etag === null) {
            throw new Error(`part ${index + 1} rejected (${response.status})`);
          }
          etags[index] = etag;
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError !== null) throw lastError;
      finished += 1;
      onProgress(finished / session.partCount);
    }
  }

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENT_PARTS, session.partCount) },
        () => worker(),
      ),
    );
    return await completeUpload(
      client,
      token,
      session.id,
      etags.map((etag, index) => ({ partNumber: index + 1, etag })),
    );
  } catch (error) {
    await abortUpload(client, token, session.id).catch(() => undefined);
    throw error;
  }
}

export type StorageUsage = Schemas["StorageUsage"];

export async function getStorageUsage(client: Client): Promise<StorageUsage> {
  const { data, response } = await client.GET("/api/v1/storage/usage");
  return ensure("getStorageUsage", response, data, 200);
}
