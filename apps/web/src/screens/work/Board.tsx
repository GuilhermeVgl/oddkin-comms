import type { BoardColumn, WorkItem } from "@crewstead/api-client";
import { useState } from "react";
import { useMenu } from "../../design/Menu";
import type { ProjectState } from "../../workspace";
import { useItemActions } from "../itemActions";
import { ColumnMenu } from "./ColumnMenu";
import { BoardColumnView } from "./BoardColumnView";
import { CardMenu } from "./CardMenu";
import { useBoardDrag } from "./useBoardDrag";
import type { Entry } from "./workRules";

export function Board({
  entries,
  state,
  onOpen,
}: {
  entries: Entry[];
  state: ProjectState;
  onOpen: (item: WorkItem) => void;
}) {
  const { move, toggle } = useItemActions();
  const { host, dragging, over, justDragged, pressCard } = useBoardDrag(
    state,
    move,
  );
  const cardMenu = useMenu<Entry>();
  const [adding, setAdding] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState<{
    anchor: HTMLElement;
    column: BoardColumn;
  } | null>(null);

  return (
    <div
      aria-label="Quadro de atividades"
      className="board"
      id="board"
      ref={host}
      role="list"
    >
      {state.columns.map((column, position) => (
        <BoardColumnView
          adding={adding}
          cards={entries.filter((entry) => entry.item.columnId === column.id)}
          column={column}
          dragging={dragging}
          key={column.id}
          onAdding={setAdding}
          onCardMenu={(anchor, entry) => cardMenu.toggle(anchor, entry)}
          onColumnMenu={(anchor, value) =>
            setColMenu((current) =>
              current?.column.id === value.id
                ? null
                : { anchor, column: value },
            )
          }
          onOpenCard={(entry) => {
            if (justDragged.current) return;
            onOpen(entry.item);
          }}
          onPress={pressCard}
          onToggle={(entry) => void toggle(state, entry.item)}
          over={over}
          position={position}
          state={state}
        />
      ))}
      {cardMenu.state === null ? null : (
        <CardMenu
          anchor={cardMenu.state.anchor}
          entry={cardMenu.state.data}
          move={move}
          onClose={cardMenu.close}
          onOpen={onOpen}
        />
      )}
      {colMenu === null ? null : (
        <ColumnMenu
          anchor={colMenu.anchor}
          column={colMenu.column}
          onClose={() => setColMenu(null)}
          state={state}
        />
      )}
    </div>
  );
}
