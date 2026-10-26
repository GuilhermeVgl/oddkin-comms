import type { Sprint } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Menu } from "../../design/Menu";
import { nameOf } from "../../design/people";
import { useWorkspace } from "../../workspace";
import { board } from "./boardStore";
import { extraFilterCount } from "./workRules";

/** Assignee and sprint filters, plus the shortcut to manage epics. */
export function FilterMenu({
  anchor,
  members,
  sprints,
  canManageEpics,
  onClose,
  onManageEpics,
}: {
  anchor: HTMLElement;
  members: Map<string, string>;
  sprints: Sprint[];
  canManageEpics: boolean;
  onClose: () => void;
  onManageEpics: () => void;
}) {
  const { people } = useWorkspace();
  const prefs = board.use();
  return (
    <Menu
      anchor={anchor}
      className="filtermenu"
      focusFirst={false}
      onClose={onClose}
      right
    >
      <div className="field wk-pad">
        <label htmlFor="fa">Responsável</label>
        <select
          className="inp"
          id="fa"
          onChange={(event) => board.set({ assignee: event.target.value })}
          value={prefs.assignee}
        >
          <option value="">Qualquer responsável</option>
          <option value="none">Sem responsável</option>
          {[...members.entries()].map(([id, email]) => (
            <option key={id} value={id}>
              {nameOf(people.get(id)?.email ?? email)}
            </option>
          ))}
        </select>
      </div>
      <div className="field wk-pad">
        <label htmlFor="fs">Sprint</label>
        <select
          className="inp"
          id="fs"
          onChange={(event) => board.set({ sprint: event.target.value })}
          value={prefs.sprint}
        >
          <option value="">Qualquer sprint</option>
          <option value="backlog">Backlog</option>
          {sprints
            .filter((sprint) => sprint.state !== "closed")
            .map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
        </select>
      </div>
      {extraFilterCount(prefs) > 0 ? (
        <button
          onClick={() => board.set({ assignee: "", sprint: "" })}
          role="menuitem"
          type="button"
        >
          <Icon name="x" size="sm" />
          Limpar filtros
        </button>
      ) : null}
      {canManageEpics ? (
        <>
          <hr />
          <button
            onClick={() => {
              onClose();
              onManageEpics();
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="layers" size="sm" />
            Gerenciar épicos…
          </button>
        </>
      ) : null}
    </Menu>
  );
}
