import type { CurrentAccount, Sprint } from "@crewstead/api-client";
import { isDone } from "../../columns";
import { daysTo, fmtD } from "../../design/format";
import { Icon } from "../../design/icons";
import { MissionBar } from "../../design/Mission";
import { Avatar, Banner, NoAvatar } from "../../design/primitives";
import { go } from "../../design/router";
import { useWorkspace } from "../../workspace";
import { doneCount, groupByProject, type Row } from "./sprintRules";
import { ProjectDot } from "../ProjectDot";

function Progress({ rows }: { rows: Row[] }) {
  const done = doneCount(rows);
  return (
    <div className="row">
      <MissionBar done={done} total={rows.length} />
      <span className="num sm muted">
        <b className="sp-ink">{done}</b>/{rows.length}
      </span>
    </div>
  );
}

function TaskLine({ row }: { row: Row }) {
  const { people } = useWorkspace();
  const { item, state } = row;
  const finished = isDone(state.columns, item.columnId);
  const owner =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);
  return (
    <button
      className="qrow sp-qrow"
      onClick={() => go(`work/${item.id}`)}
      type="button"
    >
      <span
        aria-checked={finished}
        aria-label={finished ? "concluída" : "aberta"}
        className="chk sq sp-chk"
        role="img"
      >
        <Icon name="check" />
      </span>
      <span className={finished ? "grow struck" : "grow"}>{item.title}</span>
      <span className="tag mute">
        {state.columns.find((column) => column.id === item.columnId)?.name}
      </span>
      {owner === undefined ? (
        <NoAvatar size="sm" />
      ) : (
        <Avatar email={owner.email} id={owner.id} size="sm" />
      )}
    </button>
  );
}

function ProjectGroup({ list }: { list: Row[] }) {
  const state = list[0]?.state;
  if (state === undefined) return null;
  return (
    <div className="sp-group">
      <div className="row sp-group-head">
        <ProjectDot color={state.project.color} />
        <b>{state.project.name}</b>
        <span className="xs muted num">
          {doneCount(list)}/{list.length}
        </span>
      </div>
      {list.map((row) => (
        <TaskLine key={row.item.id} row={row} />
      ))}
    </div>
  );
}

/** The sprint that is running now, with its work grouped by project. */
export function SprintCard({
  account,
  sprint,
  rows,
  canPlan,
  onClose,
}: {
  account: CurrentAccount;
  sprint: Sprint;
  rows: Row[];
  canPlan: boolean;
  onClose: () => void;
}) {
  const byProject = groupByProject(rows);
  const left = Math.max(0, daysTo(sprint.endsOn));
  return (
    <section aria-label="Sprint ativa" className="card sprint-card">
      <div className="row wrap">
        <span className="tag lime">Ativa</span>
        <h2 className="h2">{sprint.name}</h2>
        {sprint.goal === "" ? null : (
          <span className="muted">Missão: {sprint.goal}</span>
        )}
        <span className="grow" />
        <span className="sm muted">
          {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)} · {left} dias
          restantes
        </span>
        {canPlan ? (
          <button className="btn accent" onClick={onClose} type="button">
            <Icon name="check" size="sm" />
            Encerrar sprint
          </button>
        ) : null}
      </div>
      <Progress rows={rows} />
      {account.membershipKind === "external" ? (
        <Banner icon="eye">
          Você vê somente a projeção da sprint para os projetos que pode ler.
          Totais de outros projetos não aparecem.
        </Banner>
      ) : null}
      <div className="col">
        {[...byProject.entries()].map(([projectId, list]) => (
          <ProjectGroup key={projectId} list={list} />
        ))}
        {byProject.size === 0 ? (
          <p className="muted">
            Nenhuma atividade desta sprint está no seu acesso.
          </p>
        ) : null}
      </div>
    </section>
  );
}
