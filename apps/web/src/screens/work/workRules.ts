import type { WorkItem } from "@crewstead/api-client";
import { isDone } from "../../columns";
import { daysTo } from "../../design/format";
import type { SpringState } from "../../design/spring";
import type { ProjectState } from "../../workspace";

export type Scope = "todas" | "minhas" | "semana";
export type SortKey = "due" | "title" | "prio" | "p" | "st";

export type Filters = {
  scope: Scope;
  epic: string;
  prio: string;
  assignee: string;
  sprint: string;
};

export type Entry = { item: WorkItem; state: ProjectState };

type DaysTo = (iso: string) => number;

/** Every task (subtasks are shown inside their task) of the given projects. */
export function taskEntries(states: ProjectState[]): Entry[] {
  return states.flatMap((state) =>
    state.items
      .filter((item) => item.kind === "task")
      .map((item) => ({ item, state })),
  );
}

/** Applies the toolbar and popover filters; `days` is injectable for tests. */
export function filterEntries(
  entries: Entry[],
  filters: Filters,
  accountId: string,
  days: DaysTo = daysTo,
): Entry[] {
  let rows = entries;
  if (filters.scope === "minhas")
    rows = rows.filter(({ item }) => item.assigneeId === accountId);
  if (filters.scope === "semana")
    rows = rows.filter(
      ({ item, state }) =>
        item.dueDate !== undefined &&
        days(item.dueDate) <= 7 &&
        !isDone(state.columns, item.columnId),
    );
  if (filters.epic !== "")
    rows = rows.filter(({ item }) => item.epicId === filters.epic);
  if (filters.prio !== "")
    rows = rows.filter(({ item }) => item.priority === filters.prio);
  if (filters.assignee === "none")
    rows = rows.filter(({ item }) => item.assigneeId === undefined);
  else if (filters.assignee !== "")
    rows = rows.filter(({ item }) => item.assigneeId === filters.assignee);
  if (filters.sprint === "backlog")
    rows = rows.filter(({ item }) => item.sprintId === undefined);
  else if (filters.sprint !== "")
    rows = rows.filter(({ item }) => item.sprintId === filters.sprint);
  return rows;
}

const PRIORITY_ORDER = ["urgent", "high", "normal", "low"];

function sortKeyOf(entry: Entry, key: SortKey): string | number {
  const { item, state } = entry;
  switch (key) {
    case "due":
      return item.dueDate ?? "9999";
    case "title":
      return item.title.toLowerCase();
    case "prio":
      return PRIORITY_ORDER.indexOf(item.priority);
    case "p":
      return state.project.name;
    case "st":
      return state.columns.findIndex((column) => column.id === item.columnId);
  }
}

/** A sorted copy for the list view; the input is left alone. */
export function sortEntries(
  entries: Entry[],
  key: SortKey,
  dir: 1 | -1,
): Entry[] {
  return [...entries].sort(
    (left, right) =>
      (sortKeyOf(left, key) > sortKeyOf(right, key) ? 1 : -1) * dir,
  );
}

/** How many of the popover's filters (assignee, sprint) are set. */
export function extraFilterCount(
  filters: Pick<Filters, "assignee" | "sprint">,
): number {
  return (filters.assignee === "" ? 0 : 1) + (filters.sprint === "" ? 0 : 1);
}

/** A deep link to an activity: the item and the project that holds it. */
export function findItemTarget(
  projects: ProjectState[] | null,
  itemId: string | null,
): Entry | null {
  if (itemId === null) return null;
  for (const state of projects ?? []) {
    const item = state.items.find((value) => value.id === itemId);
    if (item !== undefined) return { item, state };
  }
  return null;
}

export function isLate(
  item: WorkItem,
  done: boolean,
  days: DaysTo = daysTo,
): boolean {
  return item.dueDate !== undefined && days(item.dueDate) < 0 && !done;
}

const DRAG_THRESHOLD_PX = 6;
const EDGE_PX = 60;
const SCROLL_STEP_PX = 14;

/** Whether the pointer moved far enough from where it went down to count as a drag. */
export function pastDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

export function canStartDrag(press: {
  button: number;
  pointerType: string;
  onControl: boolean;
}): boolean {
  return (
    press.button === 0 && press.pointerType !== "touch" && !press.onControl
  );
}

/** Index of the column whose horizontal span holds the pointer, or -1. */
export function columnIndexAt(
  rects: { left: number; right: number }[],
  clientX: number,
): number {
  return rects.findIndex(
    (rect) => clientX >= rect.left && clientX <= rect.right,
  );
}

/** Slot a dragged card would take: before the first card whose middle is below the pointer. */
export function dropIndex(
  cards: { top: number; height: number }[],
  clientY: number,
): number {
  const found = cards.findIndex((box) => clientY < box.top + box.height / 2);
  return found === -1 ? cards.length : found;
}

/** How far to scroll the board sideways while dragging near its edges. */
export function scrollDelta(
  clientX: number,
  bounds: { left: number; right: number },
): number {
  return (
    (clientX > bounds.right - EDGE_PX ? SCROLL_STEP_PX : 0) +
    (clientX < bounds.left + EDGE_PX ? -SCROLL_STEP_PX : 0)
  );
}

export function ghostTransform(spring: SpringState, leanDegrees: number) {
  return `translate3d(${spring.x}px, ${spring.y}px, 0) rotate(${leanDegrees}deg) scale(1.04)`;
}
