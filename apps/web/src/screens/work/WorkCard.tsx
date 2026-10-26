import { isDone } from "../../columns";
import { fmtD } from "../../design/format";
import { Icon } from "../../design/icons";
import { firstNameOf } from "../../design/people";
import { Avatar, NoAvatar } from "../../design/primitives";
import { useWorkspace } from "../../workspace";
import { subtasksOf } from "../itemActions";
import { PRIORITY_ICON, PRIORITY_LABEL } from "../priority";
import { isLate, type Entry } from "./workRules";
import { ProjectDot } from "../ProjectDot";

export function WorkCard({
  entry,
  onOpen,
  onToggle,
  onMenu,
  onDragStart,
  dragging,
  canMove,
}: {
  entry: Entry;
  onOpen: () => void;
  onToggle: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onDragStart: (event: React.PointerEvent<HTMLElement>) => void;
  dragging: boolean;
  canMove: boolean;
}) {
  const { item, state } = entry;
  const { people } = useWorkspace();
  const done = isDone(state.columns, item.columnId);
  const subs = subtasksOf(state, item);
  const finished = subs.filter((sub) =>
    isDone(state.columns, sub.columnId),
  ).length;
  const late = isLate(item, done);
  const epic =
    item.epicId === undefined
      ? null
      : state.epics.find((value) => value.id === item.epicId);
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);
  const column = state.columns.find((value) => value.id === item.columnId);
  return (
    <article
      aria-label={`${item.title}, ${column?.name ?? ""}`}
      className={`wi${done ? " done" : ""}${canMove ? "" : " ro"}${dragging ? " dragging" : ""}`}
      data-id={item.id}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
        if (event.key.toLowerCase() === "m") {
          event.currentTarget
            .querySelector<HTMLElement>("[data-cardmenu]")
            ?.click();
        }
      }}
      onPointerDown={onDragStart}
      tabIndex={0}
    >
      <div className="r1">
        <span className="tag">
          <ProjectDot color={state.project.color} />
          {state.project.name}
        </span>
        {epic === null || epic === undefined ? null : (
          <span className="tag mute" title="Épico">
            {epic.title}
          </span>
        )}
        <button
          aria-checked={done}
          aria-label={`Concluir ${item.title}`}
          className={canMove ? "chk" : "chk wk-locked"}
          disabled={!canMove}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          role="checkbox"
          type="button"
        >
          <Icon name="check" />
        </button>
      </div>
      <h4 className="ttl">{item.title}</h4>
      {item.description === "" ? null : (
        <p className="ds">{item.description}</p>
      )}
      {subs.length > 0 ? (
        <div className="row" title={`${finished} de ${subs.length} subtarefas`}>
          <div aria-hidden="true" className="pbar wk-pips">
            {subs.slice(0, 8).map((sub) => (
              <i
                className={isDone(state.columns, sub.columnId) ? "on" : ""}
                key={sub.id}
              />
            ))}
          </div>
          <span className="xs num muted">
            {finished}/{subs.length}
          </span>
        </div>
      ) : null}
      <div className="ft">
        <span className="who">
          {assignee === undefined ? (
            <NoAvatar size="sm" />
          ) : (
            <Avatar email={assignee.email} id={assignee.id} size="sm" />
          )}
          <span>
            {assignee === undefined
              ? "Sem responsável"
              : firstNameOf(assignee.email)}
          </span>
        </span>
        {item.priority === "high" || item.priority === "urgent" ? (
          <span className={`prio ${item.priority}`}>
            <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
            {PRIORITY_LABEL[item.priority]}
          </span>
        ) : null}
        {item.dueDate === undefined ? null : (
          <span className={`meta${late ? " over" : ""}`}>
            <Icon name="cal" size="sm" />
            {late ? "Atrasada · " : ""}
            {fmtD(item.dueDate)}
          </span>
        )}
        <button
          aria-label={`Mover ou abrir ${item.title}`}
          className="iconbtn mini wk-push"
          data-cardmenu
          onClick={(event) => {
            event.stopPropagation();
            onMenu(event.currentTarget);
          }}
          type="button"
        >
          <Icon name="more" size="sm" />
        </button>
      </div>
    </article>
  );
}
