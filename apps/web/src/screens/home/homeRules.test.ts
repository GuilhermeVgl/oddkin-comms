import type { BoardColumn, WorkItem } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import type { ProjectState } from "../../workspace";
import { taskEntries, type Entry } from "../work/workRules";
import {
  byDue,
  countOpenToday,
  countUpcoming,
  myQueue,
  recentActivity,
} from "./homeRules";

const columns = [
  { id: "todo", category: "todo" },
  { id: "doing", category: "in_progress" },
  { id: "done", category: "done" },
] as BoardColumn[];

const item = (id: string, patch: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    kind: "task",
    columnId: "todo",
    updatedAt: "2026-01-01T00:00:00Z",
    ...patch,
  }) as WorkItem;

const entries: Entry[] = [];

const withItems = (items: WorkItem[]) =>
  taskEntries([{ project: { id: "p" }, columns, items } as ProjectState]);

describe("byDue", () => {
  it("orders by date and puts undated work last", () => {
    const sorted = [
      item("none"),
      item("late", { dueDate: "2026-03-01" }),
      item("early", { dueDate: "2026-01-01" }),
    ].sort(byDue);
    expect(sorted.map((entry) => entry.id)).toEqual(["early", "late", "none"]);
  });
  it("treats two undated items as equal", () => {
    expect(byDue(item("a"), item("b"))).toBe(0);
  });
});

describe("myQueue", () => {
  it("keeps open work assigned to the person, soonest first", () => {
    const queue = myQueue(
      withItems([
        item("x", { assigneeId: "me", dueDate: "2026-02-01" }),
        item("y", { assigneeId: "me", dueDate: "2026-01-01" }),
        item("z", { assigneeId: "me", columnId: "done" }),
        item("w", { assigneeId: "other" }),
      ]),
      "me",
    );
    expect(queue.map((entry) => entry.item.id)).toEqual(["y", "x"]);
  });
  it("is empty without entries", () => {
    expect(myQueue(entries, "me")).toEqual([]);
  });
});

describe("countOpenToday", () => {
  it("counts work due today or earlier and work already in progress", () => {
    const queue = withItems([
      item("overdue", { dueDate: "2026-06-01" }),
      item("today", { dueDate: "2026-06-10" }),
      item("later", { dueDate: "2026-06-20" }),
      item("doing", { columnId: "doing" }),
      item("idle"),
    ]);
    expect(countOpenToday(queue, "2026-06-10")).toBe(3);
  });
});

describe("countUpcoming", () => {
  it("counts items due within three days, overdue included", () => {
    const queue = withItems([
      item("a", { dueDate: "2026-06-11" }),
      item("b", { dueDate: "2026-06-30" }),
      item("c"),
    ]);
    const days = (iso: string) =>
      Math.round((Date.parse(iso) - Date.parse("2026-06-10")) / 864e5);
    expect(countUpcoming(queue, days)).toBe(1);
  });
});

describe("recentActivity", () => {
  it("returns the most recently updated first, capped", () => {
    const feed = recentActivity(
      withItems([
        item("old", { updatedAt: "2026-01-01T00:00:00Z" }),
        item("new", { updatedAt: "2026-03-01T00:00:00Z" }),
        item("mid", { updatedAt: "2026-02-01T00:00:00Z" }),
      ]),
      2,
    );
    expect(feed.map((entry) => entry.item.id)).toEqual(["new", "mid"]);
  });
});
