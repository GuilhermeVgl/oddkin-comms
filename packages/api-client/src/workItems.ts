import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type WorkItem = Schemas["WorkItem"];
export type WorkItemComment = Schemas["WorkItemComment"];
export type UpdateWorkItem = Schemas["UpdateWorkItemRequest"];
export type CreateWorkItem = Schemas["CreateWorkItemRequest"];

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

export async function getFollowing(
  client: Client,
  workItemId: string,
): Promise<boolean> {
  const { data, response } = await client.GET(
    "/api/v1/work-items/{workItemId}/followers/me",
    { params: { path: { workItemId } } },
  );
  return ensure("getFollowing", response, data, 200).following;
}

export async function setFollowing(
  client: Client,
  token: string,
  workItemId: string,
  following: boolean,
): Promise<void> {
  const options = {
    params: { path: { workItemId } },
    headers: csrf(token),
  };
  const { response } = following
    ? await client.PUT("/api/v1/work-items/{workItemId}/followers/me", options)
    : await client.DELETE(
        "/api/v1/work-items/{workItemId}/followers/me",
        options,
      );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setFollowing");
}
