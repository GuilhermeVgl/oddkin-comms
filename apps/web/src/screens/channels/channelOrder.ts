/** The channel ids after moving one by `offset` places, or null when it cannot move. */
export function idsAfterMove(
  ids: readonly string[],
  id: string,
  offset: number,
): string[] | null {
  const from = ids.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0] ?? id);
  return next;
}

/** The channel ids after dropping `dragging` before or after `targetId`; null when nothing changes. */
export function idsAfterDrop(
  ids: readonly string[],
  dragging: string | null,
  targetId: string,
  after: boolean,
): string[] | null {
  if (dragging === null || dragging === targetId) return null;
  const next = ids.filter((id) => id !== dragging);
  next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, dragging);
  return next;
}
