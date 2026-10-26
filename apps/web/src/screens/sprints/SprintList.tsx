import { startSprint, type Sprint } from "@crewstead/api-client";
import { fmtD } from "../../design/format";
import { blip } from "../../design/sound";
import { toast } from "../../design/toast";
import { csrfToken } from "../../errors";
import { useWorkspace } from "../../workspace";
import { doneCount, rowsOfSprint, type Row } from "./sprintRules";
import { ProjectDot } from "../ProjectDot";

export function PlannedSprints({
  planned,
  rows,
  active,
  canPlan,
}: {
  planned: Sprint[];
  rows: Row[];
  active: Sprint | undefined;
  canPlan: boolean;
}) {
  const { client, run } = useWorkspace();
  return (
    <section className="stack">
      <h2 className="h2">Planejadas</h2>
      {planned.map((sprint) => {
        const list = rowsOfSprint(rows, sprint.id);
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
              <span className="sm muted grow">{list.length} atividades</span>
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
                <ProjectDot color={state.project.color} />
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
  );
}

export function ClosedSprints({
  closed,
  rows,
}: {
  closed: Sprint[];
  rows: Row[];
}) {
  return (
    <section className="card pad">
      <h2 className="h2 sp-h2-tight">Encerradas</h2>
      {closed.map((sprint) => (
        <div className="list-i" key={sprint.id}>
          <div className="grow col">
            <b>{sprint.name}</b>
            <span className="xs muted">
              {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)}
              {sprint.goal === "" ? "" : ` · ${sprint.goal}`}
            </span>
          </div>
          <span className="tag lime num">
            {doneCount(rowsOfSprint(rows, sprint.id))} concluídas
          </span>
        </div>
      ))}
      {closed.length === 0 ? (
        <p className="muted sm">Nenhuma sprint encerrada.</p>
      ) : null}
    </section>
  );
}
