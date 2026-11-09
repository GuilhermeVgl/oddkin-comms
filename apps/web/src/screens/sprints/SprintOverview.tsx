import {
  getSprintSummary,
  type CurrentAccount,
  type Sprint,
  type SprintSummary,
} from "@crewstead/api-client";
import { useEffect, useMemo, useState } from "react";
import { fmtD, rel } from "../../design/format";
import { Icon } from "../../design/icons";
import { Avatar, Banner, NoAvatar } from "../../design/primitives";
import { go } from "../../design/router";
import { decryptItems } from "../../e2ee/content";
import { Page } from "../../shell/Page";
import { useWorkspace } from "../../workspace";
import { ProjectDot } from "../ProjectDot";
import { Drawer } from "../Drawer";
import type { DrawerEntry } from "../drawer/types";
import { PRIORITY_ICON, PRIORITY_LABEL } from "../priority";

type SummaryEntry = SprintSummary["items"][number];
type Filter = "all" | SummaryEntry["outcome"];

const STATE_LABEL: Record<Sprint["state"], string> = {
  planned: "Planejada",
  active: "Ativa",
  closed: "Encerrada",
};

const OUTCOME_LABEL: Record<SummaryEntry["outcome"], string> = {
  current: "Pendente",
  completed: "Concluída",
  carried: "Levada adiante",
  backlog: "Voltou ao backlog",
};

const FILTER_LABEL: Record<SummaryEntry["outcome"], string> = {
  current: "Pendentes",
  completed: "Concluídas",
  carried: "Levadas adiante",
  backlog: "Ao backlog",
};

function count(entries: SummaryEntry[], outcome: SummaryEntry["outcome"]) {
  return entries.filter((entry) => entry.outcome === outcome).length;
}

function SprintTitle({ name }: { name: string }) {
  const match = /^(.*?)(\S+)\s+([·—–-])\s+(\S+)(.*)$/.exec(name);
  if (match === null) return name;
  return (
    <>
      {match[1]}
      <span className="spv-title-tail">
        {match[2]} {match[3]} {match[4]}
      </span>
      {match[5]}
    </>
  );
}

function SummaryHero({
  sprint,
  entries,
}: {
  sprint: Sprint;
  entries: SummaryEntry[];
}) {
  const completed = count(entries, "completed");
  const total = entries.length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <section className="spv-hero">
      <div className="row wrap gap8">
        <span className={`tag${sprint.state === "active" ? " lime" : ""}`}>
          {STATE_LABEL[sprint.state]}
        </span>
        <span className="spv-period">
          <Icon name="cal" size="sm" /> {fmtD(sprint.startsOn)} —{" "}
          {fmtD(sprint.endsOn)}
        </span>
      </div>
      <div className="spv-title-row">
        <div>
          <h2>
            <SprintTitle name={sprint.name} />
          </h2>
          {sprint.goal === "" ? null : <p>{sprint.goal}</p>}
        </div>
        <strong className="spv-percent num">{percent}%</strong>
      </div>
      <div
        aria-label={`${percent}% concluído`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="spv-progress"
        role="progressbar"
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="spv-facts">
        <span>
          <b className="num">{total}</b> no escopo
        </span>
        <span>
          <b className="num">{completed}</b> concluídas
        </span>
        <span>
          <b className="num">{count(entries, "current")}</b> pendentes
        </span>
        {sprint.state === "closed" ? (
          <>
            <span>
              <b className="num">{count(entries, "carried")}</b> levadas adiante
            </span>
            <span>
              <b className="num">{count(entries, "backlog")}</b> ao backlog
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ActivityRow({
  entry,
  onOpen,
}: {
  entry: SummaryEntry;
  onOpen: (entry: DrawerEntry) => void;
}) {
  const { people, projects } = useWorkspace();
  const state = projects?.find(
    (project) => project.project.id === entry.item.projectId,
  );
  const owner =
    entry.item.assigneeId === undefined
      ? undefined
      : people.get(entry.item.assigneeId);
  const column = state?.columns.find(
    (value) => value.id === entry.item.columnId,
  );
  return (
    <button
      className="spv-activity"
      disabled={state === undefined}
      onClick={() =>
        state === undefined ? undefined : onOpen({ item: entry.item, state })
      }
      type="button"
    >
      <span className={`spv-outcome ${entry.outcome}`} aria-hidden="true">
        <Icon
          name={
            entry.outcome === "completed"
              ? "check"
              : entry.outcome === "carried"
                ? "arrow"
                : entry.outcome === "backlog"
                  ? "rot"
                  : "clock"
          }
          size="sm"
        />
      </span>
      <div className="grow col spv-activity-copy">
        <b>{entry.item.title}</b>
        <span className="xs muted row wrap gap8">
          <span className="row gap8">
            <ProjectDot color={state?.project.color ?? ""} />
            {state?.project.name ?? "Projeto"}
          </span>
          <span>{OUTCOME_LABEL[entry.outcome]}</span>
          {column === undefined ? null : <span>{column.name}</span>}
          <span>atualizada {rel(entry.item.updatedAt)}</span>
        </span>
      </div>
      <span
        className="tag mute spv-priority"
        title={`Prioridade ${PRIORITY_LABEL[entry.item.priority]}`}
      >
        <Icon name={PRIORITY_ICON[entry.item.priority]} size="sm" />
        {PRIORITY_LABEL[entry.item.priority]}
      </span>
      {owner === undefined ? (
        <NoAvatar size="sm" />
      ) : (
        <Avatar
          email={owner.email}
          id={owner.id}
          name={owner.displayName}
          size="sm"
        />
      )}
      <Icon name="right" size="sm" />
    </button>
  );
}

function ProjectBreakdown({ entries }: { entries: SummaryEntry[] }) {
  const { projects } = useWorkspace();
  const groups = useMemo(() => {
    const result = new Map<string, SummaryEntry[]>();
    for (const entry of entries)
      result.set(entry.item.projectId, [
        ...(result.get(entry.item.projectId) ?? []),
        entry,
      ]);
    return [...result.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [entries]);
  return (
    <section className="spv-side-section">
      <h3>Por projeto</h3>
      {groups.map(([projectId, list]) => {
        const state = projects?.find((entry) => entry.project.id === projectId);
        const done = count(list, "completed");
        return (
          <div className="spv-breakdown" key={projectId}>
            <div className="row gap8">
              <ProjectDot color={state?.project.color ?? ""} />
              <b className="grow sm">{state?.project.name ?? "Projeto"}</b>
              <span className="xs muted num">
                {done}/{list.length}
              </span>
            </div>
            <div aria-hidden="true" className="spv-mini-bar">
              <i
                style={{
                  width: `${list.length === 0 ? 0 : (done / list.length) * 100}%`,
                }}
              />
            </div>
          </div>
        );
      })}
      {groups.length === 0 ? (
        <p className="sm muted">Nenhum projeto no escopo.</p>
      ) : null}
    </section>
  );
}

function PeopleBreakdown({ entries }: { entries: SummaryEntry[] }) {
  const { people } = useWorkspace();
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.item.assigneeId ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);
  return (
    <section className="spv-side-section">
      <h3>Responsáveis</h3>
      <div className="col gap8">
        {groups.map(([accountId, total]) => {
          const person = accountId === "" ? undefined : people.get(accountId);
          return (
            <div className="row gap8" key={accountId || "unassigned"}>
              {person === undefined ? (
                <NoAvatar size="sm" />
              ) : (
                <Avatar
                  email={person.email}
                  id={person.id}
                  name={person.displayName}
                  size="sm"
                />
              )}
              <span className="grow sm">
                {person?.displayName ?? person?.email ?? "Sem responsável"}
              </span>
              <span className="tag mute num">{total}</span>
            </div>
          );
        })}
        {groups.length === 0 ? (
          <p className="sm muted">Nenhum responsável no escopo.</p>
        ) : null}
      </div>
    </section>
  );
}

export function SprintOverview({
  account,
  sprintId,
}: {
  account: CurrentAccount;
  sprintId: string;
}) {
  const { client, projects, sprints } = useWorkspace();
  const sprint = sprints.find((entry) => entry.id === sprintId);
  const [entries, setEntries] = useState<SummaryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<DrawerEntry | null>(null);

  useEffect(() => {
    if (projects === null) return;
    let alive = true;
    setEntries(null);
    setFailed(false);
    void getSprintSummary(client, sprintId)
      .then(async (summary) => {
        const decoded = await Promise.all(
          summary.items.map(async (entry) => {
            const state = projects.find(
              (project) => project.project.id === entry.item.projectId,
            );
            if (state === undefined) return entry;
            const opened = await decryptItems(state.crypto, [entry.item]);
            return { ...entry, item: opened.items[0] ?? entry.item };
          }),
        );
        if (alive) setEntries(decoded);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [client, projects, reload, sprintId]);

  if (projects !== null && sprint === undefined) {
    return (
      <Page title="Sprint" sub="Resumo indisponível">
        <section className="card empty">
          <h3>Sprint não encontrada</h3>
          <p>
            Ela pode ter sido removida ou não fazer parte dos projetos que você
            pode acessar.
          </p>
          <button className="btn" onClick={() => go("sprints")} type="button">
            Voltar para sprints
          </button>
        </section>
      </Page>
    );
  }
  if (projects === null || (entries === null && !failed)) {
    return (
      <Page title="Sprint" sub="Carregando o resumo…">
        <section className="card empty">
          <p>Reunindo atividades da sprint…</p>
        </section>
      </Page>
    );
  }
  if (failed) {
    return (
      <Page title="Sprint" sub="Não foi possível carregar o resumo">
        <section className="card empty">
          <h3>O resumo não carregou</h3>
          <p>
            Verifique sua conexão e se este navegador está desbloqueado, depois
            tente novamente.
          </p>
          <button
            className="btn"
            onClick={() => setReload((value) => value + 1)}
            type="button"
          >
            Tentar novamente
          </button>
        </section>
      </Page>
    );
  }

  if (sprint === undefined) return null;

  const all = entries ?? [];
  const shown =
    filter === "all" ? all : all.filter((entry) => entry.outcome === filter);
  const filters: Filter[] =
    sprint.state === "closed"
      ? ["all", "completed", "carried", "backlog"]
      : ["all", "completed", "current"];
  return (
    <Page
      cta={
        <button
          className="btn ghost"
          onClick={() => go("sprints")}
          type="button"
        >
          <Icon name="left" size="sm" /> Todas as sprints
        </button>
      }
      sub="Escopo, andamento e desfecho das atividades"
      title={<span className="spv-page-title">Resumo da sprint</span>}
    >
      <SummaryHero entries={all} sprint={sprint} />
      {account.membershipKind === "external" ? (
        <Banner icon="eye">
          Este resumo inclui somente atividades dos projetos que você pode ler.
        </Banner>
      ) : null}
      <div className="spv-layout">
        <section className="card spv-main">
          <div className="spv-section-head">
            <div>
              <h2 className="h2">Atividades</h2>
              <p className="sm muted">
                O escopo visível e o destino de cada entrega.
              </p>
            </div>
            <div aria-label="Filtrar atividades" className="seg" role="group">
              {filters.map((value) => (
                <button
                  aria-pressed={filter === value}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {value === "all" ? "Todas" : FILTER_LABEL[value]}
                  <span className="num">
                    {value === "all" ? all.length : count(all, value)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="spv-activity-list">
            {shown.map((entry) => (
              <ActivityRow
                entry={entry}
                key={entry.item.id}
                onOpen={setSelected}
              />
            ))}
            {shown.length === 0 ? (
              <div className="spv-empty">
                <Icon name="flag" />
                <b>Nenhuma atividade neste recorte</b>
                <span className="sm muted">
                  Escolha outro filtro para ver o restante da sprint.
                </span>
              </div>
            ) : null}
          </div>
        </section>
        <aside className="card spv-side">
          <ProjectBreakdown entries={all} />
          <PeopleBreakdown entries={all} />
        </aside>
      </div>
      {selected === null ? null : (
        <Drawer
          entry={selected}
          meId={account.id}
          onClose={() => {
            setSelected(null);
            setReload((value) => value + 1);
          }}
        />
      )}
    </Page>
  );
}
