import {
  getFollowing,
  listComments,
  setFollowing,
  type WorkItem,
  type WorkItemComment,
} from "@crewstead/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Attachments } from "../Attachments";
import { dueLabel, daysTo, fmtD } from "../design/format";
import { Icon } from "../design/icons";
import { Menu, useMenu } from "../design/Menu";
import { nameOf } from "../design/people";
import { Avatar, Banner, NoAvatar, Pbar } from "../design/primitives";
import { Rich } from "../design/rich";
import { blip } from "../design/sound";
import { isReduced } from "../design/prefs";
import { burst } from "../design/sprites";
import { toast } from "../design/toast";
import {
  createCommentContent,
  createItem,
  decryptComments,
  saveItem,
  type ContentStatus,
} from "../e2ee/content";
import { csrfToken } from "../errors";
import { can, isDone, useWorkspace, type ProjectState } from "../workspace";
import { projectColor } from "../shell/Sidebar";
import { PRIORITY_ICON, PRIORITY_LABEL } from "./Home";
import { subtasksOf, useItemActions } from "./itemActions";

type Comment = WorkItemComment & { status: ContentStatus };
type Conflict = {
  field: "title" | "description";
  mine: string;
  theirs: string;
};

/** The detail of one activity: every field, subtasks, files and comments. */
export function Drawer({
  entry,
  onClose,
}: {
  entry: { item: WorkItem; state: ProjectState };
  onClose: () => void;
}) {
  const { item, state } = entry;
  const { client, run, sprints, people } = useWorkspace();
  const { patch, move } = useItemActions();
  const close = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [comment, setComment] = useState("");
  const [subtask, setSubtask] = useState("");
  const [following, setFollowingState] = useState(false);
  const more = useMenu();
  const status = state.status.get(item.id) ?? "plain";
  const readable = status === "plain" || status === "ok";
  const canEdit = can(state, "work.edit") && readable;
  const canComment = can(state, "work.comment");
  const canMove = can(state, "work.move");
  const canPlan = can(state, "planning.edit");
  const done = isDone(state.columns, item.columnId);
  const subs = subtasksOf(state, item);
  const finished = subs.filter((sub) =>
    isDone(state.columns, sub.columnId),
  ).length;
  const encrypted = item.encrypted || state.keyed;

  useEffect(() => {
    setTitle(item.title);
    setDescription(item.description);
  }, [item.id, item.version, item.title, item.description]);

  useEffect(() => close.current?.focus(), [item.id]);

  useEffect(() => {
    let alive = true;
    getFollowing(client, item.id)
      .then((value) => alive && setFollowingState(value))
      .catch(() => alive && setFollowingState(false));
    return () => {
      alive = false;
    };
  }, [client, item.id]);

  const load = useCallback(async () => {
    try {
      setComments(
        await decryptComments(
          state.crypto,
          await listComments(client, item.id),
        ),
      );
    } catch {
      setComments([]);
    }
  }, [client, item.id, state.crypto]);

  useEffect(() => {
    void load();
  }, [load]);

  const closeSoon = useCallback(() => {
    if (isReduced()) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(onClose, 150);
  }, [onClose]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("dialog[open], .menu") !== null) return;
      closeSoon();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [closeSoon]);

  const mentionable = useMemo(
    () =>
      new Set(
        state.members.map((member) => nameOf(member.email).split(" ")[0] ?? ""),
      ),
    [state.members],
  );

  async function saveText(field: "title" | "description", value: string) {
    if (!canEdit) return;
    const current = field === "title" ? item.title : item.description;
    if (value === current || (field === "title" && value.trim() === "")) {
      if (field === "title" && value.trim() === "") setTitle(item.title);
      return;
    }
    try {
      await saveItem(client, csrfToken(), state.crypto, item, {
        title: field === "title" ? value : item.title,
        description: field === "description" ? value : item.description,
        priority: item.priority,
      });
      toast("Salvo.", { ms: 1400 });
      await run(async () => undefined);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 409
      ) {
        await run(async () => undefined);
        setConflict({ field, mine: value, theirs: current });
        blip("err");
      } else {
        await run(async () => {
          throw error;
        });
      }
    }
  }

  async function field(changes: Parameters<typeof patch>[1], saved = true) {
    const result = await patch(item, changes);
    if (result !== undefined && saved) toast("Salvo.", { ms: 1400 });
  }

  async function toggleSub(sub: WorkItem, el: HTMLElement) {
    const wasDone = isDone(state.columns, sub.columnId);
    const target = wasDone
      ? (state.columns.find((column) => column.category === "todo") ??
        state.columns[0])
      : state.columns.find((column) => column.category === "done");
    if (target === undefined) return;
    const result = await patch(sub, { columnId: target.id });
    if (result === undefined) return;
    if (!wasDone) {
      const box = el.getBoundingClientRect();
      burst(box.left + 11, box.top + 11, { count: 12, power: 4, size: 3 });
      blip("ok");
      const allDone = subs.every((value) =>
        value.id === sub.id ? true : isDone(state.columns, value.columnId),
      );
      if (allDone && !done) {
        toast("Todas as subtarefas concluídas.", {
          act: [
            "Concluir atividade",
            () => void move(state, item, doneColumnId()),
          ],
        });
      }
    } else if (done) {
      const reopen =
        state.columns.find((column) => column.category === "in_progress") ??
        state.columns[0];
      if (reopen !== undefined) {
        await patch(item, { columnId: reopen.id });
        toast(
          "Atividade reaberta porque uma subtarefa voltou a ficar aberta.",
          { icon: "rot" },
        );
      }
    }
  }

  function doneColumnId(): string {
    return (
      state.columns.find((column) => column.category === "done")?.id ??
      item.columnId
    );
  }

  const sprint = sprints.find((value) => value.id === item.sprintId);
  const assignee =
    item.assigneeId === undefined ? undefined : people.get(item.assigneeId);
  const doneColumn = state.columns.find((column) => column.category === "done");

  return (
    <>
      <div className="scrim dscrim" onClick={closeSoon} />
      <aside
        aria-label={`Detalhe da atividade: ${item.title}`}
        className={`drawer${leaving ? " out" : ""}`}
        role="dialog"
      >
        <div className="dh">
          <span className="tag">
            <i
              className="pd"
              style={{ background: projectColor(state.project.color) }}
            />
            {state.project.name}
          </span>
          <span className="mono xs muted">
            {item.id.slice(0, 8).toUpperCase()}
          </span>
          <span className="grow" />
          <button
            aria-pressed={following}
            className="btn sm"
            onClick={() => {
              const next = !following;
              setFollowingState(next);
              setFollowing(client, csrfToken(), item.id, next)
                .then(() =>
                  toast(
                    next
                      ? "Você receberá eventos deste item dentro do app."
                      : "Você deixou de seguir.",
                    { icon: "bell" },
                  ),
                )
                .catch(() => {
                  setFollowingState(!next);
                  toast("Não foi possível alterar agora.", { kind: "err" });
                });
            }}
            type="button"
          >
            <Icon name="bell" size="sm" />
            {following ? "Seguindo" : "Seguir"}
          </button>
          <button
            aria-label="Mais ações"
            className="iconbtn"
            onClick={(event) => more.toggle(event.currentTarget, undefined)}
            type="button"
          >
            <Icon name="more" />
          </button>
          <button
            aria-label="Fechar detalhe"
            className="iconbtn"
            onClick={closeSoon}
            ref={close}
            type="button"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="db">
          <div>
            <input
              aria-label="Título"
              className="titleinp"
              maxLength={200}
              onBlur={() => void saveText("title", title)}
              onChange={(event) => setTitle(event.target.value)}
              readOnly={!canEdit}
              value={title}
            />
          </div>
          {conflict === null ? null : (
            <Banner kind="warn" role="alert">
              <div className="col gap8">
                <div>
                  <b>Outra pessoa alterou este item enquanto você editava.</b>{" "}
                  Sua alteração não foi aplicada (versão v{item.version}).
                  Compare e escolha.
                </div>
                <div className="row gap12 wrap">
                  <div className="card pad grow" style={{ padding: 10 }}>
                    <span className="xs muted">Atual</span>
                    <div>
                      {conflict.field === "title"
                        ? item.title
                        : item.description}
                    </div>
                  </div>
                  <div className="card pad grow" style={{ padding: 10 }}>
                    <span className="xs muted">Sua versão</span>
                    <div>{conflict.mine}</div>
                  </div>
                </div>
                <div className="row gap8">
                  <button
                    className="btn sm"
                    onClick={() => setConflict(null)}
                    type="button"
                  >
                    Recarregar e usar a atual
                  </button>
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      const kept = conflict;
                      setConflict(null);
                      void saveItem(client, csrfToken(), state.crypto, item, {
                        title: kept.field === "title" ? kept.mine : item.title,
                        description:
                          kept.field === "description"
                            ? kept.mine
                            : item.description,
                        priority: item.priority,
                      })
                        .then(() =>
                          toast("Sua versão foi salva sobre a mais recente."),
                        )
                        .catch(() =>
                          toast("Não foi possível salvar.", { kind: "err" }),
                        )
                        .finally(() => void run(async () => undefined));
                    }}
                    type="button"
                  >
                    Manter a minha por cima
                  </button>
                </div>
              </div>
            </Banner>
          )}
          {!canEdit ? (
            <Banner icon="lock">
              {readable ? (
                <>
                  Seu perfil neste projeto permite{" "}
                  <b>{canComment ? "ler e comentar" : "apenas ler"}</b>. Campos
                  de edição estão bloqueados.
                </>
              ) : (
                <>
                  Este conteúdo está cifrado e não pôde ser lido neste
                  navegador; a edição está desativada.
                </>
              )}
            </Banner>
          ) : null}
          <dl className="props">
            <dt>
              <Icon name="board" size="sm" />
              Estado
            </dt>
            <dd>
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
            </dd>
            <dt>
              <Icon name="user" size="sm" />
              Responsável
            </dt>
            <dd>
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
            </dd>
            <dt>
              <Icon name="cal" size="sm" />
              Prazo
            </dt>
            <dd>
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
              {item.dueDate !== undefined &&
              daysTo(item.dueDate) < 0 &&
              !done ? (
                <span className="tag danger">
                  <Icon name="alert" size="sm" />
                  Atrasada
                </span>
              ) : item.dueDate !== undefined ? (
                <span className="xs muted">{dueLabel(item.dueDate)}</span>
              ) : null}
            </dd>
            <dt>
              <Icon name="flag" size="sm" />
              Prioridade
            </dt>
            <dd>
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
            </dd>
            <dt>
              <Icon name="layers" size="sm" />
              Épico
            </dt>
            <dd>
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
            </dd>
            <dt>
              <Icon name="clock" size="sm" />
              Sprint
            </dt>
            <dd>
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
                    (value) =>
                      value.state !== "closed" || value.id === item.sprintId,
                  )
                  .map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                      {value.state === "active" ? " (ativa)" : ""}
                    </option>
                  ))}
              </select>
            </dd>
          </dl>
          <div className="field">
            <label htmlFor="ds">Descrição</label>
            <textarea
              className="inp"
              id="ds"
              maxLength={50000}
              onBlur={() => void saveText("description", description)}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Sem descrição"
              readOnly={!canEdit}
              rows={4}
              value={description}
            />
            <span className="hint">
              Até 50 mil caracteres
              {encrypted ? " · cifrado neste dispositivo" : ""}
            </span>
          </div>
          <section aria-labelledby="sth">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 className="h2" id="sth">
                Subtarefas
              </h3>
              <span className="xs muted num">
                {finished}/{subs.length}
              </span>
              <Pbar
                block={8}
                on={
                  subs
                    .slice(0, 10)
                    .filter((sub) => isDone(state.columns, sub.columnId)).length
                }
                total={Math.min(10, subs.length)}
              />
            </div>
            <div className="col">
              {subs.map((sub) => {
                const subDone = isDone(state.columns, sub.columnId);
                const owner =
                  sub.assigneeId === undefined
                    ? undefined
                    : people.get(sub.assigneeId);
                return (
                  <div
                    className="row"
                    key={sub.id}
                    style={{
                      padding: "8px 0",
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    <button
                      aria-checked={subDone}
                      aria-label={`Concluir subtarefa ${sub.title}`}
                      className="chk sq"
                      disabled={!canMove}
                      onClick={(event) =>
                        void toggleSub(sub, event.currentTarget)
                      }
                      role="checkbox"
                      style={{ margin: 0 }}
                      type="button"
                    >
                      <Icon name="check" />
                    </button>
                    <span
                      className="grow"
                      style={
                        subDone
                          ? {
                              textDecoration: "line-through",
                              color: "var(--ink-2)",
                            }
                          : undefined
                      }
                    >
                      {sub.title}
                    </span>
                    {sub.dueDate === undefined ? null : (
                      <span className="xs muted">
                        <Icon name="cal" size="sm" /> {fmtD(sub.dueDate)}
                      </span>
                    )}
                    {owner === undefined ? (
                      <NoAvatar size="sm" />
                    ) : (
                      <Avatar email={owner.email} id={owner.id} size="sm" />
                    )}
                  </div>
                );
              })}
              {can(state, "work.create") && readable ? (
                <form
                  className="row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = subtask.trim();
                    if (value === "") return;
                    void run(async () => {
                      await createItem(
                        client,
                        csrfToken(),
                        state.crypto,
                        state.project.id,
                        {
                          kind: "subtask",
                          parentId: item.id,
                          title: value,
                          ...(item.assigneeId === undefined
                            ? {}
                            : { assigneeId: item.assigneeId }),
                        },
                      );
                      setSubtask("");
                    });
                  }}
                  style={{ paddingTop: 10, borderTop: "1px solid var(--line)" }}
                >
                  <input
                    aria-label="Nova subtarefa"
                    className="inp"
                    maxLength={200}
                    onChange={(event) => setSubtask(event.target.value)}
                    placeholder="Adicionar subtarefa"
                    style={{ height: 36 }}
                    value={subtask}
                  />
                  <button className="btn sm" type="submit">
                    <Icon name="plus" size="sm" />
                    Adicionar
                  </button>
                </form>
              ) : null}
            </div>
          </section>
          <Attachments
            canUpload={can(state, "files.upload")}
            client={client}
            context={{
              contextType: "work_item",
              contextId: item.id,
              projectId: item.projectId,
            }}
          />
          <section>
            <h3 className="h2" style={{ marginBottom: 10 }}>
              Comentários
            </h3>
            <div className="col gap12" id="cmts">
              {comments === null ? (
                <p className="muted sm">Carregando…</p>
              ) : null}
              {comments !== null && comments.length === 0 ? (
                <p className="muted sm">Seja a primeira pessoa a comentar.</p>
              ) : null}
              {(comments ?? []).map((entryComment) => (
                <div
                  className="row"
                  key={entryComment.id}
                  style={{ alignItems: "flex-start", gap: 12 }}
                >
                  <Avatar
                    email={entryComment.authorEmail}
                    id={entryComment.authorId ?? entryComment.authorEmail}
                    size="lg"
                  />
                  <div className="grow">
                    <div className="row gap8">
                      <b>{nameOf(entryComment.authorEmail)}</b>
                      <time className="xs muted">
                        {new Date(entryComment.createdAt).toLocaleString(
                          "pt-BR",
                          {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </time>
                    </div>
                    <div style={{ marginTop: 2, lineHeight: 1.5 }}>
                      <Rich mentions={mentionable} text={entryComment.body} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {canComment ? (
              <form
                className="col gap8"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = comment.trim();
                  if (value === "") return;
                  void run(async () => {
                    await createCommentContent(
                      client,
                      csrfToken(),
                      state.crypto,
                      item.id,
                      value,
                    );
                    setComment("");
                    await load();
                    blip("ok");
                  });
                }}
                style={{ marginTop: 14 }}
              >
                <textarea
                  aria-label="Novo comentário"
                  className="inp"
                  maxLength={10000}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Comente. Use @ para mencionar quem tem acesso ao projeto."
                  rows={2}
                  value={comment}
                />
                <div className="row">
                  <span className="xs muted grow">
                    <Icon name="lock" size="sm" /> Cifrado antes de sair do
                    navegador
                  </span>
                  <button className="btn primary sm" type="submit">
                    Comentar
                  </button>
                </div>
              </form>
            ) : (
              <p className="muted sm" style={{ marginTop: 12 }}>
                Seu perfil não permite comentar.
              </p>
            )}
          </section>
          <details>
            <summary className="h2" style={{ cursor: "pointer" }}>
              Histórico
            </summary>
            <ul className="feed" style={{ marginTop: 8 }}>
              <li>
                {assignee === undefined ? (
                  <NoAvatar size="sm" />
                ) : (
                  <Avatar email={assignee.email} id={assignee.id} size="sm" />
                )}
                <span>
                  Versão atual <b className="mono">v{item.version}</b>
                  {sprint === undefined ? "" : ` · ${sprint.name}`}
                </span>
              </li>
              <li>
                <span className="xs muted">
                  Criada em{" "}
                  {new Date(item.createdAt).toLocaleDateString("pt-BR")} ·
                  atualizada em{" "}
                  {new Date(item.updatedAt).toLocaleDateString("pt-BR")}.
                  Valores antigos de texto não ficam em claro no servidor.
                </span>
              </li>
            </ul>
          </details>
        </div>
        <div className="df row">
          {encrypted ? (
            <span className="lock">
              <Icon name="lock" size="sm" />
              Cifrado ponta a ponta
            </span>
          ) : null}
          <span className="xs muted grow mono">v{item.version}</span>
          {done ? (
            canMove ? (
              <button
                className="btn"
                onClick={() => {
                  const reopen =
                    state.columns.find(
                      (column) => column.category === "in_progress",
                    ) ?? state.columns[0];
                  if (reopen !== undefined) void move(state, item, reopen.id);
                }}
                type="button"
              >
                Reabrir
              </button>
            ) : null
          ) : canMove && doneColumn !== undefined ? (
            <button
              className="btn accent"
              onClick={() => void move(state, item, doneColumn.id)}
              type="button"
            >
              <Icon name="check" size="sm" />
              Concluir atividade
            </button>
          ) : null}
        </div>
      </aside>
      {more.state === null ? null : (
        <Menu anchor={more.state.anchor} onClose={more.close} right>
          <button
            onClick={() => {
              more.close();
              void navigator.clipboard
                ?.writeText(`${window.location.origin}/#/work/${item.id}`)
                .then(() =>
                  toast("Link copiado. Só abre para quem tem acesso.", {
                    icon: "link",
                  }),
                )
                .catch(() =>
                  toast("Não foi possível copiar o link.", { kind: "err" }),
                );
            }}
            role="menuitem"
            type="button"
          >
            <Icon name="link" size="sm" />
            Copiar link
          </button>
          {can(state, "work.archive") ? (
            <>
              <hr />
              <button
                onClick={() => {
                  more.close();
                  void patch(item, { archived: true }).then((result) => {
                    if (result === undefined) return;
                    closeSoon();
                    toast("Atividade arquivada.", {
                      act: [
                        "Desfazer",
                        () => void patch(result, { archived: false }),
                      ],
                    });
                  });
                }}
                role="menuitem"
                type="button"
              >
                <Icon name="trash" size="sm" />
                Arquivar
              </button>
            </>
          ) : null}
        </Menu>
      )}
    </>
  );
}
