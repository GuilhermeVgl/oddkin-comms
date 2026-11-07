import { useState } from "react";
import { useMenu } from "../../design/Menu";
import { useItemActions } from "../itemActions";
import { CardMenu } from "./CardMenu";
import { WorkCard } from "./WorkCard";
import type { Entry } from "./workRules";

const COLUMNS = [
  { category: "todo", label: "A fazer" },
  { category: "in_progress", label: "Em andamento" },
  { category: "done", label: "Concluído" },
] as const;

/** A single Kanban across projects, grouped by semantic status rather than project scope. */
export function ConsolidatedBoard({
  entries,
  onOpen,
}: {
  entries: Entry[];
  onOpen: (entry: Entry) => void;
}) {
  const { move, toggle } = useItemActions();
  const cardMenu = useMenu<Entry>();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div aria-label="Quadro de atividades" className="board" role="list">
      {COLUMNS.map((column) => {
        const cards = entries.filter((entry) =>
          entry.state.columns.some(
            (value) =>
              value.id === entry.item.columnId &&
              value.category === column.category,
          ),
        );
        return (
          <section
            aria-label={`${column.label}, ${cards.length} atividades`}
            className="colm"
            key={column.category}
            role="listitem"
          >
            <div className="colh">
              <span className="n num">{cards.length}</span>
              <h3>{column.label}</h3>
              {column.category === "done" ? (
                <span className="cat">concluída</span>
              ) : null}
            </div>
            <div className="cards">
              {cards.length === 0 ? (
                <p className="emptycol xs">Nenhuma atividade aqui.</p>
              ) : null}
              {cards.map((entry) => (
                <WorkCard
                  canMove={busy !== entry.item.id}
                  dragging={false}
                  entry={entry}
                  key={entry.item.id}
                  onDragStart={() => undefined}
                  onMenu={(anchor) => cardMenu.toggle(anchor, entry)}
                  onOpen={() => onOpen(entry)}
                  onToggle={() => {
                    setBusy(entry.item.id);
                    void toggle(entry.state, entry.item).finally(() =>
                      setBusy(null),
                    );
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
      {cardMenu.state === null ? null : (
        <CardMenu
          anchor={cardMenu.state.anchor}
          entry={cardMenu.state.data}
          move={move}
          onClose={cardMenu.close}
          onOpen={(item) => {
            const entry = entries.find((value) => value.item.id === item.id);
            if (entry !== undefined) onOpen(entry);
          }}
        />
      )}
    </div>
  );
}
