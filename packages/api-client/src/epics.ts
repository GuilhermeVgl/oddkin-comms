import { csrf, ensure, type Client, type Schemas } from "./internal";

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
