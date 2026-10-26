import {
  createProject,
  listConversations,
  type Project,
} from "@crewstead/api-client";
import { useState } from "react";
import { Modal } from "../../design/Modal";
import { Banner } from "../../design/primitives";
import { toast, toastError } from "../../design/toast";
import { useOptionalE2EE } from "../../e2ee/E2EE";
import { encryptChannel, encryptProject } from "../../e2ee/content";
import { describeError } from "../../errors";
import { useWorkspace } from "../../workspace";

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { client, unlocked, reload, setCurrentProjectId } = useWorkspace();
  const e2ee = useOptionalE2EE();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** With encryption available a new project starts encrypted, name included. */
  async function encryptNew(project: Project) {
    if (!unlocked || e2ee === null) return;
    try {
      const opened = await e2ee.openProject(project.id);
      if (opened === null) return;
      await opened.enable();
      await encryptProject(client, opened, project);
      for (const channel of await listConversations(client, project.id)) {
        if (!channel.encrypted) await encryptChannel(client, opened, channel);
      }
    } catch {
      toastError(
        "Projeto criado, mas não foi possível ativar a criptografia agora.",
      );
    }
  }

  async function create(value: string) {
    setBusy(true);
    try {
      const project = await createProject(client, value);
      await encryptNew(project);
      await reload();
      setCurrentProjectId(project.id);
      onClose();
      toast("Projeto criado.");
    } catch (error) {
      toastError(describeError(error));
    } finally {
      setBusy(false);
    }
  }

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
          void create(value);
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
