import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type Message = Schemas["Message"];

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

export type DirectContact = Schemas["DirectContact"];
export type DirectConversation = Schemas["DirectConversation"];
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
