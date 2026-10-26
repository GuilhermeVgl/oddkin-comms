import { useState } from "react";
import { isDone } from "../../columns";
import { fmtD } from "../../design/format";
import { Icon } from "../../design/icons";
import { Pbar } from "../../design/primitives";
import { can, useWorkspace } from "../../workspace";
import { subtasksOf } from "../itemActions";
import { subtaskProgress } from "./derive";
import { PersonAvatar } from "./PropertyTiles";
import type { DrawerEntry } from "./types";
import { useSubtaskActions } from "./useSubtaskActions";

/** Subtasks with their progress, the checkbox of each and a form to add another. */
export function SubtaskList({
  entry,
  readable,
  canMove,
}: {
  entry: DrawerEntry;
  readable: boolean;
  canMove: boolean;
}) {
  const { item, state } = entry;
  const { people } = useWorkspace();
  const [draft, setDraft] = useState("");
  const subs = subtasksOf(state, item);
  const progress = subtaskProgress(state.columns, subs);
  const { toggle, add } = useSubtaskActions(entry, subs);

  return (
    <section aria-labelledby="sth">
      <div className="row dr-sub-head">
        <h3 className="h2" id="sth">
          Subtarefas
        </h3>
        <span className="xs muted num">
          {progress.finished}/{progress.total}
        </span>
        <Pbar block={8} on={progress.barOn} total={progress.barTotal} />
      </div>
      <div className="col">
        {subs.map((sub) => {
          const subDone = isDone(state.columns, sub.columnId);
          const owner =
            sub.assigneeId === undefined
              ? undefined
              : people.get(sub.assigneeId);
          return (
            <div className="row dr-sub" key={sub.id}>
              <button
                aria-checked={subDone}
                aria-label={`Concluir subtarefa ${sub.title}`}
                className="chk sq"
                disabled={!canMove}
                onClick={(event) => void toggle(sub, event.currentTarget)}
                role="checkbox"
                type="button"
              >
                <Icon name="check" />
              </button>
              <span className={subDone ? "grow dr-sub-done" : "grow"}>
                {sub.title}
              </span>
              {sub.dueDate === undefined ? null : (
                <span className="xs muted">
                  <Icon name="cal" size="sm" /> {fmtD(sub.dueDate)}
                </span>
              )}
              <PersonAvatar person={owner} />
            </div>
          );
        })}
        {can(state, "work.create") && readable ? (
          <form
            className="row dr-sub-add"
            onSubmit={(event) => {
              event.preventDefault();
              const value = draft.trim();
              if (value === "") return;
              void add(value, () => setDraft(""));
            }}
          >
            <input
              aria-label="Nova subtarefa"
              className="inp"
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Adicionar subtarefa"
              value={draft}
            />
            <button className="btn sm" type="submit">
              <Icon name="plus" size="sm" />
              Adicionar
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
