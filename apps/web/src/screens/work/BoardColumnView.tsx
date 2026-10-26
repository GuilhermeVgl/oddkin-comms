import type { BoardColumn } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Sprite } from "../../design/Sprite";
import type { ProjectState } from "../../workspace";
import { InlineAdd } from "./InlineAdd";
import { WorkCard } from "./WorkCard";
import type { Entry } from "./workRules";

/** One board column: header, its cards (with the drop placeholder) and the add button. */
export function BoardColumnView({
  column,
  position,
  cards,
  state,
  dragging,
  over,
  adding,
  onAdding,
  onColumnMenu,
  onPress,
  onCardMenu,
  onOpenCard,
  onToggle,
}: {
  column: BoardColumn;
  position: number;
  cards: Entry[];
  state: ProjectState;
  dragging: string | null;
  over: { col: string; index: number } | null;
  adding: string | null;
  onAdding: (columnId: string | null) => void;
  onColumnMenu: (anchor: HTMLElement, column: BoardColumn) => void;
  onPress: (entry: Entry, event: React.PointerEvent<HTMLElement>) => void;
  onCardMenu: (anchor: HTMLElement, entry: Entry) => void;
  onOpenCard: (entry: Entry) => void;
  onToggle: (entry: Entry) => void;
}) {
  const placeholderAt = over?.col === column.id ? over.index : -1;
  const dropping = over?.col === column.id;
  const visible = cards.filter((entry) => entry.item.id !== dragging);
  return (
    <section
      aria-label={`${column.name}, ${cards.length} atividades`}
      className={`colm${dropping ? " over" : ""}${dropping && column.category === "done" ? " win" : ""}`}
      data-col={column.id}
      role="listitem"
    >
      <div className="colh">
        <span className="n num">{cards.length}</span>
        <h3>{column.name}</h3>
        <span className="cat">
          {column.category === "done" ? "concluída" : ""}
        </span>
        {state.project.isManager ? (
          <button
            aria-label={`Opções da coluna ${column.name}`}
            className="iconbtn mini"
            onClick={(event) => onColumnMenu(event.currentTarget, column)}
            type="button"
          >
            <Icon name="more" size="sm" />
          </button>
        ) : null}
      </div>
      <div className="cards">
        {cards.length === 0 && !dropping ? (
          <div className="emptycol">
            <div className="emp-sp">
              <Sprite
                pose="sleep"
                scale={2}
                who={position % 2 === 0 ? "tela" : "capuz"}
              />
            </div>
            <span className="pixel wk-px16">
              {column.category === "done"
                ? "Nada concluído ainda"
                : "Coluna vazia"}
            </span>
            <span className="xs">Arraste um cartão para cá.</span>
          </div>
        ) : null}
        {cards.flatMap((entry, index) => {
          const out: React.ReactNode[] = [];
          const visibleIndex = visible.findIndex(
            (value) => value.item.id === entry.item.id,
          );
          if (placeholderAt >= 0 && visibleIndex === placeholderAt)
            out.push(<div className="ph" key={`ph-${index}`} />);
          out.push(
            <WorkCard
              canMove
              dragging={dragging === entry.item.id}
              entry={entry}
              key={entry.item.id}
              onDragStart={(event) => onPress(entry, event)}
              onMenu={(anchor) => onCardMenu(anchor, entry)}
              onOpen={() => onOpenCard(entry)}
              onToggle={() => onToggle(entry)}
            />,
          );
          return out;
        })}
        {placeholderAt >= visible.length && dropping ? (
          <div className="ph" />
        ) : null}
      </div>
      {column.category === "todo" || position === 0 ? (
        adding === column.id ? (
          <InlineAdd
            column={column}
            onDone={() => onAdding(null)}
            state={state}
          />
        ) : (
          <button
            className="addcard"
            onClick={() => onAdding(column.id)}
            type="button"
          >
            <Icon name="plus" size="sm" /> Adicionar atividade
          </button>
        )
      ) : null}
    </section>
  );
}
