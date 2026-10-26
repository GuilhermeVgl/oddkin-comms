import type { CurrentAccount, Sprint } from "@crewstead/api-client";
import { useMemo, useState } from "react";
import { Icon } from "../design/icons";
import { Duo } from "../design/Sprite";
import { Page } from "../shell/Page";
import { useWorkspace } from "../workspace";
import { CloseWizard } from "./sprints/CloseWizard";
import { NewSprint } from "./sprints/NewSprint";
import { PlanningTable } from "./sprints/PlanningTable";
import { SprintBanners } from "./sprints/SprintBanners";
import { SprintCard } from "./sprints/SprintCard";
import { ClosedSprints, PlannedSprints } from "./sprints/SprintList";
import { backlogRows, rowsOfSprint, splitSprints } from "./sprints/sprintRules";
import { taskEntries } from "./work/workRules";

export function Sprints({ account }: { account: CurrentAccount }) {
  const { projects, sprints, reload } = useWorkspace();
  const [newOpen, setNewOpen] = useState(false);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const canPlan = account.isAdmin;

  const rows = useMemo(() => taskEntries(projects ?? []), [projects]);
  const { active, planned, closed } = splitSprints(sprints);
  const backlog = backlogRows(rows);
  const loading = projects === null;
  const activeRows = active === undefined ? [] : rowsOfSprint(rows, active.id);

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
      <SprintBanners account={account} sprints={sprints} />
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
            <SprintCard
              account={account}
              canPlan={canPlan}
              onClose={() => setClosing(active)}
              rows={activeRows}
              sprint={active}
            />
          )}
          <PlannedSprints
            active={active}
            canPlan={canPlan}
            planned={planned}
            rows={rows}
          />
        </div>
        <div className="stack">
          <PlanningTable
            backlog={backlog}
            canPlan={canPlan}
            sprints={sprints}
          />
          <ClosedSprints closed={closed} rows={rows} />
        </div>
      </div>
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
