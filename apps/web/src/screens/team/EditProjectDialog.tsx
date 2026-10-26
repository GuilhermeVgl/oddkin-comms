import {
  setProjectAppearance,
  setProjectArchived,
} from "@crewstead/api-client";
import { useState } from "react";
import { confirmDialog } from "../../design/confirm";
import { Modal } from "../../design/Modal";
import { toast } from "../../design/toast";
import { encryptProject } from "../../e2ee/content";
import { csrfToken } from "../../errors";
import { useWorkspace, type ProjectState } from "../../workspace";
import { SWATCHES } from "./teamRules";

export function EditProjectDialog({
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

  function save() {
    onClose();
    void run(async () => {
      if (color.toUpperCase() !== project.color.toUpperCase())
        await setProjectAppearance(client, csrfToken(), project.id, color);
      if (canWriteText && textChanged && crypto !== null && name.trim() !== "")
        await encryptProject(client, csrfToken(), crypto, {
          ...project,
          name: name.trim(),
          description,
        });
      return true;
    }).then(
      (done) =>
        done !== undefined && toast("Projeto atualizado.", { icon: "check" }),
    );
  }

  function archive() {
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
        await setProjectArchived(client, csrfToken(), project.id, true);
        return true;
      }).then(
        (done) =>
          done !== undefined && toast("Projeto arquivado.", { icon: "check" }),
      );
    });
  }

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Editar projeto</h2>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
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
                  className="iconbtn tm-swatch"
                  key={swatch}
                  onClick={() => setColor(swatch)}
                  role="radio"
                  style={{
                    background: swatch,
                    borderColor:
                      color === swatch ? "var(--ink)" : "transparent",
                  }}
                  type="button"
                />
              ))}
            </div>
          </div>
        </div>
        <div className="dft">
          <button className="btn danger" onClick={archive} type="button">
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
