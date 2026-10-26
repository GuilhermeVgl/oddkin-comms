import { updateWorkItem, type WorkItem } from "@crewstead/api-client";
import { useCallback } from "react";
import { confirmDialog } from "../design/confirm";
import { celebrate } from "../design/celebrate";
import { celebrationSize } from "../design/gamify";
import { csrfToken } from "../errors";
import { isDone, useWorkspace, type ProjectState } from "../workspace";

type Patch = Parameters<typeof updateWorkItem>[3];

export function subtasksOf(state: ProjectState, item: WorkItem): WorkItem[] {
  return state.items.filter((entry) => entry.parentId === item.id);
}

/** Mutations on activities shared by the board, the list and the drawer. */
export function useItemActions() {
  const { client, run, applyItem } = useWorkspace();

  const patch = useCallback(
    (item: WorkItem, changes: Omit<Patch, "version">) =>
      run(async () => {
        const updated = await updateWorkItem(client, csrfToken(), item.id, {
          version: item.version,
          ...changes,
        });
        applyItem(updated);
        return updated;
      }),
    [client, run, applyItem],
  );

  /** Moves an activity; closing it asks what to do with open subtasks and celebrates. */
  const move = useCallback(
    async (
      state: ProjectState,
      item: WorkItem,
      columnId: string,
    ): Promise<boolean> => {
      const target = state.columns.find((column) => column.id === columnId);
      if (target === undefined || target.id === item.columnId) return false;
      const wasDone = isDone(state.columns, item.columnId);
      if (target.category === "done") {
        const open = subtasksOf(state, item).filter(
          (sub) => !isDone(state.columns, sub.columnId),
        );
        if (open.length > 0) {
          const ok = await confirmDialog({
            title: "Há subtarefas abertas",
            body: (
              <p className="muted">
                <b style={{ color: "var(--ink)" }}>{item.title}</b> ainda tem{" "}
                {open.length}{" "}
                {open.length === 1 ? "subtarefa aberta" : "subtarefas abertas"}.
                Concluir tudo de uma vez ou voltar?
              </p>
            ),
            ok: "Concluir todas",
            cancel: "Cancelar",
          });
          if (ok !== true) return false;
        }
      }
      const result = await patch(item, { columnId, completeSubtasks: true });
      if (result === undefined) return false;
      if (target.category === "done" && !wasDone) {
        const size = celebrationSize(
          item.priority,
          subtasksOf(state, item).length,
        );
        window.setTimeout(
          () =>
            celebrate(
              document.querySelector(`.wi[data-id="${item.id}"]`),
              size === "big",
            ),
          60,
        );
      }
      return true;
    },
    [patch],
  );

  /** The round check on a card: done goes back to the first open column, anything else to done. */
  const toggle = useCallback(
    async (state: ProjectState, item: WorkItem) => {
      const finished = isDone(state.columns, item.columnId);
      const target = finished
        ? (state.columns.find((column) => column.category === "todo") ??
          state.columns[0])
        : state.columns.find((column) => column.category === "done");
      if (target === undefined) return false;
      return move(state, item, target.id);
    },
    [move],
  );

  return { patch, move, toggle };
}
