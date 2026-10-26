import { dueLabel } from "../../design/format";
import { Icon } from "../../design/icons";
import { Empty } from "../../design/primitives";
import { go } from "../../design/router";
import { Sprite } from "../../design/Sprite";
import { useWorkspace } from "../../workspace";
import { PRIORITY_ICON, PRIORITY_LABEL } from "../priority";
import { isLate, type Entry } from "../work/workRules";

/** The six next things assigned to the person. */
export function MyQueue({
  queue,
  loading,
}: {
  queue: Entry[];
  loading: boolean;
}) {
  const { setCurrentProjectId } = useWorkspace();
  return (
    <section className="card pad">
      <div className="row hm-mb6">
        <h2 className="h2 grow">Minha fila</h2>
        <a className="btn ghost sm" href="#/work">
          Ver quadro <Icon name="right" size="sm" />
        </a>
      </div>
      {queue.length > 0 ? (
        queue.slice(0, 6).map(({ item, state }) => (
          <button
            className="qrow"
            key={item.id}
            onClick={() => {
              setCurrentProjectId(state.project.id);
              go(`work/${item.id}`);
            }}
            type="button"
          >
            <span
              className={`prio ${item.priority}`}
              title={`Prioridade ${PRIORITY_LABEL[item.priority]}`}
            >
              <Icon name={PRIORITY_ICON[item.priority]} size="sm" />
              <span className="sr">{PRIORITY_LABEL[item.priority]}</span>
            </span>
            <span className="grow col">
              <b className="u-semibold">{item.title}</b>
              <span className="xs muted">
                {state.project.name} ·{" "}
                {state.columns.find((column) => column.id === item.columnId)
                  ?.name ?? ""}
              </span>
            </span>
            <span
              className={isLate(item, false) ? "sm muted hm-late" : "sm muted"}
            >
              {item.dueDate === undefined
                ? "sem prazo"
                : dueLabel(item.dueDate)}
            </span>
          </button>
        ))
      ) : (
        <Empty
          art={<Sprite pose="sit" scale={5} who="capuz" />}
          title={loading ? "Carregando…" : "Fila limpa"}
        >
          {loading
            ? undefined
            : "Nada atribuído a você agora. Aproveite o respiro."}
        </Empty>
      )}
    </section>
  );
}
