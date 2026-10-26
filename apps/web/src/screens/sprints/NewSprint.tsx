import { useState } from "react";
import { addDays, todayIso } from "../../design/format";
import { Modal } from "../../design/Modal";
import { Banner } from "../../design/primitives";
import { toast } from "../../design/toast";
import { createSprintContent } from "../../e2ee/content";
import { csrfToken } from "../../errors";
import { useWorkspace } from "../../workspace";
import { sprintDatesError } from "./sprintRules";

export function NewSprint({ onClose }: { onClose: () => void }) {
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
          const problem = sprintDatesError(starts, ends);
          if (problem !== "") {
            setError(problem);
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
