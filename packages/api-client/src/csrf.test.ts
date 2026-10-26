import { describe, expect, it } from "vitest";
import { createApiClient, readCsrfFromCookies } from "./index";

function recorder() {
  const headers: (string | null)[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    headers.push(request.headers.get("X-CSRF-Token"));
    return new Response(null, { status: 204 });
  };
  return { fetcher, headers };
}

describe("CSRF header", () => {
  it("is added to every state-changing request, never by the caller", async () => {
    const { fetcher, headers } = recorder();
    const client = createApiClient("http://api.test", fetcher, () => "tok-9");
    await client.POST("/api/v1/auth/logout");
    await client.PUT("/api/v1/account/history-mode", { body: { mode: "ask" } });
    await client.DELETE("/api/v1/account/avatar");
    expect(headers).toEqual(["tok-9", "tok-9", "tok-9"]);
  });

  it("is left out of reads", async () => {
    const { fetcher, headers } = recorder();
    const client = createApiClient("http://api.test", fetcher, () => "tok-9");
    await client.GET("/api/v1/health/ready");
    expect(headers).toEqual([null]);
  });

  it("keeps a token the caller set explicitly", async () => {
    const { fetcher, headers } = recorder();
    const client = createApiClient("http://api.test", fetcher, () => "tok-9");
    await client.POST("/api/v1/auth/logout", {
      headers: { "X-CSRF-Token": "explicit" },
    });
    expect(headers).toEqual(["explicit"]);
  });

  it("sends nothing when there is no session cookie yet (sign-in)", async () => {
    const { fetcher, headers } = recorder();
    const client = createApiClient("http://api.test", fetcher, () => null);
    await client.POST("/api/v1/auth/logout");
    expect(headers).toEqual([null]);
  });

  it("reads the token from the cookie header", () => {
    expect(readCsrfFromCookies("a=1; crewstead_csrf=abc%20d; b=2")).toBe(
      "abc d",
    );
    expect(readCsrfFromCookies("a=1")).toBeNull();
  });
});
