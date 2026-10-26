import type { WorkItem } from "@crewstead/api-client";
import type { ReactNode } from "react";
import { daysTo, dueLabel } from "../../design/format";
import { Icon, type IconName } from "../../design/icons";
import { nameOf } from "../../design/people";
import { Avatar, NoAvatar } from "../../design/primitives";
import { toast } from "../../design/toast";
import { useWorkspace, type Person } from "../../workspace";
import { PRIORITY_ICON, PRIORITY_LABEL } from "../Home";
import { useItemActions } from "../itemActions";
import type { DrawerEntry } from "./types";

type Changes = Parameters<ReturnType<typeof useItemActions>["patch"]>[1];

function Tile({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="im-tile">
      <dt>
        <Icon name={icon} size="sm" />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PersonAvatar({ person }: { person: Person | undefined }) {
  return person === undefined ? (
    <NoAvatar size="sm" />
  ) : (
    <Avatar email={person.email} id={person.id} size="sm" />
  );
}

/** The six fields of an activity: state, assignee, due date, priority, epic and sprint. */
export function PropertyTiles({
  entry,
  done,
  canEdit,
  canMove,
  canPlan,
}: {
  entry: DrawerEntry;
  done: boolean;
  canEdit: boolean;
  canMove: boolean;
  canPlan: boolean;
}) {
  const { item, state } = entry;
  const { sprints, people } = useWorkspace();
  const { patch, move } = useItemActions();
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);

  async function field(changes: Changes) {
    const result = await patch(item, changes);
    if (result !== undefined) toast("Salvo.", { ms: 1400 });
  }

  return (
    <dl className="im-props">
      <Tile icon="board" label="Estado">
        <select
          aria-label="Estado"
          className="inp"
          disabled={!canMove}
          onChange={(event) => void move(state, item, event.target.value)}
          value={item.columnId}
        >
          {state.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </Tile>
      <Tile icon="user" label="Responsável">
        <PersonAvatar person={assignee} />
        <select
          aria-label="Responsável"
          className="inp"
          disabled={!canEdit}
          onChange={(event) =>
            void field(
              event.target.value === ""
                ? { clearAssignee: true }
                : { assigneeId: event.target.value },
            )
          }
          value={item.assigneeId ?? ""}
        >
          <option value="">Sem responsável</option>
          {state.members.map((member) => (
            <option key={member.accountId} value={member.accountId}>
              {nameOf(member.email)}
            </option>
          ))}
        </select>
      </Tile>
      <Tile icon="cal" label="Prazo">
        <input
          aria-label="Prazo"
          className="inp"
          disabled={!canEdit}
          onChange={(event) =>
            void field(
              event.target.value === ""
                ? { clearDueDate: true }
                : { dueDate: event.target.value },
            )
          }
          type="date"
          value={item.dueDate ?? ""}
        />
        <DueNote dueDate={item.dueDate} done={done} />
      </Tile>
      <Tile icon="flag" label="Prioridade">
        <select
          aria-label="Prioridade"
          className="inp"
          disabled={!canEdit}
          onChange={(event) =>
            void field({
              priority: event.target.value as WorkItem["priority"],
            })
          }
          value={item.priority}
        >
          {(Object.keys(PRIORITY_LABEL) as WorkItem["priority"][]).map(
            (key) => (
              <option key={key} value={key}>
                {PRIORITY_LABEL[key]}
              </option>
            ),
          )}
        </select>
        <span className={`prio ${item.priority}`}>
          <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
        </span>
      </Tile>
      <Tile icon="layers" label="Épico">
        <select
          aria-label="Épico"
          className="inp"
          disabled={!canPlan}
          onChange={(event) =>
            void field(
              event.target.value === ""
                ? { clearEpic: true }
                : { epicId: event.target.value },
            )
          }
          value={item.epicId ?? ""}
        >
          <option value="">Sem épico</option>
          {state.epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.title}
            </option>
          ))}
        </select>
      </Tile>
      <Tile icon="clock" label="Sprint">
        <select
          aria-label="Sprint"
          className="inp"
          disabled={!canPlan}
          onChange={(event) =>
            void field(
              event.target.value === ""
                ? { clearSprint: true }
                : { sprintId: event.target.value },
            )
          }
          value={item.sprintId ?? ""}
        >
          <option value="">Backlog</option>
          {sprints
            .filter(
              (value) => value.state !== "closed" || value.id === item.sprintId,
            )
            .map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
                {value.state === "active" ? " (ativa)" : ""}
              </option>
            ))}
        </select>
      </Tile>
    </dl>
  );
}

/** "Atrasada" for an open overdue activity, otherwise the relative due date. */
function DueNote({
  dueDate,
  done,
}: {
  dueDate: string | undefined;
  done: boolean;
}) {
  if (dueDate === undefined) return null;
  if (daysTo(dueDate) < 0 && !done)
    return (
      <span className="tag danger">
        <Icon name="alert" size="sm" />
        Atrasada
      </span>
    );
  return <span className="xs muted">{dueLabel(dueDate)}</span>;
}
