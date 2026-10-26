import type {
  Sprint,
  SprintClosePreview,
  WorkItem,
} from "@crewstead/api-client";
import { isDone } from "../../columns";
import { fmtD } from "../../design/format";
import { Avatar, Banner, NoAvatar } from "../../design/primitives";
import { useWorkspace, type ProjectState } from "../../workspace";
import { countChoice, type Choice } from "./sprintRules";
import { ProjectDot } from "../ProjectDot";

type Choices = Record<string, Choice>;

/** The project an item belongs to, when this person can see it. */
export function useProjectOf(): (item: WorkItem) => ProjectState | undefined {
  const { projects } = useWorkspace();
  return (item) =>
    projects?.find((state) => state.project.id === item.projectId);
}

function columnName(state: ProjectState | undefined, item: WorkItem) {
  return state?.columns.find((column) => column.id === item.columnId)?.name;
}

export function SummaryStep({ preview }: { preview: SprintClosePreview }) {
  const { people } = useWorkspace();
  const projectOf = useProjectOf();
  const pending = preview.pending;
  return (
    <>
      <div className="row gap12 wrap">
        <div className="card pad grow">
          <div className="pixel sp-big">{preview.completed.length}</div>
          <span className="muted">concluídas</span>
        </div>
        <div className="card pad grow">
          <div className="pixel sp-big">{pending.length}</div>
          <span className="muted">pendentes</span>
        </div>
      </div>
      {preview.blocked ? (
        <div className="sp-mt12">
          <Banner kind="warn">
            Há pendências em projetos aos quais você não tem acesso. Peça acesso
            antes de encerrar.
          </Banner>
        </div>
      ) : null}
      <h3 className="h2 sp-mt16">Pendências</h3>
      {pending.map((item) => {
        const state = projectOf(item);
        const owner =
          item.assigneeId === undefined
            ? undefined
            : people.get(item.assigneeId);
        return (
          <div className="row sp-line" key={item.id}>
            <ProjectDot color={state?.project.color ?? ""} />
            <span className="grow">{item.title}</span>
            <span className="tag mute">{columnName(state, item)}</span>
            {owner === undefined ? (
              <NoAvatar size="sm" />
            ) : (
              <Avatar email={owner.email} id={owner.id} size="sm" />
            )}
          </div>
        );
      })}
      {pending.length === 0 ? (
        <p className="muted">Nada pendente. Sprint limpa.</p>
      ) : null}
    </>
  );
}

export function DestinationStep({
  preview,
  planned,
  choices,
  destination,
  conflict,
  onChoice,
  onDestination,
}: {
  preview: SprintClosePreview;
  planned: Sprint[];
  choices: Choices;
  destination: string;
  conflict: string;
  onChoice: (itemId: string, choice: Choice) => void;
  onDestination: (id: string) => void;
}) {
  const { projects } = useWorkspace();
  const projectOf = useProjectOf();
  const pending = preview.pending;
  const needsNext = Object.values(choices).includes("next");
  return (
    <>
      {planned.length > 0 && needsNext ? (
        <div className="field">
          <label htmlFor="wn">Próxima sprint</label>
          <select
            className="inp"
            id="wn"
            onChange={(event) => onDestination(event.target.value)}
            value={destination}
          >
            {planned.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} · {fmtD(option.startsOn)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {planned.length === 0 && pending.length > 0 ? (
        <div className="sp-mb8">
          <Banner>
            Não há sprint planejada. As pendências voltam ao backlog; planeje a
            próxima depois.
          </Banner>
        </div>
      ) : null}
      {conflict === "" ? null : (
        <div className="sp-mt12">
          <Banner kind="warn" role="alert">
            <b>{conflict}</b> O resumo foi atualizado com a versão mais recente.
            Revise o destino antes de confirmar.
          </Banner>
        </div>
      )}
      <h3 className="h2 sp-mt16">Para onde vai cada pendência?</h3>
      <p className="xs muted">
        Cada pendência precisa de um destino. Nada fica sem lugar.
      </p>
      {pending.map((item) => {
        const state = projectOf(item);
        const openSubs = (projects ?? [])
          .flatMap((entry) => entry.items)
          .filter(
            (sub) =>
              sub.parentId === item.id &&
              !isDone(projectOf(item)?.columns ?? [], sub.columnId),
          ).length;
        return (
          <div className="dest" key={item.id}>
            <div className="col">
              <b className="u-semibold">{item.title}</b>
              <span className="xs muted">
                {state?.project.name} · {columnName(state, item)}
                {openSubs > 0
                  ? ` · ${openSubs} subtarefas abertas vão junto`
                  : ""}
              </span>
            </div>
            <div
              aria-label={`Destino de ${item.title}`}
              className="seg"
              role="group"
            >
              <button
                aria-pressed={choices[item.id] === "next"}
                disabled={planned.length === 0}
                onClick={() => onChoice(item.id, "next")}
                type="button"
              >
                Próxima sprint
              </button>
              <button
                aria-pressed={choices[item.id] === "backlog"}
                onClick={() => onChoice(item.id, "backlog")}
                type="button"
              >
                Backlog
              </button>
            </div>
          </div>
        );
      })}
      {pending.length === 0 ? (
        <p className="muted">Sem pendências para distribuir.</p>
      ) : null}
    </>
  );
}

export function ReviewStep({
  pendingCount,
  choices,
  nextName,
}: {
  pendingCount: number;
  choices: Choices;
  nextName: string;
}) {
  return (
    <>
      <Banner icon="shieldOk" kind="ok">
        A API valida a lista completa de {pendingCount} pendências e as versões
        vistas por você. Se alguém alterar algo durante a revisão, você recebe
        um conflito e nada é movido pela metade.
      </Banner>
      <div className="row gap12 wrap sp-mt14">
        <div className="card pad grow">
          <span className="muted">
            Vão para {nextName === "" ? "a próxima sprint" : nextName}
          </span>
          <div className="pixel sp-mid">{countChoice(choices, "next")}</div>
        </div>
        <div className="card pad grow">
          <span className="muted">Voltam ao backlog</span>
          <div className="pixel sp-mid">{countChoice(choices, "backlog")}</div>
        </div>
      </div>
      <p className="xs muted sp-mt12">
        Prazos não mudam automaticamente. O histórico da participação nesta
        sprint é preservado.
      </p>
    </>
  );
}
