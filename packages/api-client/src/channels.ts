import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

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
  conversationId: string,
  name: string,
): Promise<void> {
  const { response } = await client.PATCH(
    "/api/v1/conversations/{conversationId}",
    {
      params: { path: { conversationId } },
      body: { name },
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "renameChannel");
}

export async function createChannel(
  client: Client,
  projectId: string,
  body: Schemas["CreateChannelRequest"],
): Promise<Conversation> {
  const { data, response } = await client.POST(
    "/api/v1/projects/{projectId}/conversations",
    { params: { path: { projectId } }, body },
  );
  return ensure("createChannel", response, data, 201);
}

export async function reorderChannels(
  client: Client,
  projectId: string,
  ids: string[],
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/conversations/order",
    { params: { path: { projectId } }, body: { ids } },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "reorderChannels");
}

export async function setChannelArchived(
  client: Client,
  conversationId: string,
  archived: boolean,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/conversations/{conversationId}/archive",
    {
      params: { path: { conversationId } },
      body: { archived },
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setChannelArchived");
}
