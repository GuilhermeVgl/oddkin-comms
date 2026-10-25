import {
  createBoardColumn,
  deleteBoardColumn,
  ApiStatusError,
  getStorageUsage,
  listOrganizationPeople,
  listSessions,
  logout,
  revokeSession,
  setPersonActive,
  reorderBoardColumns,
  updateBoardColumn,
  type AuthSession,
  type BoardColumn,
  type CurrentAccount,
  type OrganizationPerson,
  type RecoveryAuditEntry,
  type RecoveryGap,
} from "@oddkin/api-client";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog } from "../design/confirm";
import { bytes, rel } from "../design/format";
import { Icon, type IconName } from "../design/icons";
import { Modal } from "../design/Modal";
import { nameOf } from "../design/people";
import { getPrefs, setPrefs, usePrefs } from "../design/prefs";
import { Avatar, Banner, Pbar } from "../design/primitives";
import { go } from "../design/router";
import { blip } from "../design/sound";
import { Duo } from "../design/Sprite";
import { toast } from "../design/toast";
import { useE2EE } from "../e2ee/E2EE";
import { csrfToken } from "../errors";
import { Page } from "../shell/Page";
import { roleOf } from "../shell/Sidebar";
import { projectColor } from "../shell/Sidebar";
import { useShell } from "../shell/context";
import { useWorkspace } from "../workspace";

const TABS = [
  ["perfil", "Perfil e aparência"],
  ["dispositivos", "Dispositivos"],
  ["colunas", "Colunas"],
  ["pessoas", "Pessoas"],
  ["armazenamento", "Armazenamento"],
  ["recuperacao", "Recuperação"],
] as const;

type Tab = (typeof TABS)[number][0];

function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={on}
      aria-label={label}
      className="sw"
      onClick={onToggle}
      role="switch"
      type="button"
    />
  );
}

function Profile({ account }: { account: CurrentAccount }) {
  const prefs = usePrefs();
  return (
    <div className="stack">
      <section className="card pad col gap16">
        <div className="row gap16">
          <Avatar email={account.email} id={account.id} size="xl" />
          <div className="col gap4">
            <h2 className="h2">{nameOf(account.email)}</h2>
            <span className="muted">{account.email}</span>
            <span className="tag mute" style={{ width: "fit-content" }}>
              {roleOf(account)}
            </span>
          </div>
        </div>
        <p className="xs muted">
          E-mail e nome de perfil ficam acessíveis ao backend. O conteúdo de
          trabalho, não.
        </p>
      </section>
      <section className="card pad col gap16">
        <h2 className="h2">Aparência e movimento</h2>
        <div className="row">
          <div className="grow col">
            <b>Tema</b>
            <span className="xs muted">
              Papel é o padrão. Carvão para ambientes escuros.
            </span>
          </div>
          <div aria-label="Tema" className="seg" role="group">
            <button
              aria-pressed={prefs.theme === "papel"}
              onClick={() => setPrefs({ theme: "papel" })}
              type="button"
            >
              <Icon name="sun" size="sm" />
              Papel
            </button>
            <button
              aria-pressed={prefs.theme === "carvao"}
              onClick={() => setPrefs({ theme: "carvao" })}
              type="button"
            >
              <Icon name="moon" size="sm" />
              Carvão
            </button>
          </div>
        </div>
        <hr className="sep" />
        <div className="row">
          <div className="grow col">
            <b>Reduzir animações</b>
            <span className="xs muted">
              Troca movimento por fade leve. Personagens ficam parados e
              celebrações viram um aviso discreto.
            </span>
          </div>
          <Switch
            label="Reduzir animações"
            on={!prefs.motion}
            onToggle={() => setPrefs({ motion: !getPrefs().motion })}
          />
        </div>
        <hr className="sep" />
        <div className="row">
          <div className="grow col">
            <b>Sons discretos</b>
            <span className="xs muted">
              Bips curtos ao concluir. Desligado por padrão, só depois de um
              clique seu.
            </span>
          </div>
          <Switch
            label="Sons discretos"
            on={prefs.sound}
            onToggle={() => {
              setPrefs({ sound: !getPrefs().sound });
              if (getPrefs().sound) blip("ok");
            }}
          />
        </div>
        <hr className="sep" />
        <div className="row">
          <div className="grow col">
            <b>Prévia dos personagens</b>
            <span className="xs muted">
              Capuz e Tela aparecem em estados vazios e marcos. Sem pontos,
              níveis ou rankings.
            </span>
          </div>
          <div style={{ display: "flex" }}>
            <Duo pose="wave" scale={3} />
          </div>
        </div>
      </section>
      <section className="card pad col gap8">
        <h2 className="h2">Notificações</h2>
        <p className="muted">
          Apenas dentro do app: mensagens, menções, atribuições e chamadas. Sem
          e-mail ou push de atividade. E-mails existem só para convite e conta.
        </p>
      </section>
    </div>
  );
}

function SessionsCard({ onLogout }: { onLogout: () => void }) {
  const { client } = useWorkspace();
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const load = useCallback(() => {
    listSessions(client)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [client]);
  useEffect(load, [load]);

  return (
    <section className="card pad col gap12">
      <h2 className="h2">Sessões abertas</h2>
      {sessions === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="col gap8" style={{ listStyle: "none", padding: 0 }}>
          {sessions.map((entry) => (
            <li className="row gap8" key={entry.id}>
              <div className="grow col">
                <b>{entry.current ? "Esta sessão" : "Outra sessão"}</b>
                <span className="xs muted">
                  Iniciada {rel(entry.createdAt)} · ativa{" "}
                  {rel(entry.lastSeenAt)}
                </span>
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  revokeSession(client, csrfToken(), entry.id)
                    .then(() => {
                      if (entry.current) onLogout();
                      else {
                        toast("Sessão encerrada.", { icon: "check" });
                        load();
                      }
                    })
                    .catch(() =>
                      toast("Não foi possível encerrar.", { kind: "err" }),
                    );
                }}
                type="button"
              >
                {entry.current ? "Sair" : "Encerrar"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Administrators see everyone in the organization and can switch accounts off. */
function People({ account }: { account: CurrentAccount }) {
  const { client } = useWorkspace();
  const [people, setPeople] = useState<OrganizationPerson[] | null>(null);
  const load = useCallback(() => {
    listOrganizationPeople(client)
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [client]);
  useEffect(load, [load]);

  async function toggle(person: OrganizationPerson) {
    if (person.active) {
      const ok = await confirmDialog({
        title: `Desativar ${nameOf(person.email)}?`,
        body: (
          <p className="muted">
            Todas as sessões terminam agora e a pessoa não consegue entrar. Os
            registros dela continuam nos projetos. Você pode reativar a conta
            depois.
          </p>
        ),
        ok: "Desativar",
        danger: true,
      });
      if (ok !== true) return;
    }
    try {
      await setPersonActive(client, csrfToken(), person.id, !person.active);
      toast(person.active ? "Conta desativada." : "Conta reativada.", {
        icon: "check",
      });
      load();
    } catch (error) {
      toast(
        error instanceof ApiStatusError && error.status === 409
          ? "A organização precisa de ao menos um administrador ativo."
          : "Não foi possível alterar a conta.",
        { kind: "err" },
      );
    }
  }

  return (
    <section className="card pad col gap12">
      <h2 className="h2">Pessoas da organização</h2>
      {people === null ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="col gap8" style={{ listStyle: "none", padding: 0 }}>
          {people.map((person) => (
            <li className="row gap8" key={person.id}>
              <Avatar email={person.email} id={person.id} size="sm" />
              <div className="grow col">
                <b>{nameOf(person.email)}</b>
                <span className="xs muted">
                  {person.email} ·{" "}
                  {person.isAdmin
                    ? "Administração"
                    : person.membershipKind === "internal"
                      ? "Interno"
                      : "Externo"}
                  {person.active ? "" : " · desativada"}
                </span>
              </div>
              {person.id === account.id ? null : (
                <button
                  className="btn sm"
                  onClick={() => void toggle(person)}
                  type="button"
                >
                  {person.active ? "Desativar" : "Reativar"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Devices({
  account,
  onLogout,
}: {
  account: CurrentAccount;
  onLogout: () => void;
}) {
  const e2ee = useE2EE();
  const { openGate } = useShell();
  const { client } = useWorkspace();
  const [busy, setBusy] = useState(false);

  async function approve(index: number) {
    const approval = e2ee.approvals[index];
    if (approval === undefined) return;
    const ok = await confirmDialog({
      title: "Aprovar este dispositivo?",
      body: (
        <>
          <p className="muted">
            Confira se a impressão digital é a mesma exibida no dispositivo
            novo:
          </p>
          <p className="fp" style={{ fontSize: 15, margin: "10px 0" }}>
            {approval.fingerprint}
          </p>
        </>
      ),
      ok: "Sequências iguais, aprovar",
    });
    if (ok !== true) return;
    try {
      await e2ee.approve(approval);
      toast("Dispositivo aprovado. Envelopes assinados serão entregues.", {
        icon: "shieldOk",
      });
    } catch {
      toast("Este navegador não pode aprovar esse dispositivo.", {
        kind: "err",
      });
    }
  }

  async function revoke(id: string, name: string) {
    const ok = await confirmDialog({
      title: `Revogar ${name}?`,
      body: (
        <p className="muted">
          Sessões e conexões deste dispositivo caem agora e ele não recebe novos
          envelopes. Conteúdo já descriptografado nele não pode ser apagado à
          distância.
        </p>
      ),
      ok: "Revogar",
      danger: true,
    });
    if (ok !== true) return;
    try {
      await e2ee.revoke(id);
      toast("Dispositivo revogado.", { icon: "lock" });
    } catch {
      toast("Não foi possível revogar.", { kind: "err" });
    }
  }

  const ready = e2ee.phase === "unlocked";
  return (
    <div className="stack">
      <Banner icon="shield">
        Entrar na conta e conseguir descriptografar são coisas diferentes. Um
        dispositivo novo só lê o histórico depois de aprovado por um dispositivo
        confiável ou pelo administrador de recuperação.
      </Banner>
      {ready ? null : (
        <section className="card pad row">
          <div className="grow col">
            <b>
              {e2ee.phase === "locked"
                ? "Este navegador está bloqueado"
                : e2ee.phase === "not_configured"
                  ? "A criptografia ainda não foi ativada"
                  : e2ee.phase === "needs_device"
                    ? "Este navegador ainda não foi registrado"
                    : e2ee.phase === "pending_approval"
                      ? "Este dispositivo aguarda liberação"
                      : "Segurança deste navegador"}
            </b>
            <span className="xs muted">
              {e2ee.phase === "not_configured" && !account.isAdmin
                ? "A administração ainda não ativou a criptografia."
                : "Abra o assistente para continuar."}
            </span>
          </div>
          {e2ee.phase === "not_configured" && !account.isAdmin ? null : (
            <button className="btn primary" onClick={openGate} type="button">
              Abrir assistente
            </button>
          )}
        </section>
      )}
      {e2ee.approvals.length > 0 ? (
        <section className="card pad">
          <h2 className="h2" style={{ marginBottom: 6 }}>
            Aguardando liberação
          </h2>
          {e2ee.approvals.map((approval, index) => (
            <div className="list-i" key={approval.deviceId}>
              <span
                className="av lg"
                style={{
                  background: "var(--brand-tint)",
                  color: "var(--brand-ink)",
                }}
              >
                <Icon name="laptop" />
              </span>
              <div className="grow col">
                <b>
                  {nameOf(approval.email)} · {approval.name}
                  <span className="tag warn" style={{ marginLeft: 6 }}>
                    aguardando liberação
                  </span>
                </b>
                <span className="fp">{approval.fingerprint}</span>
              </div>
              <button
                className="btn sm primary"
                onClick={() => void approve(index)}
                type="button"
              >
                Aprovar
              </button>
              <button
                className="btn sm"
                onClick={() => void revoke(approval.deviceId, approval.name)}
                type="button"
              >
                Recusar
              </button>
            </div>
          ))}
        </section>
      ) : null}
      <section className="card pad">
        {e2ee.devices.length === 0 ? (
          <p className="muted sm">Nenhum dispositivo registrado.</p>
        ) : null}
        {e2ee.devices.map((device) => {
          const icon: IconName = /phone|iphone|android|mobile/i.test(
            device.name,
          )
            ? "phoneDev"
            : "laptop";
          return (
            <div className="list-i" key={device.id}>
              <span
                className="av lg"
                style={{
                  background: "var(--brand-tint)",
                  color: "var(--brand-ink)",
                }}
              >
                <Icon name={icon} />
              </span>
              <div className="grow col">
                <b>
                  {device.name}
                  {device.state === "pending" ? (
                    <span className="tag warn"> aguardando liberação</span>
                  ) : null}
                </b>
                <span className="xs muted">
                  {device.kind === "recovery"
                    ? "Identidade de recuperação"
                    : "Dispositivo"}
                </span>
              </div>
              <button
                className="btn sm danger"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void revoke(device.id, device.name).finally(() =>
                    setBusy(false),
                  );
                }}
                type="button"
              >
                Revogar
              </button>
            </div>
          );
        })}
        {ready && e2ee.deviceFingerprint !== null ? (
          <div className="list-i">
            <span
              className="av lg"
              style={{
                background: "var(--brand-tint)",
                color: "var(--brand-ink)",
              }}
            >
              <Icon name="key" />
            </span>
            <div className="grow col">
              <b>
                Este navegador{" "}
                <span className="tag lime">este dispositivo</span>
              </b>
              <span className="fp">{e2ee.deviceFingerprint}</span>
            </div>
            <button
              className="btn sm"
              onClick={() => e2ee.lock()}
              type="button"
            >
              Bloquear
            </button>
          </div>
        ) : null}
      </section>
      <section className="card pad row">
        <div className="grow col">
          <b>Sessões</b>
          <span className="xs muted">
            Sessão opaca, 7 dias no máximo e 24 h sem atividade.
          </span>
        </div>
        <button
          className="btn danger"
          onClick={() => {
            void confirmDialog({
              title: "Sair de todas as sessões?",
              body: (
                <p className="muted">Você será desconectado aqui também.</p>
              ),
              ok: "Sair de tudo",
              danger: true,
            }).then(async (ok) => {
              if (ok !== true) return;
              try {
                e2ee.lock();
                await logout(client, csrfToken(), true);
                onLogout();
              } catch {
                toast("Não foi possível encerrar as sessões.", { kind: "err" });
              }
            });
          }}
          type="button"
        >
          Sair de todas as sessões
        </button>
      </section>
      <SessionsCard onLogout={onLogout} />
    </div>
  );
}

function Columns() {
  const { projects, client, run } = useWorkspace();
  const managed = (projects ?? []).filter((state) => state.project.isManager);
  const [picked, setPicked] = useState(managed[0]?.project.id ?? "");
  const state =
    managed.find((entry) => entry.project.id === picked) ?? managed[0];
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<{
    column: BoardColumn;
    rest: BoardColumn[];
    held: number;
  } | null>(null);
  /** Runs a mutation that returns nothing and tells whether it worked. */
  const ok = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      return true;
    });

  if (state === undefined) {
    return (
      <Banner icon="lock">
        Somente quem gerencia um projeto altera as colunas do quadro.
      </Banner>
    );
  }
  const projectId = state.project.id;
  const columns = state.columns;
  const count = (column: BoardColumn) =>
    state.items.filter(
      (item) => item.kind === "task" && item.columnId === column.id,
    ).length;
  const hasEnds = (list: BoardColumn[]) =>
    list.some((column) => column.category !== "done") &&
    list.some((column) => column.category === "done");

  async function move(index: number, by: -1 | 1) {
    const next = [...columns];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    await ok(() =>
      reorderBoardColumns(
        client,
        csrfToken(),
        projectId,
        next.map((column) => column.id),
      ),
    );
  }

  async function remove(column: BoardColumn, index: number) {
    const rest = columns.filter((_, position) => position !== index);
    if (!hasEnds(rest)) {
      setError(
        "Não dá para excluir: o quadro ficaria sem coluna aberta ou sem coluna concluída.",
      );
      blip("err");
      return;
    }
    setError("");
    const held = count(column);
    if (held === 0) {
      if (
        (await ok(() =>
          deleteBoardColumn(client, csrfToken(), projectId, column.id),
        )) !== undefined
      )
        toast("Coluna excluída.");
      return;
    }
    setDeleting({ column, rest, held });
  }

  return (
    <div className="stack">
      <div aria-label="Projeto" className="pill-tabs" role="group">
        {managed.map((entry) => (
          <button
            aria-pressed={entry.project.id === projectId}
            className="pill"
            key={entry.project.id}
            onClick={() => setPicked(entry.project.id)}
            type="button"
          >
            <i
              className="pd"
              style={{ background: projectColor(entry.project.color) }}
            />
            {entry.project.name}
          </button>
        ))}
      </div>
      <section className="card pad cols-edit">
        <p className="muted sm" style={{ marginBottom: 8 }}>
          A categoria é um metadado: é ela que diz ao sistema o que é
          “concluído”, não o texto que você escolhe.
        </p>
        {columns.map((column, index) => (
          <div className="row" key={column.id}>
            <button
              aria-label={`Subir ${column.name}`}
              className="iconbtn"
              disabled={index === 0}
              onClick={() => void move(index, -1)}
              style={{ width: 32, height: 32 }}
              type="button"
            >
              <Icon name="up" size="sm" />
            </button>
            <button
              aria-label={`Descer ${column.name}`}
              className="iconbtn"
              disabled={index === columns.length - 1}
              onClick={() => void move(index, 1)}
              style={{ width: 32, height: 32 }}
              type="button"
            >
              <Icon name="down" size="sm" />
            </button>
            <input
              aria-label={`Nome da coluna ${index + 1}`}
              className="inp grow"
              defaultValue={column.name}
              key={`${column.id}-${column.name}`}
              maxLength={60}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value === "" || value === column.name) {
                  event.target.value = column.name;
                  return;
                }
                void ok(() =>
                  updateBoardColumn(client, csrfToken(), projectId, column.id, {
                    name: value,
                  }),
                ).then(
                  (done) =>
                    done !== undefined &&
                    toast("Coluna renomeada.", { ms: 1400 }),
                );
              }}
              style={{ height: 38 }}
            />
            <select
              aria-label={`Categoria de ${column.name}`}
              className="inp"
              onChange={(event) => {
                const category = event.target.value as BoardColumn["category"];
                const next = columns.map((entry) =>
                  entry.id === column.id ? { ...entry, category } : entry,
                );
                if (!hasEnds(next)) {
                  setError(
                    "Cada quadro precisa de ao menos uma coluna aberta e uma concluída.",
                  );
                  event.target.value = column.category;
                  blip("err");
                  return;
                }
                setError("");
                const held = count(column);
                void ok(() =>
                  updateBoardColumn(client, csrfToken(), projectId, column.id, {
                    category,
                  }),
                ).then(
                  (done) =>
                    done !== undefined &&
                    toast(
                      held > 0
                        ? `Categoria alterada. ${held} atividades afetadas, sem celebração em massa.`
                        : "Categoria alterada.",
                      { icon: "info" },
                    ),
                );
              }}
              style={{ width: 160, height: 38 }}
              value={column.category}
            >
              <option value="todo">A fazer</option>
              <option value="in_progress">Em andamento</option>
              <option value="done">Concluída</option>
            </select>
            <span className="tag mute num" title="atividades nesta coluna">
              {count(column)}
            </span>
            <button
              className="btn sm ghost"
              onClick={() => void remove(column, index)}
              type="button"
            >
              <Icon name="trash" size="sm" />
              <span className="sr">Excluir {column.name}</span>
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={() =>
              void ok(() =>
                createBoardColumn(client, csrfToken(), projectId, {
                  name: "Nova coluna",
                  category: "in_progress",
                }),
              )
            }
            type="button"
          >
            <Icon name="plus" size="sm" />
            Nova coluna
          </button>
          <span className="xs muted">
            Mantenha ao menos uma coluna aberta e uma concluída.
          </span>
        </div>
        {error === "" ? null : (
          <Banner kind="err" role="alert" style={{ marginTop: 10 }}>
            {error}
          </Banner>
        )}
      </section>
      {deleting === null ? null : (
        <MoveDialog
          column={deleting.column}
          held={deleting.held}
          onFinish={(target) => {
            const pending = deleting;
            setDeleting(null);
            if (target === null) return;
            void ok(() =>
              deleteBoardColumn(
                client,
                csrfToken(),
                projectId,
                pending.column.id,
                target,
              ),
            ).then(
              (done) =>
                done !== undefined &&
                toast(
                  `${pending.held} atividades movidas. Nenhuma ficou órfã.`,
                  { icon: "check" },
                ),
            );
          }}
          rest={deleting.rest}
        />
      )}
    </div>
  );
}

function MoveDialog({
  column,
  rest,
  held,
  onFinish,
}: {
  column: BoardColumn;
  rest: BoardColumn[];
  held: number;
  onFinish: (value: string | null) => void;
}) {
  const [to, setTo] = useState(rest[0]?.id ?? "");
  return (
    <Modal onClose={() => onFinish(null)} width="460px">
      <div className="dh">
        <h2 id="dlgt">Excluir “{column.name}”?</h2>
      </div>
      <div className="dbd col gap12">
        <p className="muted">
          Há {held} {held === 1 ? "atividade" : "atividades"} nela. Escolha a
          coluna de destino. A movimentação acontece numa única transação.
        </p>
        <div className="field">
          <label htmlFor="cd">Mover para</label>
          <select
            className="inp"
            id="cd"
            onChange={(event) => setTo(event.target.value)}
            value={to}
          >
            {rest.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="dft">
        <button className="btn" onClick={() => onFinish(null)} type="button">
          Cancelar
        </button>
        <button
          className="btn danger"
          onClick={() => onFinish(to)}
          type="button"
        >
          Mover e excluir
        </button>
      </div>
    </Modal>
  );
}

function Storage({ isAdmin }: { isAdmin: boolean }) {
  const { client } = useWorkspace();
  const [usage, setUsage] = useState<{
    quota: number;
    reserved: number;
  } | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    getStorageUsage(client)
      .then((value) =>
        setUsage({
          quota: Number(value.quotaBytes),
          reserved: Number(value.reservedBytes),
        }),
      )
      .catch(() => setUsage(null));
  }, [client, isAdmin]);
  const rows: [string, string][] = [
    ["Tamanho máximo por arquivo", "500.000.000 bytes"],
    ["Transferências ativas por usuário", "1 (2 partes em paralelo)"],
    ["Sessão de upload abandonada", "expira em 24 h"],
    ["Objetos desligados", "eliminação física após 30 dias"],
    ["URL de download", "60 s, objeto opaco, bucket privado"],
  ];
  const blocks = 25;
  const on =
    usage === null || usage.quota === 0
      ? 0
      : Math.min(blocks, Math.ceil((usage.reserved / usage.quota) * blocks));
  return (
    <div className="stack">
      {isAdmin ? (
        <section className="card pad col gap12">
          <div className="row">
            <h2 className="h2 grow">Cota da organização</h2>
            <span className="mono sm">
              {usage === null
                ? "—"
                : `${bytes(usage.reserved)} de ${bytes(usage.quota)}`}
            </span>
          </div>
          <Pbar label="Espaço reservado" on={on} total={blocks} />
          <p className="xs muted">
            Inclui os uploads em andamento, reservados para evitar ultrapassar a
            cota em corridas concorrentes. A cota é configurável
            (STORAGE_QUOTA_BYTES) e não representa preço do R2.
          </p>
        </section>
      ) : null}
      <section className="card pad">
        <h2 className="h2" style={{ marginBottom: 6 }}>
          Regras
        </h2>
        <table className="tbl">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="mono">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  work: "atividades",
  chat: "conversa do projeto",
  dm: "mensagem direta",
  sprint: "sprints",
};

function Recovery() {
  const e2ee = useE2EE();
  const [gaps, setGaps] = useState<RecoveryGap[]>([]);
  const [audit, setAudit] = useState<RecoveryAuditEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    let alive = true;
    if (e2ee.phase !== "unlocked" || !e2ee.hasRecoveryIdentity)
      return undefined;
    e2ee
      .recoveryGaps()
      .then((list) => alive && setGaps(list))
      .catch(() => alive && setGaps([]));
    e2ee
      .recoveryAudit()
      .then((list) => alive && setAudit(list))
      .catch(() => alive && setAudit([]));
    return () => {
      alive = false;
    };
  }, [e2ee.phase, e2ee.hasRecoveryIdentity, version]);

  const people = [...new Set(gaps.map((gap) => gap.device.email))];
  const content = e2ee.backup();

  return (
    <div className="stack">
      <Banner kind="warn">
        <b>
          O administrador de recuperação pode descriptografar conteúdo,
          inclusive mensagens diretas.
        </b>{" "}
        O produto não é privado contra esse papel. A ação é explícita, local e
        auditada. Não existe rota que baixe texto em claro.
      </Banner>
      <section className="card pad col gap12">
        <div className="row">
          <span
            className="av lg"
            style={{
              background: "var(--brand-tint)",
              color: "var(--brand-ink)",
            }}
          >
            <Icon name="key" />
          </span>
          <div className="grow col">
            <b>Identidade de recuperação</b>
            <span className="xs muted">
              Backup protegido por segredo forte, guardado fora do VPS e do R2.
              Não é variável de ambiente do servidor.
            </span>
          </div>
          <span className="tag lime">
            {e2ee.hasRecoveryIdentity
              ? "configurada"
              : "neste navegador: ausente"}
          </span>
        </div>
        <p className="xs muted">
          Se todos os dispositivos e o segredo de recuperação se perderem, o
          histórico pode ficar irrecuperável. Não há chave-mestra escondida no
          servidor.
        </p>
        {content === null ? null : (
          <div>
            <button
              className="btn"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([content], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "oddkin-recuperacao.json";
                link.click();
                URL.revokeObjectURL(url);
              }}
              type="button"
            >
              <Icon name="dl" size="sm" />
              Baixar backup de recuperação
            </button>
          </div>
        )}
      </section>
      <section className="card pad">
        <h2 className="h2" style={{ marginBottom: 6 }}>
          Pedidos de recuperação
        </h2>
        {gaps.length === 0 ? (
          <p className="muted sm">Nenhum dispositivo está esperando chaves.</p>
        ) : (
          <>
            <p className="xs muted" style={{ marginBottom: 8 }}>
              Dispositivos sem acesso ao histórico: {people.join(", ")}.
              Restaurar usa a identidade de recuperação, fica registrado e a
              pessoa é avisada.
            </p>
            {gaps.map((gap) => (
              <div
                className="list-i"
                key={`${gap.domainId}:${gap.generation}:${gap.device.deviceId}`}
              >
                <div className="grow col">
                  <b>{nameOf(gap.device.email)}</b>
                  <span className="xs muted">
                    {KIND_LABEL[gap.kind] ?? gap.kind} · geração{" "}
                    {gap.generation}
                  </span>
                </div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className={`btn primary${busy ? " loading" : ""}`}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "Aprovar recuperação?",
                    body: (
                      <p className="muted">
                        Você confirma que verificou a identidade das pessoas
                        fora do app. O material de recuperação é aberto
                        localmente neste navegador e reencapsulado para os novos
                        dispositivos. Cada uso fica registrado.
                      </p>
                    ),
                    ok: "Aprovar e reencapsular",
                  });
                  if (ok !== true) return;
                  setBusy(true);
                  e2ee
                    .restoreAccess()
                    .then((result) =>
                      toast(
                        `Restaurado: ${result.granted}. Falhas: ${result.failed}.`,
                        { icon: "key" },
                      ),
                    )
                    .catch(() =>
                      toast("Não foi possível restaurar agora.", {
                        kind: "err",
                      }),
                    )
                    .finally(() => {
                      setBusy(false);
                      setVersion((value) => value + 1);
                    });
                }}
                type="button"
              >
                Verificar e aprovar
              </button>
            </div>
          </>
        )}
      </section>
      {e2ee.hasRecoveryIdentity ? (
        <section className="card pad col gap8">
          <h2 className="h2">Trocar identidade de recuperação</h2>
          <p className="xs muted">
            A nova identidade recebe as chaves existentes antes de a atual ser
            revogada. A operação fica registrada.
          </p>
          <div className="field">
            <label htmlFor="rp">Senha de proteção deste navegador</label>
            <input
              autoComplete="current-password"
              className="inp"
              id="rp"
              minLength={12}
              onChange={(event) => setPassphrase(event.target.value)}
              type="password"
              value={passphrase}
            />
          </div>
          <div>
            <button
              className={`btn${rotating ? " loading" : ""}`}
              disabled={passphrase.length < 12}
              onClick={() => {
                setRotating(true);
                e2ee
                  .rotateRecoveryIdentity(passphrase)
                  .then(() => {
                    setPassphrase("");
                    toast("Identidade de recuperação trocada.", {
                      icon: "key",
                    });
                  })
                  .catch(() =>
                    toast(
                      "Não foi possível trocar a identidade. A atual continua ativa.",
                      { kind: "err" },
                    ),
                  )
                  .finally(() => {
                    setRotating(false);
                    setVersion((value) => value + 1);
                  });
              }}
              type="button"
            >
              Trocar identidade
            </button>
          </div>
        </section>
      ) : null}
      <section className="card pad">
        <h2 className="h2" style={{ marginBottom: 6 }}>
          Auditoria
        </h2>
        {audit.length === 0 ? (
          <p className="muted sm">Nenhum uso registrado.</p>
        ) : null}
        <ul className="feed">
          {audit.slice(0, 20).map((entry) => (
            <li key={entry.id}>
              <span className="grow">
                {nameOf(entry.approverEmail)} → {nameOf(entry.recipientEmail)} ·{" "}
                {KIND_LABEL[entry.domainKind] ?? entry.domainKind} g
                {entry.generation}
              </span>
              <time className="xs muted">
                {new Date(entry.createdAt).toLocaleString("pt-BR")}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Settings({
  account,
  tab,
  onLogout,
}: {
  account: CurrentAccount;
  tab: string | null;
  onLogout: () => void;
}) {
  const { projects } = useWorkspace();
  const manager =
    account.isAdmin ||
    (projects ?? []).some((state) => state.project.isManager);
  const tabs = TABS.filter(
    ([id]) =>
      (id !== "colunas" || manager) &&
      (id !== "pessoas" || account.isAdmin) &&
      (id !== "recuperacao" || account.isAdmin),
  );
  const active: Tab = tabs.some(([id]) => id === tab) ? (tab as Tab) : "perfil";
  return (
    <Page
      sub="Perfil, dispositivos, colunas, armazenamento e recuperação, conforme seu papel."
      title="Configurações"
    >
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            aria-selected={id === active}
            key={id}
            onClick={() => go(`settings/${id}`)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ maxWidth: 760 }}>
        {active === "perfil" ? <Profile account={account} /> : null}
        {active === "dispositivos" ? (
          <Devices account={account} onLogout={onLogout} />
        ) : null}
        {active === "colunas" ? <Columns /> : null}
        {active === "pessoas" ? <People account={account} /> : null}
        {active === "armazenamento" ? (
          <Storage isAdmin={account.isAdmin} />
        ) : null}
        {active === "recuperacao" ? <Recovery /> : null}
      </div>
    </Page>
  );
}
