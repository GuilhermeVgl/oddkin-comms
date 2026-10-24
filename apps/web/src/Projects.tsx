import {
  ApiStatusError,
  EncryptionError,
  addMember,
  createApiClient,
  createProject,
  listEpics,
  listSprints,
  type Sprint,
  updateEpic,
  type Epic,
  getExternalPolicy,
  listBoardColumns,
  listComments,
  listConversations,
  listKeyDomains,
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
import { useOptionalE2EE } from "./e2ee/E2EE";
import {
  createCommentContent,
  createEpicContent,
  createItem,
  decryptComments,
  decryptEpics,
  decryptItems,
  decryptProject,
  decryptSprints,
  encryptProject,
  encryptChannel,
  EncryptionUnavailableError,
  migrateProject,
  saveItem,
  type ContentStatus,
  type MigrationReport,
} from "./e2ee/content";
import type { ProjectCrypto } from "./e2ee/projectCrypto";
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
  if (error instanceof EncryptionUnavailableError) {
    return "Este projeto é cifrado. Desbloqueie a criptografia deste navegador para escrever.";
  }
  if (error instanceof EncryptionError) {
    if (error.code === "rotation_required")
      return "A chave do projeto está sendo renovada. Tente de novo em instantes.";
    if (error.code === "stale_generation")
      return "A chave do projeto mudou. Recarregamos; tente de novo.";
    if (error.code === "encryption_required")
      return "Este projeto exige conteúdo cifrado. Desbloqueie a criptografia.";
  }
  if (error instanceof ApiStatusError) {
    if (error.status === 409)
      return "Outra alteração chegou primeiro ou há subtarefas abertas. Recarregamos os dados.";
    if (error.status === 403) return "Você não tem permissão para isso.";
    if (error.status === 404) return "Não encontrado ou sem acesso.";
  }
  return "Não foi possível concluir a ação.";
}

export function ProjectsArea({
  account,
  onCelebrate,
}: {
  account: CurrentAccount;
  onCelebrate: (title: string) => void;
}) {
  const client = useMemo(() => createApiClient(""), []);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const e2eeArea = useOptionalE2EE();
  const areaUnlocked = e2eeArea?.phase === "unlocked";

  const reload = useCallback(async () => {
    try {
      const raw = await listProjects(client);
      // Encrypted names are read with each project's own key; locked or
      // unreadable ones show a placeholder.
      const list = await Promise.all(
        raw.map(async (entry) => {
          if (!entry.encrypted) return entry;
          const opened =
            areaUnlocked && e2eeArea !== null
              ? await e2eeArea.openProject(entry.id).catch(() => null)
              : null;
          return decryptProject(opened, entry);
        }),
      );
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
  }, [client, areaUnlocked, e2eeArea]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEvents((event) => {
    if (event === "resync" || event.eventType === "key-domain.changed")
      void reload();
  });

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const project = await createProject(client, csrfToken(), name);
      setName("");
      setMessage("");
      // With encryption available, a new project starts encrypted, name included.
      if (areaUnlocked && e2eeArea !== null) {
        try {
          const opened = await e2eeArea.openProject(project.id);
          if (opened !== null) {
            await opened.enable(csrfToken);
            await encryptProject(client, csrfToken(), opened, project);
            for (const channel of await listConversations(client, project.id)) {
              if (!channel.encrypted)
                await encryptChannel(client, csrfToken(), opened, channel);
            }
          }
        } catch {
          setMessage(
            "Projeto criado, mas não foi possível ativar a criptografia agora.",
          );
        }
      }
      await reload();
      setSelected(project.id);
    } catch (error) {
      setMessage(describe(error));
    }
  }

  const current = projects?.find((p) => p.id === selected) ?? null;

  return (
    <section
      className="projects"
      id="atividades"
      aria-labelledby="projects-title"
    >
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
        <div className="empty-note empty-note--explorers">
          <div aria-hidden="true" className="explorer-pair">
            <span className="pixel-explorer pixel-explorer--bot" />
            <span className="pixel-explorer pixel-explorer--scout" />
          </div>
          <div>
            <strong>O mapa está livre.</strong>
            <p>
              {account.isAdmin
                ? "Crie o primeiro projeto para começar."
                : "Você ainda não participa de nenhum projeto."}
            </p>
          </div>
        </div>
      ) : null}
      {current !== null ? (
        <ProjectView
          client={client}
          key={current.id}
          me={account.email}
          onCelebrate={onCelebrate}
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
  onCelebrate,
}: {
  client: Client;
  project: Project;
  me: string;
  onCelebrate: (title: string) => void;
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
  const e2ee = useOptionalE2EE();
  const unlocked = e2ee?.phase === "unlocked";
  const [pc, setPc] = useState<ProjectCrypto | null>(null);
  const [contentStatus, setContentStatus] = useState(
    new Map<string, ContentStatus>(),
  );
  const [migration, setMigration] = useState<string>("");
  // Known from the server even while this browser is locked.
  const [keyedOnServer, setKeyedOnServer] = useState(false);

  const reload = useCallback(async () => {
    try {
      let crypto: ProjectCrypto | null = null;
      if (unlocked && e2ee !== null) {
        crypto = await e2ee
          .openProject(project.id, { maintain: true })
          .catch(() => null);
      }
      setPc(crypto);
      setKeyedOnServer(
        (await listKeyDomains(client, project.id).catch(() => [])).some(
          (domain) => domain.kind === "work" && domain.currentGeneration > 0,
        ),
      );
      const [cols, work, epicList] = await Promise.all([
        listBoardColumns(client, project.id),
        listWorkItems(client, project.id),
        listEpics(client, project.id),
      ]);
      const decodedItems = await decryptItems(crypto, work);
      const decodedEpics = await decryptEpics(crypto, epicList);
      setColumns(cols);
      setItems(decodedItems.items);
      setEpics(decodedEpics.epics);
      setContentStatus(
        new Map([...decodedItems.status, ...decodedEpics.status]),
      );
      setState("ready");
    } catch (error) {
      setState(
        error instanceof ApiStatusError && error.status === 403
          ? "forbidden"
          : "error",
      );
    }
  }, [client, project.id, unlocked, e2ee]);

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
          event.eventType === "policy.changed" ||
          event.eventType === "key-domain.changed"))
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

  async function enableEncryption() {
    if (pc === null) return;
    setMigration("Ativando…");
    try {
      await pc.enable(csrfToken);
      await reload();
      setMigration("");
    } catch (error) {
      setMigration("");
      setMessage(describe(error));
    }
  }

  async function encryptLegacy() {
    if (pc === null || e2ee === null) return;
    setMigration("Cifrando conteúdo antigo…");
    try {
      const channels = await listConversations(client, project.id).catch(
        () => [],
      );
      if (project.isManager) {
        if (!project.encrypted)
          await encryptProject(client, csrfToken(), pc, project);
        const channel = channels[0];
        if (channel !== undefined && !channel.encrypted) {
          await encryptChannel(client, csrfToken(), pc, channel);
        }
      }
      const report: MigrationReport = await migrateProject(
        client,
        csrfToken(),
        pc,
        { items, epics, channelId: channels[0]?.id },
        { email: me },
        (done, total) =>
          setMigration(`Cifrando conteúdo antigo… ${done}/${total}`),
      );
      setMigration(
        `Concluído: ${report.items} atividades, ${report.epics} épicos, ${report.comments} comentários, ${report.messages} mensagens${report.failed > 0 ? `; ${report.failed} falharam` : ""}.`,
      );
      await reload();
    } catch (error) {
      setMigration("");
      setMessage(describe(error));
    }
  }

  const legacyCount =
    items.filter((item) => !item.encrypted).length +
    epics.filter((epic) => !epic.encrypted).length;
  const encryptedProject = pc?.isEncrypted("work") ?? keyedOnServer;

  return (
    <div className="project-view">
      <section
        aria-label="Criptografia do projeto"
        className="project-encryption"
      >
        {encryptedProject ? (
          <p>
            Conteúdo deste projeto cifrado de ponta a ponta (atividades, épicos,
            comentários e mensagens de canal).
            {legacyCount > 0
              ? ` Ainda há ${legacyCount} itens antigos em texto claro. `
              : " "}
            {legacyCount > 0 && unlocked ? (
              <button
                className="text-button"
                onClick={() => void encryptLegacy()}
                type="button"
              >
                Cifrar conteúdo antigo
              </button>
            ) : null}
          </p>
        ) : (
          <p>
            Este projeto ainda guarda o conteúdo em texto claro no servidor.{" "}
            {unlocked ? (
              <button
                className="text-button"
                onClick={() => void enableEncryption()}
                type="button"
              >
                Ativar criptografia neste projeto
              </button>
            ) : (
              "Desbloqueie a criptografia para ativá-la."
            )}
          </p>
        )}
        {encryptedProject && !unlocked ? (
          <p className="form-message">
            Desbloqueie a criptografia para ler e escrever.
          </p>
        ) : null}
        <p aria-live="polite">{migration}</p>
      </section>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await createItem(client, csrfToken(), pc, project.id, {
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
              await createEpicContent(
                client,
                csrfToken(),
                pc,
                project.id,
                epicTitle,
              );
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
                      onChange={(event) => {
                        const next = event.target.value;
                        const justFinished =
                          columns.find((column) => column.id === next)
                            ?.category === "done" &&
                          columns.find((column) => column.id === card.columnId)
                            ?.category !== "done";
                        void run(async () => {
                          await updateWorkItem(client, csrfToken(), card.id, {
                            version: card.version,
                            columnId: next,
                            completeSubtasks: true,
                          });
                          if (justFinished) onCelebrate("Atividade concluída!");
                        });
                      }}
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
          pc={pc}
          status={contentStatus.get(open.id) ?? "plain"}
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
  pc,
  status,
  subtasks,
  onClose,
  onRun,
}: {
  client: Client;
  columns: BoardColumn[];
  epics: Epic[];
  pc: ProjectCrypto | null;
  status: ContentStatus;
  item: WorkItem;
  subtasks: WorkItem[];
  onClose: () => void;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [priority, setPriority] = useState<string>(item.priority);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [comments, setComments] = useState<
    (WorkItemComment & { status: ContentStatus })[] | null
  >(null);
  const [comment, setComment] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);

  const loadComments = useCallback(async () => {
    try {
      setComments(
        await decryptComments(pc, await listComments(client, item.id)),
      );
    } catch {
      setComments([]);
    }
  }, [client, item.id, pc]);

  const detailE2ee = useOptionalE2EE();
  const detailUnlocked = detailE2ee?.phase === "unlocked";
  useEffect(() => {
    let alive = true;
    (async () => {
      const opened =
        detailUnlocked && detailE2ee !== null
          ? await detailE2ee.openOrganization().catch(() => null)
          : null;
      const list = await decryptSprints(opened, await listSprints(client));
      if (alive) setSprints(list.filter((sprint) => sprint.state !== "closed"));
    })().catch(() => alive && setSprints([]));
    return () => {
      alive = false;
    };
  }, [client, detailUnlocked, detailE2ee]);

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
  const editable = status === "plain" || status === "ok";

  return (
    <aside aria-label={`Detalhes de ${item.title}`} className="detail">
      {!editable ? (
        <p className="form-message">
          Este conteúdo está cifrado e não pôde ser lido neste navegador; a
          edição está desativada.
        </p>
      ) : null}
      <button className="text-button" onClick={onClose} type="button">
        Fechar
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onRun(() =>
            saveItem(client, csrfToken(), pc, item, {
              title,
              description,
              priority: priority as NonNullable<UpdateWorkItem["priority"]>,
            }),
          );
        }}
      >
        <label htmlFor="detail-title">Título</label>
        <input
          disabled={!editable}
          id="detail-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
        <label htmlFor="detail-description">Descrição</label>
        <textarea
          disabled={!editable}
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
            await createItem(client, csrfToken(), pc, item.projectId, {
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
        context={{
          contextType: "work_item",
          contextId: item.id,
          projectId: item.projectId,
        }}
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
            await createCommentContent(
              client,
              csrfToken(),
              pc,
              item.id,
              comment,
            );
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
