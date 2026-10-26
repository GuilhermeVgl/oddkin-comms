import { ApiStatusError, ensure, type Client, type Schemas } from "./internal";

export type AuthSession = Schemas["AuthSession"];

export async function listSessions(client: Client): Promise<AuthSession[]> {
  const { data, response } = await client.GET("/api/v1/sessions");
  return ensure("listSessions", response, data, 200);
}

export async function revokeSession(
  client: Client,
  sessionId: string,
): Promise<void> {
  const { response } = await client.DELETE("/api/v1/sessions/{sessionId}", {
    params: { path: { sessionId } },
  });
  if (response.status !== 204)
    throw new ApiStatusError(response.status, "revokeSession");
}
