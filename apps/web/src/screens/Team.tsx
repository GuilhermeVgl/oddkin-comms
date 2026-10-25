import {
  addMember,
  createInvitation,
  getExternalPolicy,
  removeProjectMember,
  setProjectAppearance,
  setProjectArchived,
  updateExternalPolicy,
  ApiStatusError,
  type CurrentAccount,
  type ExternalPolicy,
  type MembershipKind,
} from "@oddkin/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmDialog } from "../design/confirm";
import { Icon, type IconName } from "../design/icons";
import { Modal } from "../design/Modal";
import { nameOf } from "../design/people";
import { Avatar, Banner } from "../design/primitives";
import { blip } from "../design/sound";
import { toast } from "../design/toast";
import { csrfToken, describeError } from "../errors";
import { Page } from "../shell/Page";
import { projectColor } from "../shell/Sidebar";
import { encryptProject } from "../e2ee/content";
import { useWorkspace, type ProjectState } from "../workspace";

type Permission = ExternalPolicy["permissions"][number];

const GROUPS: {
  title: string;
  icon: IconName;
  items: [Permission, string][];
}[] = [
  {
    title: "Atividades",
    icon: "board",
    items: [
      ["work.read", "Ver épicos, atividades e subtarefas"],
      ["work.create", "Criar atividades e subtarefas"],
      ["work.edit", "Editar campos, responsável e prazo"],
      ["work.move", "Mover entre colunas e concluir"],
      ["work.archive", "Arquivar e restaurar"],
      ["work.comment", "Comentar e acompanhar"],
      ["planning.edit", "Gerenciar épicos e vincular a sprints"],
    ],
  },
  {
    title: "Conversas",
    icon: "chat",
    items: [
      ["chat.read", "Ler todos os canais do projeto"],
      ["chat.send", "Enviar, citar, reagir e mencionar"],
      ["direct_messages.use", "Mensagens diretas com o time do projeto"],
    ],
  },
  {
    title: "Arquivos",
    icon: "file",
    items: [
      ["files.download", "Baixar e descriptografar arquivos"],
      ["files.upload", "Enviar arquivos (até 500 MB)"],
    ],
  },
  {
    title: "Chamadas",
    icon: "video",
    items: [
      ["calls.join", "Aceitar convite e participar"],
      ["calls.start", "Iniciar chamada do projeto"],
      ["calls.screen_share", "Compartilhar tela"],
    ],
  },
];

const DEPENDS: Partial<Record<Permission, Permission>> = {
  "work.create": "work.read",
  "work.edit": "work.read",
  "work.move": "work.read",
  "work.archive": "work.read",
  "work.comment": "work.read",
  "planning.edit": "work.read",
  "chat.send": "chat.read",
  "files.upload": "files.download",
  "calls.start": "calls.join",
  "calls.screen_share": "calls.join",
};

const LABEL = new Map(GROUPS.flatMap((group) => group.items));

const SWATCHES = [
  "#63745A",
  "#9C7E3C",
  "#3F5A6B",
  "#8A4F3D",
  "#6B5A8E",
  "#3F7A6E",
  "#7A7A3F",
  "#4A4F4C",
];

function EditProjectDialog({
  state,
  onClose,
}: {
  state: ProjectState;
  onClose: () => void;
}) {
  const { client, run } = useWorkspace();
  const { project, crypto } = state;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [color, setColor] = useState(project.color.toUpperCase());
  // Names and descriptions of encrypted projects are only written by a browser holding the key.
  const canWriteText =
    project.encrypted && crypto !== null && crypto.canWrite("work");
  const textChanged =
    name.trim() !== project.name || description !== project.description;

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Editar projeto</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onClose();
          void run(async () => {
            if (color.toUpperCase() !== project.color.toUpperCase())
              await setProjectAppearance(
                client,
                csrfToken(),
                project.id,
                color,
              );
            if (
              canWriteText &&
              textChanged &&
              crypto !== null &&
              name.trim() !== ""
            )
              await encryptProject(client, csrfToken(), crypto, {
                ...project,
                name: name.trim(),
                description,
              });
            return true;
          }).then(
            (done) =>
              done !== undefined &&
              toast("Projeto atualizado.", { icon: "check" }),
          );
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="epn">Nome</label>
            <input
              className="inp"
              disabled={!canWriteText}
              id="epn"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="field">
            <label htmlFor="epd">Descrição</label>
            <textarea
              className="inp"
              disabled={!canWriteText}
              id="epd"
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
            {canWriteText ? null : (
              <span className="hint">
                Nome e descrição só mudam em projetos cifrados, com este
                navegador liberado.
              </span>
            )}
          </div>
          <div className="field">
            <span className="lbl" id="epc">
              Cor
            </span>
            <div aria-labelledby="epc" className="row wrap" role="radiogroup">
              {SWATCHES.map((swatch) => (
                <button
                  aria-checked={color === swatch}
                  aria-label={swatch}
                  className="iconbtn"
                  key={swatch}
                  onClick={() => setColor(swatch)}
                  role="radio"
                  style={{
                    background: swatch,
                    borderColor:
                      color === swatch ? "var(--ink)" : "transparent",
                    borderWidth: 2,
                    width: 34,
                    height: 34,
                  }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
        <div className="dft">
          <button
            className="btn danger"
            onClick={() => {
              onClose();
              void confirmDialog({
                title: `Arquivar ${project.name}?`,
                body: (
                  <p className="muted">
                    O projeto some das listas e fica somente leitura: sem novas
                    atividades, mensagens, arquivos ou chamadas. Um gestor pode
                    restaurá-lo.
                  </p>
                ),
                ok: "Arquivar",
                danger: true,
              }).then((ok) => {
                if (ok !== true) return;
                void run(async () => {
                  await setProjectArchived(
                    client,
                    csrfToken(),
                    project.id,
                    true,
                  );
                  return true;
                }).then(
                  (done) =>
                    done !== undefined &&
                    toast("Projeto arquivado.", { icon: "check" }),
                );
              });
            }}
            type="button"
          >
            Arquivar projeto
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn primary" type="submit">
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InviteDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { client, reload } = useWorkspace();
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<MembershipKind>("internal");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      try {
        // Someone already in the organization only needs to join the project.
        await addMember(client, csrfToken(), projectId, email.trim());
        toast("Pessoa adicionada ao projeto.", { icon: "check" });
        await reload();
      } catch (error) {
        if (
          !(error instanceof ApiStatusError) ||
          (error.status !== 404 && error.status !== 400)
        )
          throw error;
        await createInvitation(client, email.trim(), kind, csrfToken());
        toast("Convite criado e enfileirado para entrega.", { icon: "mail" });
      }
      onClose();
    } catch (error) {
      toast(describeError(error), { kind: "err" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Convidar para o projeto</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="ive">E-mail</label>
            <input
              aria-invalid={invalid ? true : undefined}
              autoFocus
              className="inp"
              id="ive"
              onChange={(event) => {
                setEmail(event.target.value);
                setInvalid(false);
              }}
              placeholder="pessoa@empresa.com"
              type="email"
              value={email}
            />
            {invalid ? (
              <span className="err">
                <Icon name="alert" size="sm" />
                Informe um e-mail válido.
              </span>
            ) : null}
          </div>
          <div className="field">
            <span className="lbl" id="vl">
              Vínculo (para quem ainda não está na organização)
            </span>
            <div aria-labelledby="vl" className="seg" role="group">
              <button
                aria-pressed={kind === "internal"}
                onClick={() => setKind("internal")}
                type="button"
              >
                Interno
              </button>
              <button
                aria-pressed={kind === "external"}
                onClick={() => setKind("external")}
                type="button"
              >
                Externo
              </button>
            </div>
            <span className="hint">
              {kind === "external"
                ? "Externos só podem o que o perfil compartilhado do projeto permite."
                : "Internos colaboram nos projetos aos quais pertencem."}
            </span>
          </div>
          <Banner icon="mail">
            O convite expira em 7 dias, é de uso único e só funciona para este
            e-mail. Não incluímos títulos nem prazos no e-mail.
          </Banner>
        </div>
        <div className="dft">
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button
            className={`btn primary${busy ? " loading" : ""}`}
            type="submit"
          >
            Enviar convite
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Team({ account }: { account: CurrentAccount }) {
  const { projects, current, setCurrentProjectId, client, reload } =
    useWorkspace();
  const [policy, setPolicy] = useState<ExternalPolicy | null>(null);
  const [draft, setDraft] = useState<Permission[]>([]);
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rotation, setRotation] = useState<"" | "pending" | "done">("");
  const manager = current?.project.isManager === true || account.isAdmin;
  const externals = (current?.members ?? []).filter(
    (member) => member.membershipKind === "external",
  );

  const loadPolicy = useCallback(async () => {
    if (current === null || !current.project.isManager) {
      setPolicy(null);
      return;
    }
    try {
      const value = await getExternalPolicy(client, current.project.id);
      setPolicy(value);
      setDraft([...value.permissions]);
    } catch {
      setPolicy(null);
    }
  }, [client, current]);

  useEffect(() => {
    void loadPolicy();
    setRotation("");
  }, [loadPolicy]);

  const normalized = useMemo(() => {
    const kept = new Set(draft);
    let changed = true;
    while (changed) {
      changed = false;
      for (const permission of [...kept]) {
        const need = DEPENDS[permission];
        if (need !== undefined && !kept.has(need)) {
          kept.delete(permission);
          changed = true;
        }
      }
    }
    return kept;
  }, [draft]);

  const dirty =
    policy !== null &&
    (policy.permissions.length !== normalized.size ||
      policy.permissions.some((permission) => !normalized.has(permission)));

  function toggle(permission: Permission) {
    setDraft((value) => {
      const next = new Set(value);
      if (next.has(permission)) {
        next.delete(permission);
        for (const [dependent, need] of Object.entries(DEPENDS)) {
          if (need === permission) next.delete(dependent as Permission);
        }
      } else next.add(permission);
      return [...next];
    });
  }

  async function remove(accountId: string, email: string) {
    if (current === null) return;
    const ok = await confirmDialog({
      title: `Remover ${nameOf(email)} do projeto?`,
      body: (
        <p className="muted">
          O acesso é bloqueado e as conexões abertas são encerradas na hora.
          Cópias que a pessoa já tem não podem ser apagadas à distância. As
          chaves do projeto serão rotacionadas e as atividades dela ficam sem
          responsável.
        </p>
      ),
      ok: "Remover",
      danger: true,
    });
    if (ok !== true) return;
    try {
      await removeProjectMember(
        client,
        csrfToken(),
        current.project.id,
        accountId,
      );
      toast(
        `${nameOf(email)} removida. Mídia e escritas futuras usam nova chave.`,
        { icon: "lock" },
      );
      await reload();
    } catch (error) {
      toast(
        error instanceof ApiStatusError && error.status === 409
          ? "O projeto precisa de ao menos uma pessoa gestora."
          : describeError(error),
        { kind: "err" },
      );
    }
  }

  async function save() {
    if (policy === null || current === null) return;
    const reduced = policy.permissions.some(
      (permission) => !normalized.has(permission),
    );
    try {
      const saved = await updateExternalPolicy(
        client,
        csrfToken(),
        current.project.id,
        {
          permissions: [...normalized],
          version: policy.version,
        },
      );
      setPolicy(saved);
      setDraft([...saved.permissions]);
      blip("ok");
      toast(
        `Política v${saved.version} salva. Vale para todos os externos agora.`,
        {
          icon: "shieldOk",
        },
      );
      if (reduced) {
        setRotation("pending");
        await reload();
        setRotation("done");
      }
    } catch (error) {
      toast(
        error instanceof ApiStatusError && error.status === 400
          ? "Combinação inválida: as demais permissões exigem ver atividades."
          : describeError(error),
        { kind: "err" },
      );
      await loadPolicy();
    }
  }

  return (
    <Page
      cta={
        manager ? (
          <>
            {current?.project.isManager ? (
              <button
                className="btn"
                onClick={() => setEditing(true)}
                type="button"
              >
                <Icon name="edit" size="sm" /> Editar projeto
              </button>
            ) : null}
            <button
              className="btn primary"
              disabled={current === null}
              onClick={() => setInvite(true)}
              type="button"
            >
              <Icon name="plus" /> Convidar
            </button>
          </>
        ) : null
      }
      sub="Membros, convites e o perfil comum de permissões dos externos."
      title="Equipe do projeto"
    >
      <div
        aria-label="Projeto"
        className="pill-tabs"
        role="group"
        style={{ marginBottom: 18 }}
      >
        {(projects ?? []).map((state) => (
          <button
            aria-pressed={state.project.id === current?.project.id}
            className="pill"
            key={state.project.id}
            onClick={() => setCurrentProjectId(state.project.id)}
            type="button"
          >
            <i
              className="pd"
              style={{ background: projectColor(state.project.color) }}
            />
            {state.project.name}
          </button>
        ))}
      </div>
      {current === null ? (
        <p className="muted">Nenhum projeto acessível ainda.</p>
      ) : (
        <div className="grid2">
          <div className="stack">
            <section className="card pad">
              <h2 className="h2" style={{ marginBottom: 6 }}>
                Membros{" "}
                <span className="tag mute num">{current.members.length}</span>
              </h2>
              {current.members.map((member) => (
                <div className="list-i" key={member.accountId}>
                  <Avatar
                    email={member.email}
                    id={member.accountId}
                    size="lg"
                  />
                  <div className="grow col">
                    <b>
                      {nameOf(member.email)}
                      {member.membershipKind === "external" ? (
                        <span className="ext">externo</span>
                      ) : null}
                    </b>
                    <span className="xs muted">
                      {member.isManager
                        ? "Gestor do projeto"
                        : member.membershipKind === "external"
                          ? "Perfil compartilhado de externos"
                          : "Membro interno"}
                      {" · "}
                      {member.email}
                    </span>
                  </div>
                  {manager &&
                  member.accountId !== account.id &&
                  !member.isManager ? (
                    <button
                      className="btn sm ghost"
                      onClick={() =>
                        void remove(member.accountId, member.email)
                      }
                      type="button"
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
          </div>
          <section className="card pad">
            <div className="row">
              <h2 className="h2 grow">Perfil dos externos</h2>
              {policy === null ? null : (
                <span className="tag mute num mono">
                  política v{policy.version}
                </span>
              )}
            </div>
            {externals.length > 0 ? (
              <Banner kind="warn" style={{ margin: "12px 0" }}>
                Vale <b>imediatamente</b> para os {externals.length}{" "}
                {externals.length === 1 ? "externo" : "externos"} deste projeto
                ({externals.map((member) => nameOf(member.email)).join(", ")}).
                Não existe exceção por pessoa.
              </Banner>
            ) : (
              <Banner style={{ margin: "12px 0" }}>
                Este projeto ainda não tem externos. A política vale para quem
                for convidado depois.
              </Banner>
            )}
            {policy === null ? (
              <p className="xs muted">
                Somente quem gerencia o projeto altera esta política.
              </p>
            ) : (
              <>
                <div className="matrix">
                  {GROUPS.map((group) => (
                    <div key={group.title}>
                      <div className="mgrp">
                        <Icon name={group.icon} size="sm" />
                        {group.title}
                      </div>
                      {group.items.map(([key, label]) => {
                        const need = DEPENDS[key];
                        const blocked =
                          need !== undefined && !normalized.has(need);
                        return (
                          <div className="mrow" key={key}>
                            <div className="grow col">
                              <span style={{ fontWeight: 560 }}>{label}</span>
                              <span className="k">{key}</span>
                              {blocked && need !== undefined ? (
                                <span className="why" id={`why-${key}`}>
                                  Requer: {LABEL.get(need)?.toLowerCase()}
                                </span>
                              ) : null}
                            </div>
                            <button
                              aria-checked={normalized.has(key)}
                              aria-describedby={
                                blocked ? `why-${key}` : undefined
                              }
                              aria-label={label}
                              className="sw"
                              disabled={blocked}
                              onClick={() => toggle(key)}
                              role="switch"
                              type="button"
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <span className="xs muted grow">
                    Mudanças que reduzem acesso rotacionam as chaves do domínio
                    afetado.
                  </span>
                  <button
                    className="btn"
                    disabled={!dirty}
                    onClick={() => setDraft([...policy.permissions])}
                    type="button"
                  >
                    Descartar
                  </button>
                  <button
                    className="btn primary"
                    disabled={!dirty}
                    onClick={() => void save()}
                    type="button"
                  >
                    Salvar política
                  </button>
                </div>
                {rotation === "pending" ? (
                  <Banner
                    icon="rot"
                    kind="warn"
                    role="status"
                    style={{ marginTop: 12 }}
                  >
                    <b>rotation_required.</b> Acesso bloqueado no servidor.
                    Novas escritas cifradas neste domínio ficam suspensas até um
                    cliente elegível publicar a nova geração de chaves.
                  </Banner>
                ) : null}
                {rotation === "done" ? (
                  <Banner
                    icon="shieldOk"
                    kind="ok"
                    role="status"
                    style={{ marginTop: 12 }}
                  >
                    <b>Rotação concluída.</b> Uma nova geração de chaves foi
                    publicada para o conjunto atual de destinatários.
                  </Banner>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
      {editing && current !== null ? (
        <EditProjectDialog onClose={() => setEditing(false)} state={current} />
      ) : null}
      {invite && current !== null ? (
        <InviteDialog
          onClose={() => setInvite(false)}
          projectId={current.project.id}
        />
      ) : null}
    </Page>
  );
}
