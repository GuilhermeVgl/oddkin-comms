import type { Sprint, WorkItem } from "@crewstead/api-client";
import type { Person } from "../../workspace";
import { PersonAvatar } from "./PropertyTiles";

/** Current version and creation/update dates; old text values are not kept in the clear. */
export function HistorySection({
  item,
  assignee,
  sprint,
}: {
  item: WorkItem;
  assignee: Person | undefined;
  sprint: Sprint | undefined;
}) {
  return (
    <details>
      <summary className="h2 dr-history-sum">Histórico</summary>
      <ul className="feed dr-history-feed">
        <li>
          <PersonAvatar person={assignee} />
          <span>
            Versão atual <b className="mono">v{item.version}</b>
            {sprint === undefined ? "" : ` · ${sprint.name}`}
          </span>
        </li>
        <li>
          <span className="xs muted">
            Criada em {new Date(item.createdAt).toLocaleDateString("pt-BR")} ·
            atualizada em {new Date(item.updatedAt).toLocaleDateString("pt-BR")}
            . Valores antigos de texto não ficam em claro no servidor.
          </span>
        </li>
      </ul>
    </details>
  );
}
