/** Date, time and size formatting in pt-BR, shared by every screen. */

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
});
const longDate = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function noon(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/** "12 mai" for an ISO date (yyyy-mm-dd). */
export function fmtD(iso: string): string {
  return shortDate.format(noon(iso)).replace(".", "");
}

export function fmtLong(date: Date | string): string {
  const value = typeof date === "string" ? noon(date) : date;
  return longDate.format(value);
}

export function fmtClock(iso: string): string {
  return clock.format(new Date(iso));
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const value = noon(iso);
  value.setDate(value.getDate() + days);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

/** Whole days from today to an ISO date; negative when it is in the past. */
export function daysTo(iso: string): number {
  return Math.round((noon(iso).getTime() - noon(todayIso()).getTime()) / 864e5);
}

export function dueLabel(iso: string): string {
  const days = daysTo(iso);
  if (days < -1) return `atrasada ${-days} dias`;
  if (days === -1) return "atrasada 1 dia";
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

/** Relative time for a timestamp: "agora", "há 5 min", "há 2 h", "há 3 d". */
export function rel(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const abs = Math.abs(minutes);
  if (abs < 2) return "agora";
  if (abs < 60) return `há ${abs} min`;
  if (abs < 1440) return `há ${Math.round(abs / 60)} h`;
  return `há ${Math.round(abs / 1440)} d`;
}

export function bytes(size: number): string {
  if (size >= 1e9) return `${(size / 1e9).toFixed(1).replace(".", ",")} GB`;
  if (size >= 1e6) return `${(size / 1e6).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(size / 1e3))} KB`;
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
