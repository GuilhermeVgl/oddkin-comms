import { updateEpic } from "@crewstead/api-client";
import { useState } from "react";
import { isDone } from "../../columns";
import { Icon } from "../../design/icons";
import { Modal } from "../../design/Modal";
import { Pbar } from "../../design/primitives";
import { createEpicContent } from "../../e2ee/content";
import { csrfToken } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";

export function EpicsDialog({
  state,
  onClose,
}: {
  state: ProjectState;
  onClose: () => void;
}) {
  const { client, run } = useWorkspace();
  const [title, setTitle] = useState("");
  const tasks = state.items.filter((item) => item.kind === "task");
  return (
    <Modal onClose={onClose} width="560px">
      <div className="dh">
        <h2 id="dlgt">Épicos · {state.project.name}</h2>
      </div>
      <div className="dbd col gap12">
        {state.epics.length === 0 ? (
          <p className="muted">Nenhum épico ainda.</p>
        ) : null}
        {state.epics.map((epic) => {
          const linked = tasks.filter((task) => task.epicId === epic.id);
          const finished = linked.filter((task) =>
            isDone(state.columns, task.columnId),
          ).length;
          return (
            <div className="list-i" key={epic.id}>
              <div className="grow col">
                <b>{epic.title}</b>
                <span className="xs muted">
                  {finished}/{linked.length} atividades
                  {epic.done ? " · concluído" : ""}
                </span>
              </div>
              <Pbar
                on={
                  linked.length > 0
                    ? Math.round((finished / linked.length) * 10)
                    : 0
                }
                total={10}
              />
              <button
                className="btn sm"
                onClick={() =>
                  void run(() =>
                    updateEpic(client, csrfToken(), epic.id, {
                      version: epic.version,
                      done: !epic.done,
                    }),
                  )
                }
                type="button"
              >
                {epic.done ? "Reabrir" : "Concluir"}
              </button>
            </div>
          );
        })}
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (value === "") return;
            void run(async () => {
              await createEpicContent(
                client,
                csrfToken(),
                state.crypto,
                state.project.id,
                value,
              );
              setTitle("");
            });
          }}
        >
          <input
            aria-label="Novo épico"
            className="inp"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Novo épico"
            value={title}
          />
          <button className="btn" type="submit">
            <Icon name="plus" size="sm" />
            Criar épico
          </button>
        </form>
      </div>
      <div className="dft">
        <button className="btn primary" onClick={onClose} type="button">
          Fechar
        </button>
      </div>
    </Modal>
  );
}
