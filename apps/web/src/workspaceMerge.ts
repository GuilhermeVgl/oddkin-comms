import type { Epic, Sprint, WorkItem } from "@crewstead/api-client";
import type { ContentStatus } from "./e2ee/content";
import type { ProjectState } from "./workspace";

function readable(status: ContentStatus | undefined): boolean {
  return status === "plain" || status === "ok";
}

function sameRevision(
  left: { contentRevision: number },
  right: { contentRevision: number },
): boolean {
  return left.contentRevision === right.contentRevision;
}

function preserveItem(
  previous: WorkItem | undefined,
  incoming: WorkItem,
  previousStatus: ContentStatus | undefined,
  incomingStatus: ContentStatus | undefined,
): WorkItem {
  if (
    previous === undefined ||
    !incoming.encrypted ||
    !sameRevision(previous, incoming) ||
    !readable(previousStatus) ||
    incomingStatus !== "locked"
  )
    return incoming;
  return {
    ...incoming,
    title: previous.title,
    description: previous.description,
  };
}

function preserveEpic(
  previous: Epic | undefined,
  incoming: Epic,
  previousStatus: ContentStatus | undefined,
  incomingStatus: ContentStatus | undefined,
): Epic {
  if (
    previous === undefined ||
    !incoming.encrypted ||
    !sameRevision(previous, incoming) ||
    !readable(previousStatus) ||
    incomingStatus !== "locked"
  )
    return incoming;
  return {
    ...incoming,
    title: previous.title,
    description: previous.description,
  };
}

/**
 * A temporary key refresh failure must not replace already verified plaintext
 * with a locked placeholder. New revisions are never reused: showing stale
 * content would be worse than showing that the new revision cannot be opened.
 */
export function preserveReadableProjects(
  previous: readonly ProjectState[] | null,
  incoming: readonly ProjectState[],
): ProjectState[] {
  if (previous === null) return [...incoming];
  const byProject = new Map(previous.map((state) => [state.project.id, state]));
  return incoming.map((state) => {
    const before = byProject.get(state.project.id);
    if (
      state.crypto !== null ||
      before?.crypto === null ||
      before === undefined
    )
      return state;

    const previousItems = new Map(before.items.map((item) => [item.id, item]));
    const previousEpics = new Map(before.epics.map((epic) => [epic.id, epic]));
    const status = new Map(state.status);
    const items = state.items.map((item) => {
      const kept = preserveItem(
        previousItems.get(item.id),
        item,
        before.status.get(item.id),
        state.status.get(item.id),
      );
      if (kept !== item)
        status.set(item.id, before.status.get(item.id) ?? "ok");
      return kept;
    });
    const epics = state.epics.map((epic) => {
      const kept = preserveEpic(
        previousEpics.get(epic.id),
        epic,
        before.status.get(epic.id),
        state.status.get(epic.id),
      );
      if (kept !== epic)
        status.set(epic.id, before.status.get(epic.id) ?? "ok");
      return kept;
    });
    const project =
      state.project.encrypted && sameRevision(before.project, state.project)
        ? {
            ...state.project,
            name: before.project.name,
            description: before.project.description,
          }
        : state.project;
    return {
      ...state,
      project,
      items,
      epics,
      status,
      crypto: before.crypto,
    };
  });
}

/** Keeps a verified sprint only while the same encrypted revision is reloading. */
export function preserveReadableSprints(
  previous: readonly Sprint[],
  incoming: readonly Sprint[],
  cryptoReady: boolean,
): Sprint[] {
  if (cryptoReady) return [...incoming];
  const byId = new Map(previous.map((sprint) => [sprint.id, sprint]));
  return incoming.map((sprint) => {
    const before = byId.get(sprint.id);
    return before !== undefined &&
      sprint.encrypted &&
      sameRevision(before, sprint)
      ? { ...sprint, name: before.name, goal: before.goal }
      : sprint;
  });
}
