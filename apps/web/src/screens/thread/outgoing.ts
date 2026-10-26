/** A message the person sent that the server has not confirmed yet. */
export type Outgoing = {
  id: string;
  body: string;
  replyToId?: string;
  state: "pending" | "failed";
};

export function setOutgoingState(
  list: Outgoing[],
  id: string,
  state: Outgoing["state"],
): Outgoing[] {
  return list.map((entry) => (entry.id === id ? { ...entry, state } : entry));
}
