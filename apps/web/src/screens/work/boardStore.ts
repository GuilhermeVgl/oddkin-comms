import { createStore } from "../../design/store";
import type { Scope, SortKey } from "./workRules";

/** Filters, view and sort order; kept across screens so coming back finds the same board. */
export const board = createStore({
  scope: "todas" as Scope,
  epic: "",
  prio: "",
  assignee: "",
  sprint: "",
  view: "quadro" as "quadro" | "lista",
  allProjects: false,
  sortKey: "due" as SortKey,
  sortDir: 1 as 1 | -1,
});
