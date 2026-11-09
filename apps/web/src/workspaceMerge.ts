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

function preserveText<T extends WorkItem | Epic>(
  previous: T | undefined,
  incoming: T,
  previousStatus: ContentStatus | undefined,
  incomingStatus: ContentStatus | undefined,
): T {
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

    const status = new Map(state.status);
    const previousStatus = before.status;
    function preserveList<T extends WorkItem | Epic>(
      previous: T[],
      incoming: T[],
    ): T[] {
      const byId = new Map(previous.map((item) => [item.id, item]));
      return incoming.map((item) => {
        const oldStatus = previousStatus.get(item.id);
        const kept = preserveText(
          byId.get(item.id),
          item,
          oldStatus,
          state.status.get(item.id),
        );
        if (kept !== item) status.set(item.id, oldStatus ?? "ok");
        return kept;
      });
    }
    const items = preserveList(before.items, state.items);
    const epics = preserveList(before.epics, state.epics);
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
