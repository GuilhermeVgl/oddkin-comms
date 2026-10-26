import { describe, expect, it } from "vitest";
import {
  ApiStatusError,
  closeSprint,
  createApiClient,
  createBoardColumn,
  createEpic,
  createProject,
  addMember,
  createChannel,
  createComment,
  createSprint,
  createWorkItem,
  deleteAvatar,
  getFollowing,
  listAvatars,
  listComments,
  listConversations,
  listMembers,
  listNotifications,
  listOrganizationPeople,
  listSessions,
  listWorkItems,
  markAllNotificationsRead,
  markNotificationRead,
  removeProjectMember,
  renameChannel,
  reorderChannels,
  revokeSession,
  setChannelArchived,
  setFollowing,
  setInvitePolicy,
  setMemberRole,
  setPersonActive,
  updateWorkItem,
  deleteBoardColumn,
  getExternalPolicy,
  getMyStats,
  getSprintClosePreview,
  getWorkItemEngagement,
  listBoardColumns,
  listEpics,
  listProjects,
  listSprints,
  listSprintWorkItems,
  recordFocusSession,
  reorderBoardColumns,
  setKudos,
  setProjectAppearance,
  setProjectArchived,
  startSprint,
  updateBoardColumn,
  updateEpic,
  updateExternalPolicy,
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
    const url = new URL(request.url);
    seen.push({
      method: request.method,
      path: url.pathname + url.search,
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
  return { client: createApiClient("http://api.test", fetcher), seen };
}

type Case = {
  name: string;
  call: (client: Client) => Promise<unknown>;
  status: number;
  payload?: unknown;
  method: string;
  path: string;
  /** The request must carry the CSRF token (every state-changing call does). */
  csrf: boolean;
  body?: unknown;
};

const T = "tok-1";
const P = "p1";
const cases: Case[] = [
  {
    name: "getMyStats",
    call: (c) => getMyStats(c),
    status: 200,
    payload: { completedToday: 0 },
    method: "GET",
    path: "/api/v1/me/stats",
    csrf: false,
  },
  {
    name: "getWorkItemEngagement",
    call: (c) => getWorkItemEngagement(c, "w1"),
    status: 200,
    payload: { kudosCount: 0 },
    method: "GET",
    path: "/api/v1/work-items/w1/engagement",
    csrf: false,
  },
  {
    name: "setKudos (thank)",
    call: (c) => setKudos(c, T, "w1", true),
    status: 204,
    method: "PUT",
    path: "/api/v1/work-items/w1/kudos",
    csrf: true,
  },
  {
    name: "setKudos (take back)",
    call: (c) => setKudos(c, T, "w1", false),
    status: 204,
    method: "DELETE",
    path: "/api/v1/work-items/w1/kudos",
    csrf: true,
  },
  {
    name: "recordFocusSession",
    call: (c) => recordFocusSession(c, T, "w1", 25),
    status: 204,
    method: "POST",
    path: "/api/v1/work-items/w1/focus",
    csrf: true,
    body: { minutes: 25 },
  },
  {
    name: "listProjects",
    call: (c) => listProjects(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects",
    csrf: false,
  },
  {
    name: "createProject",
    call: (c) => createProject(c, T, "Alfa", "desc"),
    status: 201,
    payload: { id: P },
    method: "POST",
    path: "/api/v1/projects",
    csrf: true,
    body: { name: "Alfa", description: "desc" },
  },
  {
    name: "createProject without description",
    call: (c) => createProject(c, T, "Alfa"),
    status: 201,
    payload: { id: P },
    method: "POST",
    path: "/api/v1/projects",
    csrf: true,
    body: { name: "Alfa" },
  },
  {
    name: "setProjectAppearance",
    call: (c) => setProjectAppearance(c, T, P, "#112233"),
    status: 204,
    method: "PUT",
    path: "/api/v1/projects/p1/appearance",
    csrf: true,
    body: { color: "#112233" },
  },
  {
    name: "getExternalPolicy",
    call: (c) => getExternalPolicy(c, P),
    status: 200,
    payload: { version: 1 },
    method: "GET",
    path: "/api/v1/projects/p1/external-policy",
    csrf: false,
  },
  {
    name: "setProjectArchived",
    call: (c) => setProjectArchived(c, T, P, true),
    status: 204,
    method: "PUT",
    path: "/api/v1/projects/p1/archive",
    csrf: true,
    body: { archived: true },
  },
  {
    name: "listBoardColumns",
    call: (c) => listBoardColumns(c, P),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/columns",
    csrf: false,
  },
  {
    name: "createBoardColumn",
    call: (c) =>
      createBoardColumn(c, T, P, { name: "Revisão", category: "in_progress" }),
    status: 201,
    payload: { id: "c1" },
    method: "POST",
    path: "/api/v1/projects/p1/columns",
    csrf: true,
    body: { name: "Revisão", category: "in_progress" },
  },
  {
    name: "updateBoardColumn",
    call: (c) => updateBoardColumn(c, T, P, "c1", { name: "Nova" }),
    status: 200,
    payload: { id: "c1" },
    method: "PATCH",
    path: "/api/v1/projects/p1/columns/c1",
    csrf: true,
    body: { name: "Nova" },
  },
  {
    name: "deleteBoardColumn",
    call: (c) => deleteBoardColumn(c, T, P, "c1"),
    status: 204,
    method: "DELETE",
    path: "/api/v1/projects/p1/columns/c1",
    csrf: true,
  },
  {
    name: "deleteBoardColumn moving cards",
    call: (c) => deleteBoardColumn(c, T, P, "c1", "c2"),
    status: 204,
    method: "DELETE",
    path: "/api/v1/projects/p1/columns/c1?moveTo=c2",
    csrf: true,
  },
  {
    name: "reorderBoardColumns",
    call: (c) => reorderBoardColumns(c, T, P, ["c2", "c1"]),
    status: 200,
    payload: [],
    method: "PUT",
    path: "/api/v1/projects/p1/columns/order",
    csrf: true,
    body: { columnIds: ["c2", "c1"] },
  },
  {
    name: "listEpics",
    call: (c) => listEpics(c, P),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/epics",
    csrf: false,
  },
  {
    name: "createEpic",
    call: (c) => createEpic(c, T, P, "Login"),
    status: 201,
    payload: { id: "e1" },
    method: "POST",
    path: "/api/v1/projects/p1/epics",
    csrf: true,
    body: { title: "Login" },
  },
  {
    name: "updateEpic",
    call: (c) => updateEpic(c, T, "e1", { version: 1, title: "Entrar" }),
    status: 200,
    payload: { id: "e1" },
    method: "PATCH",
    path: "/api/v1/epics/e1",
    csrf: true,
    body: { version: 1, title: "Entrar" },
  },
  {
    name: "listSprints",
    call: (c) => listSprints(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/sprints",
    csrf: false,
  },
  {
    name: "startSprint",
    call: (c) => startSprint(c, T, "s1"),
    status: 200,
    payload: { id: "s1" },
    method: "POST",
    path: "/api/v1/sprints/s1/start",
    csrf: true,
  },
  {
    name: "listSprintWorkItems",
    call: (c) => listSprintWorkItems(c, "s1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/sprints/s1/work-items",
    csrf: false,
  },
  {
    name: "getSprintClosePreview",
    call: (c) => getSprintClosePreview(c, "s1"),
    status: 200,
    payload: { completed: [], pending: [], blocked: false },
    method: "GET",
    path: "/api/v1/sprints/s1/close-preview",
    csrf: false,
  },
  {
    name: "closeSprint to the next sprint",
    call: (c) => closeSprint(c, T, "s1", [], "s2"),
    status: 204,
    method: "POST",
    path: "/api/v1/sprints/s1/close",
    csrf: true,
    body: { decisions: [], destinationSprintId: "s2" },
  },
  {
    name: "closeSprint without a destination",
    call: (c) => closeSprint(c, T, "s1", []),
    status: 204,
    method: "POST",
    path: "/api/v1/sprints/s1/close",
    csrf: true,
    body: { decisions: [] },
  },
  {
    name: "listWorkItems",
    call: (c) => listWorkItems(c, P),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/work-items",
    csrf: false,
  },
  {
    name: "createWorkItem",
    call: (c) =>
      createWorkItem(c, T, P, { kind: "task", title: "X" } as Parameters<
        typeof createWorkItem
      >[3]),
    status: 201,
    payload: { id: "w1" },
    method: "POST",
    path: "/api/v1/projects/p1/work-items",
    csrf: true,
  },
  {
    name: "updateWorkItem",
    call: (c) =>
      updateWorkItem(c, T, "w1", { version: 1, title: "Y" } as Parameters<
        typeof updateWorkItem
      >[3]),
    status: 200,
    payload: { id: "w1" },
    method: "PATCH",
    path: "/api/v1/work-items/w1",
    csrf: true,
  },
  {
    name: "listComments",
    call: (c) => listComments(c, "w1"),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/work-items/w1/comments",
    csrf: false,
  },
  {
    name: "createComment",
    call: (c) => createComment(c, T, "w1", "oi"),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/work-items/w1/comments",
    csrf: true,
    body: { body: "oi" },
  },
  {
    name: "getFollowing",
    call: (c) => getFollowing(c, "w1"),
    status: 200,
    payload: { following: true },
    method: "GET",
    path: "/api/v1/work-items/w1/followers/me",
    csrf: false,
  },
  {
    name: "setFollowing (follow)",
    call: (c) => setFollowing(c, T, "w1", true),
    status: 204,
    method: "PUT",
    path: "/api/v1/work-items/w1/followers/me",
    csrf: true,
  },
  {
    name: "setFollowing (unfollow)",
    call: (c) => setFollowing(c, T, "w1", false),
    status: 204,
    method: "DELETE",
    path: "/api/v1/work-items/w1/followers/me",
    csrf: true,
  },
  {
    name: "listMembers",
    call: (c) => listMembers(c, P),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/members",
    csrf: false,
  },
  {
    name: "addMember",
    call: (c) => addMember(c, T, P, "a@x.test"),
    status: 204,
    method: "POST",
    path: "/api/v1/projects/p1/members",
    csrf: true,
    body: { email: "a@x.test" },
  },
  {
    name: "removeProjectMember",
    call: (c) => removeProjectMember(c, T, P, "a1"),
    status: 204,
    method: "DELETE",
    path: "/api/v1/projects/p1/members/a1",
    csrf: true,
  },
  {
    name: "setInvitePolicy",
    call: (c) => setInvitePolicy(c, T, P, "managers"),
    status: 204,
    method: "PUT",
    path: "/api/v1/projects/p1/invite-policy",
    csrf: true,
    body: { policy: "managers" },
  },
  {
    name: "setMemberRole",
    call: (c) => setMemberRole(c, T, P, "a1", true),
    status: 204,
    method: "PUT",
    path: "/api/v1/projects/p1/members/a1",
    csrf: true,
    body: { isManager: true },
  },
  {
    name: "listConversations",
    call: (c) => listConversations(c, P),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/projects/p1/conversations",
    csrf: false,
  },
  {
    name: "renameChannel",
    call: (c) => renameChannel(c, T, "k1", "novo"),
    status: 204,
    method: "PATCH",
    path: "/api/v1/conversations/k1",
    csrf: true,
    body: { name: "novo" },
  },
  {
    name: "createChannel",
    call: (c) =>
      createChannel(c, T, P, { name: "geral" } as Parameters<
        typeof createChannel
      >[3]),
    status: 201,
    payload: { id: "k1" },
    method: "POST",
    path: "/api/v1/projects/p1/conversations",
    csrf: true,
  },
  {
    name: "reorderChannels",
    call: (c) => reorderChannels(c, T, P, ["k2", "k1"]),
    status: 204,
    method: "PUT",
    path: "/api/v1/projects/p1/conversations/order",
    csrf: true,
    body: { ids: ["k2", "k1"] },
  },
  {
    name: "setChannelArchived",
    call: (c) => setChannelArchived(c, T, "k1", true),
    status: 204,
    method: "PUT",
    path: "/api/v1/conversations/k1/archive",
    csrf: true,
    body: { archived: true },
  },
  {
    name: "listNotifications",
    call: (c) => listNotifications(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/notifications",
    csrf: false,
  },
  {
    name: "markNotificationRead",
    call: (c) => markNotificationRead(c, T, "n1"),
    status: 204,
    method: "POST",
    path: "/api/v1/notifications/n1/read",
    csrf: true,
  },
  {
    name: "markAllNotificationsRead",
    call: (c) => markAllNotificationsRead(c, T),
    status: 204,
    method: "POST",
    path: "/api/v1/notifications/read-all",
    csrf: true,
  },
  {
    name: "listOrganizationPeople",
    call: (c) => listOrganizationPeople(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/organization/people",
    csrf: false,
  },
  {
    name: "setPersonActive",
    call: (c) => setPersonActive(c, T, "a1", false),
    status: 204,
    method: "PUT",
    path: "/api/v1/organization/people/a1/active",
    csrf: true,
    body: { active: false },
  },
  {
    name: "listSessions",
    call: (c) => listSessions(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/sessions",
    csrf: false,
  },
  {
    name: "revokeSession",
    call: (c) => revokeSession(c, T, "s9"),
    status: 204,
    method: "DELETE",
    path: "/api/v1/sessions/s9",
    csrf: true,
  },
  {
    name: "listAvatars",
    call: (c) => listAvatars(c),
    status: 200,
    payload: [],
    method: "GET",
    path: "/api/v1/avatars",
    csrf: false,
  },
  {
    name: "deleteAvatar",
    call: (c) => deleteAvatar(c, T),
    status: 204,
    method: "DELETE",
    path: "/api/v1/account/avatar",
    csrf: true,
  },
];

describe("API client wrappers", () => {
  it.each(cases)("$name sends the right request", async (entry) => {
    const { client, seen } = recorder(entry.status, entry.payload);
    await entry.call(client);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe(entry.method);
    expect(seen[0]?.path).toBe(entry.path);
    expect(seen[0]?.csrf).toBe(entry.csrf ? T : null);
    if (entry.body !== undefined) expect(seen[0]?.body).toEqual(entry.body);
  });

  it.each(cases)("$name refuses an unexpected status", async (entry) => {
    const { client } = recorder(500, { message: "boom" });
    const failure = await entry.call(client).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof ApiStatusError) expect(failure.status).toBe(500);
  });

  it("createSprint sends the body and the token", async () => {
    const { client, seen } = recorder(201, { id: "s1" });
    await createSprint(client, T, {
      name: "Sprint 1",
      goal: "",
      startsOn: "2026-10-26",
      endsOn: "2026-11-06",
    });
    expect(seen[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/sprints",
      csrf: T,
    });
    expect(seen[0]?.body).toMatchObject({ name: "Sprint 1" });
  });

  it("updateExternalPolicy puts the policy", async () => {
    const { client, seen } = recorder(200, { version: 2 });
    await updateExternalPolicy(client, T, P, {
      version: 1,
      permissions: ["work.read"],
    } as Parameters<typeof updateExternalPolicy>[3]);
    expect(seen[0]).toMatchObject({
      method: "PUT",
      path: "/api/v1/projects/p1/external-policy",
      csrf: T,
    });
  });
});
