import { Icon } from "../../design/icons";
import type { useMenu } from "../../design/Menu";
import type { ProjectState } from "../../workspace";
import { PRIORITY_LABEL } from "../priority";
import { board } from "./boardStore";
import { extraFilterCount, type Scope } from "./workRules";
import { ProjectDot } from "../ProjectDot";

const SCOPES: readonly (readonly [Scope, string])[] = [
  ["todas", "Todas"],
  ["minhas", "Minhas"],
  ["semana", "Esta semana"],
];

export function FiltersBar({
  projects,
  current,
  epics,
  list,
  all,
  filterMenu,
  onPickProject,
}: {
  projects: ProjectState[];
  current: ProjectState | null;
  epics: { id: string; title: string }[];
  list: boolean;
  all: boolean;
  filterMenu: ReturnType<typeof useMenu<undefined>>;
  onPickProject: (projectId: string) => void;
}) {
  const prefs = board.use();
  const extraFilters = extraFilterCount(prefs);
  return (
    <div aria-label="Filtros" className="toolbar" role="toolbar">
      <div aria-label="Escopo" className="pill-tabs" role="group">
        {SCOPES.map(([key, label]) => (
          <button
            aria-pressed={prefs.scope === key}
            className="pill"
            key={key}
            onClick={() => board.set({ scope: key })}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <span className="sep wk-vsep" />
      <div aria-label="Projeto" className="pill-tabs" role="group">
        {list && projects.length > 1 ? (
          <button
            aria-pressed={all}
            className="pill"
            onClick={() => board.set({ allProjects: true, epic: "" })}
            type="button"
          >
            Todos
          </button>
        ) : null}
        {projects.map((state) => (
          <button
            aria-pressed={!all && current?.project.id === state.project.id}
            className="pill"
            key={state.project.id}
            onClick={() => {
              board.set({ allProjects: false, epic: "" });
              onPickProject(state.project.id);
            }}
            type="button"
          >
            <ProjectDot color={state.project.color} />
            {state.project.name}
          </button>
        ))}
      </div>
      <label className="sr" htmlFor="fe">
        Épico
      </label>
      <select
        className="inp wk-auto"
        id="fe"
        onChange={(event) => board.set({ epic: event.target.value })}
        value={prefs.epic}
      >
        <option value="">Todos os épicos</option>
        {epics.map((epic) => (
          <option key={epic.id} value={epic.id}>
            {epic.title}
          </option>
        ))}
      </select>
      <label className="sr" htmlFor="fp">
        Prioridade
      </label>
      <select
        className="inp wk-auto"
        id="fp"
        onChange={(event) => board.set({ prio: event.target.value })}
        value={prefs.prio}
      >
        <option value="">Qualquer prioridade</option>
        {(Object.keys(PRIORITY_LABEL) as (keyof typeof PRIORITY_LABEL)[]).map(
          (key) => (
            <option key={key} value={key}>
              {PRIORITY_LABEL[key]}
            </option>
          ),
        )}
      </select>
      <button
        aria-expanded={filterMenu.state !== null}
        className="btn wk-h38"
        onClick={(event) => filterMenu.toggle(event.currentTarget, undefined)}
        type="button"
      >
        <Icon name="filter" size="sm" />
        Filtros{extraFilters > 0 ? ` · ${extraFilters}` : ""}
      </button>
      <div className="grow" />
      <div aria-label="Visualização" className="seg" role="group">
        <button
          aria-pressed={!list}
          onClick={() => board.set({ view: "quadro", allProjects: false })}
          type="button"
        >
          <Icon name="board" size="sm" />
          Quadro
        </button>
        <button
          aria-pressed={list}
          onClick={() => board.set({ view: "lista" })}
          type="button"
        >
          <Icon name="list" size="sm" />
          Lista
        </button>
      </div>
    </div>
  );
}
