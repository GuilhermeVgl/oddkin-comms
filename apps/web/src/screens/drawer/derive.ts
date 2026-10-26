import type { BoardColumn, WorkItem } from "@crewstead/api-client";
import { doneColumn, isDone, startColumn } from "../../columns";

export type SubtaskProgress = {
  finished: number;
  total: number;
  /** Blocks lit in the progress bar, which shows at most the first ten subtasks. */
  barOn: number;
  barTotal: number;
};

const BAR_BLOCKS = 10;

export function subtaskProgress(
  columns: BoardColumn[],
  subs: WorkItem[],
): SubtaskProgress {
  const finishedOf = (list: WorkItem[]) =>
    list.filter((sub) => isDone(columns, sub.columnId)).length;
  return {
    finished: finishedOf(subs),
    total: subs.length,
    barOn: finishedOf(subs.slice(0, BAR_BLOCKS)),
    barTotal: Math.min(BAR_BLOCKS, subs.length),
  };
}

/** Where a subtask goes when its checkbox is toggled. */
export function subtaskTarget(
  columns: BoardColumn[],
  wasDone: boolean,
): BoardColumn | undefined {
  return wasDone ? startColumn(columns) : doneColumn(columns);
}

/** Whether every subtask is finished once `finishedId` is. */
export function allSubtasksDoneWith(
  columns: BoardColumn[],
  subs: WorkItem[],
  finishedId: string,
): boolean {
  return subs.every(
    (value) => value.id === finishedId || isDone(columns, value.columnId),
  );
}

export type TextField = "title" | "description";

/** What leaving a text field means: nothing, restore an emptied title, or save. */
export function textSaveAction(
  item: WorkItem,
  field: TextField,
  value: string,
): "none" | "restore-title" | "save" {
  const current = field === "title" ? item.title : item.description;
  if (value === current) return "none";
  if (field === "title" && value.trim() === "") return "restore-title";
  return "save";
}

/** The text edit sent to the server: one field changes, the other stays. */
export function itemEdit(item: WorkItem, field: TextField, value: string) {
  return {
    title: field === "title" ? value : item.title,
    description: field === "description" ? value : item.description,
    priority: item.priority,
  };
}

/** Whether the server refused a write because someone else saved first. */
export function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409
  );
}
