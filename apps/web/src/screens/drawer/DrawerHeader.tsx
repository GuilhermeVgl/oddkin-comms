import type { Project } from "@crewstead/api-client";
import type { RefObject } from "react";
import { Icon } from "../../design/icons";
import { projectColor } from "../../shell/Sidebar";

/** Project tag, short id, follow toggle, "more" menu and close button. */
export function DrawerHeader({
  project,
  itemId,
  following,
  closeRef,
  onToggleFollow,
  onMore,
  onClose,
}: {
  project: Project;
  itemId: string;
  following: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  onToggleFollow: () => void;
  onMore: (anchor: HTMLElement) => void;
  onClose: () => void;
}) {
  return (
    <div className="dh">
      <span className="tag">
        <i className="pd" style={{ background: projectColor(project.color) }} />
        {project.name}
      </span>
      <span className="mono xs muted">{itemId.slice(0, 8).toUpperCase()}</span>
      <span className="grow" />
      <button
        aria-pressed={following}
        className="btn sm"
        onClick={onToggleFollow}
        type="button"
      >
        <Icon name="bell" size="sm" />
        {following ? "Seguindo" : "Seguir"}
      </button>
      <button
        aria-label="Mais ações"
        className="iconbtn"
        onClick={(event) => onMore(event.currentTarget)}
        type="button"
      >
        <Icon name="more" />
      </button>
      <button
        aria-label="Fechar detalhe"
        className="iconbtn"
        onClick={onClose}
        ref={closeRef}
        type="button"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
