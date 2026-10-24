import { describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  createApiClient,
  fetchCurrentAccount,
  fetchReadiness,
  login,
  logout,
  readCookie,
} from "./index";

describe("fetchReadiness", () => {
  it.each([
    [204, "ready"],
    [503, "unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, expected) => {
    let requestUrl = "";
    const fetcher: typeof fetch = async (input) => {
      requestUrl = input instanceof Request ? input.url : String(input);
      return new Response(null, { status });
    };
    const client = createApiClient("http://localhost:8080", fetcher);
    await expect(fetchReadiness(client)).resolves.toBe(expected);
    expect(requestUrl).toBe("http://localhost:8080/api/v1/health/ready");
  });

  it("does not call a failed network request ready", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("network unavailable");
    };
    const client = createApiClient("http://localhost:8080", fetcher);
    await expect(fetchReadiness(client)).rejects.toThrow("network unavailable");
  });

  it("does not treat an unexpected HTTP status as ready", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(null, { status: 500 });
    const client = createApiClient("http://localhost:8080", fetcher);
    await expect(fetchReadiness(client)).rejects.toThrow(
      "Unexpected readiness status",
    );
  });
});

describe("account session", () => {
  it("maps login results without exposing response bodies", async () => {
    for (const [status, expected] of [
      [204, "authenticated"],
      [401, "invalid-credentials"],
      [429, "rate-limited"],
      [503, "unavailable"],
    ] as const) {
      const fetcher: typeof fetch = async () => new Response(null, { status });
      const client = createApiClient("http://localhost:8080", fetcher);
      await expect(
        login(client, "person@example.test", "long password"),
      ).resolves.toBe(expected);
    }
  });

  it("returns the current account or an anonymous session", async () => {
    const account = {
      id: "10000000-0000-4000-8000-000000000001",
      email: "person@example.test",
    };
    const authenticated = createApiClient("http://localhost:8080", async () =>
      Response.json(account),
    );
    await expect(fetchCurrentAccount(authenticated)).resolves.toEqual(account);

    const anonymous = createApiClient(
      "http://localhost:8080",
      async () => new Response(null, { status: 401 }),
    );
    await expect(fetchCurrentAccount(anonymous)).resolves.toBeNull();
  });

  it("rejects unexpected login and account responses", async () => {
    const client = createApiClient(
      "http://localhost:8080",
      async () => new Response(null, { status: 500 }),
    );
    await expect(
      login(client, "person@example.test", "long password"),
    ).rejects.toThrow("Unexpected login status: 500");
    await expect(fetchCurrentAccount(client)).rejects.toThrow(
      "Unexpected current account status: 500",
    );
  });

  it.each([
    [false, "/api/v1/auth/logout"],
    [true, "/api/v1/auth/logout-all"],
  ] as const)(
    "logs out through the selected scope",
    async (allSessions, expectedPath) => {
      let request: Request | undefined;
      const client = createApiClient("http://localhost:8080", async (input) => {
        request = input instanceof Request ? input : new Request(input);
        return new Response(null, { status: 204 });
      });

      await expect(
        logout(client, "csrf-token", allSessions),
      ).resolves.toBeUndefined();
      expect(request?.url).toBe(`http://localhost:8080${expectedPath}`);
      expect(request?.headers.get("X-CSRF-Token")).toBe("csrf-token");
    },
  );

  it("rejects a failed logout", async () => {
    const client = createApiClient(
      "http://localhost:8080",
      async () => new Response(null, { status: 403 }),
    );
    await expect(logout(client, "bad-token")).rejects.toThrow(
      "Unexpected logout status: 403",
    );
  });

  it("reads a cookie by exact name", () => {
    expect(
      readCookie("one=1; oddkin_csrf=token-value; another=2", "oddkin_csrf"),
    ).toBe("token-value");
    expect(readCookie("oddkin_csrf=a%20value%3D", "oddkin_csrf")).toBe(
      "a value=",
    );
    expect(readCookie("oddkin_csrf_extra=wrong", "oddkin_csrf")).toBeNull();
  });

  it("creates an invitation with CSRF protection", async () => {
    const invitation = {
      id: "20000000-0000-4000-8000-000000000001",
      email: "person@example.test",
      membershipKind: "external" as const,
      expiresAt: "2026-10-30T12:00:00Z",
      deliveryState: "pending" as const,
    };
    let request: Request | undefined;
    const client = createApiClient("http://localhost:8080", async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return Response.json(invitation, { status: 201 });
    });
    await expect(
      createInvitation(client, invitation.email, "external", "csrf-token"),
    ).resolves.toEqual(invitation);
    expect(request?.headers.get("X-CSRF-Token")).toBe("csrf-token");
  });

  it("rejects an unexpected invitation response", async () => {
    const client = createApiClient(
      "http://localhost:8080",
      async () => new Response(null, { status: 403 }),
    );
    await expect(
      createInvitation(client, "person@example.test", "internal", "csrf"),
    ).rejects.toThrow("Unexpected invitation status: 403");
  });

  it.each([
    [204, "accepted"],
    [400, "invalid"],
    [503, "unavailable"],
  ] as const)(
    "maps invitation acceptance HTTP %i",
    async (status, expected) => {
      const client = createApiClient(
        "http://localhost:8080",
        async () => new Response(null, { status }),
      );
      await expect(
        acceptInvitation(
          client,
          "synthetic-invitation-token-000000000000000",
          "person@example.test",
          "sufficient password",
        ),
      ).resolves.toBe(expected);
    },
  );

  it("rejects an unexpected invitation acceptance response", async () => {
    const client = createApiClient(
      "http://localhost:8080",
      async () => new Response(null, { status: 401 }),
    );
    await expect(
      acceptInvitation(
        client,
        "synthetic-invitation-token-000000000000000",
        "person@example.test",
      ),
    ).rejects.toThrow("Unexpected invitation acceptance status: 401");
  });
});
