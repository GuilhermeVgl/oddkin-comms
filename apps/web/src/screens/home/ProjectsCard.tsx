import type { CurrentAccount } from "@crewstead/api-client";
import { isDone } from "../../columns";
import { Avatar, Pbar } from "../../design/primitives";
import { go } from "../../design/router";
import { projectColor } from "../../shell/Sidebar";
import { useWorkspace } from "../../workspace";

export function ProjectsCard({
  account,
  loading,
}: {
  account: CurrentAccount;
  loading: boolean;
}) {
  const { projects, setCurrentProjectId } = useWorkspace();
  const everyProject = projects ?? [];
  return (
    <section className="card pad">
      <h2 className="h2 hm-h2">Projetos</h2>
      <div className="col gap8">
        {everyProject.length === 0 ? (
          <p className="muted sm">
            {loading
              ? "Carregando projetos…"
              : account.isAdmin
                ? "Nenhum projeto ainda. Crie o primeiro em Atividades."
                : "Você ainda não participa de nenhum projeto."}
          </p>
        ) : null}
        {everyProject.map((state) => {
          const tasks = state.items.filter((item) => item.kind === "task");
          const done = tasks.filter((item) =>
            isDone(state.columns, item.columnId),
          ).length;
          return (
            <button
              className="proj-card"
              key={state.project.id}
              onClick={() => {
                setCurrentProjectId(state.project.id);
                go("work");
              }}
              type="button"
            >
              <div className="row">
                <span
                  className="proj-ic"
                  style={{ background: projectColor(state.project.color) }}
                >
                  {state.project.name.charAt(0).toLocaleUpperCase("pt-BR")}
                </span>
                <div className="grow col">
                  <b>{state.project.name}</b>
                  <span className="xs muted">{state.project.description}</span>
                </div>
                <span className="avs">
                  {state.members.slice(0, 4).map((member) => (
                    <Avatar
                      email={member.email}
                      id={member.accountId}
                      key={member.accountId}
                      size="sm"
                    />
                  ))}
                </span>
              </div>
              <div className="row">
                <Pbar
                  on={
                    tasks.length > 0
                      ? Math.round((done / tasks.length) * 10)
                      : 0
                  }
                  total={10}
                />
                <span className="xs muted num">
                  {done}/{tasks.length}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
