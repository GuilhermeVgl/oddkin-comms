import createClient from "openapi-fetch";
import type { components, paths } from "./openapi.gen";

export type CurrentAccount = components["schemas"]["CurrentAccount"];
export type OrganizationBranding =
  components["schemas"]["OrganizationBranding"];
export type UpdateOrganizationBrandingRequest =
  components["schemas"]["UpdateOrganizationBrandingRequest"];

export async function getOrganizationBranding(
  client: ReturnType<typeof createApiClient>,
): Promise<OrganizationBranding> {
  const { data, response } = await client.GET("/api/v1/organization/branding");
  if (response.status === 200 && data !== undefined) return data;
  throw new Error(`Unexpected branding status: ${response.status}`);
}

export async function updateOrganizationBranding(
  client: ReturnType<typeof createApiClient>,
  body: UpdateOrganizationBrandingRequest,
): Promise<OrganizationBranding> {
  const { data, response } = await client.PATCH(
    "/api/v1/organization/branding",
    {
      body,
    },
  );
  if (response.status === 200 && data !== undefined) return data;
  throw new Error(`Unexpected branding update status: ${response.status}`);
}
export type LoginResult =
  "authenticated" | "invalid-credentials" | "rate-limited" | "unavailable";

const CSRF_COOKIE = "crewstead_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function readCsrfFromCookies(cookies: string): string | null {
  return readCookie(cookies, CSRF_COOKIE);
}

function cookieCsrf(): string | null {
  return typeof document === "undefined"
    ? null
    : readCsrfFromCookies(document.cookie);
}

/**
 * The API client. Every state-changing request carries the CSRF token read from
 * the session cookie at the moment it is sent, so callers never pass it around;
 * a token the caller sets explicitly wins, and with no cookie (sign-in) no
 * header is sent.
 */
export function createApiClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  csrfSource: () => string | null = cookieCsrf,
) {
  const client = createClient<paths>({ baseUrl, fetch: fetcher });
  client.use({
    onRequest({ request }) {
      if (
        SAFE_METHODS.has(request.method) ||
        request.headers.has("X-CSRF-Token")
      )
        return undefined;
      const token = csrfSource();
      if (token !== null) request.headers.set("X-CSRF-Token", token);
      return request;
    },
  });
  return client;
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
  allSessions = false,
): Promise<void> {
  const path = allSessions ? "/api/v1/auth/logout-all" : "/api/v1/auth/logout";
  const { response } = await client.POST(path, {});
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

export async function requestPasswordReset(
  client: ReturnType<typeof createApiClient>,
  email: string,
): Promise<"accepted" | "rate-limited" | "unavailable"> {
  const { response } = await client.POST("/api/v1/auth/password-reset", {
    body: { email },
  });
  switch (response.status) {
    case 202:
      return "accepted";
    case 429:
      return "rate-limited";
    case 503:
      return "unavailable";
    default:
      throw new Error(`Unexpected password reset status: ${response.status}`);
  }
}

export async function confirmPasswordReset(
  client: ReturnType<typeof createApiClient>,
  token: string,
  password: string,
): Promise<"changed" | "invalid" | "weak" | "rate-limited"> {
  const { response } = await client.POST(
    "/api/v1/auth/password-reset/confirm",
    { body: { token, password } },
  );
  switch (response.status) {
    case 204:
      return "changed";
    case 400:
      return "weak";
    case 404:
      return "invalid";
    case 429:
      return "rate-limited";
    default:
      throw new Error(`Unexpected password reset status: ${response.status}`);
  }
}

export * from "./avatar";
export * from "./calls";
export * from "./channels";
export * from "./chat";
export * from "./columns";
export * from "./e2ee";
export * from "./epics";
export * from "./gamification";
export * from "./invitations";
export * from "./members";
export * from "./notifications";
export * from "./people";
export * from "./projects";
export * from "./sessions";
export * from "./sprints";
export * from "./uploads";
export * from "./workItems";
export { ApiStatusError } from "./internal";

export async function setHistoryMode(
  client: ReturnType<typeof createApiClient>,
  mode: "ask" | "none",
): Promise<void> {
  const { response } = await client.PUT("/api/v1/account/history-mode", {
    body: { mode },
  });
  if (response.status !== 204)
    throw new Error(`Unexpected history mode status: ${response.status}`);
}
