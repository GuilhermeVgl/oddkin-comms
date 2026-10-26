import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";

export type Project = Schemas["Project"];
export type ExternalPolicy = Schemas["ExternalPolicy"];

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

export async function setProjectAppearance(
  client: Client,
  token: string,
  projectId: string,
  color: string,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/appearance",
    {
      params: { path: { projectId } },
      body: { color },
      headers: csrf(token),
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setProjectAppearance");
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

export async function setProjectArchived(
  client: Client,
  token: string,
  projectId: string,
  archived: boolean,
): Promise<void> {
  const { response } = await client.PUT(
    "/api/v1/projects/{projectId}/archive",
    {
      params: { path: { projectId } },
      body: { archived },
      headers: csrf(token),
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setProjectArchived");
}
