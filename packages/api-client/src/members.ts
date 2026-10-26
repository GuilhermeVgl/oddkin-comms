import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type ProjectMember = Schemas["ProjectMember"];

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

export async function removeProjectMember(
  client: Client,
  token: string,
  projectId: string,
  accountId: string,
): Promise<void> {
  const { response } = await client.DELETE(
    "/api/v1/projects/{projectId}/members/{accountId}",
    { params: { path: { projectId, accountId } }, headers: csrf(token) },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "removeProjectMember");
}

export type InvitePolicy = "admins" | "managers" | "members";

export async function setInvitePolicy(
  client: Client,
  token: string,
  projectId: string,
  policy: InvitePolicy,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/invite-policy",
    { params: { path: { projectId } }, body: { policy }, headers: csrf(token) },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setInvitePolicy");
}

export async function setMemberRole(
  client: Client,
  token: string,
  projectId: string,
  accountId: string,
  isManager: boolean,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/members/{accountId}",
    {
      params: { path: { projectId, accountId } },
      body: { isManager },
      headers: csrf(token),
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setMemberRole");
}
