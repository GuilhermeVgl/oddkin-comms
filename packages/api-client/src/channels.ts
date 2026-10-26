import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type Conversation = Schemas["Conversation"];

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

/** Renames a channel whose name is still in the clear. */
export async function renameChannel(
  client: Client,
  token: string,
  conversationId: string,
  name: string,
): Promise<void> {
  const { response } = await client.PATCH(
    "/api/v1/conversations/{conversationId}",
    {
      params: { path: { conversationId } },
      body: { name },
      headers: csrf(token),
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "renameChannel");
}

export async function createChannel(
  client: Client,
  token: string,
  projectId: string,
  body: Schemas["CreateChannelRequest"],
): Promise<Conversation> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/conversations",
    { params: { path: { projectId } }, body, headers: csrf(token) },
  );
  return ensure("createChannel", response, data, 201);
}

export async function reorderChannels(
  client: Client,
  token: string,
  projectId: string,
  ids: string[],
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/conversations/order",
    { params: { path: { projectId } }, body: { ids }, headers: csrf(token) },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "reorderChannels");
}

export async function setChannelArchived(
  client: Client,
  token: string,
  conversationId: string,
  archived: boolean,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/conversations/{conversationId}/archive",
    {
      params: { path: { conversationId } },
      body: { archived },
      headers: csrf(token),
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setChannelArchived");
}
