import type { CallRecord } from "@crewstead/api-client";
import { nameOf } from "../design/people";

/** "45 s", "12 min", "1 h 05 min": calls are short, so seconds only under a minute. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export type CallSummary = {
  tone: "live" | "done" | "missed";
  title: string;
  detail: string;
};

/** What the thread says about one call, from the point of view of the reader. */
export function describeCall(record: CallRecord, meEmail: string): CallSummary {
  const starter = record.startedBy === "" ? "Alguém" : nameOf(record.startedBy);
  const mine = record.startedBy === meEmail;
  const people = record.participants.map((email) => nameOf(email));
  if (record.state === "active") {
    return {
      tone: "live",
      title: "Chamada em andamento",
      detail:
        people.length === 0
          ? `${mine ? "Você iniciou" : `${starter} iniciou`} a chamada`
          : `${listNames(people)} ${people.length === 1 ? "está" : "estão"} na chamada`,
    };
  }
  if (!record.answered) {
    return {
      tone: "missed",
      title: mine ? "Ninguém atendeu" : `Chamada perdida de ${starter}`,
      detail: mine ? "Você ligou e ninguém entrou" : "Você não entrou a tempo",
    };
  }
  return {
    tone: "done",
    title: `Chamada de ${formatDuration(record.durationSeconds)}`,
    detail: `${listNames(people)} participaram · iniciada por ${mine ? "você" : starter}`,
  };
}
