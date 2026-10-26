import { isDone } from "../../columns";
import { fmtD } from "../../design/format";
import { Icon } from "../../design/icons";
import { firstNameOf } from "../../design/people";
import { Avatar, NoAvatar } from "../../design/primitives";
import { Sprite } from "../../design/Sprite";
import { useWorkspace } from "../../workspace";
import { subtasksOf } from "../itemActions";
import { PRIORITY_ICON, PRIORITY_LABEL } from "../priority";
import { board } from "./boardStore";
import { isLate, sortEntries, type Entry, type SortKey } from "./workRules";
import { ProjectDot } from "../ProjectDot";

function SortHead({ sortKey, label }: { sortKey: SortKey; label: string }) {
  const prefs = board.use();
  const active = prefs.sortKey === sortKey;
  return (
    <th
      aria-sort={
        active ? (prefs.sortDir > 0 ? "ascending" : "descending") : "none"
      }
      scope="col"
    >
      <button
        onClick={() =>
          board.set(
            active
              ? { sortDir: prefs.sortDir === 1 ? -1 : 1 }
              : { sortKey, sortDir: 1 },
          )
        }
        type="button"
      >
        {label}
        {active ? (
          <Icon name={prefs.sortDir > 0 ? "up" : "down"} size="sm" />
        ) : null}
      </button>
    </th>
  );
}

function ListRow({
  entry,
  showProject,
  onOpen,
}: {
  entry: Entry;
  showProject: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const { sprints, people } = useWorkspace();
  const { item, state } = entry;
  const done = isDone(state.columns, item.columnId);
  const late = isLate(item, done);
  const subs = subtasksOf(state, item);
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);
  const sprint = sprints.find((value) => value.id === item.sprintId);
  return (
    <tr
      onClick={() => onOpen(entry)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(entry);
        }
      }}
      tabIndex={0}
    >
      <td>
        <b className={done ? "u-semibold struck" : "u-semibold"}>
          {item.title}
        </b>
        {subs.length > 0 ? (
          <span className="xs muted num">
            {" "}
            · {subs.filter((sub) => isDone(state.columns, sub.columnId)).length}
            /{subs.length}
          </span>
        ) : null}
      </td>
      {showProject ? (
        <td>
          <span className="tag">
            <ProjectDot color={state.project.color} />
            {state.project.name}
          </span>
        </td>
      ) : null}
      <td>
        <span className="row gap8">
          {assignee === undefined ? (
            <>
              <NoAvatar size="sm" />
              <span className="muted">Sem responsável</span>
            </>
          ) : (
            <>
              <Avatar email={assignee.email} id={assignee.id} size="sm" />
              {firstNameOf(assignee.email)}
            </>
          )}
        </span>
      </td>
      <td>
        <span className={`tag ${done ? "lime" : "mute"}`}>
          {state.columns.find((column) => column.id === item.columnId)?.name}
        </span>
      </td>
      <td>
        <span className={`prio ${item.priority}`}>
          <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
          {PRIORITY_LABEL[item.priority]}
        </span>
      </td>
      <td className={late ? "wk-late" : undefined}>
        {item.dueDate === undefined ? (
          <span className="muted">—</span>
        ) : (
          `${late ? "Atrasada · " : ""}${fmtD(item.dueDate)}`
        )}
      </td>
      <td>
        {sprint === undefined ? (
          <span className="muted">Backlog</span>
        ) : (
          sprint.name
        )}
      </td>
    </tr>
  );
}

export function ListView({
  entries,
  showProject,
  onOpen,
}: {
  entries: Entry[];
  showProject: boolean;
  onOpen: (entry: Entry) => void;
}) {
  const prefs = board.use();
  const sorted = sortEntries(entries, prefs.sortKey, prefs.sortDir);
  return (
    <div className="wk-list">
      <div className="card wk-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <SortHead label="Atividade" sortKey="title" />
              {showProject ? <SortHead label="Projeto" sortKey="p" /> : null}
              <th scope="col">Responsável</th>
              <SortHead label="Estado" sortKey="st" />
              <SortHead label="Prioridade" sortKey="prio" />
              <SortHead label="Prazo" sortKey="due" />
              <th scope="col">Sprint</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <ListRow
                entry={entry}
                key={entry.item.id}
                onOpen={onOpen}
                showProject={showProject}
              />
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <div className="emp-sp2">
                      <Sprite pose="sleep" scale={3} who="capuz" />
                    </div>
                    <h3>Nada por aqui</h3>
                    <p>Nenhuma atividade combina com os filtros atuais.</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
