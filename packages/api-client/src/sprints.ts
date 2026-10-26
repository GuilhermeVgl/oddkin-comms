import {
  ApiStatusError,
  csrf,
  ensure,
  type Client,
  type Schemas,
} from "./internal";
import type { WorkItem } from "./workItems";

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
