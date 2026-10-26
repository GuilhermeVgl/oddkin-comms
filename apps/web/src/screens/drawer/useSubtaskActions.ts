import type { WorkItem } from "@crewstead/api-client";
import { doneColumn, isDone, reopenColumn } from "../../columns";
import { blip } from "../../design/sound";
import { burst } from "../../design/sprites";
import { toast } from "../../design/toast";
import { createItem } from "../../e2ee/content";
import { useWorkspace } from "../../workspace";
import { useItemActions } from "../itemActions";
import { allSubtasksDoneWith, subtaskTarget } from "./derive";
import type { DrawerEntry } from "./types";

/** Checking a subtask off (with its side effects on the parent) and adding a new one. */
export function useSubtaskActions(
  { item, state }: DrawerEntry,
  subs: WorkItem[],
) {
  const { client, run } = useWorkspace();
  const { patch, move } = useItemActions();
  const done = isDone(state.columns, item.columnId);

  async function toggle(sub: WorkItem, el: HTMLElement) {
    const wasDone = isDone(state.columns, sub.columnId);
    const target = subtaskTarget(state.columns, wasDone);
    if (target === undefined) return;
    const result = await patch(sub, { columnId: target.id });
    if (result === undefined) return;
    if (!wasDone) {
      const box = el.getBoundingClientRect();
      burst(box.left + 11, box.top + 11, { count: 12, power: 4, size: 3 });
      blip("ok");
      if (allSubtasksDoneWith(state.columns, subs, sub.id) && !done) {
        const finish = doneColumn(state.columns)?.id ?? item.columnId;
        toast("Todas as subtarefas concluídas.", {
          act: ["Concluir atividade", () => void move(state, item, finish)],
        });
      }
    } else if (done) {
      const reopen = reopenColumn(state.columns);
      if (reopen !== undefined) {
        await patch(item, { columnId: reopen.id });
        toast(
          "Atividade reaberta porque uma subtarefa voltou a ficar aberta.",
          {
            icon: "rot",
          },
        );
      }
    }
  }

  /** Creates a subtask assigned to the same person; `onAdded` runs once it exists. */
  function add(title: string, onAdded: () => void) {
    return run(async () => {
      await createItem(client, state.crypto, state.project.id, {
        kind: "subtask",
        parentId: item.id,
        title,
        ...(item.assigneeId === undefined
          ? {}
          : { assigneeId: item.assigneeId }),
      });
      onAdded();
    });
  }

  return { toggle, add };
}
