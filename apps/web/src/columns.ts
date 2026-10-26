import type { BoardColumn } from "@crewstead/api-client";

/** Which column a card lands in, by the category each column carries. */

export function isDone(columns: BoardColumn[], columnId: string): boolean {
  return columns.find((column) => column.id === columnId)?.category === "done";
}

/** Where finished work goes. */
export function doneColumn(columns: BoardColumn[]): BoardColumn | undefined {
  return columns.find((column) => column.category === "done");
}

/** Where a new or reopened-from-scratch card starts: the first "to do" column. */
export function startColumn(columns: BoardColumn[]): BoardColumn | undefined {
  return columns.find((column) => column.category === "todo") ?? columns[0];
}

/** Where a finished card goes when it is reopened: back to work, not to the start. */
export function reopenColumn(columns: BoardColumn[]): BoardColumn | undefined {
  return (
    columns.find((column) => column.category === "in_progress") ?? columns[0]
  );
}
