import { describe, expect, it } from "vitest";
import { createApiClient, fetchReadiness } from "./index";

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
