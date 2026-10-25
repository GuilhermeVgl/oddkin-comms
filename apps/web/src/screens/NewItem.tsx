import type { WorkItem } from "@oddkin/api-client";
import { useMemo, useState } from "react";
import { addDays, todayIso } from "../design/format";
import { Icon } from "../design/icons";
import { Modal } from "../design/Modal";
import { nameOf } from "../design/people";
import { go } from "../design/router";
import { blip } from "../design/sound";
import { toast } from "../design/toast";
import { can, useWorkspace } from "../workspace";
import { PRIORITY_LABEL } from "./Home";
import { useQuickCreate } from "./quickCreate";

/** The full "new activity" dialog. */
export function NewItem({
  projectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const { projects, current, sprints, account, setCurrentProjectId } =
    useWorkspace();
  const { create } = useQuickCreate();
  const writable = useMemo(
    () => (projects ?? []).filter((state) => can(state, "work.create")),
    [projects],
  );
  const initial =
    writable.find(
      (state) => state.project.id === (projectId ?? current?.project.id),
    ) ?? writable[0];
  const [project, setProject] = useState(initial?.project.id ?? "");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(account.id);
  const [due, setDue] = useState(addDays(todayIso(), 5));
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [description, setDescription] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = writable.find((entry) => entry.project.id === project);
  const active = sprints.find((sprint) => sprint.state === "active");

  async function submit() {
    if (state === undefined) return;
    if (title.trim() === "") {
      setMissing(true);
      return;
    }
    setBusy(true);
    const created = await create(state, {
      title: title.trim(),
      ...(description.trim() === "" ? {} : { description: description.trim() }),
      ...(assignee === "" ? {} : { assigneeId: assignee }),
      ...(due === "" ? {} : { dueDate: due }),
      priority,
      ...(active === undefined ? {} : { sprintId: active.id }),
    });
    setBusy(false);
    if (created === undefined) return;
    onClose();
    setCurrentProjectId(state.project.id);
    blip("ok");
    toast("Atividade criada em A fazer.", {
      act: ["Abrir", () => go(`work/${created.id}`)],
    });
    go("work");
  }

  return (
    <Modal onClose={onClose}>
      <div className="dh">
        <h2 id="dlgt">Nova atividade</h2>
      </div>
      <form
        className="dbd col gap12"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="nt">Título</label>
          <input
            aria-invalid={missing ? true : undefined}
            autoFocus
            className="inp"
            id="nt"
            maxLength={200}
            onChange={(event) => {
              setTitle(event.target.value);
              setMissing(false);
            }}
            placeholder="O que precisa ser feito?"
            value={title}
          />
          {missing ? (
            <span className="err">
              <Icon name="alert" size="sm" />
              Dê um título para continuar.
            </span>
          ) : null}
        </div>
        <div className="row gap12 wrap">
          <div className="field grow">
            <label htmlFor="np">Projeto</label>
            <select
              className="inp"
              id="np"
              onChange={(event) => {
                setProject(event.target.value);
                setAssignee("");
              }}
              value={project}
            >
              {writable.map((entry) => (
                <option key={entry.project.id} value={entry.project.id}>
                  {entry.project.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="nw">Responsável</label>
            <select
              className="inp"
              id="nw"
              onChange={(event) => setAssignee(event.target.value)}
              value={assignee}
            >
              <option value="">Sem responsável</option>
              {(state?.members ?? []).map((member) => (
                <option key={member.accountId} value={member.accountId}>
                  {nameOf(member.email)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row gap12 wrap">
          <div className="field grow">
            <label htmlFor="nd">Prazo</label>
            <input
              className="inp"
              id="nd"
              onChange={(event) => setDue(event.target.value)}
              type="date"
              value={due}
            />
          </div>
          <div className="field grow">
            <label htmlFor="nr">Prioridade</label>
            <select
              className="inp"
              id="nr"
              onChange={(event) =>
                setPriority(event.target.value as WorkItem["priority"])
              }
              value={priority}
            >
              {(Object.keys(PRIORITY_LABEL) as WorkItem["priority"][]).map(
                (key) => (
                  <option key={key} value={key}>
                    {PRIORITY_LABEL[key]}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ns">Descrição</label>
          <textarea
            className="inp"
            id="ns"
            maxLength={50000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Markdown simples. Fica cifrada neste dispositivo."
            rows={3}
            value={description}
          />
        </div>
        <button hidden type="submit" />
      </form>
      <div className="dft">
        <button className="btn" onClick={onClose} type="button">
          Cancelar
        </button>
        <button
          className={`btn primary${busy ? " loading" : ""}`}
          disabled={state === undefined}
          onClick={() => void submit()}
          type="button"
        >
          Criar atividade
        </button>
      </div>
    </Modal>
  );
}
