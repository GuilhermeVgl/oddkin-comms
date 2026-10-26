import {
  createBoardColumn,
  deleteBoardColumn,
  reorderBoardColumns,
  updateBoardColumn,
  type BoardColumn,
} from "@crewstead/api-client";
import { useState } from "react";
import { blip } from "../../design/sound";
import { toast } from "../../design/toast";
import { useWorkspace, type ProjectState } from "../../workspace";
import {
  columnOrderAfterMove,
  countTasksIn,
  hasOpenAndDone,
  withCategory,
} from "./settingsRules";

export type PendingDelete = {
  column: BoardColumn;
  rest: BoardColumn[];
  held: number;
};

/** Everything the column editor does to one project's columns. */
export function useColumnEditor(state: ProjectState) {
  const { client, run } = useWorkspace();
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<PendingDelete | null>(null);
  const projectId = state.project.id;
  const columns = state.columns;
  const count = (column: BoardColumn) => countTasksIn(state.items, column.id);

  /** Runs a mutation that returns nothing and tells whether it worked. */
  const ok = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      return true;
    });

  async function move(index: number, by: -1 | 1) {
    const order = columnOrderAfterMove(columns, index, by);
    if (order === null) return;
    await ok(() => reorderBoardColumns(client, projectId, order));
  }

  async function remove(column: BoardColumn, index: number) {
    const rest = columns.filter((_, position) => position !== index);
    if (!hasOpenAndDone(rest)) {
      setError(
        "Não dá para excluir: o quadro ficaria sem coluna aberta ou sem coluna concluída.",
      );
      blip("err");
      return;
    }
    setError("");
    const held = count(column);
    if (held === 0) {
      if (
        (await ok(() => deleteBoardColumn(client, projectId, column.id))) !==
        undefined
      )
        toast("Coluna excluída.");
      return;
    }
    setDeleting({ column, rest, held });
  }

  function rename(column: BoardColumn, input: HTMLInputElement) {
    const value = input.value.trim();
    if (value === "" || value === column.name) {
      input.value = column.name;
      return;
    }
    void ok(() =>
      updateBoardColumn(client, projectId, column.id, {
        name: value,
      }),
    ).then(
      (done) => done !== undefined && toast("Coluna renomeada.", { ms: 1400 }),
    );
  }

  function recategorize(
    column: BoardColumn,
    select: HTMLSelectElement,
    category: BoardColumn["category"],
  ) {
    if (!hasOpenAndDone(withCategory(columns, column.id, category))) {
      setError(
        "Cada quadro precisa de ao menos uma coluna aberta e uma concluída.",
      );
      select.value = column.category;
      blip("err");
      return;
    }
    setError("");
    const held = count(column);
    void ok(() =>
      updateBoardColumn(client, projectId, column.id, {
        category,
      }),
    ).then(
      (done) =>
        done !== undefined &&
        toast(
          held > 0
            ? `Categoria alterada. ${held} atividades afetadas, sem celebração em massa.`
            : "Categoria alterada.",
          { icon: "info" },
        ),
    );
  }

  function add() {
    void ok(() =>
      createBoardColumn(client, projectId, {
        name: "Nova coluna",
        category: "in_progress",
      }),
    );
  }

  function finishDelete(target: string | null) {
    const pending = deleting;
    setDeleting(null);
    if (target === null || pending === null) return;
    void ok(() =>
      deleteBoardColumn(client, projectId, pending.column.id, target),
    ).then(
      (done) =>
        done !== undefined &&
        toast(`${pending.held} atividades movidas. Nenhuma ficou órfã.`, {
          icon: "check",
        }),
    );
  }

  return {
    error,
    deleting,
    count,
    move,
    remove,
    rename,
    recategorize,
    add,
    finishDelete,
  };
}
