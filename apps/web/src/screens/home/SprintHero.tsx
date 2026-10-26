import type { Sprint } from "@crewstead/api-client";
import { daysTo, fmtD } from "../../design/format";
import { MissionBar } from "../../design/Mission";
import { Duo } from "../../design/Sprite";

export function SprintHero({
  sprint,
  total,
  done,
  projectNames,
}: {
  sprint: Sprint;
  total: number;
  done: number;
  projectNames: string[];
}) {
  const left = Math.max(0, daysTo(sprint.endsOn));
  return (
    <section aria-label="Sprint atual" className="sprint-hero">
      <div className="col gap12 grow">
        <span className="tag lime hm-fit">Sprint ativa</span>
        <h2>{sprint.name}</h2>
        {sprint.goal === "" ? null : (
          <p className="mission-goal">
            <b>Missão:</b> {sprint.goal}
          </p>
        )}
        <p className="muted sm">
          {fmtD(sprint.startsOn)} a {fmtD(sprint.endsOn)} ·{" "}
          {left === 0 ? "último dia" : `${left} dias restantes`}
        </p>
        <MissionBar done={done} total={total} />
        <div className="row hm-mt6">
          <a className="btn accent sm" href="#/sprints">
            Ver sprint
          </a>
          <span className="xs muted">
            {projectNames.length === 0
              ? ""
              : `Projetos: ${projectNames.join(", ")}`}
          </span>
        </div>
      </div>
      <div aria-hidden="true" className="dockhero hm-dock">
        <Duo pose="wave" scale={4} />
      </div>
    </section>
  );
}

/** Shown while no sprint is running. */
export function NoSprintHero() {
  return (
    <section aria-label="Sprint atual" className="sprint-hero">
      <div className="col gap12 grow">
        <span className="tag hm-fit">Planejamento</span>
        <h2>Pronto para o próximo passo</h2>
        <p className="muted sm">
          Ainda não existe uma sprint ativa. Organize o backlog e comece quando
          a equipe estiver pronta.
        </p>
        <div className="row hm-mt6">
          <a className="btn accent sm" href="#/sprints">
            Ver sprints
          </a>
        </div>
      </div>
      <div aria-hidden="true" className="hm-dock">
        <Duo pose="think" scale={4} />
      </div>
    </section>
  );
}
