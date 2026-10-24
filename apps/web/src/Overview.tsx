import {
  createApiClient,
  listProjects,
  listSprints,
  listWorkItems,
  type CurrentAccount,
  type Project,
  type Sprint,
  type WorkItem,
} from "@oddkin/api-client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { decryptItems, decryptProject, decryptSprints } from "./e2ee/content";
import { useOptionalE2EE } from "./e2ee/E2EE";
import { useEvents } from "./events";

type OverviewProject = {
  project: Project;
  tasks: WorkItem[];
};

type OverviewData = {
  projects: OverviewProject[];
  sprints: Sprint[];
};

function taskOrder(left: WorkItem, right: WorkItem): number {
  if (left.dueDate === undefined && right.dueDate === undefined) {
    return right.updatedAt.localeCompare(left.updatedAt);
  }
  if (left.dueDate === undefined) return 1;
  if (right.dueDate === undefined) return -1;
  return left.dueDate.localeCompare(right.dueDate);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00`));
}

function daysUntil(value: string) {
  const target = new Date(`${value}T12:00:00`).getTime();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.max(0, Math.ceil((target - today.getTime()) / 86_400_000));
}

export function OverviewArea({
  account,
  onOpenActivities,
}: {
  account: CurrentAccount;
  onOpenActivities: () => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [rawProjects, rawSprints] = await Promise.all([
        listProjects(client),
        listSprints(client),
      ]);
      const organizationCrypto =
        unlocked && e2ee !== null
          ? await e2ee.openOrganization({ maintain: true }).catch(() => null)
          : null;
      const projects = await Promise.all(
        rawProjects.map(async (project) => {
          const projectCrypto =
            unlocked && e2ee !== null
              ? await e2ee
                  .openProject(project.id, { maintain: true })
                  .catch(() => null)
              : null;
          const [displayProject, rawItems] = await Promise.all([
            decryptProject(projectCrypto, project),
            listWorkItems(client, project.id),
          ]);
          const items = await decryptItems(projectCrypto, rawItems);
          return {
            project: displayProject,
            tasks: items.items.filter((item) => item.kind === "task"),
          };
        }),
      );
      setData({
        projects,
        sprints: await decryptSprints(organizationCrypto, rawSprints),
      });
      setError("");
    } catch {
      setData({ projects: [], sprints: [] });
      setError("Não foi possível atualizar sua visão geral.");
    }
  }, [client, e2ee, unlocked]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (
      event === "resync" ||
      event.eventType === "work-item.changed" ||
      event.eventType === "sprint.changed" ||
      event.eventType === "key-domain.changed"
    ) {
      void reload();
    }
  });

  if (data === null) return <p>Preparando sua visão geral…</p>;

  const activeSprint = data.sprints.find((sprint) => sprint.state === "active");
  const assigned = data.projects
    .flatMap(({ project, tasks }) =>
      tasks
        .filter((task) => task.assigneeId === account.id)
        .map((task) => ({ task, project })),
    )
    .sort((left, right) => taskOrder(left.task, right.task));

  return (
    <section className="overview-dashboard" aria-labelledby="overview-title">
      <h2 id="overview-title" className="visually-hidden">
        Resumo do trabalho
      </h2>
      <p aria-live="polite" className="form-message">
        {error}
      </p>
      <section className="overview-sprint" aria-label="Sprint atual">
        <div className="overview-sprint__copy">
          <span className="status-tag">
            {activeSprint === undefined ? "Planejamento" : "Sprint ativa"}
          </span>
          <h2>{activeSprint?.name ?? "Pronto para o próximo passo"}</h2>
          <p>
            {activeSprint === undefined
              ? "Ainda não existe uma sprint ativa. Organize o backlog e comece quando a equipe estiver pronta."
              : `${formatDate(activeSprint.startsOn)} a ${formatDate(activeSprint.endsOn)} · ${daysUntil(activeSprint.endsOn)} dias restantes`}
          </p>
          <div className="overview-sprint__footer">
            <button onClick={onOpenActivities} type="button">
              Ver atividades
            </button>
            <span>
              {data.projects.length} projetos · {assigned.length} itens na sua
              fila
            </span>
          </div>
        </div>
        <div aria-hidden="true" className="overview-sprint__explorers">
          <span className="pixel-explorer" />
        </div>
      </section>

      <div className="overview-dashboard__grid">
        <section
          className="overview-card overview-card--queue"
          aria-labelledby="overview-queue"
        >
          <div className="overview-card__heading">
            <div>
              <h3 id="overview-queue">Minha fila</h3>
              <p>Prioridades sincronizadas neste dispositivo.</p>
            </div>
            <button
              className="overview-card__link"
              onClick={onOpenActivities}
              type="button"
            >
              Ver quadro <span aria-hidden="true">→</span>
            </button>
          </div>
          {assigned.length === 0 ? (
            <div className="empty-note overview-empty">
              <span aria-hidden="true" className="pixel-explorer" />
              <div>
                <strong>Fila limpa</strong>
                <p>Nada atribuído a você agora. Aproveite o respiro.</p>
              </div>
            </div>
          ) : (
            <ul className="overview-task-list">
              {assigned.slice(0, 6).map(({ task, project }) => (
                <li key={task.id}>
                  <span
                    aria-hidden="true"
                    className={`priority-mark priority-mark--${task.priority}`}
                  />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{project.name}</span>
                  </div>
                  <time dateTime={task.dueDate}>
                    {task.dueDate === undefined
                      ? "sem prazo"
                      : formatDate(task.dueDate)}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {assigned.length > 6 ? (
            <p className="overview-card__footnote">
              +{assigned.length - 6} atividades também estão na sua fila.
            </p>
          ) : null}
        </section>

        <section className="overview-card" aria-labelledby="overview-projects">
          <div className="overview-card__heading">
            <div>
              <h3 id="overview-projects">Projetos</h3>
              <p>Espaços liberados para você.</p>
            </div>
          </div>
          {data.projects.length === 0 ? (
            <p className="empty-note">Nenhum projeto acessível ainda.</p>
          ) : (
            <ul className="overview-project-list">
              {data.projects.map(({ project, tasks }) => (
                <li key={project.id}>
                  <span aria-hidden="true" className="project-monogram">
                    {project.name.charAt(0).toLocaleUpperCase("pt-BR")}
                  </span>
                  <div>
                    <strong>{project.name}</strong>
                    <span>{tasks.length} atividades</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
