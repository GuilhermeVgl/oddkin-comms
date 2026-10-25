import type { CurrentAccount, Sprint, WorkItem } from "@oddkin/api-client";
import { useEffect, useMemo } from "react";
import {
  dueLabel,
  daysTo,
  fmtD,
  fmtLong,
  greeting,
  rel,
  todayIso,
} from "../design/format";
import { Icon, type IconName } from "../design/icons";
import { firstNameOf } from "../design/people";
import { Avatar, Empty, NoAvatar, Pbar } from "../design/primitives";
import { go } from "../design/router";
import { Duo, Sprite } from "../design/Sprite";
import { Page } from "../shell/Page";
import { projectColor } from "../shell/Sidebar";
import { useShell } from "../shell/context";
import { isDone, useWorkspace } from "../workspace";

export const PRIORITY_ICON: Record<WorkItem["priority"], IconName> = {
  low: "pBaixa",
  normal: "pNormal",
  high: "pAlta",
  urgent: "pUrgente",
};

export const PRIORITY_LABEL: Record<WorkItem["priority"], string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

function byDue(left: WorkItem, right: WorkItem): number {
  if (left.dueDate === undefined && right.dueDate === undefined) return 0;
  if (left.dueDate === undefined) return 1;
  if (right.dueDate === undefined) return -1;
  return left.dueDate.localeCompare(right.dueDate);
}

function SprintHero({
  sprint,
  total,
  done,
  projectNames,
}: {
  sprint: Sprint;
  total: number;
  done: number;
  projectNames: string[];
}) {
  const blocks = 20;
  const on = total > 0 ? Math.round((done / total) * blocks) : 0;
  const left = Math.max(0, daysTo(sprint.endsOn));
  return (
    <section aria-label="Sprint atual" className="sprint-hero">
      <div className="col gap12 grow">
        <span className="tag lime" style={{ width: "fit-content" }}>
          Sprint ativa
        </span>
        <h2>
          {sprint.name}
          {sprint.goal === "" ? "" : `: ${sprint.goal}`}
        </h2>
        <p className="muted sm">
          {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)} ·{" "}
          {left === 0 ? "último dia" : `${left} dias restantes`}
        </p>
        <div className="row" style={{ marginTop: 6 }}>
          <Pbar
            label={`${done} de ${total} concluídas`}
            on={on}
            stagger={30}
            total={blocks}
          />
          <span className="num sm">
            <b>{done}</b> de {total} concluídas
          </span>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <a className="btn accent sm" href="#/sprints">
            Ver sprint
          </a>
          <span className="xs muted">
            {projectNames.length === 0
              ? ""
              : `Projetos: ${projectNames.join(", ")}`}
          </span>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="dockhero"
        style={{ alignSelf: "flex-end", marginBottom: -24, marginRight: -4 }}
      >
        <Duo pose="wave" scale={4} />
      </div>
    </section>
  );
}

export function Home({ account }: { account: CurrentAccount }) {
  const { projects, sprints, setCurrentProjectId, people } = useWorkspace();
  const { openNewItem } = useShell();
  const loading = projects === null;
  const items = useMemo(
    () =>
      (projects ?? []).flatMap((state) =>
        state.items
          .filter((item) => item.kind === "task")
          .map((item) => ({ item, state })),
      ),
    [projects],
  );
  const mine = items
    .filter(
      ({ item, state }) =>
        item.assigneeId === account.id && !isDone(state.columns, item.columnId),
    )
    .sort((left, right) => byDue(left.item, right.item));
  const active = sprints.find((sprint) => sprint.state === "active");
  const inSprint =
    active === undefined
      ? []
      : items.filter(({ item }) => item.sprintId === active.id);
  const finished = inSprint.filter(({ item, state }) =>
    isDone(state.columns, item.columnId),
  ).length;
  const upcoming = mine.filter(
    ({ item }) => item.dueDate !== undefined && daysTo(item.dueDate) <= 3,
  ).length;
  const canCreate = (projects ?? []).length > 0;

  useEffect(() => {
    document.title = "ODDKIN · Visão geral";
  }, []);

  const feed = [...items]
    .sort((left, right) =>
      right.item.updatedAt.localeCompare(left.item.updatedAt),
    )
    .slice(0, 5);

  return (
    <Page
      cta={
        canCreate ? (
          <button
            className="btn primary"
            onClick={() => openNewItem()}
            type="button"
          >
            <Icon name="plus" /> Nova atividade
          </button>
        ) : null
      }
      sub={`${fmtLong(todayIso())}. ${
        loading
          ? ""
          : mine.length > 0
            ? `Você tem ${mine.length} ${mine.length === 1 ? "item" : "itens"} na fila${
                upcoming > 0 ? `, ${upcoming} com prazo curto` : ""
              }.`
            : "Sua fila está limpa."
      }`}
      title={`${greeting()}, ${firstNameOf(account.email)}`}
    >
      <div className="grid2">
        <div className="stack">
          {active === undefined ? (
            <section aria-label="Sprint atual" className="sprint-hero">
              <div className="col gap12 grow">
                <span className="tag" style={{ width: "fit-content" }}>
                  Planejamento
                </span>
                <h2>Pronto para o próximo passo</h2>
                <p className="muted sm">
                  Ainda não existe uma sprint ativa. Organize o backlog e comece
                  quando a equipe estiver pronta.
                </p>
                <div className="row" style={{ marginTop: 6 }}>
                  <a className="btn accent sm" href="#/sprints">
                    Ver sprints
                  </a>
                </div>
              </div>
              <div
                aria-hidden="true"
                style={{
                  alignSelf: "flex-end",
                  marginBottom: -24,
                  marginRight: -4,
                }}
              >
                <Duo pose="think" scale={4} />
              </div>
            </section>
          ) : (
            <SprintHero
              done={finished}
              projectNames={[
                ...new Set(inSprint.map(({ state }) => state.project.name)),
              ]}
              sprint={active}
              total={inSprint.length}
            />
          )}
          <section className="card pad">
            <div className="row" style={{ marginBottom: 6 }}>
              <h2 className="h2 grow">Minha fila</h2>
              <a className="btn ghost sm" href="#/work">
                Ver quadro <Icon name="right" size="sm" />
              </a>
            </div>
            {mine.length > 0 ? (
              mine.slice(0, 6).map(({ item, state }) => {
                const late =
                  item.dueDate !== undefined && daysTo(item.dueDate) < 0;
                return (
                  <button
                    className="qrow"
                    key={item.id}
                    onClick={() => {
                      setCurrentProjectId(state.project.id);
                      go(`work/${item.id}`);
                    }}
                    type="button"
                  >
                    <span
                      className={`prio ${item.priority}`}
                      title={`Prioridade ${PRIORITY_LABEL[item.priority]}`}
                    >
                      <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
                      <span className="sr">
                        {PRIORITY_LABEL[item.priority]}
                      </span>
                    </span>
                    <span className="grow col">
                      <b style={{ fontWeight: 650 }}>{item.title}</b>
                      <span className="xs muted">
                        {state.project.name} ·{" "}
                        {state.columns.find(
                          (column) => column.id === item.columnId,
                        )?.name ?? ""}
                      </span>
                    </span>
                    <span
                      className="sm muted"
                      style={
                        late
                          ? { color: "var(--danger)", fontWeight: 650 }
                          : undefined
                      }
                    >
                      {item.dueDate === undefined
                        ? "sem prazo"
                        : dueLabel(item.dueDate)}
                    </span>
                  </button>
                );
              })
            ) : (
              <Empty
                art={<Sprite pose="sit" scale={5} who="capuz" />}
                title={loading ? "Carregando…" : "Fila limpa"}
              >
                {loading
                  ? undefined
                  : "Nada atribuído a você agora. Aproveite o respiro."}
              </Empty>
            )}
          </section>
        </div>
        <div className="stack">
          <section className="card pad">
            <h2 className="h2" style={{ marginBottom: 10 }}>
              Projetos
            </h2>
            <div className="col gap8">
              {(projects ?? []).length === 0 ? (
                <p className="muted sm">
                  {loading
                    ? "Carregando projetos…"
                    : account.isAdmin
                      ? "Nenhum projeto ainda. Crie o primeiro em Atividades."
                      : "Você ainda não participa de nenhum projeto."}
                </p>
              ) : null}
              {(projects ?? []).map((state) => {
                const tasks = state.items.filter(
                  (item) => item.kind === "task",
                );
                const done = tasks.filter((item) =>
                  isDone(state.columns, item.columnId),
                ).length;
                return (
                  <button
                    className="proj-card"
                    key={state.project.id}
                    onClick={() => {
                      setCurrentProjectId(state.project.id);
                      go("work");
                    }}
                    type="button"
                  >
                    <div className="row">
                      <span
                        className="proj-ic"
                        style={{
                          background: projectColor(state.project.color),
                        }}
                      >
                        {state.project.name
                          .charAt(0)
                          .toLocaleUpperCase("pt-BR")}
                      </span>
                      <div className="grow col">
                        <b>{state.project.name}</b>
                        <span className="xs muted">
                          {state.project.description}
                        </span>
                      </div>
                      <span className="avs">
                        {state.members.slice(0, 4).map((member) => (
                          <Avatar
                            email={member.email}
                            id={member.accountId}
                            key={member.accountId}
                            size="sm"
                          />
                        ))}
                      </span>
                    </div>
                    <div className="row">
                      <Pbar
                        on={
                          tasks.length > 0
                            ? Math.round((done / tasks.length) * 10)
                            : 0
                        }
                        total={10}
                      />
                      <span className="xs muted num">
                        {done}/{tasks.length}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="card pad">
            <h2 className="h2">Atividade recente</h2>
            {feed.length === 0 ? (
              <p className="muted sm" style={{ marginTop: 8 }}>
                Sem novidades por aqui.
              </p>
            ) : (
              <ul className="feed" style={{ marginTop: 6 }}>
                {feed.map(({ item, state }) => {
                  const owner =
                    item.assigneeId === undefined
                      ? undefined
                      : people.get(item.assigneeId);
                  return (
                    <li key={item.id}>
                      {owner === undefined ? (
                        <NoAvatar size="sm" />
                      ) : (
                        <Avatar email={owner.email} id={owner.id} size="sm" />
                      )}
                      <span className="grow">
                        <b>{item.title}</b> foi atualizada ·{" "}
                        {state.project.name}
                      </span>
                      <time className="xs muted">{rel(item.updatedAt)}</time>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </Page>
  );
}
