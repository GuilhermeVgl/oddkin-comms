import {
  ApiStatusError,
  addMember,
  createApiClient,
  createComment,
  createEpic,
  createProject,
  listEpics,
  listSprints,
  type Sprint,
  updateEpic,
  type Epic,
  createWorkItem,
  getExternalPolicy,
  listBoardColumns,
  listComments,
  listMembers,
  listProjects,
  listWorkItems,
  readCookie,
  updateExternalPolicy,
  updateWorkItem,
  type BoardColumn,
  type CurrentAccount,
  type ExternalPolicy,
  type Project,
  type ProjectMember,
  type UpdateWorkItem,
  type WorkItem,
  type WorkItemComment,
} from "@oddkin/api-client";
import { Attachments } from "./Attachments";
import { ProjectChat } from "./Chat";
import { useEvents } from "./events";
import React, { useCallback, useEffect, useMemo, useState } from "react";

type Client = ReturnType<typeof createApiClient>;

const PERMISSIONS: { key: string; label: string }[] = [
  { key: "work.read", label: "Ver atividades" },
  { key: "work.create", label: "Criar atividades" },
  { key: "work.edit", label: "Editar campos" },
  { key: "work.move", label: "Mover entre colunas" },
  { key: "work.archive", label: "Arquivar" },
  { key: "work.comment", label: "Comentar" },
  { key: "planning.edit", label: "Gerenciar épicos" },
  { key: "chat.read", label: "Ler conversas" },
  { key: "chat.send", label: "Enviar mensagens" },
  { key: "direct_messages.use", label: "Mensagens diretas" },
  { key: "files.download", label: "Baixar arquivos" },
  { key: "files.upload", label: "Enviar arquivos" },
  { key: "calls.join", label: "Entrar em chamadas" },
  { key: "calls.start", label: "Iniciar chamadas" },
  { key: "calls.screen_share", label: "Compartilhar tela" },
];

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

function csrfToken(): string {
  const token = readCookie(document.cookie, "oddkin_csrf");
  if (token === null) throw new Error("missing csrf cookie");
  return token;
}

function describe(error: unknown): string {
  if (error instanceof ApiStatusError) {
    if (error.status === 409)
      return "Outra alteração chegou primeiro ou há subtarefas abertas. Recarregamos os dados.";
    if (error.status === 403) return "Você não tem permissão para isso.";
    if (error.status === 404) return "Não encontrado ou sem acesso.";
  }
  return "Não foi possível concluir a ação.";
}

export function ProjectsArea({ account }: { account: CurrentAccount }) {
  const client = useMemo(() => createApiClient(""), []);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      const list = await listProjects(client);
      setProjects(list);
      setSelected((current) =>
        current !== null && list.some((p) => p.id === current)
          ? current
          : (list[0]?.id ?? null),
      );
    } catch {
      setMessage("Não foi possível carregar os projetos.");
      setProjects([]);
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const project = await createProject(client, csrfToken(), name);
      setName("");
      setMessage("");
      await reload();
      setSelected(project.id);
    } catch (error) {
      setMessage(describe(error));
    }
  }

  const current = projects?.find((p) => p.id === selected) ?? null;

  return (
    <section className="projects" aria-labelledby="projects-title">
      <div className="projects__bar">
        <h2 id="projects-title">Projetos</h2>
        <div className="project-tabs" role="tablist" aria-label="Projetos">
          {(projects ?? []).map((project) => (
            <button
              aria-selected={project.id === selected}
              className="project-tab"
              key={project.id}
              onClick={() => setSelected(project.id)}
              role="tab"
              type="button"
            >
              {project.name}
            </button>
          ))}
        </div>
        {account.isAdmin ? (
          <form className="inline-form" onSubmit={handleCreate}>
            <label className="visually-hidden" htmlFor="project-name">
              Nome do projeto
            </label>
            <input
              id="project-name"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Novo projeto"
              required
              value={name}
            />
            <button type="submit">Criar</button>
          </form>
        ) : null}
      </div>
      <p aria-live="polite" className="form-message">
        {message}
      </p>
      {projects === null ? <p>Carregando projetos…</p> : null}
      {projects !== null && projects.length === 0 ? (
        <p className="empty-note">
          {account.isAdmin
            ? "Crie o primeiro projeto para começar."
            : "Você ainda não participa de nenhum projeto."}
        </p>
      ) : null}
      {current !== null ? (
        <ProjectView
          client={client}
          key={current.id}
          me={account.email}
          project={current}
        />
      ) : null}
    </section>
  );
}

function ProjectView({
  client,
  project,
  me,
}: {
  client: Client;
  project: Project;
  me: string;
}) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [epicTitle, setEpicTitle] = useState("");
  const [chatMembers, setChatMembers] = useState<ProjectMember[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    try {
      const [cols, work, epicList] = await Promise.all([
        listBoardColumns(client, project.id),
        listWorkItems(client, project.id),
        listEpics(client, project.id),
      ]);
      setColumns(cols);
      setItems(work);
      setEpics(epicList);
      setState("ready");
    } catch (error) {
      setState(
        error instanceof ApiStatusError && error.status === 403
          ? "forbidden"
          : "error",
      );
    }
  }, [client, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    listMembers(client, project.id)
      .then(setChatMembers)
      .catch(() => setChatMembers([]));
  }, [client, project.id]);

  useEvents((event) => {
    if (
      event === "resync" ||
      (event.contextId === project.id &&
        (event.eventType === "work-item.changed" ||
          event.eventType === "policy.changed"))
    ) {
      void reload();
    }
  });

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setMessage("");
    } catch (error) {
      setMessage(describe(error));
    }
    await reload();
  }

  const tasks = items.filter((item) => item.kind === "task");
  const subtasksOf = (id: string) =>
    items.filter((item) => item.parentId === id);
  const open = items.find((item) => item.id === openId) ?? null;

  if (state === "loading") return <p>Carregando quadro…</p>;
  if (state === "forbidden")
    return (
      <p className="empty-note">Seu perfil não permite ver as atividades.</p>
    );
  if (state === "error")
    return (
      <p className="empty-note">
        Não foi possível carregar o quadro.{" "}
        <button
          className="text-button"
          onClick={() => void reload()}
          type="button"
        >
          Tentar novamente
        </button>
      </p>
    );

  return (
    <div className="project-view">
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await createWorkItem(client, csrfToken(), project.id, {
              kind: "task",
              title,
            });
            setTitle("");
          });
        }}
      >
        <label className="visually-hidden" htmlFor="task-title">
          Título da atividade
        </label>
        <input
          id="task-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nova atividade"
          required
          value={title}
        />
        <button type="submit">Adicionar</button>
      </form>
      <p aria-live="polite" className="form-message">
        {message}
      </p>

      <section className="epics" aria-label="Épicos">
        <h3>Épicos</h3>
        {epics.length === 0 ? (
          <p className="empty-note">Nenhum épico.</p>
        ) : null}
        <ul>
          {epics.map((epic) => {
            const linked = tasks.filter((task) => task.epicId === epic.id);
            const finished = linked.filter(
              (task) =>
                columns.find((c) => c.id === task.columnId)?.category ===
                "done",
            ).length;
            return (
              <li key={epic.id}>
                <strong>{epic.title}</strong>{" "}
                <span>
                  {finished}/{linked.length} atividades
                  {epic.done ? " · concluído" : ""}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    void run(() =>
                      updateEpic(client, csrfToken(), epic.id, {
                        version: epic.version,
                        done: !epic.done,
                      }),
                    )
                  }
                  type="button"
                >
                  {epic.done ? "Reabrir" : "Concluir"}
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await createEpic(client, csrfToken(), project.id, epicTitle);
              setEpicTitle("");
            });
          }}
        >
          <label className="visually-hidden" htmlFor="epic-title">
            Novo épico
          </label>
          <input
            id="epic-title"
            maxLength={200}
            onChange={(event) => setEpicTitle(event.target.value)}
            placeholder="Novo épico"
            required
            value={epicTitle}
          />
          <button type="submit">Criar épico</button>
        </form>
      </section>

      <div className="board">
        {columns.map((column) => {
          const cards = tasks.filter((task) => task.columnId === column.id);
          return (
            <section
              aria-label={`${column.name}, ${cards.length} atividades`}
              className="board-column"
              key={column.id}
            >
              <h3>
                {column.name} <span>{cards.length}</span>
              </h3>
              {cards.length === 0 ? <p className="empty-note">Vazio</p> : null}
              {cards.map((card) => {
                const subs = subtasksOf(card.id);
                const finished = subs.filter(
                  (sub) =>
                    columns.find((c) => c.id === sub.columnId)?.category ===
                    "done",
                ).length;
                return (
                  <article className="card" key={card.id}>
                    <button
                      className="card__title"
                      onClick={() => setOpenId(card.id)}
                      type="button"
                    >
                      {card.title}
                    </button>
                    <p className="card__meta">
                      {PRIORITY_LABEL[card.priority]}
                      {subs.length > 0
                        ? ` · ${finished}/${subs.length} subtarefas`
                        : ""}
                    </p>
                    <label
                      className="visually-hidden"
                      htmlFor={`move-${card.id}`}
                    >
                      Mover {card.title}
                    </label>
                    <select
                      id={`move-${card.id}`}
                      onChange={(event) =>
                        void run(() =>
                          updateWorkItem(client, csrfToken(), card.id, {
                            version: card.version,
                            columnId: event.target.value,
                            completeSubtasks: true,
                          }),
                        )
                      }
                      value={card.columnId}
                    >
                      {columns.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>

      {open !== null ? (
        <ItemDetail
          client={client}
          columns={columns}
          epics={epics}
          item={open}
          onClose={() => setOpenId(null)}
          onRun={run}
          subtasks={subtasksOf(open.id)}
        />
      ) : null}

      <ProjectChat
        client={client}
        members={chatMembers}
        me={me}
        moderator={project.isManager}
        projectId={project.id}
      />

      {project.isManager ? (
        <ProjectSettings client={client} project={project} />
      ) : null}
    </div>
  );
}

function ItemDetail({
  client,
  columns,
  epics,
  item,
  subtasks,
  onClose,
  onRun,
}: {
  client: Client;
  columns: BoardColumn[];
  epics: Epic[];
  item: WorkItem;
  subtasks: WorkItem[];
  onClose: () => void;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState<string>(item.priority);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [comments, setComments] = useState<WorkItemComment[] | null>(null);
  const [comment, setComment] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);

  const loadComments = useCallback(async () => {
    try {
      setComments(await listComments(client, item.id));
    } catch {
      setComments([]);
    }
  }, [client, item.id]);

  useEffect(() => {
    listSprints(client)
      .then((list) =>
        setSprints(list.filter((sprint) => sprint.state !== "closed")),
      )
      .catch(() => setSprints([]));
  }, [client]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
    setPriority(item.priority);
  }, [item.version, item.title, item.description, item.priority]);

  const doneColumn = columns.find((c) => c.category === "done");
  const todoColumn = columns.find((c) => c.category === "todo");

  return (
    <aside aria-label={`Detalhes de ${item.title}`} className="detail">
      <button className="text-button" onClick={onClose} type="button">
        Fechar
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const body: UpdateWorkItem = {
            version: item.version,
            title,
            description,
            priority: priority as NonNullable<UpdateWorkItem["priority"]>,
          };
          void onRun(() => updateWorkItem(client, csrfToken(), item.id, body));
        }}
      >
        <label htmlFor="detail-title">Título</label>
        <input
          id="detail-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
        <label htmlFor="detail-description">Descrição</label>
        <textarea
          id="detail-description"
          maxLength={50000}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          value={description}
        />
        <label htmlFor="detail-priority">Prioridade</label>
        <select
          id="detail-priority"
          onChange={(event) => setPriority(event.target.value)}
          value={priority}
        >
          {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {item.kind === "task" ? (
          <>
            <label htmlFor="detail-epic">Épico</label>
            <select
              id="detail-epic"
              onChange={(event) =>
                void onRun(() =>
                  updateWorkItem(
                    client,
                    csrfToken(),
                    item.id,
                    event.target.value === ""
                      ? { version: item.version, clearEpic: true }
                      : { version: item.version, epicId: event.target.value },
                  ),
                )
              }
              value={item.epicId ?? ""}
            >
              <option value="">Sem épico</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {item.kind === "task" ? (
          <>
            <label htmlFor="detail-sprint">Sprint</label>
            <select
              id="detail-sprint"
              onChange={(event) =>
                void onRun(() =>
                  updateWorkItem(
                    client,
                    csrfToken(),
                    item.id,
                    event.target.value === ""
                      ? { version: item.version, clearSprint: true }
                      : { version: item.version, sprintId: event.target.value },
                  ),
                )
              }
              value={item.sprintId ?? ""}
            >
              <option value="">Backlog</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button type="submit">Salvar</button>
      </form>

      <h3>Subtarefas</h3>
      <ul className="subtasks">
        {subtasks.map((sub) => {
          const finished =
            columns.find((c) => c.id === sub.columnId)?.category === "done";
          const target = finished ? todoColumn : doneColumn;
          return (
            <li key={sub.id}>
              <label>
                <input
                  checked={finished}
                  disabled={target === undefined}
                  onChange={() =>
                    target !== undefined
                      ? void onRun(() =>
                          updateWorkItem(client, csrfToken(), sub.id, {
                            version: sub.version,
                            columnId: target.id,
                          }),
                        )
                      : undefined
                  }
                  type="checkbox"
                />
                {sub.title}
              </label>
            </li>
          );
        })}
      </ul>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(async () => {
            await createWorkItem(client, csrfToken(), item.projectId, {
              kind: "subtask",
              parentId: item.id,
              title: subtaskTitle,
            });
            setSubtaskTitle("");
          });
        }}
      >
        <label className="visually-hidden" htmlFor="subtask-title">
          Nova subtarefa
        </label>
        <input
          id="subtask-title"
          maxLength={200}
          onChange={(event) => setSubtaskTitle(event.target.value)}
          placeholder="Nova subtarefa"
          required
          value={subtaskTitle}
        />
        <button type="submit">Adicionar</button>
      </form>

      <Attachments
        client={client}
        context={{ contextType: "work_item", contextId: item.id }}
      />

      <h3>Comentários</h3>
      {comments === null ? <p>Carregando…</p> : null}
      {comments !== null && comments.length === 0 ? (
        <p className="empty-note">Nenhum comentário ainda.</p>
      ) : null}
      <ul className="comments">
        {(comments ?? []).map((entry) => (
          <li key={entry.id}>
            <strong>{entry.authorEmail}</strong>
            <p>{entry.body}</p>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(async () => {
            await createComment(client, csrfToken(), item.id, comment);
            setComment("");
            await loadComments();
          });
        }}
      >
        <label className="visually-hidden" htmlFor="comment-body">
          Comentário
        </label>
        <input
          id="comment-body"
          maxLength={10000}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Escreva um comentário"
          required
          value={comment}
        />
        <button type="submit">Comentar</button>
      </form>
    </aside>
  );
}

function ProjectSettings({
  client,
  project,
}: {
  client: Client;
  project: Project;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [policy, setPolicy] = useState<ExternalPolicy | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([
        listMembers(client, project.id),
        getExternalPolicy(client, project.id),
      ]);
      setMembers(list);
      setPolicy(current);
    } catch {
      setMessage("Não foi possível carregar as configurações.");
    }
  }, [client, project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePermission(key: string) {
    if (policy === null) return;
    const has = policy.permissions.some((p) => p === key);
    const next = has
      ? policy.permissions.filter((p) => p !== key)
      : [...policy.permissions, key as ExternalPolicy["permissions"][number]];
    try {
      setPolicy(
        await updateExternalPolicy(client, csrfToken(), project.id, {
          permissions: next,
          version: policy.version,
        }),
      );
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof ApiStatusError && error.status === 400
          ? "Combinação inválida: as demais permissões exigem ver atividades (e enviar mensagens exige ler conversas)."
          : describe(error),
      );
      await load();
    }
  }

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h3 id="settings-title">Equipe e acesso</h3>
      <ul className="members">
        {members.map((member) => (
          <li key={member.accountId}>
            {member.email}{" "}
            <span>
              {member.membershipKind === "external" ? "externo" : "interno"}
              {member.isManager ? " · gestor" : ""}
            </span>
          </li>
        ))}
      </ul>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            try {
              await addMember(client, csrfToken(), project.id, email);
              setEmail("");
              setMessage("");
              await load();
            } catch {
              setMessage(
                "Não foi possível adicionar: a pessoa precisa já fazer parte da organização.",
              );
            }
          })();
        }}
      >
        <label className="visually-hidden" htmlFor="member-email">
          E-mail do membro
        </label>
        <input
          id="member-email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="E-mail de quem já está na organização"
          required
          type="email"
          value={email}
        />
        <button type="submit">Adicionar ao projeto</button>
      </form>
      {policy !== null ? (
        <fieldset>
          <legend>
            O que externos podem fazer (vale para todos os externos deste
            projeto)
          </legend>
          {PERMISSIONS.map((permission) => (
            <label key={permission.key}>
              <input
                checked={policy.permissions.some((p) => p === permission.key)}
                onChange={() => void togglePermission(permission.key)}
                type="checkbox"
              />
              {permission.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p aria-live="polite" className="form-message">
        {message}
      </p>
    </section>
  );
}
