import type {
  BoardColumn,
  OrganizationPerson,
  WorkItem,
} from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  columnOrderAfterMove,
  countTasksIn,
  deviceIconName,
  hasOpenAndDone,
  kindLabel,
  membershipLabel,
  storageBlocks,
  withCategory,
} from "./settingsRules";

const column = (id: string, category: BoardColumn["category"]): BoardColumn =>
  ({ id, name: id, category, position: 0 }) as BoardColumn;

describe("hasOpenAndDone", () => {
  it("needs a column that is not done and one that is", () => {
    expect(hasOpenAndDone([column("a", "todo"), column("b", "done")])).toBe(
      true,
    );
    expect(hasOpenAndDone([column("a", "todo")])).toBe(false);
    expect(hasOpenAndDone([column("a", "done")])).toBe(false);
    expect(hasOpenAndDone([])).toBe(false);
  });
});

describe("withCategory", () => {
  it("changes only the named column", () => {
    const next = withCategory(
      [column("a", "todo"), column("b", "done")],
      "a",
      "done",
    );
    expect(next.map((entry) => entry.category)).toEqual(["done", "done"]);
  });
});

describe("columnOrderAfterMove", () => {
  const list = [column("a", "todo"), column("b", "todo"), column("c", "done")];
  it("moves a column down and up", () => {
    expect(columnOrderAfterMove(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(columnOrderAfterMove(list, 2, -1)).toEqual(["a", "c", "b"]);
  });
  it("does not move past the ends", () => {
    expect(columnOrderAfterMove(list, 0, -1)).toBeNull();
    expect(columnOrderAfterMove(list, 2, 1)).toBeNull();
    expect(columnOrderAfterMove(list, 9, 1)).toBeNull();
  });
});

describe("countTasksIn", () => {
  it("counts tasks only, not subtasks", () => {
    const items = [
      { kind: "task", columnId: "a" },
      { kind: "task", columnId: "a" },
      { kind: "subtask", columnId: "a" },
      { kind: "task", columnId: "b" },
    ] as WorkItem[];
    expect(countTasksIn(items, "a")).toBe(2);
    expect(countTasksIn(items, "z")).toBe(0);
  });
});

describe("storageBlocks", () => {
  it("is empty without usage or quota", () => {
    expect(storageBlocks(null)).toBe(0);
    expect(storageBlocks({ quota: 0, reserved: 5 })).toBe(0);
  });
  it("rounds up and caps at the total", () => {
    expect(storageBlocks({ quota: 100, reserved: 1 })).toBe(1);
    expect(storageBlocks({ quota: 100, reserved: 50 })).toBe(13);
    expect(storageBlocks({ quota: 100, reserved: 400 })).toBe(25);
  });
});

describe("membershipLabel", () => {
  const person = (patch: Partial<OrganizationPerson>) =>
    ({
      isAdmin: false,
      membershipKind: "internal",
      active: true,
      ...patch,
    }) as OrganizationPerson;
  it("describes the role and the deactivated state", () => {
    expect(membershipLabel(person({ isAdmin: true }))).toBe("Administração");
    expect(membershipLabel(person({}))).toBe("Interno");
    expect(membershipLabel(person({ membershipKind: "external" }))).toBe(
      "Externo",
    );
    expect(membershipLabel(person({ active: false }))).toBe(
      "Interno · desativada",
    );
  });
});

describe("kindLabel", () => {
  it("translates known domains and passes unknown ones through", () => {
    expect(kindLabel("dm")).toBe("mensagem direta");
    expect(kindLabel("other")).toBe("other");
  });
});

describe("deviceIconName", () => {
  it("picks a phone icon for mobile-looking names", () => {
    expect(deviceIconName("Pixel Android")).toBe("phoneDev");
    expect(deviceIconName("iPhone de Ana")).toBe("phoneDev");
    expect(deviceIconName("MacBook")).toBe("laptop");
  });
});
