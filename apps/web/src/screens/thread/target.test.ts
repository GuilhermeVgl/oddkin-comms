import { describe, expect, it } from "vitest";
import { defaultWorld } from "../../testing/fakeApi";
import type { ProjectState } from "../../workspace";
import { threadTargetFor } from "./target";

function projects(): ProjectState[] {
  const world = defaultWorld();
  return world.projects.map((project) => ({
    project,
    columns: world.columns[project.id] ?? [],
    items: [],
    epics: [],
    members: world.members[project.id] ?? [],
    crypto: null,
    status: new Map(),
    keyed: false,
    canRead: true,
  }));
}

describe("threadTargetFor", () => {
  it("resolves the exact project channel where a call started", () => {
    const target = threadTargetFor("k1", {
      channels: [
        {
          id: "k1",
          projectId: "p1",
          name: "geral",
          unread: 0,
          archived: false,
          encrypted: false,
          contentRevision: 0,
        },
      ],
      dms: [],
      projects: projects(),
    });
    expect(target?.kind).toBe("chat");
    expect(target?.title).toBe("#geral");
  });

  it("resolves the direct conversation where a call started", () => {
    const target = threadTargetFor("dm1", {
      channels: [],
      dms: [
        {
          id: "dm1",
          peerEmail: "bruno@crewstead.test",
          peerId: "b1",
          unread: 0,
        } as never,
      ],
      projects: projects(),
    });
    expect(target?.kind).toBe("dm");
    expect(target?.title).toBe("Bruno");
  });
});
