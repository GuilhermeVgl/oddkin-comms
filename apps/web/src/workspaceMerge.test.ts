import type { Epic, Project, Sprint, WorkItem } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import type { ProjectState } from "./workspace";
import {
  preserveReadableProjects,
  preserveReadableSprints,
} from "./workspaceMerge";

function state(input: {
  projectName: string;
  itemTitle: string;
  status: "ok" | "locked";
  crypto: ProjectState["crypto"];
  revision?: number;
}): ProjectState {
  const revision = input.revision ?? 2;
  return {
    project: {
      id: "p1",
      encrypted: true,
      contentRevision: revision,
      name: input.projectName,
      description: "Descrição",
    } as Project,
    columns: [],
    items: [
      {
        id: "w1",
        encrypted: true,
        contentRevision: revision,
        title: input.itemTitle,
        description: "Detalhes",
      } as WorkItem,
    ],
    epics: [
      {
        id: "e1",
        encrypted: true,
        contentRevision: revision,
        title: `${input.itemTitle} epic`,
      } as Epic,
    ],
    members: [],
    crypto: input.crypto,
    status: new Map([
      ["w1", input.status],
      ["e1", input.status],
    ]),
    keyed: true,
    canRead: true,
  };
}

describe("preserveReadableProjects", () => {
  it("keeps decrypted text when refreshing keys fails transiently", () => {
    const crypto = { isEncrypted: () => true } as unknown as NonNullable<
      ProjectState["crypto"]
    >;
    const previous = state({
      projectName: "Produto",
      itemTitle: "Planejar entrega",
      status: "ok",
      crypto,
    });
    const incoming = state({
      projectName: "Conteúdo cifrado (desbloqueie este navegador)",
      itemTitle: "Conteúdo cifrado (desbloqueie este navegador)",
      status: "locked",
      crypto: null,
    });

    const [merged] = preserveReadableProjects([previous], [incoming]);

    expect(merged?.project.name).toBe("Produto");
    expect(merged?.items[0]?.title).toBe("Planejar entrega");
    expect(merged?.epics[0]?.title).toBe("Planejar entrega epic");
    expect(merged?.status.get("w1")).toBe("ok");
    expect(merged?.crypto).toBe(crypto);
  });

  it("does not reuse text for a newer encrypted revision", () => {
    const crypto = {} as NonNullable<ProjectState["crypto"]>;
    const previous = state({
      projectName: "Produto",
      itemTitle: "Antigo",
      status: "ok",
      crypto,
      revision: 1,
    });
    const incoming = state({
      projectName: "Conteúdo cifrado (desbloqueie este navegador)",
      itemTitle: "Conteúdo cifrado (desbloqueie este navegador)",
      status: "locked",
      crypto: null,
      revision: 2,
    });

    const [merged] = preserveReadableProjects([previous], [incoming]);
    expect(merged?.items[0]?.title).toContain("Conteúdo cifrado");
    expect(merged?.epics[0]?.title).toContain("Conteúdo cifrado");
  });
});

describe("preserveReadableSprints", () => {
  it("keeps the readable sprint while the organization key refresh recovers", () => {
    const previous = [
      {
        id: "s1",
        encrypted: true,
        contentRevision: 3,
        name: "Sprint 12",
        goal: "Entregar",
      } as Sprint,
    ];
    const incoming = [
      {
        ...previous[0],
        name: "Conteúdo cifrado (desbloqueie este navegador)",
        goal: "",
      } as Sprint,
    ];

    expect(preserveReadableSprints(previous, incoming, false)).toEqual(
      previous,
    );
  });
});
