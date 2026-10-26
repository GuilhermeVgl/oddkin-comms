import type { BoardColumn } from "@crewstead/api-client";
import { useState } from "react";
import { Icon } from "../../design/icons";
import { Banner } from "../../design/primitives";
import { useWorkspace, type ProjectState } from "../../workspace";
import { MoveColumnDialog } from "./MoveColumnDialog";
import { useColumnEditor } from "./useColumnEditor";
import { ProjectDot } from "../ProjectDot";

function ColumnsEditor({ state }: { state: ProjectState }) {
  const editor = useColumnEditor(state);
  const columns = state.columns;
  return (
    <>
      <section className="card pad cols-edit">
        <p className="muted sm st-mb8">
          A categoria é um metadado: é ela que diz ao sistema o que é
          “concluído”, não o texto que você escolhe.
        </p>
        {columns.map((column, index) => (
          <div className="row" key={column.id}>
            <button
              aria-label={`Subir ${column.name}`}
              className="iconbtn st-sq32"
              disabled={index === 0}
              onClick={() => void editor.move(index, -1)}
              type="button"
            >
              <Icon name="up" size="sm" />
            </button>
            <button
              aria-label={`Descer ${column.name}`}
              className="iconbtn st-sq32"
              disabled={index === columns.length - 1}
              onClick={() => void editor.move(index, 1)}
              type="button"
            >
              <Icon name="down" size="sm" />
            </button>
            <input
              aria-label={`Nome da coluna ${index + 1}`}
              className="inp grow st-h38"
              defaultValue={column.name}
              key={`${column.id}-${column.name}`}
              maxLength={60}
              onBlur={(event) => editor.rename(column, event.target)}
            />
            <select
              aria-label={`Categoria de ${column.name}`}
              className="inp st-cat"
              onChange={(event) =>
                editor.recategorize(
                  column,
                  event.target,
                  event.target.value as BoardColumn["category"],
                )
              }
              value={column.category}
            >
              <option value="todo">A fazer</option>
              <option value="in_progress">Em andamento</option>
              <option value="done">Concluída</option>
            </select>
            <span className="tag mute num" title="atividades nesta coluna">
              {editor.count(column)}
            </span>
            <button
              className="btn sm ghost"
              onClick={() => void editor.remove(column, index)}
              type="button"
            >
              <Icon name="trash" size="sm" />
              <span className="sr">Excluir {column.name}</span>
            </button>
          </div>
        ))}
        <div className="row st-mt10">
          <button className="btn" onClick={editor.add} type="button">
            <Icon name="plus" size="sm" />
            Nova coluna
          </button>
          <span className="xs muted">
            Mantenha ao menos uma coluna aberta e uma concluída.
          </span>
        </div>
        {editor.error === "" ? null : (
          <div className="st-mt10">
            <Banner kind="err" role="alert">
              {editor.error}
            </Banner>
          </div>
        )}
      </section>
      {editor.deleting === null ? null : (
        <MoveColumnDialog
          column={editor.deleting.column}
          held={editor.deleting.held}
          onFinish={editor.finishDelete}
          rest={editor.deleting.rest}
        />
      )}
    </>
  );
}

export function ColumnsTab() {
  const { projects } = useWorkspace();
  const managed = (projects ?? []).filter((state) => state.project.isManager);
  const [picked, setPicked] = useState(managed[0]?.project.id ?? "");
  const state =
    managed.find((entry) => entry.project.id === picked) ?? managed[0];

  if (state === undefined) {
    return (
      <Banner icon="lock">
        Somente quem gerencia um projeto altera as colunas do quadro.
      </Banner>
    );
  }
  const projectId = state.project.id;
  return (
    <div className="stack">
      <div aria-label="Projeto" className="pill-tabs" role="group">
        {managed.map((entry) => (
          <button
            aria-pressed={entry.project.id === projectId}
            className="pill"
            key={entry.project.id}
            onClick={() => setPicked(entry.project.id)}
            type="button"
          >
            <ProjectDot color={entry.project.color} />
            {entry.project.name}
          </button>
        ))}
      </div>
      <ColumnsEditor state={state} />
    </div>
  );
}
