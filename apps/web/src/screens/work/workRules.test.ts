import type { BoardColumn, WorkItem } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import type { ProjectState } from "../../workspace";
import {
  canStartDrag,
  columnIndexAt,
  dropIndex,
  extraFilterCount,
  filterEntries,
  findItemTarget,
  ghostTransform,
  isLate,
  pastDragThreshold,
  scrollDelta,
  sortEntries,
  taskEntries,
  type Filters,
} from "./workRules";

const columns = [
  { id: "todo", name: "A fazer", category: "todo" },
  { id: "doing", name: "Fazendo", category: "in_progress" },
  { id: "done", name: "Feito", category: "done" },
] as BoardColumn[];

const item = (id: string, patch: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    kind: "task",
    title: id,
    columnId: "todo",
    priority: "normal",
    ...patch,
  }) as WorkItem;

const state = (id: string, items: WorkItem[], name = id): ProjectState =>
  ({ project: { id, name }, columns, items }) as ProjectState;

const none: Filters = {
  scope: "todas",
  epic: "",
  prio: "",
  assignee: "",
  sprint: "",
};

/** Days until an ISO date, with "today" fixed so the tests do not depend on the clock. */
const daysFromFixedToday = (iso: string) =>
  Math.round((Date.parse(iso) - Date.parse("2026-06-10")) / 864e5);

describe("taskEntries", () => {
  it("lists tasks of the given projects and drops subtasks", () => {
    const entries = taskEntries([
      state("a", [item("t1"), item("s1", { kind: "subtask" })]),
      state("b", [item("t2")]),
    ]);
    expect(entries.map((entry) => entry.item.id)).toEqual(["t1", "t2"]);
    expect(entries[1]?.state.project.id).toBe("b");
  });
});

describe("filterEntries", () => {
  const entries = taskEntries([
    state("a", [
      item("mine", { assigneeId: "me", priority: "high", sprintId: "s1" }),
      item("theirs", { assigneeId: "other", epicId: "e1" }),
      item("loose", {}),
      item("soon", { dueDate: "2026-06-15" }),
      item("far", { dueDate: "2026-07-30" }),
      item("soon-done", { dueDate: "2026-06-12", columnId: "done" }),
    ]),
  ]);
  const ids = (filters: Partial<Filters>) =>
    filterEntries(
      entries,
      { ...none, ...filters },
      "me",
      daysFromFixedToday,
    ).map((entry) => entry.item.id);

  it("keeps everything without filters", () => {
    expect(ids({})).toHaveLength(6);
  });
  it("narrows to the person's own work", () => {
    expect(ids({ scope: "minhas" })).toEqual(["mine"]);
  });
  it("narrows to unfinished work due within a week", () => {
    expect(ids({ scope: "semana" })).toEqual(["soon"]);
  });
  it("filters by epic, priority and sprint", () => {
    expect(ids({ epic: "e1" })).toEqual(["theirs"]);
    expect(ids({ prio: "high" })).toEqual(["mine"]);
    expect(ids({ sprint: "s1" })).toEqual(["mine"]);
    expect(ids({ sprint: "backlog" })).toHaveLength(5);
  });
  it("filters by assignee, including nobody", () => {
    expect(ids({ assignee: "other" })).toEqual(["theirs"]);
    expect(ids({ assignee: "none" })).toHaveLength(4);
  });
});

describe("sortEntries", () => {
  const entries = taskEntries([
    state("beta", [
      item("b", { title: "Banana", priority: "low", columnId: "done" }),
      item("a", { title: "apple", priority: "urgent", dueDate: "2026-01-02" }),
    ]),
    state("alpha", [
      item("c", { title: "Cherry", priority: "normal", dueDate: "2026-01-01" }),
    ]),
  ]);
  const order = (key: Parameters<typeof sortEntries>[1], dir: 1 | -1 = 1) =>
    sortEntries(entries, key, dir).map((entry) => entry.item.id);

  it("sorts by due date with undated work last", () => {
    expect(order("due")).toEqual(["c", "a", "b"]);
    expect(order("due", -1)).toEqual(["b", "a", "c"]);
  });
  it("sorts titles ignoring case", () => {
    expect(order("title")).toEqual(["a", "b", "c"]);
  });
  it("sorts by priority from urgent down", () => {
    expect(order("prio")).toEqual(["a", "c", "b"]);
  });
  it("sorts by project name and by column position", () => {
    expect(order("p")[0]).toBe("c");
    expect(order("st")[2]).toBe("b");
  });
  it("does not change the input", () => {
    sortEntries(entries, "title", 1);
    expect(entries.map((entry) => entry.item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("extraFilterCount", () => {
  it("counts the filters kept in the popover", () => {
    expect(extraFilterCount(none)).toBe(0);
    expect(extraFilterCount({ ...none, assignee: "x" })).toBe(1);
    expect(extraFilterCount({ ...none, assignee: "x", sprint: "y" })).toBe(2);
  });
});

describe("findItemTarget", () => {
  const projects = [state("a", [item("x")]), state("b", [item("y")])];
  it("finds the item and its project, or nothing", () => {
    expect(findItemTarget(projects, "y")?.state.project.id).toBe("b");
    expect(findItemTarget(projects, "zzz")).toBeNull();
    expect(findItemTarget(projects, null)).toBeNull();
    expect(findItemTarget(null, "x")).toBeNull();
  });
});

describe("isLate", () => {
  it("is late only when overdue and not done", () => {
    const due = (iso: string | undefined) =>
      item("t", iso ? { dueDate: iso } : {});
    expect(isLate(due("2026-06-01"), false, daysFromFixedToday)).toBe(true);
    expect(isLate(due("2026-06-01"), true, daysFromFixedToday)).toBe(false);
    expect(isLate(due("2026-06-10"), false, daysFromFixedToday)).toBe(false);
    expect(isLate(due(undefined), false, daysFromFixedToday)).toBe(false);
  });
});

describe("drag geometry", () => {
  it("starts dragging only after a few pixels of movement", () => {
    expect(pastDragThreshold(3, 3)).toBe(false);
    expect(pastDragThreshold(6, 0)).toBe(true);
    expect(pastDragThreshold(-4, 5)).toBe(true);
  });
  it("lets only a primary-button, non-touch press on a plain area start a drag", () => {
    expect(
      canStartDrag({ button: 0, pointerType: "mouse", onControl: false }),
    ).toBe(true);
    expect(
      canStartDrag({ button: 2, pointerType: "mouse", onControl: false }),
    ).toBe(false);
    expect(
      canStartDrag({ button: 0, pointerType: "touch", onControl: false }),
    ).toBe(false);
    expect(
      canStartDrag({ button: 0, pointerType: "mouse", onControl: true }),
    ).toBe(false);
  });
  it("finds the column under the pointer", () => {
    const rects = [
      { left: 0, right: 100 },
      { left: 110, right: 210 },
    ];
    expect(columnIndexAt(rects, 50)).toBe(0);
    expect(columnIndexAt(rects, 210)).toBe(1);
    expect(columnIndexAt(rects, 105)).toBe(-1);
  });
  it("drops above the first card whose middle is below the pointer", () => {
    const cards = [
      { top: 0, height: 100 },
      { top: 110, height: 100 },
    ];
    expect(dropIndex(cards, 10)).toBe(0);
    expect(dropIndex(cards, 60)).toBe(1);
    expect(dropIndex(cards, 500)).toBe(2);
    expect(dropIndex([], 5)).toBe(0);
  });
  it("scrolls the board near its edges", () => {
    const bounds = { left: 0, right: 1000 };
    expect(scrollDelta(990, bounds)).toBe(14);
    expect(scrollDelta(20, bounds)).toBe(-14);
    expect(scrollDelta(500, bounds)).toBe(0);
  });
  it("builds the ghost transform", () => {
    expect(ghostTransform({ x: 10, y: 20, vx: 0, vy: 0 }, 3)).toBe(
      "translate3d(10px, 20px, 0) rotate(3deg) scale(1.04)",
    );
  });
});
