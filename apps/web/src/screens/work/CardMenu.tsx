import type { WorkItem } from "@crewstead/api-client";
import { Icon } from "../../design/icons";
import { Menu } from "../../design/Menu";
import type { ProjectState } from "../../workspace";
import type { Entry } from "./workRules";

type Move = (
  state: ProjectState,
  item: WorkItem,
  columnId: string,
) => Promise<boolean>;

/** "Mover para" menu of one card: its project's columns, plus opening the detail. */
export function CardMenu({
  anchor,
  entry,
  onClose,
  onOpen,
  move,
}: {
  anchor: HTMLElement;
  entry: Entry;
  onClose: () => void;
  onOpen: (item: WorkItem) => void;
  move: Move;
}) {
  return (
    <Menu anchor={anchor} onClose={onClose} right>
      <div className="mh">Mover para</div>
      {entry.state.columns.map((column) => (
        <button
          aria-current={column.id === entry.item.columnId ? "true" : undefined}
          key={column.id}
          onClick={() => {
            onClose();
            void move(entry.state, entry.item, column.id);
          }}
          role="menuitem"
          type="button"
        >
          <Icon
            name={column.category === "done" ? "check" : "right"}
            size="sm"
          />
          {column.name}
        </button>
      ))}
      <hr />
      <button
        onClick={() => {
          onClose();
          onOpen(entry.item);
        }}
        role="menuitem"
        type="button"
      >
        <Icon name="eye" size="sm" />
        Abrir detalhe
      </button>
    </Menu>
  );
}
