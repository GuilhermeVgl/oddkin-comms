import { ApiStatusError, type Client, type Schemas } from "./internal";

export type TrustRoot = Schemas["TrustRoot"];
export type Device = Schemas["Device"];
export type PendingDevice = Schemas["PendingDevice"];
export type DirectoryDevice = Schemas["DirectoryDevice"];
export type KeyDomain = Schemas["KeyDomain"];
export type KeyEnvelope = Schemas["KeyEnvelope"];
export type KeyRecipient = Schemas["KeyRecipient"];
export type ApiError = Schemas["ApiError"];

/** A write the server refused for an encryption reason (409/400 with a code). */
export class EncryptionError extends ApiStatusError {
  constructor(
    status: number,
    readonly code: ApiError["code"] | null,
  ) {
    super(status, `encryption:${code ?? "unknown"}`);
  }
}

export function encryptionErrorFrom(status: number, body: unknown): Error {
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? (body.code as ApiError["code"])
      : null;
  return new EncryptionError(status, code);
}

function csrf(token: string) {
  return { "X-CSRF-Token": token };
}

function expect<T>(
  operation: string,
  response: Response,
  data: T | undefined,
  status: number,
): T {
  if (response.status !== status || data === undefined) {
    throw new ApiStatusError(response.status, operation);
  }
  return data;
}

export async function getTrustRoot(client: Client): Promise<TrustRoot | null> {
  const { data, response } = await client.GET("/api/v1/e2ee/trust-root");
  if (response.status === 404) return null;
  return expect("getTrustRoot", response, data, 200);
}

export async function setTrustRoot(
  client: Client,
  token: string,
  signPublicKey: string,
): Promise<TrustRoot> {
  const { data, response } = await client.PUT("/api/v1/e2ee/trust-root", {
    body: { signPublicKey },
    headers: csrf(token),
  });
  return expect("setTrustRoot", response, data, 200);
}

export async function registerDevice(
  client: Client,
  token: string,
  body: Schemas["RegisterDeviceRequest"],
): Promise<Device> {
  const { data, response } = await client.POST("/api/v1/devices", {
    body,
    headers: csrf(token),
  });
  return expect("registerDevice", response, data, 201);
}

export async function listDevices(client: Client): Promise<Device[]> {
  const { data, response } = await client.GET("/api/v1/devices");
  return expect("listDevices", response, data, 200);
}

export async function listPendingDevices(
  client: Client,
): Promise<PendingDevice[]> {
  const { data, response } = await client.GET("/api/v1/devices/pending");
  return expect("listPendingDevices", response, data, 200);
}

export async function authorizeDevice(
  client: Client,
  token: string,
  deviceId: string,
  certificate: string,
  authorizerDeviceId?: string,
): Promise<Device> {
  const { data, response } = await client.POST(
    "/api/v1/devices/{deviceId}/authorize",
    {
      params: { path: { deviceId } },
      body: {
        certificate,
        ...(authorizerDeviceId === undefined ? {} : { authorizerDeviceId }),
      },
      headers: csrf(token),
    },
  );
  return expect("authorizeDevice", response, data, 200);
}

export async function revokeDevice(
  client: Client,
  token: string,
  deviceId: string,
): Promise<void> {
  const { response } = await client.POST("/api/v1/devices/{deviceId}/revoke", {
    params: { path: { deviceId } },
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "revokeDevice");
  }
}

export async function getDeviceRecord(
  client: Client,
  deviceId: string,
): Promise<DirectoryDevice | undefined> {
  const { data, response } = await client.GET("/api/v1/devices/{deviceId}", {
    params: { path: { deviceId } },
  });
  if (response.status === 404) return undefined;
  return expect("getDeviceRecord", response, data, 200);
}

export async function listKeyDomains(
  client: Client,
  projectId: string,
): Promise<KeyDomain[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/key-domains",
    { params: { path: { projectId } } },
  );
  return expect("listKeyDomains", response, data, 200);
}

export async function createKeyDomain(
  client: Client,
  token: string,
  projectId: string,
  kind: "work" | "chat" | "files",
): Promise<KeyDomain> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/key-domains",
    { params: { path: { projectId } }, body: { kind }, headers: csrf(token) },
  );
  return expect("createKeyDomain", response, data, 201);
}

export async function listAuthorizedDevices(
  client: Client,
  keyDomainId: string,
): Promise<DirectoryDevice[]> {
  const { data, response } = await client.GET(
    "/api/v1/key-domains/{keyDomainId}/authorized-devices",
    { params: { path: { keyDomainId } } },
  );
  return expect("listAuthorizedDevices", response, data, 200);
}

export async function listKeyRecipients(
  client: Client,
  keyDomainId: string,
): Promise<KeyRecipient[]> {
  const { data, response } = await client.GET(
    "/api/v1/key-domains/{keyDomainId}/recipients",
    { params: { path: { keyDomainId } } },
  );
  return expect("listKeyRecipients", response, data, 200);
}

export async function listMyKeyEnvelopes(
  client: Client,
  keyDomainId: string,
): Promise<KeyEnvelope[]> {
  const { data, response } = await client.GET(
    "/api/v1/key-domains/{keyDomainId}/envelopes",
    { params: { path: { keyDomainId } } },
  );
  return expect("listMyKeyEnvelopes", response, data, 200);
}

export type EnvelopeInput = {
  recipientDeviceId: string;
  sealed: string;
  signature: string;
};

/** Devices holding a call seat, and its short lived media-key envelopes. */
export async function listCallKeyDevices(
  client: Client,
  callId: string,
): Promise<DirectoryDevice[]> {
  const { data, response } = await client.GET(
    "/api/v1/calls/{callId}/key-devices",
    { params: { path: { callId } } },
  );
  return expect("listCallKeyDevices", response, data, 200);
}

export async function listCallKeyEnvelopes(
  client: Client,
  callId: string,
): Promise<KeyEnvelope[]> {
  const { data, response } = await client.GET(
    "/api/v1/calls/{callId}/key-envelopes",
    { params: { path: { callId } } },
  );
  return expect("listCallKeyEnvelopes", response, data, 200);
}

export async function publishCallKey(
  client: Client,
  token: string,
  callId: string,
  generation: number,
  signerDeviceId: string,
  envelopes: EnvelopeInput[],
): Promise<Schemas["Call"]> {
  const { data, response } = await client.POST(
    "/api/v1/calls/{callId}/key-generations",
    {
      params: { path: { callId } },
      body: { generation, signerDeviceId, envelopes },
      headers: csrf(token),
    },
  );
  return expect("publishCallKey", response, data, 200);
}

export async function publishKeyGeneration(
  client: Client,
  token: string,
  keyDomainId: string,
  generation: number,
  signerDeviceId: string,
  envelopes: EnvelopeInput[],
): Promise<KeyDomain> {
  const { data, response } = await client.POST(
    "/api/v1/key-domains/{keyDomainId}/generations",
    {
      params: { path: { keyDomainId } },
      body: { generation, signerDeviceId, envelopes },
      headers: csrf(token),
    },
  );
  return expect("publishKeyGeneration", response, data, 200);
}

export async function grantKeyEnvelopes(
  client: Client,
  token: string,
  keyDomainId: string,
  generation: number,
  signerDeviceId: string,
  envelopes: EnvelopeInput[],
): Promise<KeyDomain> {
  const { data, response } = await client.POST(
    "/api/v1/key-domains/{keyDomainId}/envelopes",
    {
      params: { path: { keyDomainId } },
      body: { generation, signerDeviceId, envelopes },
      headers: csrf(token),
    },
  );
  return expect("grantKeyEnvelopes", response, data, 200);
}

// --- encrypted content writes -------------------------------------------

type Written<T> = { data?: T; error?: unknown; response: Response };

function written<T>(operation: string, result: Written<T>, ok: number): T {
  if (result.response.status === ok && result.data !== undefined) {
    return result.data;
  }
  if (result.response.status === 409 || result.response.status === 400) {
    throw encryptionErrorFrom(result.response.status, result.error);
  }
  throw new ApiStatusError(result.response.status, operation);
}

export async function createWorkItemRaw(
  client: Client,
  token: string,
  projectId: string,
  body: Schemas["CreateWorkItemRequest"],
): Promise<Schemas["WorkItem"]> {
  return written(
    "createWorkItem",
    await client.POST("/api/v1/projects/{projectId}/work-items", {
      params: { path: { projectId } },
      body,
      headers: csrf(token),
    }),
    201,
  );
}

export async function updateWorkItemRaw(
  client: Client,
  token: string,
  workItemId: string,
  body: Schemas["UpdateWorkItemRequest"],
): Promise<Schemas["WorkItem"]> {
  return written(
    "updateWorkItem",
    await client.PATCH("/api/v1/work-items/{workItemId}", {
      params: { path: { workItemId } },
      body,
      headers: csrf(token),
    }),
    200,
  );
}

export async function createEpicRaw(
  client: Client,
  token: string,
  projectId: string,
  body: Schemas["CreateEpicRequest"],
): Promise<Schemas["Epic"]> {
  return written(
    "createEpic",
    await client.POST("/api/v1/projects/{projectId}/epics", {
      params: { path: { projectId } },
      body,
      headers: csrf(token),
    }),
    201,
  );
}

export async function updateEpicRaw(
  client: Client,
  token: string,
  epicId: string,
  body: Schemas["UpdateEpicRequest"],
): Promise<Schemas["Epic"]> {
  return written(
    "updateEpic",
    await client.PATCH("/api/v1/epics/{epicId}", {
      params: { path: { epicId } },
      body,
      headers: csrf(token),
    }),
    200,
  );
}

export async function createCommentRaw(
  client: Client,
  token: string,
  workItemId: string,
  body: Schemas["CreateCommentRequest"],
): Promise<Schemas["WorkItemComment"]> {
  return written(
    "createComment",
    await client.POST("/api/v1/work-items/{workItemId}/comments", {
      params: { path: { workItemId } },
      body,
      headers: csrf(token),
    }),
    201,
  );
}

export async function encryptComment(
  client: Client,
  token: string,
  commentId: string,
  bodyEnc: string,
  signerDeviceId: string,
): Promise<void> {
  const { error, response } = await client.PATCH(
    "/api/v1/comments/{commentId}",
    {
      params: { path: { commentId } },
      body: { bodyEnc, signerDeviceId },
      headers: csrf(token),
    },
  );
  if (response.status === 204) return;
  if (response.status === 409 || response.status === 400) {
    throw encryptionErrorFrom(response.status, error);
  }
  throw new ApiStatusError(response.status, "encryptComment");
}

export async function sendMessageRaw(
  client: Client,
  token: string,
  conversationId: string,
  body: Schemas["SendMessageRequest"],
): Promise<Schemas["Message"]> {
  const result = await client.POST(
    "/api/v1/conversations/{conversationId}/messages",
    { params: { path: { conversationId } }, body, headers: csrf(token) },
  );
  if (result.response.status === 200 || result.response.status === 201) {
    if (result.data !== undefined) return result.data;
  }
  if (result.response.status === 409 || result.response.status === 400) {
    throw encryptionErrorFrom(result.response.status, result.error);
  }
  throw new ApiStatusError(result.response.status, "sendMessage");
}

export async function editMessageRaw(
  client: Client,
  token: string,
  messageId: string,
  body: Schemas["EditMessageRequest"],
): Promise<Schemas["Message"]> {
  return written(
    "editMessage",
    await client.PATCH("/api/v1/messages/{messageId}", {
      params: { path: { messageId } },
      body,
      headers: csrf(token),
    }),
    200,
  );
}

// --- DM and sprint domains, names, recovery -----------------------------

export type RecoveryGap = Schemas["RecoveryGap"];
export type RecoveryAuditEntry = Schemas["RecoveryAuditEntry"];

export async function getConversationKeyDomain(
  client: Client,
  conversationId: string,
): Promise<KeyDomain | null> {
  const { data, response } = await client.GET(
    "/api/v1/conversations/{conversationId}/key-domain",
    { params: { path: { conversationId } } },
  );
  if (response.status === 404) return null;
  return expect("getConversationKeyDomain", response, data, 200);
}

export async function createConversationKeyDomain(
  client: Client,
  token: string,
  conversationId: string,
): Promise<KeyDomain> {
  const { data, response } = await client.POST(
    "/api/v1/conversations/{conversationId}/key-domain",
    { params: { path: { conversationId } }, headers: csrf(token) },
  );
  return expect("createConversationKeyDomain", response, data, 201);
}

export async function getSprintKeyDomain(
  client: Client,
): Promise<KeyDomain | null> {
  const { data, response } = await client.GET("/api/v1/e2ee/sprint-domain");
  if (response.status === 404) return null;
  return expect("getSprintKeyDomain", response, data, 200);
}

export async function createSprintKeyDomain(
  client: Client,
  token: string,
): Promise<KeyDomain> {
  const { data, response } = await client.POST("/api/v1/e2ee/sprint-domain", {
    headers: csrf(token),
  });
  return expect("createSprintKeyDomain", response, data, 201);
}

async function noContent(
  operation: string,
  result: { response: Response; error?: unknown },
): Promise<void> {
  if (result.response.status === 204) return;
  if (result.response.status === 409 || result.response.status === 400) {
    throw encryptionErrorFrom(result.response.status, result.error);
  }
  throw new ApiStatusError(result.response.status, operation);
}

export async function updateProjectContent(
  client: Client,
  token: string,
  projectId: string,
  body: Schemas["UpdateProjectRequest"],
): Promise<void> {
  return noContent(
    "updateProject",
    await client.PATCH("/api/v1/projects/{projectId}", {
      params: { path: { projectId } },
      body,
      headers: csrf(token),
    }),
  );
}

export async function updateConversationContent(
  client: Client,
  token: string,
  conversationId: string,
  body: Schemas["UpdateConversationRequest"],
): Promise<void> {
  return noContent(
    "updateConversation",
    await client.PATCH("/api/v1/conversations/{conversationId}", {
      params: { path: { conversationId } },
      body,
      headers: csrf(token),
    }),
  );
}

export async function updateSprintContent(
  client: Client,
  token: string,
  sprintId: string,
  body: Schemas["UpdateSprintRequest"],
): Promise<void> {
  return noContent(
    "updateSprint",
    await client.PATCH("/api/v1/sprints/{sprintId}", {
      params: { path: { sprintId } },
      body,
      headers: csrf(token),
    }),
  );
}

export async function createSprintRaw(
  client: Client,
  token: string,
  body: Schemas["CreateSprintRequest"],
): Promise<Schemas["Sprint"]> {
  return written(
    "createSprint",
    await client.POST("/api/v1/sprints", { body, headers: csrf(token) }),
    201,
  );
}

export async function listRecoveryGaps(client: Client): Promise<RecoveryGap[]> {
  const { data, response } = await client.GET("/api/v1/recovery/gaps");
  return expect("listRecoveryGaps", response, data, 200);
}

export async function listRecoveryEnvelopes(
  client: Client,
  keyDomainId: string,
): Promise<KeyEnvelope[]> {
  const { data, response } = await client.GET(
    "/api/v1/key-domains/{keyDomainId}/recovery-envelopes",
    { params: { path: { keyDomainId } } },
  );
  return expect("listRecoveryEnvelopes", response, data, 200);
}

export async function grantRecoveryEnvelopes(
  client: Client,
  token: string,
  keyDomainId: string,
  generation: number,
  signerDeviceId: string,
  envelopes: EnvelopeInput[],
): Promise<KeyDomain> {
  const { data, response } = await client.POST(
    "/api/v1/key-domains/{keyDomainId}/recovery-grants",
    {
      params: { path: { keyDomainId } },
      body: { generation, signerDeviceId, envelopes },
      headers: csrf(token),
    },
  );
  return expect("grantRecoveryEnvelopes", response, data, 200);
}

export async function listRecoveryAudit(
  client: Client,
): Promise<RecoveryAuditEntry[]> {
  const { data, response } = await client.GET("/api/v1/recovery/audit");
  return expect("listRecoveryAudit", response, data, 200);
}
