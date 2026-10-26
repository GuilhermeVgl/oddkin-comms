import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

export type MyStats = Schemas["MyStats"];
export type WorkItemEngagement = Schemas["WorkItemEngagement"];

/** The caller's own scoreboard: streaks, thanks, focus time, calls. */
export async function getMyStats(client: Client): Promise<MyStats> {
  const { data, response } = await client.GET("/api/v1/me/stats");
  return ensure("getMyStats", response, data, 200);
}

export async function getWorkItemEngagement(
  client: Client,
  workItemId: string,
): Promise<WorkItemEngagement> {
  const { data, response } = await client.GET(
    "/api/v1/work-items/{workItemId}/engagement",
    { params: { path: { workItemId } } },
  );
  return ensure("getWorkItemEngagement", response, data, 200);
}

/** Thanks whoever finished the activity, or takes the thanks back. */
export async function setKudos(
  client: Client,
  workItemId: string,
  thanked: boolean,
): Promise<void> {
  const options = {
    params: { path: { workItemId } },
  };
  const { response } = thanked
    ? await client.PUT("/api/v1/work-items/{workItemId}/kudos", options)
    : await client.DELETE("/api/v1/work-items/{workItemId}/kudos", options);
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "setKudos");
}

export async function recordFocusSession(
  client: Client,
  workItemId: string,
  minutes: number,
): Promise<void> {
  const { response } = await client.POST(
    "/api/v1/work-items/{workItemId}/focus",
    {
      params: { path: { workItemId } },
      body: { minutes },
    },
  );
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "recordFocusSession");
}
