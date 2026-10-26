import {
  createProject,
  listConversations,
  updateBoardColumn,
  updateEpic,
  type BoardColumn,
} from "@crewstead/api-client";
import { useState } from "react";
import { Icon } from "../design/icons";
import { Menu } from "../design/Menu";
import { Modal } from "../design/Modal";
import { Banner, Pbar } from "../design/primitives";
import { go } from "../design/router";
import { toast } from "../design/toast";
import { useOptionalE2EE } from "../e2ee/E2EE";
import {
  createEpicContent,
  encryptChannel,
  encryptProject,
  migrateProject,
  type MigrationReport,
} from "../e2ee/content";
import { csrfToken, describeError } from "../errors";
import { isDone, useWorkspace, type ProjectState } from "../workspace";

/** What this project does about encryption, and what the person can do about it. */
export function EncryptionBanner({ state }: { state: ProjectState }) {
  const { client, unlocked, reload, account } = useWorkspace();
  const [progress, setProgress] = useState("");
  const encrypted = state.crypto?.isEncrypted("work") ?? state.keyed;
  const legacy =
    state.items.filter((item) => !item.encrypted).length +
    state.epics.filter((epic) => !epic.encrypted).length;
  const manager = state.project.isManager;
  const pc = state.crypto;

  async function enable() {
    if (pc === null) return;
    setProgress("Ativando…");
    try {
      await pc.enable(csrfToken);
      await reload();
      setProgress("");
      toast("Criptografia ativada neste projeto.", { icon: "shieldOk" });
    } catch (error) {
      setProgress("");
      toast(describeError(error), { kind: "err" });
    }
  }

  async function migrate() {
    if (pc === null) return;
    setProgress("Cifrando conteúdo antigo…");
    try {
      const channels = await listConversations(client, state.project.id).catch(
        () => [],
      );
      if (manager) {
        if (!state.project.encrypted)
          await encryptProject(client, csrfToken(), pc, state.project);
        const channel = channels[0];
        if (channel !== undefined && !channel.encrypted)
          await encryptChannel(client, csrfToken(), pc, channel);
      }
      const report: MigrationReport = await migrateProject(
        client,
        csrfToken(),
        pc,
        {
          items: state.items,
          epics: state.epics,
          channelId: channels[0]?.id,
        },
        { email: account.email },
        (done, total) =>
          setProgress(`Cifrando conteúdo antigo… ${done}/${total}`),
      );
      setProgress("");
      toast(
        `Concluído: ${report.items} atividades, ${report.epics} épicos, ${report.comments} comentários, ${report.messages} mensagens${
          report.failed > 0 ? `; ${report.failed} falharam` : ""
        }.`,
        { icon: "shieldOk", ms: 6000 },
      );
      await reload();
    } catch (error) {
      setProgress("");
      toast(describeError(error), { kind: "err" });
    }
  }

  if (encrypted && !unlocked) {
    return (
      <Banner
        icon="lock"
        kind="warn"
        role="status"
        style={{ margin: "0 32px 14px" }}
      >
        <b>Este projeto é cifrado.</b> Libere a criptografia deste navegador
        para ler e escrever.{" "}
        <button
          className="btn sm"
          onClick={() => go("settings/dispositivos")}
          type="button"
        >
          Abrir dispositivos
        </button>
      </Banner>
    );
  }
  if (encrypted && legacy > 0 && manager) {
    return (
      <Banner kind="warn" role="status" style={{ margin: "0 32px 14px" }}>
        <b>Ainda há {legacy} itens antigos em texto claro.</b> {progress}{" "}
        <button
          className={`btn sm${progress === "" ? "" : " loading"}`}
          onClick={() => void migrate()}
          type="button"
        >
          Cifrar conteúdo antigo
        </button>
      </Banner>
    );
  }
  if (!encrypted && manager && unlocked) {
    return (
      <Banner kind="warn" role="status" style={{ margin: "0 32px 14px" }}>
        <b>Este projeto ainda guarda o conteúdo em texto claro no servidor.</b>{" "}
        {progress}{" "}
        <button
          className={`btn sm${progress === "" ? "" : " loading"}`}
          onClick={() => void enable()}
          type="button"
        >
          Ativar criptografia neste projeto
        </button>
      </Banner>
    );
  }
  return null;
}

export function ColumnMenu({
  anchor,
  column,
  state,
  onClose,
}: {
  anchor: HTMLElement;
  column: BoardColumn;
  state: ProjectState;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <Menu anchor={anchor} onClose={onClose} right>
        <button
          onClick={() => {
            setRenaming(true);
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="edit" size="sm" />
          Renomear coluna
        </button>
        <button
          onClick={() => {
            onClose();
            go("settings/colunas");
          }}
          role="menuitem"
          type="button"
        >
          <Icon name="gear" size="sm" />
          Gerenciar colunas…
        </button>
      </Menu>
      {renaming ? (
        <RenameColumn
          column={column}
          onClose={() => {
            setRenaming(false);
            onClose();
          }}
          state={state}
        />
      ) : null}
    </>
  );
}

function RenameColumn({
  column,
  state,
  onClose,
}: {
  column: BoardColumn;
  state: ProjectState;
  onClose: () => void;
}) {
  const { client, run } = useWorkspace();
  const [name, setName] = useState(column.name);
  return (
    <Modal onClose={onClose} width="420px">
      <div className="dh">
        <h2 id="dlgt">Renomear coluna</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (value === "") return;
          onClose();
          void run(() =>
            updateBoardColumn(
              client,
              csrfToken(),
              state.project.id,
              column.id,
              { name: value },
            ),
          ).then((done) => done !== undefined && toast("Coluna renomeada."));
        }}
      >
        <div className="dbd">
          <div className="field">
            <label htmlFor="rn">Nome</label>
            <input
              autoFocus
              className="inp"
              id="rn"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
        </div>
        <div className="dft">
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

export function EpicsDialog({
  state,
  onClose,
}: {
  state: ProjectState;
  onClose: () => void;
}) {
  const { client, run } = useWorkspace();
  const [title, setTitle] = useState("");
  const tasks = state.items.filter((item) => item.kind === "task");
  return (
    <Modal onClose={onClose} width="560px">
      <div className="dh">
        <h2 id="dlgt">Épicos · {state.project.name}</h2>
      </div>
      <div className="dbd col gap12">
        {state.epics.length === 0 ? (
          <p className="muted">Nenhum épico ainda.</p>
        ) : null}
        {state.epics.map((epic) => {
          const linked = tasks.filter((task) => task.epicId === epic.id);
          const finished = linked.filter((task) =>
            isDone(state.columns, task.columnId),
          ).length;
          return (
            <div className="list-i" key={epic.id}>
              <div className="grow col">
                <b>{epic.title}</b>
                <span className="xs muted">
                  {finished}/{linked.length} atividades
                  {epic.done ? " · concluído" : ""}
                </span>
              </div>
              <Pbar
                on={
                  linked.length > 0
                    ? Math.round((finished / linked.length) * 10)
                    : 0
                }
                total={10}
              />
              <button
                className="btn sm"
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
            </div>
          );
        })}
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (value === "") return;
            void run(async () => {
              await createEpicContent(
                client,
                csrfToken(),
                state.crypto,
                state.project.id,
                value,
              );
              setTitle("");
            });
          }}
        >
          <input
            aria-label="Novo épico"
            className="inp"
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Novo épico"
            value={title}
          />
          <button className="btn" type="submit">
            <Icon name="plus" size="sm" />
            Criar épico
          </button>
        </form>
      </div>
      <div className="dft">
        <button className="btn primary" onClick={onClose} type="button">
          Fechar
        </button>
      </div>
    </Modal>
  );
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { client, unlocked, reload, setCurrentProjectId } = useWorkspace();
  const e2ee = useOptionalE2EE();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} width="460px">
      <div className="dh">
        <h2 id="dlgt">Novo projeto</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (value === "") return;
          setBusy(true);
          void (async () => {
            try {
              const project = await createProject(client, csrfToken(), value);
              // With encryption available a new project starts encrypted, name included.
              if (unlocked && e2ee !== null) {
                try {
                  const opened = await e2ee.openProject(project.id);
                  if (opened !== null) {
                    await opened.enable(csrfToken);
                    await encryptProject(client, csrfToken(), opened, project);
                    for (const channel of await listConversations(
                      client,
                      project.id,
                    )) {
                      if (!channel.encrypted)
                        await encryptChannel(
                          client,
                          csrfToken(),
                          opened,
                          channel,
                        );
                    }
                  }
                } catch {
                  toast(
                    "Projeto criado, mas não foi possível ativar a criptografia agora.",
                    {
                      kind: "err",
                    },
                  );
                }
              }
              await reload();
              setCurrentProjectId(project.id);
              onClose();
              toast("Projeto criado.");
            } catch (error) {
              toast(describeError(error), { kind: "err" });
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <div className="dbd col gap12">
          <div className="field">
            <label htmlFor="pn">Nome do projeto</label>
            <input
              autoFocus
              className="inp"
              id="pn"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>
          <Banner>
            {unlocked
              ? "O nome e o conteúdo do projeto nascem cifrados."
              : "Libere a criptografia deste navegador para criar projetos já cifrados."}
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
            Criar projeto
          </button>
        </div>
      </form>
    </Modal>
  );
}
