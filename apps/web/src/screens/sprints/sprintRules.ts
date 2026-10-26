import type { Sprint } from "@crewstead/api-client";
import { isDone } from "../../columns";
import type { Entry } from "../work/workRules";

/** A task together with the project that holds it. */
export type Row = Entry;

export type Choice = "next" | "backlog";

export function rowsOfSprint(rows: Row[], sprintId: string): Row[] {
  return rows.filter(({ item }) => item.sprintId === sprintId);
}

export function doneCount(rows: Row[]): number {
  return rows.filter(({ item, state }) => isDone(state.columns, item.columnId))
    .length;
}

/** Unplanned work that is not finished yet. */
export function backlogRows(rows: Row[]): Row[] {
  return rows.filter(
    ({ item, state }) =>
      item.sprintId === undefined && !isDone(state.columns, item.columnId),
  );
}

export function groupByProject(rows: Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    groups.set(row.state.project.id, [
      ...(groups.get(row.state.project.id) ?? []),
      row,
    ]);
  }
  return groups;
}

export function splitSprints(sprints: Sprint[]): {
  active: Sprint | undefined;
  planned: Sprint[];
  closed: Sprint[];
} {
  return {
    active: sprints.find((sprint) => sprint.state === "active"),
    planned: sprints.filter((sprint) => sprint.state === "planned"),
    closed: sprints.filter((sprint) => sprint.state === "closed"),
  };
}

/** Calendar days a sprint spans, both ends included; at least one. */
export function sprintLengthDays(startsOn: string, endsOn: string): number {
  const started = new Date(`${startsOn}T12:00:00`).getTime();
  const ended = new Date(`${endsOn}T12:00:00`).getTime();
  return Math.max(1, Math.round((ended - started) / 864e5) + 1);
}

/** Where pending work goes unless the person says otherwise. */
export function initialChoices(
  pending: { id: string }[],
  hasPlanned: boolean,
): Record<string, Choice> {
  return Object.fromEntries(
    pending.map((item) => [item.id, hasPlanned ? "next" : "backlog"] as const),
  );
}

export function countChoice(
  choices: Record<string, Choice>,
  which: Choice,
): number {
  return Object.values(choices).filter((value) => value === which).length;
}

/** One decision per pending item, with the version this person saw. */
export function closeDecisions(
  pending: { id: string; version: number }[],
  choices: Record<string, Choice>,
): { workItemId: string; version: number; destination: Choice }[] {
  return pending.map((item) => ({
    workItemId: item.id,
    version: item.version,
    destination: choices[item.id] ?? "backlog",
  }));
}

/** Whether a failed request was refused because someone changed the data meanwhile. */
export function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 409
  );
}

/** The message for an impossible date range, or an empty string. */
export function sprintDatesError(starts: string, ends: string): string {
  return starts > ends ? "O início não pode ser posterior ao fim." : "";
}
