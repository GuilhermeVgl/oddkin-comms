import type { WorkItem } from "@crewstead/api-client";
import { isDone } from "../../columns";
import { daysTo } from "../../design/format";
import type { Entry } from "../work/workRules";

/** Soonest due date first; work without a date goes last. */
export function byDue(left: WorkItem, right: WorkItem): number {
  if (left.dueDate === undefined && right.dueDate === undefined) return 0;
  if (left.dueDate === undefined) return 1;
  if (right.dueDate === undefined) return -1;
  return left.dueDate.localeCompare(right.dueDate);
}

/** Open work assigned to the person, soonest due first. */
export function myQueue(entries: Entry[], accountId: string): Entry[] {
  return entries
    .filter(
      ({ item, state }) =>
        item.assigneeId === accountId && !isDone(state.columns, item.columnId),
    )
    .sort((left, right) => byDue(left.item, right.item));
}

/** Work that is due today (or overdue) or already in progress. */
export function countOpenToday(queue: Entry[], today: string): number {
  return queue.filter(
    ({ item, state }) =>
      (item.dueDate !== undefined && item.dueDate <= today) ||
      state.columns.find((column) => column.id === item.columnId)?.category ===
        "in_progress",
  ).length;
}

/** Work due within three days, overdue included. */
export function countUpcoming(
  queue: Entry[],
  days: (iso: string) => number = daysTo,
): number {
  return queue.filter(
    ({ item }) => item.dueDate !== undefined && days(item.dueDate) <= 3,
  ).length;
}

/** The most recently updated work, newest first. */
export function recentActivity(entries: Entry[], limit: number): Entry[] {
  return [...entries]
    .sort((left, right) =>
      right.item.updatedAt.localeCompare(left.item.updatedAt),
    )
    .slice(0, limit);
}
