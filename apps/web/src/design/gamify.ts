import type { MyStats } from "@crewstead/api-client";

export type Achievement = {
  id: string;
  title: string;
  hint: string;
  icon:
    "check" | "flag" | "bell" | "phone" | "smile" | "clock" | "chat" | "key";
  /** How far the person is, as a count out of goal. */
  progress: (stats: MyStats) => number;
  goal: number;
};

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-delivery",
    title: "Primeira entrega",
    hint: "Conclua uma atividade atribuída a você",
    icon: "check",
    progress: (s) => s.completedTotal,
    goal: 1,
  },
  {
    id: "ten-deliveries",
    title: "Ritmo de equipe",
    hint: "Conclua 10 atividades",
    icon: "flag",
    progress: (s) => s.completedTotal,
    goal: 10,
  },
  {
    id: "fifty-deliveries",
    title: "Máquina de entregar",
    hint: "Conclua 50 atividades",
    icon: "flag",
    progress: (s) => s.completedTotal,
    goal: 50,
  },
  {
    id: "streak-3",
    title: "Pegando fogo",
    hint: "3 dias seguidos entregando",
    icon: "bell",
    progress: (s) => s.bestStreak,
    goal: 3,
  },
  {
    id: "streak-7",
    title: "Semana inteira",
    hint: "7 dias seguidos entregando",
    icon: "bell",
    progress: (s) => s.bestStreak,
    goal: 7,
  },
  {
    id: "streak-30",
    title: "Constância",
    hint: "30 dias seguidos entregando",
    icon: "bell",
    progress: (s) => s.bestStreak,
    goal: 30,
  },
  {
    id: "first-call",
    title: "Na linha",
    hint: "Participe de uma chamada",
    icon: "phone",
    progress: (s) => s.callsJoined,
    goal: 1,
  },
  {
    id: "ten-calls",
    title: "Voz da equipe",
    hint: "Participe de 10 chamadas",
    icon: "phone",
    progress: (s) => s.callsJoined,
    goal: 10,
  },
  {
    id: "first-thanks",
    title: "Gentileza",
    hint: "Agradeça por uma entrega",
    icon: "smile",
    progress: (s) => s.kudosGiven,
    goal: 1,
  },
  {
    id: "five-thanks",
    title: "Reconhecido",
    hint: "Receba 5 agradecimentos",
    icon: "smile",
    progress: (s) => s.kudosReceived,
    goal: 5,
  },
  {
    id: "focus-hour",
    title: "Concentração",
    hint: "Some 1 hora em modo foco",
    icon: "clock",
    progress: (s) => s.focusMinutes,
    goal: 60,
  },
  {
    id: "focus-ten-hours",
    title: "Mergulho fundo",
    hint: "Some 10 horas em modo foco",
    icon: "clock",
    progress: (s) => s.focusMinutes,
    goal: 600,
  },
  {
    id: "commenter",
    title: "Boa de papo",
    hint: "Escreva 10 comentários em atividades",
    icon: "chat",
    progress: (s) => s.commentsWritten,
    goal: 10,
  },
];

export function earnedIds(stats: MyStats): string[] {
  return ACHIEVEMENTS.filter(
    (entry) => entry.progress(stats) >= entry.goal,
  ).map((entry) => entry.id);
}

/** Achievements earned now that were not in the set already announced. */
export function newlyEarned(
  stats: MyStats,
  announced: string[],
): Achievement[] {
  const known = new Set(announced);
  return ACHIEVEMENTS.filter(
    (entry) => entry.progress(stats) >= entry.goal && !known.has(entry.id),
  );
}

export const MILESTONES = [25, 50, 75, 100] as const;

/**
 * The highest milestone (percent) that progress crossed between two readings,
 * or null when it crossed none. Going backwards never announces anything.
 */
export function milestoneCrossed(
  before: number,
  after: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  const was = (before / total) * 100;
  const now = (after / total) * 100;
  let crossed: number | null = null;
  for (const milestone of MILESTONES) {
    if (was < milestone && now >= milestone) crossed = milestone;
  }
  return crossed;
}

/** Finishing something heavy (urgent, or with several subtasks) earns a bigger celebration. */
export function celebrationSize(
  priority: "low" | "normal" | "high" | "urgent",
  subtasks: number,
): "normal" | "big" {
  return priority === "urgent" || subtasks >= 3 ? "big" : "normal";
}

/** "3 dias seguidos" / "1 dia" for the streak chip; empty while there is no streak. */
export function streakLabel(days: number): string {
  if (days <= 0) return "";
  return days === 1 ? "1 dia seguido" : `${days} dias seguidos`;
}

/** What Capuz says about the person's day. */
export function dayLine(open: number, finishedToday: number): string {
  if (open === 0 && finishedToday === 0)
    return "Dia livre. Que tal planejar o próximo passo?";
  if (open === 0)
    return `Fila limpa. ${finishedToday} ${finishedToday === 1 ? "entrega" : "entregas"} hoje.`;
  if (finishedToday === 0)
    return `${open} ${open === 1 ? "coisa" : "coisas"} para hoje. Um passo de cada vez.`;
  return `${finishedToday} já ${finishedToday === 1 ? "foi" : "foram"}, faltam ${open}.`;
}

/** Whole minutes left in a countdown, as m:ss (negative time shows 0:00). */
export function clockLabel(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whole minutes spent so far in a focus block, never more than planned. */
export function elapsedMinutes(
  startedAt: number,
  now: number,
  plannedMinutes: number,
): number {
  return Math.min(
    plannedMinutes,
    Math.max(0, Math.floor((now - startedAt) / 60_000)),
  );
}

/** A cancelled focus block only counts once it lasted a few minutes. */
export const MIN_COUNTED_FOCUS = 5;

export type SprintRecap = {
  name: string;
  goal: string;
  delivered: number;
  carried: number;
  urgent: number;
  days: number;
  projects: string[];
  streak: number;
};

/** The sprint summary as plain text, ready to paste into a channel. */
export function recapText(recap: SprintRecap): string {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const lines = [`Sprint “${recap.name}” encerrada.`];
  if (recap.goal !== "") lines.push(`Missão: ${recap.goal}`);
  lines.push(
    `Entregas: ${recap.delivered}${recap.urgent > 0 ? ` (${plural(recap.urgent, "urgente", "urgentes")})` : ""}. Seguiram: ${recap.carried}.`,
  );
  lines.push(
    `${plural(recap.days, "dia", "dias")} de sprint${recap.projects.length > 0 ? ` · ${recap.projects.join(", ")}` : ""}.`,
  );
  if (recap.streak > 1)
    lines.push(
      `Maior sequência da equipe agora: ${streakLabel(recap.streak)}.`,
    );
  return lines.join("\n");
}
