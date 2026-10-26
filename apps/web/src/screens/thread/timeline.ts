import type { CallRecord, Message } from "@crewstead/api-client";
import { fmtLong } from "../../design/format";

/** Fresh messages replace loaded ones with the same id; the result is ordered by sequence. */
export function mergeMessages(current: Message[], fresh: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of fresh) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest sequence seen so far, given a page of fresh messages (oldest first). */
export function latestSeq(previous: number, fresh: Message[]): number {
  return Math.max(previous, fresh[fresh.length - 1]?.seq ?? 0);
}

/** The messages whose body contains the search text; the same list when the search is empty. */
export function filterMessages(messages: Message[], query: string): Message[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return messages;
  return messages.filter((message) =>
    message.body.toLowerCase().includes(needle),
  );
}

/** Where "Novas mensagens" goes: before the messages unread when the thread opened. */
export function firstUnreadIndex(shown: number, unread: number): number {
  return unread > 0 ? shown - unread : -1;
}

/** "Hoje" for today, otherwise the long date. */
export function dayLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? "Hoje" : fmtLong(date);
}

type Placed =
  | { kind: "message"; message: Message; index: number }
  | { kind: "call"; record: CallRecord };

/** One row of the conversation; `day` is set when it starts a new day. */
export type TimelineEntry = Placed & { day: string | null };

/**
 * Messages and call records in one list, calls at the moment they started.
 * `history` is newest first, as the API returns it. While searching only
 * messages are shown.
 */
export function buildTimeline(
  shown: Message[],
  history: CallRecord[],
  { searching, now }: { searching: boolean; now: Date },
): TimelineEntry[] {
  const placed: Placed[] = [];
  const records = searching ? [] : [...history].reverse();
  shown.forEach((message, index) => {
    for (
      let next = records[0];
      next !== undefined && next.startedAt <= message.createdAt;
      next = records[0]
    ) {
      placed.push({ kind: "call", record: next });
      records.shift();
    }
    placed.push({ kind: "message", message, index });
  });
  for (const record of records) placed.push({ kind: "call", record });

  let lastDay = "";
  return placed.map((entry) => {
    const iso =
      entry.kind === "call" ? entry.record.startedAt : entry.message.createdAt;
    const long = fmtLong(new Date(iso));
    const changed = long !== lastDay;
    lastDay = long;
    return { ...entry, day: changed ? dayLabel(iso, now) : null };
  });
}
