import { Icon } from "../../design/icons";
import { Menu, useMenu } from "../../design/Menu";
import type { ProjectState } from "../../workspace";
import { ProjectDot } from "../ProjectDot";

export function ProjectPicker({
  projects,
  current,
  all,
  onPick,
}: {
  projects: ProjectState[];
  current: ProjectState | null;
  all: boolean;
  onPick: (projectId: string | null) => void;
}) {
  const menu = useMenu();
  const label = all
    ? "Todos os projetos"
    : (current?.project.name ?? "Projeto");
  return (
    <div className="wk-project-picker">
      <span>Projeto do quadro</span>
      <button
        aria-expanded={menu.state !== null}
        aria-label={`Projeto do quadro: ${label}`}
        className="wk-project-button"
        onClick={(event) => menu.toggle(event.currentTarget, undefined)}
        type="button"
      >
        {all || current === null ? (
          <Icon name="board" size="sm" />
        ) : (
          <ProjectDot color={current.project.color} />
        )}
        <span>{label}</span>
        <Icon name="down" size="sm" />
      </button>
      {menu.state === null ? null : (
        <Menu
          anchor={menu.state.anchor}
          className="wk-project-menu"
          label="Escolher projeto do quadro"
          onClose={menu.close}
        >
          {projects.length > 1 ? (
            <button
              aria-checked={all}
              onClick={() => {
                onPick(null);
                menu.close();
              }}
              role="menuitem"
              type="button"
            >
              <Icon name="board" size="sm" />
              <span>Todos os projetos</span>
              {all ? <Icon name="check" size="sm" /> : null}
            </button>
          ) : null}
          {projects.map((state) => (
            <button
              aria-checked={!all && current?.project.id === state.project.id}
              key={state.project.id}
              onClick={() => {
                onPick(state.project.id);
                menu.close();
              }}
              role="menuitem"
              type="button"
            >
              <ProjectDot color={state.project.color} />
              <span>{state.project.name}</span>
              {!all && current?.project.id === state.project.id ? (
                <Icon name="check" size="sm" />
              ) : null}
            </button>
          ))}
        </Menu>
      )}
    </div>
  );
}
