import type { WorkItem, WorkItemComment } from "@crewstead/api-client";
import type { ContentStatus } from "../../e2ee/content";
import type { ProjectState } from "../../workspace";

/** The activity the drawer shows, with the project it belongs to. */
export type DrawerEntry = { item: WorkItem; state: ProjectState };

export type Comment = WorkItemComment & { status: ContentStatus };

/** Someone else saved the same field first; the person picks which text stays. */
export type Conflict = {
  field: "title" | "description";
  mine: string;
  theirs: string;
};
