import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

export type Call = Schemas["Call"];
export type CallInvitation = Schemas["CallInvitation"];
export type CallRecord = Schemas["CallRecord"];
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
  conversationId: string,
  inviteeIds: string[],
): Promise<Call> {
  const { data, response } = await client.POST("/api/v1/calls", {
    body: { conversationId, inviteeIds },
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

/** The calls of a conversation, newest first, for the record shown in the thread. */
export async function listCallHistory(
  client: Client,
  conversationId: string,
): Promise<CallRecord[]> {
  const { data, response } = await client.GET("/api/v1/calls/history", {
    params: { query: { conversationId } },
  });
  return ensure("listCallHistory", response, data, 200);
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
  callId: string,
  deviceId: string,
  transfer = false,
): Promise<CallTicket> {
  const { data, error, response } = await client.POST(
    "/api/v1/calls/{callId}/join",
    {
      params: { path: { callId } },
      body: transfer ? { deviceId, transfer: true } : { deviceId },
    },
  );
  if (response.status === 200 && data !== undefined) return data;
  return conflict(response, error);
}

export async function startScreenShare(
  client: Client,
  callId: string,
): Promise<CallTicket> {
  const { data, error, response } = await client.POST(
    "/api/v1/calls/{callId}/screen-share",
    { params: { path: { callId } } },
  );
  if (response.status === 200 && data !== undefined) return data;
  return conflict(response, error);
}

async function callAction(
  client: Client,
  callId: string,
  action: "decline" | "leave" | "end",
): Promise<void> {
  const { response } = await client.POST(`/api/v1/calls/{callId}/${action}`, {
    params: { path: { callId } },
  });
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, action);
  }
}

export const declineCall = (c: Client, id: string) =>
  callAction(c, id, "decline");
export const leaveCall = (c: Client, id: string) => callAction(c, id, "leave");
export const endCall = (c: Client, id: string) => callAction(c, id, "end");

export async function stopScreenShare(
  client: Client,
  callId: string,
): Promise<void> {
  const { response } = await client.DELETE(
    "/api/v1/calls/{callId}/screen-share",
    {
      params: { path: { callId } },
    },
  );
  if (response.status !== 204) {
    throw new ApiStatusError(response.status, "stopScreenShare");
  }
}
