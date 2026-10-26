import { updateWorkItem, type Sprint } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Menu, useMenu } from "../../design/Menu";
import { toast } from "../../design/toast";
import { csrfToken } from "../../errors";
import { can, useWorkspace } from "../../workspace";
import type { Row } from "./sprintRules";
import { ProjectDot } from "../ProjectDot";

/** Work without a sprint, with a menu to put each item into one. */
export function PlanningTable({
  backlog,
  sprints,
  canPlan,
}: {
  backlog: Row[];
  sprints: Sprint[];
  canPlan: boolean;
}) {
  const { client, run } = useWorkspace();
  const toSprint = useMenu<Row>();
  return (
    <>
      <section className="card pad">
        <div className="row">
          <h2 className="h2 grow">Backlog</h2>
          <span className="tag mute num">{backlog.length}</span>
        </div>
        <p className="xs muted sp-note">Atividades sem sprint corrente.</p>
        {backlog.map((row) => (
          <div className="row sp-line" key={row.item.id}>
            <ProjectDot color={row.state.project.color} />
            <span className="grow sm">{row.item.title}</span>
            {canPlan && can(row.state, "planning.edit") ? (
              <button
                className="btn sm ghost"
                onClick={(event) => toSprint.toggle(event.currentTarget, row)}
                type="button"
              >
                <Icon name="plus" size="sm" />
                Sprint
              </button>
            ) : null}
          </div>
        ))}
        {backlog.length === 0 ? (
          <p className="muted sm">Backlog vazio.</p>
        ) : null}
      </section>
      {toSprint.state === null ? null : (
        <Menu anchor={toSprint.state.anchor} onClose={toSprint.close} right>
          <div className="mh">Adicionar à sprint</div>
          {sprints
            .filter((sprint) => sprint.state !== "closed")
            .map((sprint) => (
              <button
                key={sprint.id}
                onClick={() => {
                  const row = toSprint.state?.data;
                  toSprint.close();
                  if (row === undefined) return;
                  void run(() =>
                    updateWorkItem(client, csrfToken(), row.item.id, {
                      version: row.item.version,
                      sprintId: sprint.id,
                    }),
                  ).then((moved) => {
                    if (moved !== undefined)
                      toast("Atividade e subtarefas movidas para a sprint.");
                  });
                }}
                role="menuitem"
                type="button"
              >
                {sprint.name}
                {sprint.state === "active" ? " (ativa)" : ""}
              </button>
            ))}
        </Menu>
      )}
    </>
  );
}
