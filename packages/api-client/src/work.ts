import type { components } from "./openapi.gen";
import type { createApiClient } from "./index";

type Client = ReturnType<typeof createApiClient>;
type Schemas = components["schemas"];

export type Project = Schemas["Project"];
export type BoardColumn = Schemas["BoardColumn"];
export type WorkItem = Schemas["WorkItem"];
export type WorkItemComment = Schemas["WorkItemComment"];
export type ProjectMember = Schemas["ProjectMember"];
export type ExternalPolicy = Schemas["ExternalPolicy"];
export type UpdateWorkItem = Schemas["UpdateWorkItemRequest"];
export type CreateWorkItem = Schemas["CreateWorkItemRequest"];

export class ApiStatusError extends Error {
  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`${operation} failed with status ${status}`);
  }
}

function csrf(token: string) {
  return { "X-CSRF-Token": token };
}

function ensure<T>(
  operation: string,
  response: Response,
  data: T | undefined,
  expected: number,
): T {
  if (response.status !== expected || data === undefined) {
    throw new ApiStatusError(response.status, operation);
  }
  return data;
}

export async function listProjects(client: Client): Promise<Project[]> {
  const { data, response } = await client.GET("/api/v1/projects");
  return ensure("listProjects", response, data, 200);
}

export async function createProject(
  client: Client,
  token: string,
  name: string,
  description?: string,
): Promise<Project> {
  const { data, response } = await client.POST("/api/v1/projects", {
    body: { name, ...(description ? { description } : {}) },
    headers: csrf(token),
  });
  return ensure("createProject", response, data, 201);
}

export async function listBoardColumns(
  client: Client,
  projectId: string,
): Promise<BoardColumn[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/columns",
    { params: { path: { projectId } } },
  );
  return ensure("listBoardColumns", response, data, 200);
}

export async function listWorkItems(
  client: Client,
  projectId: string,
): Promise<WorkItem[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/work-items",
    { params: { path: { projectId } } },
  );
  return ensure("listWorkItems", response, data, 200);
}

export async function createWorkItem(
  client: Client,
  token: string,
  projectId: string,
  body: CreateWorkItem,
): Promise<WorkItem> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/work-items",
    { params: { path: { projectId } }, body, headers: csrf(token) },
  );
  return ensure("createWorkItem", response, data, 201);
}

export async function updateWorkItem(
  client: Client,
  token: string,
  workItemId: string,
  body: UpdateWorkItem,
): Promise<WorkItem> {
  const { data, response } = await client.PATCH(
    "/api/v1/work-items/{workItemId}",
    { params: { path: { workItemId } }, body, headers: csrf(token) },
  );
  return ensure("updateWorkItem", response, data, 200);
}

export async function listComments(
  client: Client,
  workItemId: string,
): Promise<WorkItemComment[]> {
  const { data, response } = await client.GET(
    "/api/v1/work-items/{workItemId}/comments",
    { params: { path: { workItemId } } },
  );
  return ensure("listComments", response, data, 200);
}

export async function createComment(
  client: Client,
  token: string,
  workItemId: string,
  body: string,
): Promise<WorkItemComment> {
  const { data, response } = await client.POST(
    "/api/v1/work-items/{workItemId}/comments",
    { params: { path: { workItemId } }, body: { body }, headers: csrf(token) },
  );
  return ensure("createComment", response, data, 201);
}

export async function listMembers(
  client: Client,
  projectId: string,
): Promise<ProjectMember[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/members",
    { params: { path: { projectId } } },
  );
  return ensure("listMembers", response, data, 200);
}

export async function addMember(
  client: Client,
  token: string,
  projectId: string,
  email: string,
): Promise<void> {
  const { response } = await client.POST(
    "/api/v1/projects/{projectId}/members",
    { params: { path: { projectId } }, body: { email }, headers: csrf(token) },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "addMember");
}

export async function getExternalPolicy(
  client: Client,
  projectId: string,
): Promise<ExternalPolicy> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/external-policy",
    { params: { path: { projectId } } },
  );
  return ensure("getExternalPolicy", response, data, 200);
}

export async function updateExternalPolicy(
  client: Client,
  token: string,
  projectId: string,
  policy: ExternalPolicy,
): Promise<ExternalPolicy> {
  const { data, response } = await client.PUT(
    "/api/v1/projects/{projectId}/external-policy",
    { params: { path: { projectId } }, body: policy, headers: csrf(token) },
  );
  return ensure("updateExternalPolicy", response, data, 200);
}

export type Conversation = Schemas["Conversation"];
export type Message = Schemas["Message"];

export async function listConversations(
  client: Client,
  projectId: string,
): Promise<Conversation[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/conversations",
    { params: { path: { projectId } } },
  );
  return ensure("listConversations", response, data, 200);
}

export async function listMessages(
  client: Client,
  conversationId: string,
  after = 0,
): Promise<Message[]> {
  const { data, response } = await client.GET(
    "/api/v1/conversations/{conversationId}/messages",
    { params: { path: { conversationId }, query: { after } } },
  );
  return ensure("listMessages", response, data, 200);
}

export async function sendMessage(
  client: Client,
  token: string,
  conversationId: string,
  body: string,
  clientMutationId: string,
  options: { replyToId?: string; mentionIds?: string[] } = {},
): Promise<Message> {
  const { data, response } = await client.POST(
    "/api/v1/conversations/{conversationId}/messages",
    {
      params: { path: { conversationId } },
      body: {
        body,
        clientMutationId,
        ...(options.replyToId === undefined
          ? {}
          : { replyToId: options.replyToId }),
        ...(options.mentionIds === undefined
          ? {}
          : { mentionIds: options.mentionIds }),
      },
      headers: csrf(token),
    },
  );
  if (response.status !== 200 && response.status !== 201) {
    throw new ApiStatusError(response.status, "sendMessage");
  }
  return ensure("sendMessage", response, data, response.status);
}

export type Epic = Schemas["Epic"];

export async function listEpics(
  client: Client,
  projectId: string,
): Promise<Epic[]> {
  const { data, response } = await client.GET(
    "/api/v1/projects/{projectId}/epics",
    { params: { path: { projectId } } },
  );
  return ensure("listEpics", response, data, 200);
}

export async function createEpic(
  client: Client,
  token: string,
  projectId: string,
  title: string,
): Promise<Epic> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/epics",
    { params: { path: { projectId } }, body: { title }, headers: csrf(token) },
  );
  return ensure("createEpic", response, data, 201);
}

export async function updateEpic(
  client: Client,
  token: string,
  epicId: string,
  body: Schemas["UpdateEpicRequest"],
): Promise<Epic> {
  const { data, response } = await client.PATCH("/api/v1/epics/{epicId}", {
    params: { path: { epicId } },
    body,
    headers: csrf(token),
  });
  return ensure("updateEpic", response, data, 200);
}

export type Sprint = Schemas["Sprint"];
export type SprintClosePreview = Schemas["SprintClosePreview"];
export type SprintDecision = NonNullable<
  Schemas["CloseSprintRequest"]["decisions"]
>[number];

export async function listSprints(client: Client): Promise<Sprint[]> {
  const { data, response } = await client.GET("/api/v1/sprints");
  return ensure("listSprints", response, data, 200);
}

export async function createSprint(
  client: Client,
  token: string,
  body: Schemas["CreateSprintRequest"],
): Promise<Sprint> {
  const { data, response } = await client.POST("/api/v1/sprints", {
    body,
    headers: csrf(token),
  });
  return ensure("createSprint", response, data, 201);
}

export async function startSprint(
  client: Client,
  token: string,
  sprintId: string,
): Promise<Sprint> {
  const { data, response } = await client.POST(
    "/api/v1/sprints/{sprintId}/start",
    { params: { path: { sprintId } }, headers: csrf(token) },
  );
  return ensure("startSprint", response, data, 200);
}

export async function listSprintWorkItems(
  client: Client,
  sprintId: string,
): Promise<WorkItem[]> {
  const { data, response } = await client.GET(
    "/api/v1/sprints/{sprintId}/work-items",
    { params: { path: { sprintId } } },
  );
  return ensure("listSprintWorkItems", response, data, 200);
}

export async function getSprintClosePreview(
  client: Client,
  sprintId: string,
): Promise<SprintClosePreview> {
  const { data, response } = await client.GET(
    "/api/v1/sprints/{sprintId}/close-preview",
    { params: { path: { sprintId } } },
  );
  return ensure("getSprintClosePreview", response, data, 200);
}

export async function closeSprint(
  client: Client,
  token: string,
  sprintId: string,
  decisions: SprintDecision[],
  destinationSprintId?: string,
): Promise<void> {
  const { response } = await client.POST("/api/v1/sprints/{sprintId}/close", {
    params: { path: { sprintId } },
    body: {
      decisions,
      ...(destinationSprintId === undefined ? {} : { destinationSprintId }),
    },
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "closeSprint");
  }
}

export type DirectContact = Schemas["DirectContact"];
export type DirectConversation = Schemas["DirectConversation"];
export type Notification = Schemas["Notification"];
export type ReactionSummary = Schemas["ReactionSummary"];

export async function editMessage(
  client: Client,
  token: string,
  messageId: string,
  body: string,
): Promise<Message> {
  const { data, response } = await client.PATCH(
    "/api/v1/messages/{messageId}",
    {
      params: { path: { messageId } },
      body: { body },
      headers: csrf(token),
    },
  );
  return ensure("editMessage", response, data, 200);
}

export async function deleteMessage(
  client: Client,
  token: string,
  messageId: string,
): Promise<void> {
  const { response } = await client.DELETE("/api/v1/messages/{messageId}", {
    params: { path: { messageId } },
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "deleteMessage");
  }
}

export async function toggleReaction(
  client: Client,
  token: string,
  messageId: string,
  emoji: string,
): Promise<ReactionSummary[]> {
  const { data, response } = await client.POST(
    "/api/v1/messages/{messageId}/reactions",
    {
      params: { path: { messageId } },
      body: { emoji },
      headers: csrf(token),
    },
  );
  return ensure("toggleReaction", response, data, 200);
}

export async function listDirectContacts(
  client: Client,
): Promise<DirectContact[]> {
  const { data, response } = await client.GET("/api/v1/direct-contacts");
  return ensure("listDirectContacts", response, data, 200);
}

export async function listDirectConversations(
  client: Client,
): Promise<DirectConversation[]> {
  const { data, response } = await client.GET("/api/v1/direct-conversations");
  return ensure("listDirectConversations", response, data, 200);
}

export async function openDirectConversation(
  client: Client,
  token: string,
  accountId: string,
): Promise<DirectConversation> {
  const { data, response } = await client.POST("/api/v1/direct-conversations", {
    body: { accountId },
    headers: csrf(token),
  });
  if (response.status !== 200 && response.status !== 201) {
    throw new ApiStatusError(response.status, "openDirectConversation");
  }
  return ensure("openDirectConversation", response, data, response.status);
}

export async function listNotifications(
  client: Client,
): Promise<Notification[]> {
  const { data, response } = await client.GET("/api/v1/notifications");
  return ensure("listNotifications", response, data, 200);
}

export async function markNotificationRead(
  client: Client,
  token: string,
  notificationId: string,
): Promise<void> {
  const { response } = await client.POST(
    "/api/v1/notifications/{notificationId}/read",
    { params: { path: { notificationId } }, headers: csrf(token) },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "markNotificationRead");
  }
}

export async function markAllNotificationsRead(
  client: Client,
  token: string,
): Promise<void> {
  const { response } = await client.POST("/api/v1/notifications/read-all", {
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "markAllNotificationsRead");
  }
}

export async function setReadCursor(
  client: Client,
  token: string,
  conversationId: string,
  seq: number,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/conversations/{conversationId}/read-cursor",
    {
      params: { path: { conversationId } },
      body: { seq },
      headers: csrf(token),
    },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "setReadCursor");
  }
}

export type Attachment = Schemas["Attachment"];
export type UploadSession = Schemas["Upload"];
export type UploadContext = {
  contextType: "work_item" | "conversation";
  contextId: string;
};

export async function createUpload(
  client: Client,
  token: string,
  context: UploadContext,
  file: { name: string; type: string; size: number },
): Promise<UploadSession> {
  const { data, response } = await client.POST("/api/v1/uploads", {
    body: {
      ...context,
      name: file.name,
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
): Promise<Attachment> {
  const session = await createUpload(client, token, context, file);
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

export type Call = Schemas["Call"];
export type CallInvitation = Schemas["CallInvitation"];
export type CallTicket = Schemas["CallTicket"];
export type CallConflictCode = Schemas["CallConflict"]["code"];

export class CallConflictError extends ApiStatusError {
  constructor(readonly code: CallConflictCode | null) {
    super(409, "call");
  }
}

function conflict(response: Response, data: unknown): never {
  if (response.status === 409) {
    const code =
      typeof data === "object" && data !== null && "code" in data
        ? (data.code as CallConflictCode)
        : null;
    throw new CallConflictError(code);
  }
  throw new ApiStatusError(response.status, "call");
}

export async function startCall(
  client: Client,
  token: string,
  conversationId: string,
  inviteeIds: string[],
): Promise<Call> {
  const { data, response } = await client.POST("/api/v1/calls", {
    body: { conversationId, inviteeIds },
    headers: csrf(token),
  });
  return ensure("startCall", response, data, 201);
}

export async function listActiveCalls(
  client: Client,
  conversationId: string,
): Promise<Call[]> {
  const { data, response } = await client.GET("/api/v1/calls/active", {
    params: { query: { conversationId } },
  });
  return ensure("listActiveCalls", response, data, 200);
}

export async function getCall(client: Client, callId: string): Promise<Call> {
  const { data, response } = await client.GET("/api/v1/calls/{callId}", {
    params: { path: { callId } },
  });
  return ensure("getCall", response, data, 200);
}

export async function listCallInvitations(
  client: Client,
): Promise<CallInvitation[]> {
  const { data, response } = await client.GET("/api/v1/call-invitations");
  return ensure("listCallInvitations", response, data, 200);
}

/** Reserves a seat; a 409 carries the reason (full, other call, other device). */
export async function joinCall(
  client: Client,
  token: string,
  callId: string,
  deviceId: string,
  transfer = false,
): Promise<CallTicket> {
  const { data, error, response } = await client.POST(
    "/api/v1/calls/{callId}/join",
    {
      params: { path: { callId } },
      body: transfer ? { deviceId, transfer: true } : { deviceId },
      headers: csrf(token),
    },
  );
  if (response.status === 200 && data !== undefined) return data;
  return conflict(response, error);
}

export async function startScreenShare(
  client: Client,
  token: string,
  callId: string,
): Promise<CallTicket> {
  const { data, error, response } = await client.POST(
    "/api/v1/calls/{callId}/screen-share",
    { params: { path: { callId } }, headers: csrf(token) },
  );
  if (response.status === 200 && data !== undefined) return data;
  return conflict(response, error);
}

async function callAction(
  client: Client,
  token: string,
  callId: string,
  action: "decline" | "leave" | "end",
): Promise<void> {
  const { response } = await client.POST(`/api/v1/calls/{callId}/${action}`, {
    params: { path: { callId } },
    headers: csrf(token),
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, action);
  }
}

export const declineCall = (c: Client, t: string, id: string) =>
  callAction(c, t, id, "decline");
export const leaveCall = (c: Client, t: string, id: string) =>
  callAction(c, t, id, "leave");
export const endCall = (c: Client, t: string, id: string) =>
  callAction(c, t, id, "end");

export async function stopScreenShare(
  client: Client,
  token: string,
  callId: string,
): Promise<void> {
  const { response } = await client.DELETE(
    "/api/v1/calls/{callId}/screen-share",
    {
      params: { path: { callId } },
      headers: csrf(token),
    },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "stopScreenShare");
  }
}
