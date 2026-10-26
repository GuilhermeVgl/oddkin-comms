import { describe, expect, it } from "vitest";
import { createApiClient } from "./index";
import { uploadFile } from "./uploads";

function apiFetcher(log: string[], failPart?: number): typeof fetch {
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const { pathname } = new URL(request.url);
    log.push(`${request.method} ${pathname}`);
    if (pathname === "/api/v1/uploads") {
      return Response.json(
        { id: "u1", partSize: 4, partCount: 3 },
        { status: 201 },
      );
    }
    const part = /parts\/(\d+)$/.exec(pathname);
    if (part !== null) {
      return Response.json({
        url: `https://bucket.invalid/p${part[1]}${failPart === Number(part[1]) ? "?fail" : ""}`,
        expiresInSeconds: 900,
      });
    }
    if (pathname.endsWith("/complete")) {
      const body = (await request.json()) as {
        parts: { partNumber: number; etag: string }[];
      };
      return Response.json({
        id: "a1",
        name: "f",
        contentType: "text/plain",
        size: 10,
        uploaderEmail: "x@example.test",
        createdAt: new Date().toISOString(),
        etags: body.parts.map((entry) => entry.etag),
      });
    }
    return new Response(null, { status: 204 });
  };
}

const file = new File(["0123456789"], "f.txt", { type: "text/plain" });

describe("uploadFile", () => {
  it("sends every part and completes with the ETags in part order", async () => {
    const log: string[] = [];
    const sent: string[] = [];
    const putPart: typeof fetch = async (url, init) => {
      const body = init?.body as Blob;
      sent.push(`${String(url)}:${await body.text()}`);
      return new Response(null, {
        status: 200,
        headers: { ETag: `"e${String(url).slice(-1)}"` },
      });
    };
    const progress: number[] = [];
    const client = createApiClient("http://localhost", apiFetcher(log));
    const result = await uploadFile(
      client,
      { contextType: "work_item", contextId: "w1" },
      file,
      (fraction) => progress.push(fraction),
      putPart,
    );
    expect(sent.sort()).toEqual([
      "https://bucket.invalid/p1:0123",
      "https://bucket.invalid/p2:4567",
      "https://bucket.invalid/p3:89",
    ]);
    expect((result as unknown as { etags: string[] }).etags).toEqual([
      '"e1"',
      '"e2"',
      '"e3"',
    ]);
    expect(progress.at(-1)).toBe(1);
  });

  it("retries a failing part with identical bytes, then aborts the upload", async () => {
    const log: string[] = [];
    let attempts = 0;
    const putPart: typeof fetch = async (url) => {
      if (String(url).includes("fail")) {
        attempts += 1;
        return new Response(null, { status: 500 });
      }
      return new Response(null, { status: 200, headers: { ETag: '"ok"' } });
    };
    const client = createApiClient("http://localhost", apiFetcher(log, 2));
    await expect(
      uploadFile(
        client,
        { contextType: "conversation", contextId: "c1" },
        file,
        () => undefined,
        putPart,
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(3);
    expect(log).toContain("POST /api/v1/uploads/u1/abort");
    expect(log).not.toContain("POST /api/v1/uploads/u1/complete");
  });
});
