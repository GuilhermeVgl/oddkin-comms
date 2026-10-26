import type { BoardColumn, Sprint, WorkItem } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import type { ProjectState } from "../../workspace";
import { taskEntries } from "../work/workRules";
import {
  backlogRows,
  closeDecisions,
  countChoice,
  doneCount,
  groupByProject,
  initialChoices,
  isConflict,
  rowsOfSprint,
  splitSprints,
  sprintDatesError,
  sprintLengthDays,
} from "./sprintRules";

const columns = [
  { id: "todo", category: "todo" },
  { id: "done", category: "done" },
] as BoardColumn[];

const item = (id: string, patch: Partial<WorkItem>): WorkItem =>
  ({ id, kind: "task", columnId: "todo", ...patch }) as WorkItem;

const project = (id: string, items: WorkItem[]): ProjectState =>
  ({ project: { id }, columns, items }) as ProjectState;

const alpha = project("a", [
  item("t1", { sprintId: "s1" }),
  item("t2", { columnId: "done", sprintId: "s1" }),
  item("sub", { kind: "subtask", sprintId: "s1" }),
  item("t3", {}),
]);
const beta = project("b", [item("t4", { sprintId: "s2" })]);

describe("row helpers", () => {
  const rows = taskEntries([alpha, beta]);
  it("filters the rows of one sprint", () => {
    expect(rowsOfSprint(rows, "s1").map((row) => row.item.id)).toEqual([
      "t1",
      "t2",
    ]);
  });
  it("counts finished rows by their column category", () => {
    expect(doneCount(rowsOfSprint(rows, "s1"))).toBe(1);
  });
  it("keeps the backlog to unplanned work that is not done", () => {
    expect(backlogRows(rows).map((row) => row.item.id)).toEqual(["t3"]);
  });
  it("groups rows by project keeping their order", () => {
    const groups = groupByProject(rows);
    expect([...groups.keys()]).toEqual(["a", "b"]);
    expect(groups.get("a")?.length).toBe(3);
  });
});

describe("splitSprints", () => {
  it("separates the active sprint from planned and closed ones", () => {
    const sprint = (id: string, state: Sprint["state"]) =>
      ({ id, state }) as Sprint;
    const result = splitSprints([
      sprint("1", "closed"),
      sprint("2", "active"),
      sprint("3", "planned"),
      sprint("4", "planned"),
    ]);
    expect(result.active?.id).toBe("2");
    expect(result.planned.map((entry) => entry.id)).toEqual(["3", "4"]);
    expect(result.closed.map((entry) => entry.id)).toEqual(["1"]);
    expect(splitSprints([]).active).toBeUndefined();
  });
});

describe("sprintLengthDays", () => {
  it("counts both the first and the last day", () => {
    expect(sprintLengthDays("2026-01-01", "2026-01-14")).toBe(14);
    expect(sprintLengthDays("2026-01-05", "2026-01-05")).toBe(1);
    expect(sprintLengthDays("2026-01-05", "2026-01-01")).toBe(1);
  });
});

describe("close choices", () => {
  const pending = [{ id: "x" }, { id: "y" }];
  it("starts by carrying work to the next sprint when one is planned", () => {
    expect(initialChoices(pending, true)).toEqual({ x: "next", y: "next" });
    expect(initialChoices(pending, false)).toEqual({
      x: "backlog",
      y: "backlog",
    });
  });
  it("counts each destination", () => {
    const choices = { x: "next", y: "backlog", z: "next" } as const;
    expect(countChoice(choices, "next")).toBe(2);
    expect(countChoice(choices, "backlog")).toBe(1);
  });
  it("sends the seen version of every pending item, backlog by default", () => {
    const items = [
      { id: "x", version: 3 },
      { id: "y", version: 5 },
    ];
    expect(closeDecisions(items, { x: "next" })).toEqual([
      { workItemId: "x", version: 3, destination: "next" },
      { workItemId: "y", version: 5, destination: "backlog" },
    ]);
  });
});

describe("isConflict", () => {
  it("recognises a 409 from the API client", () => {
    expect(isConflict({ status: 409 })).toBe(true);
    expect(isConflict({ status: 500 })).toBe(false);
    expect(isConflict(new Error("x"))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});

describe("sprintDatesError", () => {
  it("rejects a start after the end", () => {
    expect(sprintDatesError("2026-02-01", "2026-01-01")).toBe(
      "O início não pode ser posterior ao fim.",
    );
    expect(sprintDatesError("2026-01-01", "2026-01-01")).toBe("");
  });
});
