import createClient from "openapi-fetch";
import type { paths } from "./openapi.gen";

export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
) {
  return createClient<paths>({ baseUrl, fetch: fetcher });
}

export async function fetchReadiness(
  client: ReturnType<typeof createApiClient>,
): Promise<"ready" | "unavailable"> {
  const { response } = await client.GET("/api/v1/health/ready");
  if (response.status === 204) {
    return "ready";
  }
  if (response.status === 503) {
    return "unavailable";
  }
  throw new Error(`Unexpected readiness status: ${response.status}`);
}
