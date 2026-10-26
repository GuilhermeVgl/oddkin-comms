import { describe, expect, it } from "vitest";
import {
  ApiStatusError,
  EncryptionError,
  authorizeDevice,
  createApiClient,
  createConversationKeyDomain,
  createEpicRaw,
  createCommentRaw,
  createKeyDomain,
  createSprintKeyDomain,
  createSprintRaw,
  createWorkItemRaw,
  editMessageRaw,
  encryptComment,
  getConversationKeyDomain,
  getDeviceRecord,
  getSprintKeyDomain,
  getTrustRoot,
  grantKeyEnvelopes,
  grantRecoveryEnvelopes,
  listAuthorizedDevices,
  listCallKeyDevices,
  listCallKeyEnvelopes,
  listDevices,
  listKeyDomains,
  listKeyRecipients,
  listMyKeyEnvelopes,
  listPendingDevices,
  listRecoveryAudit,
  listRecoveryEnvelopes,
  listRecoveryGaps,
  publishCallKey,
  publishKeyGeneration,
  registerDevice,
  revokeDevice,
  sendMessageRaw,
  setTrustRoot,
  updateConversationContent,
  updateEpicRaw,
  updateProjectContent,
  updateSprintContent,
  updateWorkItemRaw,
} from "./index";
import type { Client } from "./internal";

type Seen = {
  method: string;
  path: string;
  csrf: string | null;
  body: unknown;
};

function recorder(status: number, payload: unknown) {
  const seen: Seen[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      csrf: request.headers.get("X-CSRF-Token"),
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
    });
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        });
  };
  return {
    client: createApiClient("http://api.test", fetcher, () => "t"),
    seen,
  };
}

const envelopes = [{ recipientDeviceId: "d1", sealed: "s", signature: "g" }];
type Case = {
  name: string;
  call: (client: Client) => Promise<unknown>;
  status: number;
  method: string;
  path: string;
  payload?: unknown;
  body?: unknown;
};

const cases: Case[] = [
  {
    name: "getTrustRoot",
    call: (c) => getTrustRoot(c),
    status: 200,
    payload: { signPublicKey: "k" },
    method: "GET",
    path: "/api/v1/e2ee/trust-root",
  },
  {
    name: "setTrustRoot",
    call: (c) => setTrustRoot(c, "pub"),
    status: 200,
    payload: { signPublicKey: "pub" },
    method: "PUT",
    path: "/api/v1/e2ee/trust-root",
    body: { signPublicKey: "pub" },
  },
  {
    name: "registerDevice",
    call: (c) =>
      registerDevice(c, {
        name: "N",
        signPublicKey: "a",
        boxPublicKey: "b",
      } as Parameters<typeof registerDevice>[1]),
    status: 201,
    payload: { id: "d1" },
    method: "POST",
    path: "/api/v1/devices",
  },
  {
    name: "listDevices",
    call: (c) => listDevices(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/devices",
  },
  {
    name: "listPendingDevices",
    call: (c) => listPendingDevices(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/devices/pending",
  },
  {
    name: "authorizeDevice",
    call: (c) => authorizeDevice(c, "d1", "cert", "d0"),
    status: 200,
    payload: { id: "d1" },
    method: "POST",
    path: "/api/v1/devices/d1/authorize",
  },
  {
    name: "authorizeDevice without an authorizer",
    call: (c) => authorizeDevice(c, "d1", "cert"),
    status: 200,
    payload: { id: "d1" },
    method: "POST",
    path: "/api/v1/devices/d1/authorize",
    body: { certificate: "cert" },
  },
  {
    name: "revokeDevice",
    call: (c) => revokeDevice(c, "d1"),
    status: 204,
    method: "POST",
    path: "/api/v1/devices/d1/revoke",
  },
  {
    name: "getDeviceRecord",
    call: (c) => getDeviceRecord(c, "d1"),
    status: 200,
    payload: { id: "d1" },
    method: "GET",
    path: "/api/v1/devices/d1",
  },
  {
    name: "listKeyDomains",
    call: (c) => listKeyDomains(c, "p1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/key-domains",
  },
  {
    name: "createKeyDomain",
    call: (c) => createKeyDomain(c, "p1", "chat"),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/projects/p1/key-domains",
    body: { kind: "chat" },
  },
  {
    name: "listAuthorizedDevices",
    call: (c) => listAuthorizedDevices(c, "k1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/key-domains/k1/authorized-devices",
  },
  {
    name: "listKeyRecipients",
    call: (c) => listKeyRecipients(c, "k1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/key-domains/k1/recipients",
  },
  {
    name: "listMyKeyEnvelopes",
    call: (c) => listMyKeyEnvelopes(c, "k1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/key-domains/k1/envelopes",
  },
  {
    name: "listCallKeyDevices",
    call: (c) => listCallKeyDevices(c, "c1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/calls/c1/key-devices",
  },
  {
    name: "listCallKeyEnvelopes",
    call: (c) => listCallKeyEnvelopes(c, "c1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/calls/c1/key-envelopes",
  },
  {
    name: "publishCallKey",
    call: (c) => publishCallKey(c, "c1", 2, "d1", envelopes),
    status: 200,
    payload: { id: "c1" },
    method: "POST",
    path: "/api/v1/calls/c1/key-generations",
    body: { generation: 2, signerDeviceId: "d1", envelopes },
  },
  {
    name: "publishKeyGeneration",
    call: (c) => publishKeyGeneration(c, "k1", 1, "d1", envelopes),
    status: 200,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/key-domains/k1/generations",
    body: { generation: 1, signerDeviceId: "d1", envelopes },
  },
  {
    name: "grantKeyEnvelopes",
    call: (c) => grantKeyEnvelopes(c, "k1", 1, "d1", envelopes),
    status: 200,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/key-domains/k1/envelopes",
  },
  {
    name: "createWorkItemRaw",
    call: (c) =>
      createWorkItemRaw(c, "p1", { kind: "task" } as Parameters<
        typeof createWorkItemRaw
      >[2]),
    status: 201,
    payload: { id: "w1" },
    method: "POST",
    path: "/api/v1/projects/p1/work-items",
  },
  {
    name: "updateWorkItemRaw",
    call: (c) => updateWorkItemRaw(c, "w1", { version: 1 }),
    status: 200,
    payload: { id: "w1" },
    method: "PATCH",
    path: "/api/v1/work-items/w1",
  },
  {
    name: "createEpicRaw",
    call: (c) =>
      createEpicRaw(c, "p1", {} as Parameters<typeof createEpicRaw>[2]),
    status: 201,
    payload: { id: "e1" },
    method: "POST",
    path: "/api/v1/projects/p1/epics",
  },
  {
    name: "updateEpicRaw",
    call: (c) => updateEpicRaw(c, "e1", { version: 1 }),
    status: 200,
    payload: { id: "e1" },
    method: "PATCH",
    path: "/api/v1/epics/e1",
  },
  {
    name: "createCommentRaw",
    call: (c) =>
      createCommentRaw(c, "w1", {} as Parameters<typeof createCommentRaw>[2]),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/work-items/w1/comments",
  },
  {
    name: "encryptComment",
    call: (c) => encryptComment(c, "k1", "enc", "d1"),
    status: 204,
    method: "PATCH",
    path: "/api/v1/comments/k1",
    body: { bodyEnc: "enc", signerDeviceId: "d1" },
  },
  {
    name: "sendMessageRaw",
    call: (c) =>
      sendMessageRaw(c, "k1", {} as Parameters<typeof sendMessageRaw>[2]),
    status: 201,
    payload: { id: "m1" },
    method: "POST",
    path: "/api/v1/conversations/k1/messages",
  },
  {
    name: "editMessageRaw",
    call: (c) =>
      editMessageRaw(c, "m1", {} as Parameters<typeof editMessageRaw>[2]),
    status: 200,
    payload: { id: "m1" },
    method: "PATCH",
    path: "/api/v1/messages/m1",
  },
  {
    name: "getConversationKeyDomain",
    call: (c) => getConversationKeyDomain(c, "k1"),
    status: 200,
    payload: { id: "k1" },
    method: "GET",
    path: "/api/v1/conversations/k1/key-domain",
  },
  {
    name: "createConversationKeyDomain",
    call: (c) => createConversationKeyDomain(c, "k1"),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/conversations/k1/key-domain",
  },
  {
    name: "getSprintKeyDomain",
    call: (c) => getSprintKeyDomain(c),
    status: 200,
    payload: { id: "k1" },
    method: "GET",
    path: "/api/v1/e2ee/sprint-domain",
  },
  {
    name: "createSprintKeyDomain",
    call: (c) => createSprintKeyDomain(c),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/e2ee/sprint-domain",
  },
  {
    name: "updateProjectContent",
    call: (c) =>
      updateProjectContent(
        c,
        "p1",
        {} as Parameters<typeof updateProjectContent>[2],
      ),
    status: 204,
    method: "PATCH",
    path: "/api/v1/projects/p1",
  },
  {
    name: "updateConversationContent",
    call: (c) =>
      updateConversationContent(
        c,
        "k1",
        {} as Parameters<typeof updateConversationContent>[2],
      ),
    status: 204,
    method: "PATCH",
    path: "/api/v1/conversations/k1",
  },
  {
    name: "updateSprintContent",
    call: (c) =>
      updateSprintContent(
        c,
        "s1",
        {} as Parameters<typeof updateSprintContent>[2],
      ),
    status: 204,
    method: "PATCH",
    path: "/api/v1/sprints/s1",
  },
  {
    name: "createSprintRaw",
    call: (c) =>
      createSprintRaw(c, {} as Parameters<typeof createSprintRaw>[1]),
    status: 201,
    payload: { id: "s1" },
    method: "POST",
    path: "/api/v1/sprints",
  },
  {
    name: "listRecoveryGaps",
    call: (c) => listRecoveryGaps(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/recovery/gaps",
  },
  {
    name: "listRecoveryEnvelopes",
    call: (c) => listRecoveryEnvelopes(c, "k1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/key-domains/k1/recovery-envelopes",
  },
  {
    name: "grantRecoveryEnvelopes",
    call: (c) => grantRecoveryEnvelopes(c, "k1", 1, "d1", envelopes),
    status: 200,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/key-domains/k1/recovery-grants",
  },
  {
    name: "listRecoveryAudit",
    call: (c) => listRecoveryAudit(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/recovery/audit",
  },
];

describe("E2EE client wrappers", () => {
  it.each(cases)("$name sends the right request", async (entry) => {
    const { client, seen } = recorder(entry.status, entry.payload);
    await entry.call(client);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe(entry.method);
    expect(seen[0]?.path).toBe(entry.path);
    if (entry.method !== "GET") expect(seen[0]?.csrf).toBe("t");
    if (entry.body !== undefined) expect(seen[0]?.body).toEqual(entry.body);
  });

  it.each(cases)("$name refuses an unexpected status", async (entry) => {
    const { client } = recorder(500, {});
    const failure = await entry.call(client).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
  });
});

describe("absent records", () => {
  it("answers null or undefined instead of failing on 404", async () => {
    const { client } = recorder(404, {});
    await expect(getTrustRoot(client)).resolves.toBeNull();
    await expect(getDeviceRecord(client, "d1")).resolves.toBeUndefined();
    await expect(getConversationKeyDomain(client, "k1")).resolves.toBeNull();
    await expect(getSprintKeyDomain(client)).resolves.toBeNull();
  });
});

describe("encrypted writes", () => {
  it.each([
    [
      "createWorkItemRaw",
      (c: Client) =>
        createWorkItemRaw(c, "p1", { kind: "task" } as Parameters<
          typeof createWorkItemRaw
        >[2]),
    ],
    ["updateEpicRaw", (c: Client) => updateEpicRaw(c, "e1", { version: 1 })],
    ["encryptComment", (c: Client) => encryptComment(c, "k1", "e", "d")],
    [
      "sendMessageRaw",
      (c: Client) =>
        sendMessageRaw(c, "k1", {} as Parameters<typeof sendMessageRaw>[2]),
    ],
    [
      "updateProjectContent",
      (c: Client) =>
        updateProjectContent(
          c,
          "p1",
          {} as Parameters<typeof updateProjectContent>[2],
        ),
    ],
  ])(
    "%s turns a refused write into a typed encryption error",
    async (_name, call) => {
      const { client } = recorder(409, { code: "stale_generation" });
      const failure = await call(client).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(EncryptionError);
      expect((failure as EncryptionError).code).toBe("stale_generation");
    },
  );

  it("keeps other statuses as plain status errors", async () => {
    const { client } = recorder(500, {});
    const failure = await updateEpicRaw(client, "e1", { version: 1 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ApiStatusError);
  });

  it("tolerates an error body without a code", async () => {
    const { client } = recorder(400, { message: "x" });
    const failure = await encryptComment(client, "k1", "e", "d").then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EncryptionError);
    expect((failure as EncryptionError).code).toBeNull();
  });
});
