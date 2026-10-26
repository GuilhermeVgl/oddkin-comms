import { updateWorkItem, type WorkItem } from "@crewstead/api-client";
import { useCallback } from "react";
import { blip } from "../design/sound";
import { toast } from "../design/toast";
import { createItem } from "../e2ee/content";
import { useWorkspace, type ProjectState } from "../workspace";

export type NewItemInput = {
  title: string;
  description?: string;
  assigneeId?: string;
  dueDate?: string;
  priority?: WorkItem["priority"];
  columnId?: string;
  /** Put the activity in this sprint right after creating it. */
  sprintId?: string;
};

/** Creates activities; shared by the inline "add" on a column and the full dialog. */
export function useQuickCreate() {
  const { client, run, account, sprints } = useWorkspace();
  const internal = account.membershipKind === "internal";

  const create = useCallback(
    async (
      state: ProjectState,
      input: NewItemInput,
    ): Promise<WorkItem | undefined> => {
      const { sprintId, ...fields } = input;
      const created = await run(async () => {
        const item = await createItem(client, state.crypto, state.project.id, {
          kind: "task",
          ...fields,
        });
        if (sprintId !== undefined && internal) {
          return updateWorkItem(client, item.id, {
            version: item.version,
            sprintId,
          });
        }
        return item;
      });
      if (created !== undefined) blip("ok");
      return created;
    },
    [client, run, internal],
  );

  const createQuick = useCallback(
    async (state: ProjectState, columnId: string, title: string) => {
      const active = sprints.find((sprint) => sprint.state === "active");
      const created = await create(state, {
        title,
        columnId,
        assigneeId: account.id,
        ...(active === undefined ? {} : { sprintId: active.id }),
      });
      if (created !== undefined) toast("Atividade criada.");
    },
    [create, account.id, sprints],
  );

  return { create, createQuick };
}
