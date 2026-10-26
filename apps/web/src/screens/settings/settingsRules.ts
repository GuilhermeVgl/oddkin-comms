import type {
  BoardColumn,
  OrganizationPerson,
  WorkItem,
} from "@crewstead/api-client";
import type { IconName } from "../../design/icons";

/** A board needs at least one open column and one done column. */
export function hasOpenAndDone(columns: BoardColumn[]): boolean {
  return (
    columns.some((column) => column.category !== "done") &&
    columns.some((column) => column.category === "done")
  );
}

/** The same columns with one of them filed under another category. */
export function withCategory(
  columns: BoardColumn[],
  columnId: string,
  category: BoardColumn["category"],
): BoardColumn[] {
  return columns.map((entry) =>
    entry.id === columnId ? { ...entry, category } : entry,
  );
}

/** The column ids after moving one column up (-1) or down (1); null when it cannot move. */
export function columnOrderAfterMove(
  columns: BoardColumn[],
  index: number,
  by: -1 | 1,
): string[] | null {
  const target = index + by;
  if (index < 0 || index >= columns.length) return null;
  if (target < 0 || target >= columns.length) return null;
  const next = [...columns];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return null;
  next.splice(target, 0, moved);
  return next.map((column) => column.id);
}

/** Tasks (not subtasks) sitting in a column. */
export function countTasksIn(items: WorkItem[], columnId: string): number {
  return items.filter(
    (item) => item.kind === "task" && item.columnId === columnId,
  ).length;
}

export const STORAGE_BLOCKS = 25;

/** How many of the quota bar's blocks are filled by the reserved space. */
export function storageBlocks(
  usage: { quota: number; reserved: number } | null,
  total: number = STORAGE_BLOCKS,
): number {
  if (usage === null || usage.quota === 0) return 0;
  return Math.min(total, Math.ceil((usage.reserved / usage.quota) * total));
}

/** The role line shown under a person in the organization list. */
export function membershipLabel(person: OrganizationPerson): string {
  const role = person.isAdmin
    ? "Administração"
    : person.membershipKind === "internal"
      ? "Interno"
      : "Externo";
  return person.active ? role : `${role} · desativada`;
}

const KIND_LABEL: Record<string, string> = {
  work: "atividades",
  chat: "conversa do projeto",
  dm: "mensagem direta",
  sprint: "sprints",
};

/** The name of a key domain, as a person would say it. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function deviceIconName(deviceName: string): IconName {
  return /phone|iphone|android|mobile/i.test(deviceName)
    ? "phoneDev"
    : "laptop";
}
