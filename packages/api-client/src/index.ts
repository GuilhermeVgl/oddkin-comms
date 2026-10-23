import createClient from "openapi-fetch";
import type { components, paths } from "./openapi.gen";

export type CurrentAccount = components["schemas"]["CurrentAccount"];
export type LoginResult =
  "authenticated" | "invalid-credentials" | "rate-limited" | "unavailable";

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

export async function login(
  client: ReturnType<typeof createApiClient>,
  email: string,
  password: string,
): Promise<LoginResult> {
  const { response } = await client.POST("/api/v1/auth/login", {
    body: { email, password },
  });
  switch (response.status) {
    case 204:
      return "authenticated";
    case 401:
      return "invalid-credentials";
    case 429:
      return "rate-limited";
    case 503:
      return "unavailable";
    default:
      throw new Error(`Unexpected login status: ${response.status}`);
  }
}

export async function fetchCurrentAccount(
  client: ReturnType<typeof createApiClient>,
): Promise<CurrentAccount | null> {
  const { data, response } = await client.GET("/api/v1/auth/me");
  if (response.status === 200 && data !== undefined) {
    return data;
  }
  if (response.status === 401) {
    return null;
  }
  throw new Error(`Unexpected current account status: ${response.status}`);
}

export async function logout(
  client: ReturnType<typeof createApiClient>,
  csrfToken: string,
  allSessions = false,
): Promise<void> {
  const path = allSessions ? "/api/v1/auth/logout-all" : "/api/v1/auth/logout";
  const { response } = await client.POST(path, {
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (response.status !== 204) {
    throw new Error(`Unexpected logout status: ${response.status}`);
  }
}

export function readCookie(cookies: string, name: string): string | null {
  for (const pair of cookies.split(";")) {
    const [rawName, ...value] = pair.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}
