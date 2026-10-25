import {
  createCommentRaw,
  createEpicRaw,
  createWorkItemRaw,
  editMessageRaw,
  createSprintRaw,
  encryptComment,
  listComments,
  listMessages,
  sendMessageRaw,
  updateConversationContent,
  updateEpicRaw,
  updateProjectContent,
  updateSprintContent,
  updateWorkItemRaw,
  type createApiClient,
  type Conversation,
  type Epic,
  type Project,
  type Sprint,
  type Message,
  type WorkItem,
  type WorkItemComment,
} from "@oddkin/api-client";
import type { DomainKind } from "./keyring";
import { resources, type ProjectCrypto } from "./projectCrypto";

type Client = ReturnType<typeof createApiClient>;

export type ContentStatus =
  "plain" | "ok" | "locked" | "no_key" | "untrusted" | "invalid";

const PLACEHOLDER: Record<Exclude<ContentStatus, "plain" | "ok">, string> = {
  locked: "Conteúdo cifrado (desbloqueie este navegador)",
  no_key: "Conteúdo cifrado (sem chave neste dispositivo)",
  untrusted: "Conteúdo de origem não verificada",
  invalid: "Conteúdo cifrado inválido ou adulterado",
};

/** Raised when a write needs encryption but this browser cannot provide it right now. */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super("encryption unavailable");
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * How to write content of one kind: legacy plaintext only while the project has
 * no key generation; once it has one, the server refuses plaintext, so a
 * browser that cannot encrypt must not try.
 */
function writeMode(
  pc: ProjectCrypto | null,
  kind: DomainKind,
): "plain" | "encrypt" {
  if (pc === null || !pc.isEncrypted(kind)) return "plain";
  if (!pc.canWrite(kind)) throw new EncryptionUnavailableError();
  return "encrypt";
}

async function open(
  pc: ProjectCrypto | null,
  kind: "work" | "chat" | "dm" | "sprint",
  input: {
    resource: string;
    revision: number;
    authorId: string | undefined;
    signerDeviceId: string | undefined;
    envelope: string | undefined;
  },
): Promise<{ text: string; status: ContentStatus }> {
  if (
    input.envelope === undefined ||
    input.authorId === undefined ||
    input.signerDeviceId === undefined
  ) {
    return { text: PLACEHOLDER.invalid, status: "invalid" };
  }
  if (pc === null) return { text: PLACEHOLDER.locked, status: "locked" };
  const result = await pc.decrypt(kind, {
    resource: input.resource,
    revision: input.revision,
    authorId: input.authorId,
    signerDeviceId: input.signerDeviceId,
    envelope: input.envelope,
  });
  return result.ok
    ? { text: result.text, status: "ok" }
    : { text: PLACEHOLDER[result.reason], status: result.reason };
}

export async function decryptItems(
  pc: ProjectCrypto | null,
  items: WorkItem[],
) {
  const status = new Map<string, ContentStatus>();
  const decoded = await Promise.all(
    items.map(async (item): Promise<WorkItem> => {
      if (!item.encrypted) {
        status.set(item.id, "plain");
        return item;
      }
      const base = {
        revision: item.contentRevision,
        authorId: item.contentAuthorId,
        signerDeviceId: item.signerDeviceId,
      };
      const title = await open(pc, "work", {
        ...base,
        resource: resources.workItem(item.id, "title"),
        envelope: item.titleEnc,
      });
      const description = await open(pc, "work", {
        ...base,
        resource: resources.workItem(item.id, "desc"),
        envelope: item.descriptionEnc,
      });
      status.set(
        item.id,
        title.status === "ok" && description.status === "ok"
          ? "ok"
          : title.status === "ok"
            ? description.status
            : title.status,
      );
      return {
        ...item,
        title: title.text,
        description: description.status === "ok" ? description.text : "",
      };
    }),
  );
  return { items: decoded, status };
}

export async function decryptEpics(pc: ProjectCrypto | null, epics: Epic[]) {
  const status = new Map<string, ContentStatus>();
  const decoded = await Promise.all(
    epics.map(async (epic): Promise<Epic> => {
      if (!epic.encrypted) {
        status.set(epic.id, "plain");
        return epic;
      }
      const base = {
        revision: epic.contentRevision,
        authorId: epic.contentAuthorId,
        signerDeviceId: epic.signerDeviceId,
      };
      const title = await open(pc, "work", {
        ...base,
        resource: resources.epic(epic.id, "title"),
        envelope: epic.titleEnc,
      });
      status.set(epic.id, title.status);
      return { ...epic, title: title.text, description: "" };
    }),
  );
  return { epics: decoded, status };
}

export async function decryptComments(
  pc: ProjectCrypto | null,
  comments: WorkItemComment[],
) {
  return Promise.all(
    comments.map(
      async (comment): Promise<WorkItemComment & { status: ContentStatus }> => {
        if (!comment.encrypted) return { ...comment, status: "plain" };
        const body = await open(pc, "work", {
          resource: resources.comment(comment.id),
          revision: 1,
          authorId: comment.authorId,
          signerDeviceId: comment.signerDeviceId,
          envelope: comment.bodyEnc,
        });
        return { ...comment, body: body.text, status: body.status };
      },
    ),
  );
}

export async function decryptMessages(
  pc: ProjectCrypto | null,
  messages: Message[],
  kind: "chat" | "dm" = "chat",
) {
  return Promise.all(
    messages.map(async (message): Promise<Message> => {
      if (!message.encrypted || message.deleted) return message;
      const body = await open(pc, kind, {
        resource: resources.message(message.clientMutationId),
        revision: message.contentRevision,
        authorId: message.authorId,
        signerDeviceId: message.signerDeviceId,
        envelope: message.bodyEnc,
      });
      return { ...message, body: body.text };
    }),
  );
}

export async function createItem(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  projectId: string,
  input: {
    kind: "task" | "subtask";
    parentId?: string;
    title: string;
    description?: string;
    assigneeId?: string;
    dueDate?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    columnId?: string;
  },
): Promise<WorkItem> {
  const parent =
    input.parentId === undefined ? {} : { parentId: input.parentId };
  const plainFields = {
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.columnId === undefined ? {} : { columnId: input.columnId }),
  };
  if (writeMode(pc, "work") === "plain" || pc === null) {
    return createWorkItemRaw(client, token, projectId, {
      kind: input.kind,
      title: input.title,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...parent,
      ...plainFields,
    });
  }
  const id = newId();
  const title = pc.encrypt(
    "work",
    resources.workItem(id, "title"),
    1,
    input.title,
  );
  const description = pc.encrypt(
    "work",
    resources.workItem(id, "desc"),
    1,
    input.description ?? "",
  );
  return createWorkItemRaw(client, token, projectId, {
    kind: input.kind,
    id,
    titleEnc: title.envelope,
    descriptionEnc: description.envelope,
    signerDeviceId: title.signerDeviceId,
    ...parent,
    ...plainFields,
  });
}

export async function saveItem(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  item: WorkItem,
  input: {
    title: string;
    description: string;
    priority: "low" | "normal" | "high" | "urgent";
  },
): Promise<WorkItem> {
  if (writeMode(pc, "work") === "plain" || pc === null) {
    return updateWorkItemRaw(client, token, item.id, {
      version: item.version,
      ...input,
    });
  }
  const revision = item.contentRevision + 1;
  const title = pc.encrypt(
    "work",
    resources.workItem(item.id, "title"),
    revision,
    input.title,
  );
  const description = pc.encrypt(
    "work",
    resources.workItem(item.id, "desc"),
    revision,
    input.description,
  );
  return updateWorkItemRaw(client, token, item.id, {
    version: item.version,
    priority: input.priority,
    titleEnc: title.envelope,
    descriptionEnc: description.envelope,
    signerDeviceId: title.signerDeviceId,
    contentRevision: revision,
  });
}

export async function createEpicContent(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  projectId: string,
  title: string,
): Promise<Epic> {
  if (writeMode(pc, "work") === "plain" || pc === null) {
    return createEpicRaw(client, token, projectId, { title });
  }
  const id = newId();
  const encrypted = pc.encrypt("work", resources.epic(id, "title"), 1, title);
  const description = pc.encrypt("work", resources.epic(id, "desc"), 1, "");
  return createEpicRaw(client, token, projectId, {
    id,
    titleEnc: encrypted.envelope,
    descriptionEnc: description.envelope,
    signerDeviceId: encrypted.signerDeviceId,
  });
}

export async function createCommentContent(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  workItemId: string,
  body: string,
): Promise<WorkItemComment> {
  if (writeMode(pc, "work") === "plain" || pc === null) {
    return createCommentRaw(client, token, workItemId, { body });
  }
  const id = newId();
  const encrypted = pc.encrypt("work", resources.comment(id), 1, body);
  return createCommentRaw(client, token, workItemId, {
    id,
    bodyEnc: encrypted.envelope,
    signerDeviceId: encrypted.signerDeviceId,
  });
}

export async function sendChannelMessage(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  conversationId: string,
  input: {
    body: string;
    mutationId: string;
    replyToId?: string;
    mentionIds?: string[];
  },
  kind: "chat" | "dm" = "chat",
): Promise<Message> {
  const extras = {
    ...(input.replyToId === undefined ? {} : { replyToId: input.replyToId }),
    ...(input.mentionIds === undefined ? {} : { mentionIds: input.mentionIds }),
  };
  if (pc === null || writeMode(pc, kind) === "plain") {
    return sendMessageRaw(client, token, conversationId, {
      clientMutationId: input.mutationId,
      body: input.body,
      ...extras,
    });
  }
  const encrypted = pc.encrypt(
    kind,
    resources.message(input.mutationId),
    1,
    input.body,
  );
  return sendMessageRaw(client, token, conversationId, {
    clientMutationId: input.mutationId,
    bodyEnc: encrypted.envelope,
    signerDeviceId: encrypted.signerDeviceId,
    ...extras,
  });
}

export async function editChannelMessage(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  message: Message,
  body: string,
  kind: "chat" | "dm" = "chat",
): Promise<Message> {
  if (pc === null || writeMode(pc, kind) === "plain") {
    return editMessageRaw(client, token, message.id, { body });
  }
  const revision = message.contentRevision + 1;
  const encrypted = pc.encrypt(
    kind,
    resources.message(message.clientMutationId),
    revision,
    body,
  );
  return editMessageRaw(client, token, message.id, {
    bodyEnc: encrypted.envelope,
    signerDeviceId: encrypted.signerDeviceId,
    contentRevision: revision,
  });
}

export type MigrationReport = {
  items: number;
  epics: number;
  comments: number;
  messages: number;
  failed: number;
};

/**
 * Encrypts the legacy plaintext of a project that this person is allowed to
 * rewrite: every work item and epic they can edit, and their own comments and
 * messages. Others' comments and messages are migrated by their authors.
 */
export async function migrateProject(
  client: Client,
  token: string,
  pc: ProjectCrypto,
  data: {
    items: WorkItem[];
    epics: Epic[];
    channelId: string | undefined;
    project?: Project;
    channel?: Conversation;
  },
  me: { email: string },
  progress: (done: number, total: number) => void,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    items: 0,
    epics: 0,
    comments: 0,
    messages: 0,
    failed: 0,
  };
  const legacyItems = data.items.filter((item) => !item.encrypted);
  const legacyEpics = data.epics.filter((epic) => !epic.encrypted);
  const total = legacyItems.length + legacyEpics.length;
  let done = 0;
  const step = async (
    action: () => Promise<void>,
    counter: keyof Omit<MigrationReport, "failed">,
  ) => {
    try {
      await action();
      report[counter] += 1;
    } catch {
      report.failed += 1;
    }
    done += 1;
    progress(done, total);
  };
  for (const item of legacyItems) {
    await step(async () => {
      const title = pc.encrypt(
        "work",
        resources.workItem(item.id, "title"),
        1,
        item.title,
      );
      const description = pc.encrypt(
        "work",
        resources.workItem(item.id, "desc"),
        1,
        item.description,
      );
      await updateWorkItemRaw(client, token, item.id, {
        version: item.version,
        titleEnc: title.envelope,
        descriptionEnc: description.envelope,
        signerDeviceId: title.signerDeviceId,
        contentRevision: 1,
      });
    }, "items");
    // This person's own legacy comments on the item.
    for (const comment of await listComments(client, item.id).catch(() => [])) {
      if (comment.encrypted || comment.authorEmail !== me.email) continue;
      try {
        const encrypted = pc.encrypt(
          "work",
          resources.comment(comment.id),
          1,
          comment.body,
        );
        await encryptComment(
          client,
          token,
          comment.id,
          encrypted.envelope,
          encrypted.signerDeviceId,
        );
        report.comments += 1;
      } catch {
        report.failed += 1;
      }
    }
  }
  for (const epic of legacyEpics) {
    await step(async () => {
      const title = pc.encrypt(
        "work",
        resources.epic(epic.id, "title"),
        1,
        epic.title,
      );
      const description = pc.encrypt(
        "work",
        resources.epic(epic.id, "desc"),
        1,
        epic.description,
      );
      await updateEpicRaw(client, token, epic.id, {
        version: epic.version,
        titleEnc: title.envelope,
        descriptionEnc: description.envelope,
        signerDeviceId: title.signerDeviceId,
        contentRevision: 1,
      });
    }, "epics");
  }
  if (data.channelId !== undefined) {
    const result = await migrateOwnMessages(
      client,
      token,
      pc,
      data.channelId,
      me.email,
      "chat",
    );
    report.messages += result.migrated;
    report.failed += result.failed;
  }
  return report;
}

// --- names -----------------------------------------------------------------

export async function decryptProject(
  pc: ContentLike,
  project: Project,
): Promise<Project> {
  if (!project.encrypted) return project;
  const base = {
    revision: project.contentRevision,
    authorId: project.contentAuthorId,
    signerDeviceId: project.signerDeviceId,
  };
  const name = await open(pc, "work", {
    ...base,
    resource: resources.project(project.id, "name"),
    envelope: project.nameEnc,
  });
  const description = await open(pc, "work", {
    ...base,
    resource: resources.project(project.id, "desc"),
    envelope: project.descriptionEnc,
  });
  return {
    ...project,
    name: name.text,
    description: description.status === "ok" ? description.text : "",
  };
}

export async function encryptProject(
  client: Client,
  token: string,
  pc: ProjectCrypto,
  project: Project,
): Promise<void> {
  const revision = project.contentRevision + 1;
  const name = pc.encrypt(
    "work",
    resources.project(project.id, "name"),
    revision,
    project.name,
  );
  const description = pc.encrypt(
    "work",
    resources.project(project.id, "desc"),
    revision,
    project.description,
  );
  await updateProjectContent(client, token, project.id, {
    nameEnc: name.envelope,
    descriptionEnc: description.envelope,
    signerDeviceId: name.signerDeviceId,
    contentRevision: revision,
  });
}

export async function decryptChannel(
  pc: ContentLike,
  channel: Conversation,
): Promise<Conversation> {
  if (!channel.encrypted) return channel;
  const name = await open(pc, "chat", {
    resource: resources.channel(channel.id),
    revision: channel.contentRevision,
    authorId: channel.contentAuthorId,
    signerDeviceId: channel.signerDeviceId,
    envelope: channel.nameEnc,
  });
  return { ...channel, name: name.text };
}

export async function encryptChannel(
  client: Client,
  token: string,
  pc: ProjectCrypto,
  channel: Conversation,
): Promise<void> {
  const revision = channel.contentRevision + 1;
  const name = pc.encrypt(
    "chat",
    resources.channel(channel.id),
    revision,
    channel.name,
  );
  await updateConversationContent(client, token, channel.id, {
    nameEnc: name.envelope,
    signerDeviceId: name.signerDeviceId,
    contentRevision: revision,
  });
}

export async function decryptSprints(
  pc: ContentLike,
  sprints: Sprint[],
): Promise<Sprint[]> {
  return Promise.all(
    sprints.map(async (sprint) => {
      if (!sprint.encrypted) return sprint;
      const base = {
        revision: sprint.contentRevision,
        authorId: sprint.contentAuthorId,
        signerDeviceId: sprint.signerDeviceId,
      };
      const name = await open(pc, "sprint", {
        ...base,
        resource: resources.sprint(sprint.id, "name"),
        envelope: sprint.nameEnc,
      });
      const goal = await open(pc, "sprint", {
        ...base,
        resource: resources.sprint(sprint.id, "goal"),
        envelope: sprint.goalEnc,
      });
      return {
        ...sprint,
        name: name.text,
        goal: goal.status === "ok" ? goal.text : "",
      };
    }),
  );
}

export async function createSprintContent(
  client: Client,
  token: string,
  pc: ProjectCrypto | null,
  input: { name: string; goal?: string; startsOn: string; endsOn: string },
): Promise<Sprint> {
  if (pc === null || writeMode(pc, "sprint") === "plain") {
    return createSprintRaw(client, token, input);
  }
  const id = newId();
  const name = pc.encrypt(
    "sprint",
    resources.sprint(id, "name"),
    1,
    input.name,
  );
  const goal = pc.encrypt(
    "sprint",
    resources.sprint(id, "goal"),
    1,
    input.goal ?? "",
  );
  return createSprintRaw(client, token, {
    id,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    nameEnc: name.envelope,
    goalEnc: goal.envelope,
    signerDeviceId: name.signerDeviceId,
  });
}

export async function encryptSprint(
  client: Client,
  token: string,
  pc: ProjectCrypto,
  sprint: Sprint,
): Promise<void> {
  const revision = sprint.contentRevision + 1;
  const name = pc.encrypt(
    "sprint",
    resources.sprint(sprint.id, "name"),
    revision,
    sprint.name,
  );
  const goal = pc.encrypt(
    "sprint",
    resources.sprint(sprint.id, "goal"),
    revision,
    sprint.goal,
  );
  await updateSprintContent(client, token, sprint.id, {
    nameEnc: name.envelope,
    goalEnc: goal.envelope,
    signerDeviceId: name.signerDeviceId,
    contentRevision: revision,
  });
}

type ContentLike = ProjectCrypto | null;

/** Encrypts the legacy plaintext messages this person wrote in a conversation. */
export async function migrateOwnMessages(
  client: Client,
  token: string,
  pc: ProjectCrypto,
  conversationId: string,
  email: string,
  kind: "chat" | "dm",
): Promise<{ migrated: number; failed: number }> {
  let migrated = 0;
  let failed = 0;
  let after = 0;
  for (;;) {
    const page = await listMessages(client, conversationId, after).catch(
      () => [],
    );
    for (const message of page) {
      if (message.encrypted || message.deleted || message.authorEmail !== email)
        continue;
      try {
        const encrypted = pc.encrypt(
          kind,
          resources.message(message.clientMutationId),
          1,
          message.body,
        );
        await editMessageRaw(client, token, message.id, {
          bodyEnc: encrypted.envelope,
          signerDeviceId: encrypted.signerDeviceId,
          contentRevision: 1,
        });
        migrated += 1;
      } catch {
        failed += 1;
      }
    }
    const last = page[page.length - 1];
    if (page.length < 100 || last === undefined) break;
    after = last.seq;
  }
  return { migrated, failed };
}
