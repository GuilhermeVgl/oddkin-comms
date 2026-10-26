import type { BoardColumn, WorkItem } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  allSubtasksDoneWith,
  isVersionConflict,
  itemEdit,
  subtaskProgress,
  subtaskTarget,
  textSaveAction,
} from "./derive";

const column = (id: string, category: BoardColumn["category"]): BoardColumn =>
  ({ id, name: id, category, position: 0 }) as BoardColumn;

const columns = [
  column("todo", "todo"),
  column("doing", "in_progress"),
  column("done", "done"),
];

const sub = (id: string, columnId: string): WorkItem =>
  ({ id, columnId }) as WorkItem;

const item = {
  title: "Título",
  description: "Descrição",
  priority: "high",
} as WorkItem;

describe("subtask progress", () => {
  it("counts finished subtasks and fills the bar from the first ten", () => {
    const subs = [sub("a", "done"), sub("b", "todo"), sub("c", "done")];
    expect(subtaskProgress(columns, subs)).toEqual({
      finished: 2,
      total: 3,
      barOn: 2,
      barTotal: 3,
    });
  });

  it("caps the bar at ten blocks while the count keeps every subtask", () => {
    const subs = Array.from({ length: 12 }, (_, index) =>
      sub(String(index), index < 11 ? "done" : "todo"),
    );
    expect(subtaskProgress(columns, subs)).toEqual({
      finished: 11,
      total: 12,
      barOn: 10,
      barTotal: 10,
    });
  });

  it("is empty without subtasks", () => {
    expect(subtaskProgress(columns, [])).toEqual({
      finished: 0,
      total: 0,
      barOn: 0,
      barTotal: 0,
    });
  });
});

describe("toggling a subtask", () => {
  it("finishes an open subtask into the done column", () => {
    expect(subtaskTarget(columns, false)?.id).toBe("done");
  });

  it("reopens a finished subtask into the first to-do column", () => {
    expect(subtaskTarget(columns, true)?.id).toBe("todo");
  });

  it("has no target without a done column", () => {
    expect(subtaskTarget([column("todo", "todo")], false)).toBeUndefined();
  });

  it("knows when finishing one subtask finishes them all", () => {
    const subs = [sub("a", "done"), sub("b", "todo")];
    expect(allSubtasksDoneWith(columns, subs, "b")).toBe(true);
    expect(allSubtasksDoneWith(columns, subs, "a")).toBe(false);
  });
});

describe("saving text", () => {
  it("does nothing when the text did not change", () => {
    expect(textSaveAction(item, "title", "Título")).toBe("none");
    expect(textSaveAction(item, "description", "Descrição")).toBe("none");
  });

  it("puts the old title back when it was emptied", () => {
    expect(textSaveAction(item, "title", "   ")).toBe("restore-title");
  });

  it("allows an empty description", () => {
    expect(textSaveAction(item, "description", "")).toBe("save");
  });

  it("saves a changed title", () => {
    expect(textSaveAction(item, "title", "Novo")).toBe("save");
  });

  it("builds the edit with the other field untouched", () => {
    expect(itemEdit(item, "title", "Novo")).toEqual({
      title: "Novo",
      description: "Descrição",
      priority: "high",
    });
    expect(itemEdit(item, "description", "Outra")).toEqual({
      title: "Título",
      description: "Outra",
      priority: "high",
    });
  });
});

describe("version conflicts", () => {
  it("recognises a 409 from the API", () => {
    expect(isVersionConflict({ status: 409 })).toBe(true);
  });

  it("ignores every other failure", () => {
    expect(isVersionConflict({ status: 500 })).toBe(false);
    expect(isVersionConflict(new Error("x"))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
    expect(isVersionConflict("409")).toBe(false);
  });
});
