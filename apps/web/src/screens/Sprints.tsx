import {
  closeSprint,
  getSprintClosePreview,
  startSprint,
  updateWorkItem,
  type CurrentAccount,
  type Sprint,
  type SprintClosePreview,
  type WorkItem,
} from "@crewstead/api-client";
import { useEffect, useMemo, useState } from "react";
import { showFinale } from "../design/celebrate";
import { addDays, daysTo, fmtD, todayIso } from "../design/format";
import { Icon } from "../design/icons";
import { Menu, useMenu } from "../design/Menu";
import { Modal } from "../design/Modal";
import { Avatar, Banner, NoAvatar, Pbar } from "../design/primitives";
import { go } from "../design/router";
import { blip } from "../design/sound";
import { Duo } from "../design/Sprite";
import { toast } from "../design/toast";
import { createSprintContent, encryptSprint } from "../e2ee/content";
import { csrfToken, describeError } from "../errors";
import { Page } from "../shell/Page";
import { projectColor } from "../shell/Sidebar";
import { can, isDone, useWorkspace, type ProjectState } from "../workspace";

type Row = { item: WorkItem; state: ProjectState };

function Progress({ rows }: { rows: Row[] }) {
  const done = rows.filter(({ item, state }) =>
    isDone(state.columns, item.columnId),
  ).length;
  const blocks = 20;
  const on = rows.length > 0 ? Math.round((done / rows.length) * blocks) : 0;
  return (
    <div className="row">
      <Pbar
        label={`${done} de ${rows.length} concluídas`}
        on={on}
        stagger={25}
        total={blocks}
      />
      <span className="num sm muted">
        <b style={{ color: "var(--ink)" }}>{done}</b>/{rows.length}
      </span>
    </div>
  );
}

export function Sprints({ account }: { account: CurrentAccount }) {
  const {
    client,
    projects,
    sprints,
    people,
    run,
    orgCrypto,
    orgKeyed,
    unlocked,
    reload,
  } = useWorkspace();
  const [newOpen, setNewOpen] = useState(false);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const toSprint = useMenu<Row>();
  const canPlan = account.isAdmin;

  const rows = useMemo<Row[]>(
    () =>
      (projects ?? []).flatMap((state) =>
        state.items
          .filter((item) => item.kind === "task")
          .map((item) => ({ item, state })),
      ),
    [projects],
  );
  const active = sprints.find((sprint) => sprint.state === "active");
  const planned = sprints.filter((sprint) => sprint.state === "planned");
  const closed = sprints.filter((sprint) => sprint.state === "closed");
  const backlog = rows.filter(
    ({ item, state }) =>
      item.sprintId === undefined && !isDone(state.columns, item.columnId),
  );
  const loading = projects === null;

  const activeRows =
    active === undefined
      ? []
      : rows.filter(({ item }) => item.sprintId === active.id);
  const byProject = new Map<string, Row[]>();
  for (const row of activeRows) {
    byProject.set(row.state.project.id, [
      ...(byProject.get(row.state.project.id) ?? []),
      row,
    ]);
  }
  const left = active === undefined ? 0 : Math.max(0, daysTo(active.endsOn));

  async function encryptNames() {
    if (orgCrypto === null) return;
    await run(async () => {
      await orgCrypto.enable(csrfToken);
      for (const sprint of sprints) {
        if (!sprint.encrypted)
          await encryptSprint(client, csrfToken(), orgCrypto, sprint);
      }
    });
    toast("Nomes e objetivos das sprints agora são cifrados.", {
      icon: "shieldOk",
    });
  }

  return (
    <Page
      cta={
        canPlan ? (
          <button
            className="btn primary"
            onClick={() => setNewOpen(true)}
            type="button"
          >
            <Icon name="plus" /> Nova sprint
          </button>
        ) : null
      }
      sub="Uma sprint da equipe pode reunir atividades de vários projetos."
      title="Sprints"
    >
      {account.isAdmin && unlocked && !orgKeyed && sprints.length > 0 ? (
        <Banner kind="warn" style={{ marginBottom: 16 }}>
          <b>Nomes e objetivos das sprints ainda ficam em texto claro.</b>{" "}
          <button
            className="btn sm"
            onClick={() => void encryptNames()}
            type="button"
          >
            Cifrar nomes de sprints
          </button>
        </Banner>
      ) : null}
      {orgKeyed && !unlocked ? (
        <Banner icon="lock" kind="warn" style={{ marginBottom: 16 }}>
          Libere a criptografia deste navegador para ler os nomes das sprints.{" "}
          <button
            className="btn sm"
            onClick={() => go("settings/dispositivos")}
            type="button"
          >
            Abrir dispositivos
          </button>
        </Banner>
      ) : null}
      <div className="grid2">
        <div className="stack">
          {active === undefined ? (
            <section aria-label="Sem sprint ativa" className="card empty">
              <div className="emp-sp">
                <Duo pose="sleep" scale={3} />
              </div>
              <h3>{loading ? "Carregando…" : "Nenhuma sprint ativa"}</h3>
              {loading ? null : (
                <p>
                  Escolha uma sprint planejada para começar. A abertura é
                  manual: datas orientam, não disparam nada sozinhas.
                </p>
              )}
            </section>
          ) : (
            <section aria-label="Sprint ativa" className="card sprint-card">
              <div className="row wrap">
                <span className="tag lime">Ativa</span>
                <h2 className="h2">{active.name}</h2>
                <span className="muted">{active.goal}</span>
                <span className="grow" />
                <span className="sm muted">
                  {fmtD(active.startsOn)} a {fmtD(active.endsOn)} · {left} dias
                  restantes
                </span>
                {canPlan ? (
                  <button
                    className="btn accent"
                    onClick={() => setClosing(active)}
                    type="button"
                  >
                    <Icon name="check" size="sm" />
                    Encerrar sprint
                  </button>
                ) : null}
              </div>
              <Progress rows={activeRows} />
              {account.membershipKind === "external" ? (
                <Banner icon="eye">
                  Você vê somente a projeção da sprint para os projetos que pode
                  ler. Totais de outros projetos não aparecem.
                </Banner>
              ) : null}
              <div className="col">
                {[...byProject.entries()].map(([projectId, list]) => {
                  const state = list[0]?.state;
                  if (state === undefined) return null;
                  return (
                    <div
                      key={projectId}
                      style={{
                        padding: "10px 0",
                        borderTop: "1px solid var(--line)",
                      }}
                    >
                      <div className="row" style={{ marginBottom: 6 }}>
                        <i
                          className="pd"
                          style={{
                            background: projectColor(state.project.color),
                          }}
                        />
                        <b>{state.project.name}</b>
                        <span className="xs muted num">
                          {
                            list.filter(({ item }) =>
                              isDone(state.columns, item.columnId),
                            ).length
                          }
                          /{list.length}
                        </span>
                      </div>
                      {list.map(({ item }) => {
                        const finished = isDone(state.columns, item.columnId);
                        const owner =
                          item.assigneeId === undefined
                            ? undefined
                            : people.get(item.assigneeId);
                        return (
                          <button
                            className="qrow"
                            key={item.id}
                            onClick={() => go(`work/${item.id}`)}
                            style={{ padding: "8px 10px" }}
                            type="button"
                          >
                            <span
                              aria-checked={finished}
                              aria-label={finished ? "concluída" : "aberta"}
                              className="chk sq"
                              role="img"
                              style={{ margin: 0, cursor: "inherit" }}
                            >
                              <Icon name="check" />
                            </span>
                            <span
                              className="grow"
                              style={
                                finished
                                  ? {
                                      textDecoration: "line-through",
                                      color: "var(--ink-2)",
                                    }
                                  : undefined
                              }
                            >
                              {item.title}
                            </span>
                            <span className="tag mute">
                              {
                                state.columns.find(
                                  (column) => column.id === item.columnId,
                                )?.name
                              }
                            </span>
                            {owner === undefined ? (
                              <NoAvatar size="sm" />
                            ) : (
                              <Avatar
                                email={owner.email}
                                id={owner.id}
                                size="sm"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {byProject.size === 0 ? (
                  <p className="muted">
                    Nenhuma atividade desta sprint está no seu acesso.
                  </p>
                ) : null}
              </div>
            </section>
          )}
          <section className="stack">
            <h2 className="h2">Planejadas</h2>
            {planned.map((sprint) => {
              const list = rows.filter(
                ({ item }) => item.sprintId === sprint.id,
              );
              return (
                <div className="card sprint-card" key={sprint.id}>
                  <div className="row wrap">
                    <span className="tag">Planejada</span>
                    <b>{sprint.name}</b>
                    <span className="muted">{sprint.goal}</span>
                    <span className="grow" />
                    <span className="sm muted">
                      {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="sm muted grow">
                      {list.length} atividades
                    </span>
                    {canPlan ? (
                      <button
                        className="btn sm"
                        disabled={active !== undefined}
                        onClick={() => {
                          void run(() =>
                            startSprint(client, csrfToken(), sprint.id),
                          ).then((started) => {
                            if (started === undefined) return;
                            blip("ok");
                            toast(`${sprint.name} iniciada.`, {
                              mascot: "tela",
                              pose: "wave",
                            });
                          });
                        }}
                        title={
                          active === undefined
                            ? undefined
                            : "Já existe uma sprint ativa. Encerre-a antes de iniciar outra."
                        }
                        type="button"
                      >
                        Iniciar sprint
                      </button>
                    ) : null}
                  </div>
                  {list.slice(0, 4).map(({ item, state }) => (
                    <div className="row sm" key={item.id}>
                      <i
                        className="pd"
                        style={{
                          background: projectColor(state.project.color),
                        }}
                      />
                      {item.title}
                    </div>
                  ))}
                </div>
              );
            })}
            {planned.length === 0 ? (
              <p className="muted">Nenhuma sprint planejada.</p>
            ) : null}
          </section>
        </div>
        <div className="stack">
          <section className="card pad">
            <div className="row">
              <h2 className="h2 grow">Backlog</h2>
              <span className="tag mute num">{backlog.length}</span>
            </div>
            <p className="xs muted" style={{ margin: "4px 0 8px" }}>
              Atividades sem sprint corrente.
            </p>
            {backlog.map((row) => (
              <div
                className="row"
                key={row.item.id}
                style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}
              >
                <i
                  className="pd"
                  style={{ background: projectColor(row.state.project.color) }}
                />
                <span className="grow sm">{row.item.title}</span>
                {canPlan && can(row.state, "planning.edit") ? (
                  <button
                    className="btn sm ghost"
                    onClick={(event) =>
                      toSprint.toggle(event.currentTarget, row)
                    }
                    type="button"
                  >
                    <Icon name="plus" size="sm" />
                    Sprint
                  </button>
                ) : null}
              </div>
            ))}
            {backlog.length === 0 ? (
              <p className="muted sm">Backlog vazio.</p>
            ) : null}
          </section>
          <section className="card pad">
            <h2 className="h2" style={{ marginBottom: 6 }}>
              Encerradas
            </h2>
            {closed.map((sprint) => {
              const list = rows.filter(
                ({ item }) => item.sprintId === sprint.id,
              );
              const finished = list.filter(({ item, state }) =>
                isDone(state.columns, item.columnId),
              ).length;
              return (
                <div className="list-i" key={sprint.id}>
                  <div className="grow col">
                    <b>{sprint.name}</b>
                    <span className="xs muted">
                      {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)}
                      {sprint.goal === "" ? "" : ` · ${sprint.goal}`}
                    </span>
                  </div>
                  <span className="tag lime num">{finished} concluídas</span>
                </div>
              );
            })}
            {closed.length === 0 ? (
              <p className="muted sm">Nenhuma sprint encerrada.</p>
            ) : null}
          </section>
        </div>
      </div>
      {toSprint.state === null ? null : (
        <Menu anchor={toSprint.state.anchor} onClose={toSprint.close} right>
          <div className="mh">Adicionar à sprint</div>
          {sprints
            .filter((sprint) => sprint.state !== "closed")
            .map((sprint) => (
              <button
                key={sprint.id}
                onClick={() => {
                  const row = toSprint.state?.data;
                  toSprint.close();
                  if (row === undefined) return;
                  void run(() =>
                    updateWorkItem(client, csrfToken(), row.item.id, {
                      version: row.item.version,
                      sprintId: sprint.id,
                    }),
                  ).then((moved) => {
                    if (moved !== undefined)
                      toast("Atividade e subtarefas movidas para a sprint.");
                  });
                }}
                role="menuitem"
                type="button"
              >
                {sprint.name}
                {sprint.state === "active" ? " (ativa)" : ""}
              </button>
            ))}
        </Menu>
      )}
      {newOpen ? <NewSprint onClose={() => setNewOpen(false)} /> : null}
      {closing === null ? null : (
        <CloseWizard
          onClose={() => {
            setClosing(null);
            void reload();
          }}
          planned={planned}
          sprint={closing}
        />
      )}
    </Page>
  );
}

function NewSprint({ onClose }: { onClose: () => void }) {
  const { client, run, orgCrypto, sprints } = useWorkspace();
  const next = sprints.length + 1;
  const [name, setName] = useState(`Sprint ${next}`);
  const [goal, setGoal] = useState("");
  const [starts, setStarts] = useState(addDays(todayIso(), 7));
  const [ends, setEnds] = useState(addDays(todayIso(), 20));
  const [error, setError] = useState("");
  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Nova sprint</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (starts > ends) {
            setError("O início não pode ser posterior ao fim.");
            return;
          }
          onClose();
          void run(() =>
            createSprintContent(client, csrfToken(), orgCrypto, {
              name: name.trim() === "" ? "Sprint" : name.trim(),
              ...(goal.trim() === "" ? {} : { goal: goal.trim() }),
              startsOn: starts,
              endsOn: ends,
            }),
          ).then((created) => created !== undefined && toast("Sprint criada."));
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="sn">Nome</label>
            <input
              autoFocus
              className="inp"
              id="sn"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>
          <div className="field">
            <label htmlFor="sg">Objetivo (opcional)</label>
            <input
              className="inp"
              id="sg"
              maxLength={1000}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Sem segredos de projetos que nem todos podem ver"
              value={goal}
            />
          </div>
          <div className="row gap12">
            <div className="field grow">
              <label htmlFor="s1">Início</label>
              <input
                className="inp"
                id="s1"
                onChange={(event) => setStarts(event.target.value)}
                required
                type="date"
                value={starts}
              />
            </div>
            <div className="field grow">
              <label htmlFor="s2">Fim</label>
              <input
                className="inp"
                id="s2"
                min={starts}
                onChange={(event) => setEnds(event.target.value)}
                required
                type="date"
                value={ends}
              />
            </div>
          </div>
          {error === "" ? null : (
            <Banner kind="err" role="alert">
              {error}
            </Banner>
          )}
          <Banner>
            Nome e objetivo são visíveis para todos que participam da sprint.
            Detalhes específicos ficam nas atividades de cada projeto.
          </Banner>
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Criar sprint
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CloseWizard({
  sprint,
  planned,
  onClose,
}: {
  sprint: Sprint;
  planned: Sprint[];
  onClose: () => void;
}) {
  const { client, projects, people } = useWorkspace();
  const [step, setStep] = useState(1);
  const [preview, setPreview] = useState<SprintClosePreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [choices, setChoices] = useState<Record<string, "next" | "backlog">>(
    {},
  );
  const [destination, setDestination] = useState(planned[0]?.id ?? "");
  const [conflict, setConflict] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getSprintClosePreview(client, sprint.id)
      .then((result) => {
        if (!alive) return;
        setPreview(result);
        setChoices(
          Object.fromEntries(
            result.pending.map(
              (item) =>
                [item.id, planned.length > 0 ? "next" : "backlog"] as const,
            ),
          ),
        );
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [client, sprint.id, planned.length]);

  const projectOf = (item: WorkItem) =>
    projects?.find((state) => state.project.id === item.projectId);
  const needsNext = Object.values(choices).includes("next");
  const pending = preview?.pending ?? [];
  const steps = ["Resumo", "Destino das pendências", "Revisar e encerrar"];
  const nextName =
    planned.find((entry) => entry.id === destination)?.name ?? "";

  async function confirm() {
    if (preview === null) return;
    setBusy(true);
    try {
      await closeSprint(
        client,
        csrfToken(),
        sprint.id,
        preview.pending.map((item) => ({
          workItemId: item.id,
          version: item.version,
          destination: choices[item.id] ?? "backlog",
        })),
        needsNext ? destination : undefined,
      );
      const delivered = preview.completed.length;
      const carried = Object.values(choices).filter(
        (value) => value === "next",
      ).length;
      onClose();
      showFinale({
        name: sprint.name,
        delivered,
        carried: pending.length === 0 ? 0 : carried,
      });
    } catch (error) {
      setBusy(false);
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 409
      ) {
        setConflict("Alguém alterou uma pendência durante a revisão.");
        blip("err");
        setStep(2);
        getSprintClosePreview(client, sprint.id)
          .then(setPreview)
          .catch(() => undefined);
      } else {
        toast(describeError(error), { kind: "err" });
      }
    }
  }

  return (
    <Modal label={`Encerrar ${sprint.name}`} onClose={onClose} width="760px">
      <div className="dh">
        <div className="row gap16 wrap">
          {steps.map((label, index) => (
            <span
              className={`wiz-step${index + 1 === step ? " on" : index + 1 < step ? " ok" : ""}`}
              key={label}
            >
              <b>
                {index + 1 < step ? <Icon name="check" size="sm" /> : index + 1}
              </b>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="dbd" style={{ minHeight: 260 }}>
        {failed ? (
          <p className="muted">Não foi possível carregar o resumo.</p>
        ) : null}
        {preview === null && !failed ? (
          <p className="muted">Carregando resumo…</p>
        ) : null}
        {preview !== null && step === 1 ? (
          <>
            <div className="row gap12 wrap">
              <div className="card pad grow">
                <div className="pixel" style={{ fontSize: 34, lineHeight: 1 }}>
                  {preview.completed.length}
                </div>
                <span className="muted">concluídas</span>
              </div>
              <div className="card pad grow">
                <div className="pixel" style={{ fontSize: 34, lineHeight: 1 }}>
                  {pending.length}
                </div>
                <span className="muted">pendentes</span>
              </div>
            </div>
            {preview.blocked ? (
              <Banner kind="warn" style={{ marginTop: 12 }}>
                Há pendências em projetos aos quais você não tem acesso. Peça
                acesso antes de encerrar.
              </Banner>
            ) : null}
            <h3 className="h2" style={{ marginTop: 16 }}>
              Pendências
            </h3>
            {pending.map((item) => {
              const state = projectOf(item);
              const owner =
                item.assigneeId === undefined
                  ? undefined
                  : people.get(item.assigneeId);
              return (
                <div
                  className="row"
                  key={item.id}
                  style={{
                    padding: "8px 0",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <i
                    className="pd"
                    style={{
                      background: projectColor(state?.project.color ?? ""),
                    }}
                  />
                  <span className="grow">{item.title}</span>
                  <span className="tag mute">
                    {
                      state?.columns.find(
                        (column) => column.id === item.columnId,
                      )?.name
                    }
                  </span>
                  {owner === undefined ? (
                    <NoAvatar size="sm" />
                  ) : (
                    <Avatar email={owner.email} id={owner.id} size="sm" />
                  )}
                </div>
              );
            })}
            {pending.length === 0 ? (
              <p className="muted">Nada pendente. Sprint limpa.</p>
            ) : null}
          </>
        ) : null}
        {preview !== null && step === 2 ? (
          <>
            {planned.length > 0 && needsNext ? (
              <div className="field">
                <label htmlFor="wn">Próxima sprint</label>
                <select
                  className="inp"
                  id="wn"
                  onChange={(event) => setDestination(event.target.value)}
                  value={destination}
                >
                  {planned.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {fmtD(option.startsOn)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {planned.length === 0 && pending.length > 0 ? (
              <Banner style={{ marginBottom: 8 }}>
                Não há sprint planejada. As pendências voltam ao backlog;
                planeje a próxima depois.
              </Banner>
            ) : null}
            {conflict === "" ? null : (
              <Banner kind="warn" role="alert" style={{ marginTop: 12 }}>
                <b>{conflict}</b> O resumo foi atualizado com a versão mais
                recente. Revise o destino antes de confirmar.
              </Banner>
            )}
            <h3 className="h2" style={{ marginTop: 16 }}>
              Para onde vai cada pendência?
            </h3>
            <p className="xs muted">
              Cada pendência precisa de um destino. Nada fica sem lugar.
            </p>
            {pending.map((item) => {
              const state = projectOf(item);
              const openSubs = (projects ?? [])
                .flatMap((entry) => entry.items)
                .filter(
                  (sub) =>
                    sub.parentId === item.id &&
                    !isDone(projectOf(item)?.columns ?? [], sub.columnId),
                ).length;
              return (
                <div className="dest" key={item.id}>
                  <div className="col">
                    <b style={{ fontWeight: 650 }}>{item.title}</b>
                    <span className="xs muted">
                      {state?.project.name} ·{" "}
                      {
                        state?.columns.find(
                          (column) => column.id === item.columnId,
                        )?.name
                      }
                      {openSubs > 0
                        ? ` · ${openSubs} subtarefas abertas vão junto`
                        : ""}
                    </span>
                  </div>
                  <div
                    aria-label={`Destino de ${item.title}`}
                    className="seg"
                    role="group"
                  >
                    <button
                      aria-pressed={choices[item.id] === "next"}
                      disabled={planned.length === 0}
                      onClick={() =>
                        setChoices((value) => ({ ...value, [item.id]: "next" }))
                      }
                      type="button"
                    >
                      Próxima sprint
                    </button>
                    <button
                      aria-pressed={choices[item.id] === "backlog"}
                      onClick={() =>
                        setChoices((value) => ({
                          ...value,
                          [item.id]: "backlog",
                        }))
                      }
                      type="button"
                    >
                      Backlog
                    </button>
                  </div>
                </div>
              );
            })}
            {pending.length === 0 ? (
              <p className="muted">Sem pendências para distribuir.</p>
            ) : null}
          </>
        ) : null}
        {preview !== null && step === 3 ? (
          <>
            <Banner icon="shieldOk" kind="ok">
              A API valida a lista completa de {pending.length} pendências e as
              versões vistas por você. Se alguém alterar algo durante a revisão,
              você recebe um conflito e nada é movido pela metade.
            </Banner>
            <div className="row gap12 wrap" style={{ marginTop: 14 }}>
              <div className="card pad grow">
                <span className="muted">
                  Vão para {nextName === "" ? "a próxima sprint" : nextName}
                </span>
                <div className="pixel" style={{ fontSize: 30 }}>
                  {
                    Object.values(choices).filter((value) => value === "next")
                      .length
                  }
                </div>
              </div>
              <div className="card pad grow">
                <span className="muted">Voltam ao backlog</span>
                <div className="pixel" style={{ fontSize: 30 }}>
                  {
                    Object.values(choices).filter(
                      (value) => value === "backlog",
                    ).length
                  }
                </div>
              </div>
            </div>
            <p className="xs muted" style={{ marginTop: 12 }}>
              Prazos não mudam automaticamente. O histórico da participação
              nesta sprint é preservado.
            </p>
          </>
        ) : null}
      </div>
      <div className="dft">
        {step > 1 ? (
          <button
            className="btn"
            onClick={() => setStep(step - 1)}
            type="button"
          >
            Voltar
          </button>
        ) : (
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
        )}
        {step < 3 ? (
          <button
            className="btn primary"
            disabled={preview === null || (step === 1 && preview.blocked)}
            onClick={() => setStep(step + 1)}
            type="button"
          >
            Continuar
          </button>
        ) : (
          <button
            className={`btn accent${busy ? " loading" : ""}`}
            disabled={preview === null || preview.blocked}
            onClick={() => void confirm()}
            type="button"
          >
            Encerrar sprint
          </button>
        )}
      </div>
    </Modal>
  );
}
