import {
  createCommentRaw,
  createEpicRaw,
  createWorkItemRaw,
  editMessageRaw,
  encryptComment,
  listComments,
  listMessages,
  sendMessageRaw,
  updateEpicRaw,
  updateWorkItemRaw,
  type createApiClient,
  type Epic,
  type Message,
  type WorkItem,
  type WorkItemComment,
} from "@oddkin/api-client";
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
  kind: "work" | "chat",
): "plain" | "encrypt" {
  if (pc === null || !pc.isEncrypted(kind)) return "plain";
  if (!pc.canWrite(kind)) throw new EncryptionUnavailableError();
  return "encrypt";
}

async function open(
  pc: ProjectCrypto | null,
  kind: "work" | "chat",
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
) {
  return Promise.all(
    messages.map(async (message): Promise<Message> => {
      if (!message.encrypted || message.deleted) return message;
      const body = await open(pc, "chat", {
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
  },
): Promise<WorkItem> {
  const parent =
    input.parentId === undefined ? {} : { parentId: input.parentId };
  if (writeMode(pc, "work") === "plain" || pc === null) {
    return createWorkItemRaw(client, token, projectId, {
      kind: input.kind,
      title: input.title,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...parent,
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
): Promise<Message> {
  const extras = {
    ...(input.replyToId === undefined ? {} : { replyToId: input.replyToId }),
    ...(input.mentionIds === undefined ? {} : { mentionIds: input.mentionIds }),
  };
  if (pc === null || writeMode(pc, "chat") === "plain") {
    return sendMessageRaw(client, token, conversationId, {
      clientMutationId: input.mutationId,
      body: input.body,
      ...extras,
    });
  }
  const encrypted = pc.encrypt(
    "chat",
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
): Promise<Message> {
  if (pc === null || writeMode(pc, "chat") === "plain") {
    return editMessageRaw(client, token, message.id, { body });
  }
  const revision = message.contentRevision + 1;
  const encrypted = pc.encrypt(
    "chat",
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
  data: { items: WorkItem[]; epics: Epic[]; channelId: string | undefined },
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
    let after = 0;
    for (;;) {
      const page = await listMessages(client, data.channelId, after).catch(
        () => [],
      );
      for (const message of page) {
        if (
          message.encrypted ||
          message.deleted ||
          message.authorEmail !== me.email
        )
          continue;
        try {
          const encrypted = pc.encrypt(
            "chat",
            resources.message(message.clientMutationId),
            1,
            message.body,
          );
          await editMessageRaw(client, token, message.id, {
            bodyEnc: encrypted.envelope,
            signerDeviceId: encrypted.signerDeviceId,
            contentRevision: 1,
          });
          report.messages += 1;
        } catch {
          report.failed += 1;
        }
      }
      const last = page[page.length - 1];
      if (page.length < 100 || last === undefined) break;
      after = last.seq;
    }
  }
  return report;
}
