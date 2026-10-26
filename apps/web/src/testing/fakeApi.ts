import type {
  BoardColumn,
  CurrentAccount,
  Conversation,
  DirectContact,
  DirectConversation,
  Epic,
  Message,
  Notification,
  Project,
  ProjectMember,
  Sprint,
  WorkItem,
  WorkItemComment,
} from "@crewstead/api-client";

/** The whole backend a screen can see, in memory. Tests read and change it directly. */
export type World = {
  account: CurrentAccount;
  projects: Project[];
  columns: Record<string, BoardColumn[]>;
  items: WorkItem[];
  epics: Epic[];
  members: Record<string, ProjectMember[]>;
  sprints: Sprint[];
  conversations: Record<string, Conversation[]>;
  messages: Record<string, Message[]>;
  comments: Record<string, WorkItemComment[]>;
  notifications: Notification[];
  directConversations: DirectConversation[];
  directContacts: DirectContact[];
  stats: Record<string, number>;
};

const NOW = "2026-10-26T10:00:00.000Z";

export const ALL_PERMISSIONS = [
  "calls.join",
  "calls.screen_share",
  "calls.start",
  "chat.read",
  "chat.send",
  "direct_messages.use",
  "files.download",
  "files.upload",
  "planning.edit",
  "work.archive",
  "work.comment",
  "work.create",
  "work.edit",
  "work.move",
  "work.read",
];

export const ME: CurrentAccount = {
  id: "acc-ana",
  email: "ana@crewstead.test",
  membershipKind: "internal",
  isAdmin: true,
  historyMode: "ask",
};

export function defaultWorld(): World {
  const project: Project = {
    id: "p1",
    name: "Alfa",
    description: "",
    color: "#63745a",
    icon: "",
    version: 1,
    isManager: true,
    permissions: [...ALL_PERMISSIONS],
    encrypted: false,
    contentRevision: 0,
  };
  const columns: BoardColumn[] = [
    { id: "c-todo", name: "A fazer", position: 0, category: "todo" },
    {
      id: "c-doing",
      name: "Em andamento",
      position: 1,
      category: "in_progress",
    },
    { id: "c-done", name: "Concluído", position: 2, category: "done" },
  ];
  const item = (
    id: string,
    title: string,
    columnId: string,
    extra: Partial<WorkItem> = {},
  ): WorkItem => ({
    id,
    projectId: "p1",
    kind: "task",
    title,
    description: "",
    priority: "normal",
    columnId,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    encrypted: false,
    contentRevision: 0,
    assigneeId: ME.id,
    ...extra,
  });
  return {
    account: ME,
    projects: [project],
    columns: { p1: columns },
    items: [
      item("w1", "Revisar contratos", "c-todo", { dueDate: "2026-10-30" }),
      item("w2", "Escrever o plano", "c-doing", { priority: "high" }),
      item("w3", "Publicar o site", "c-done"),
    ],
    epics: [],
    members: {
      p1: [
        {
          accountId: ME.id,
          email: ME.email,
          membershipKind: "internal",
          isManager: true,
        },
        {
          accountId: "acc-bruno",
          email: "bruno@crewstead.test",
          membershipKind: "internal",
          isManager: false,
        },
      ],
    },
    sprints: [],
    conversations: {
      p1: [
        {
          id: "k1",
          name: "geral",
          unread: 0,
          encrypted: false,
          contentRevision: 0,
        },
      ],
    },
    messages: { k1: [] },
    comments: {},
    notifications: [],
    directConversations: [],
    directContacts: [],
    stats: {
      completedToday: 0,
      completedTotal: 0,
      currentStreak: 0,
      bestStreak: 0,
      kudosReceived: 0,
      kudosGiven: 0,
      focusMinutes: 0,
      callsJoined: 0,
      commentsWritten: 0,
    },
  };
}

export type RecordedCall = { method: string; path: string; body: unknown };

type Context = {
  world: World;
  match: RegExpExecArray;
  body: unknown;
  url: URL;
};
type Handler = (context: Context) => unknown | Response;
type Route = [
  method: string,
  pattern: RegExp,
  handler: Handler,
  status?: number,
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const empty = (status = 204) => new Response(null, { status });

function routes(): Route[] {
  const itemOf = (world: World, id: string) =>
    world.items.find((entry) => entry.id === id);
  return [
    ["GET", /^\/api\/v1\/projects$/, ({ world }) => world.projects],
    [
      "POST",
      /^\/api\/v1\/projects$/,
      ({ world, body }) => {
        const input = body as { name: string; description?: string };
        const project: Project = {
          ...(world.projects[0] as Project),
          id: `p${world.projects.length + 1}`,
          name: input.name,
          description: input.description ?? "",
        };
        world.projects.push(project);
        world.columns[project.id] = [
          {
            id: `${project.id}-todo`,
            name: "A fazer",
            position: 0,
            category: "todo",
          },
          {
            id: `${project.id}-done`,
            name: "Concluído",
            position: 1,
            category: "done",
          },
        ];
        world.members[project.id] = [];
        world.conversations[project.id] = [];
        return project;
      },
      201,
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/([^/]+)\/columns$/,
      ({ world, match }) => world.columns[match[1] ?? ""] ?? [],
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/([^/]+)\/work-items$/,
      ({ world, match }) =>
        world.items.filter((entry) => entry.projectId === match[1]),
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/([^/]+)\/work-items$/,
      ({ world, match, body }) => {
        const input = body as Partial<WorkItem> & { columnId?: string };
        const created: WorkItem = {
          id: `w${world.items.length + 1}`,
          projectId: match[1] ?? "",
          kind: input.kind ?? "task",
          title: input.title ?? "",
          description: input.description ?? "",
          priority: input.priority ?? "normal",
          columnId:
            input.columnId ?? world.columns[match[1] ?? ""]?.[0]?.id ?? "",
          version: 1,
          createdAt: NOW,
          updatedAt: NOW,
          encrypted: false,
          contentRevision: 0,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          ...(input.assigneeId === undefined
            ? {}
            : { assigneeId: input.assigneeId }),
        };
        world.items.push(created);
        return created;
      },
      201,
    ],
    [
      "PATCH",
      /^\/api\/v1\/work-items\/([^/]+)$/,
      ({ world, match, body }) => {
        const found = itemOf(world, match[1] ?? "");
        if (found === undefined) return empty(404);
        const input = body as Record<string, unknown>;
        if (input["version"] !== found.version) return empty(409);
        const {
          version: _version,
          clearAssignee,
          clearDueDate,
          clearEpic,
          clearSprint,
          completeSubtasks: _c,
          ...rest
        } = input;
        Object.assign(found, rest, { version: found.version + 1 });
        if (clearAssignee === true) delete found.assigneeId;
        if (clearDueDate === true) delete found.dueDate;
        if (clearEpic === true) delete found.epicId;
        if (clearSprint === true) delete found.sprintId;
        return found;
      },
    ],
    [
      "GET",
      /^\/api\/v1\/work-items\/([^/]+)\/comments$/,
      ({ world, match }) => world.comments[match[1] ?? ""] ?? [],
    ],
    [
      "POST",
      /^\/api\/v1\/work-items\/([^/]+)\/comments$/,
      ({ world, match, body }) => {
        const id = match[1] ?? "";
        const comment: WorkItemComment = {
          id: `k${(world.comments[id]?.length ?? 0) + 1}`,
          authorEmail: world.account.email,
          authorId: world.account.id,
          body: (body as { body: string }).body,
          createdAt: NOW,
          encrypted: false,
        } as WorkItemComment;
        world.comments[id] = [...(world.comments[id] ?? []), comment];
        return comment;
      },
      201,
    ],
    [
      "GET",
      /^\/api\/v1\/work-items\/[^/]+\/followers\/me$/,
      () => ({ following: false }),
    ],
    ["PUT", /^\/api\/v1\/work-items\/[^/]+\/followers\/me$/, () => empty()],
    ["DELETE", /^\/api\/v1\/work-items\/[^/]+\/followers\/me$/, () => empty()],
    [
      "GET",
      /^\/api\/v1\/work-items\/[^/]+\/engagement$/,
      () => ({ kudosCount: 0, kudosMine: false, focusMinutes: 0 }),
    ],
    ["PUT", /^\/api\/v1\/work-items\/[^/]+\/kudos$/, () => empty()],
    ["DELETE", /^\/api\/v1\/work-items\/[^/]+\/kudos$/, () => empty()],
    ["POST", /^\/api\/v1\/work-items\/[^/]+\/focus$/, () => empty()],
    ["GET", /^\/api\/v1\/work-items\/[^/]+\/attachments$/, () => []],
    [
      "GET",
      /^\/api\/v1\/projects\/([^/]+)\/epics$/,
      ({ world, match }) =>
        world.epics.filter((entry) => entry.projectId === match[1]),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/([^/]+)\/members$/,
      ({ world, match }) => world.members[match[1] ?? ""] ?? [],
    ],
    ["GET", /^\/api\/v1\/projects\/[^/]+\/key-domains$/, () => []],
    [
      "GET",
      /^\/api\/v1\/projects\/([^/]+)\/conversations$/,
      ({ world, match }) => world.conversations[match[1] ?? ""] ?? [],
    ],
    ["GET", /^\/api\/v1\/sprints$/, ({ world }) => world.sprints],
    ["GET", /^\/api\/v1\/e2ee\/sprint-domain$/, () => empty(404)],
    [
      "GET",
      /^\/api\/v1\/direct-conversations$/,
      ({ world }) => world.directConversations,
    ],
    [
      "GET",
      /^\/api\/v1\/direct-contacts$/,
      ({ world }) => world.directContacts,
    ],
    ["GET", /^\/api\/v1\/notifications$/, ({ world }) => world.notifications],
    ["GET", /^\/api\/v1\/avatars$/, () => []],
    ["GET", /^\/api\/v1\/me\/stats$/, ({ world }) => world.stats],
    ["GET", /^\/api\/v1\/call-invitations$/, () => []],
    ["GET", /^\/api\/v1\/calls\/active$/, () => []],
    ["GET", /^\/api\/v1\/calls\/history$/, () => []],
    [
      "GET",
      /^\/api\/v1\/conversations\/([^/]+)\/messages$/,
      ({ world, match, url }) => {
        const after = Number(url.searchParams.get("after") ?? 0);
        return (world.messages[match[1] ?? ""] ?? []).filter(
          (entry) => entry.seq > after,
        );
      },
    ],
    [
      "POST",
      /^\/api\/v1\/conversations\/([^/]+)\/messages$/,
      ({ world, match, body }) => {
        const id = match[1] ?? "";
        const input = body as { body?: string; clientMutationId: string };
        const list = world.messages[id] ?? [];
        const message: Message = {
          id: `m${list.length + 1}`,
          seq: list.length + 1,
          authorEmail: world.account.email,
          authorId: world.account.id,
          body: input.body ?? "",
          createdAt: NOW,
          encrypted: false,
          contentRevision: 0,
          clientMutationId: input.clientMutationId,
          deleted: false,
          reactions: [],
        };
        world.messages[id] = [...list, message];
        return message;
      },
      201,
    ],
    ["PUT", /^\/api\/v1\/conversations\/[^/]+\/read-cursor$/, () => empty()],
  ];
}

/**
 * A fake `fetch` over an in-memory world. Unknown routes answer 404 and are
 * kept in `unhandled`, so a test notices a screen calling something it did not set up.
 */
export function createFakeApi(world: World = defaultWorld()) {
  const calls: RecordedCall[] = [];
  const unhandled: string[] = [];
  const table = routes();
  const extra: Route[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://app.test"), init);
    const url = new URL(request.url);
    const text = await request.clone().text();
    const body: unknown =
      text === "" ? undefined : (JSON.parse(text) as unknown);
    calls.push({
      method: request.method,
      path: url.pathname + url.search,
      body,
    });
    for (const [method, pattern, handler, status] of [...extra, ...table]) {
      if (method !== request.method) continue;
      const match = pattern.exec(url.pathname);
      if (match === null) continue;
      const result = handler({ world, match, body, url });
      return result instanceof Response ? result : json(result, status ?? 200);
    }
    unhandled.push(`${request.method} ${url.pathname}`);
    return empty(404);
  };
  return {
    world,
    fetch: fetcher,
    calls,
    unhandled,
    /** Answers a route differently from the default (checked before the defaults). */
    route(method: string, pattern: RegExp, handler: Handler, status?: number) {
      extra.unshift([method, pattern, handler, status]);
    },
    /** How many times this request was made. */
    count(method: string, pathPattern: RegExp) {
      return calls.filter(
        (call) => call.method === method && pathPattern.test(call.path),
      ).length;
    },
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;
