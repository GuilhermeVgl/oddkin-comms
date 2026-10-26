import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  bytes,
  daysTo,
  dueLabel,
  fmtClock,
  fmtD,
  fmtLong,
  greeting,
  rel,
  todayIso,
} from "./format";

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 10, 30));
  });
  afterEach(() => vi.useRealTimers());

  it("writes today as an ISO date in local time", () => {
    expect(todayIso()).toBe("2026-10-26");
  });

  it("moves across months and years", () => {
    expect(addDays("2026-10-26", 6)).toBe("2026-11-01");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole days, negative in the past", () => {
    expect(daysTo("2026-10-26")).toBe(0);
    expect(daysTo("2026-10-29")).toBe(3);
    expect(daysTo("2026-10-20")).toBe(-6);
  });

  it("says how late or early something is", () => {
    expect(dueLabel("2026-10-20")).toBe("atrasada 6 dias");
    expect(dueLabel("2026-10-25")).toBe("atrasada 1 dia");
    expect(dueLabel("2026-10-26")).toBe("hoje");
    expect(dueLabel("2026-10-27")).toBe("amanhã");
    expect(dueLabel("2026-10-30")).toBe("em 4 dias");
  });

  it("formats short, long and clock times in Portuguese", () => {
    expect(fmtD("2026-05-12")).toMatch(/^12( de)? mai$/);
    expect(fmtLong("2026-10-26").toLowerCase()).toContain("segunda");
    expect(fmtLong(new Date(2026, 9, 27)).toLowerCase()).toContain("terça");
    expect(fmtClock(new Date(2026, 9, 26, 9, 5).toISOString())).toBe("09:05");
  });

  it("says how long ago, in the biggest sensible unit", () => {
    const ago = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000).toISOString();
    expect(rel(ago(0))).toBe("agora");
    expect(rel(ago(5))).toBe("há 5 min");
    expect(rel(ago(120))).toBe("há 2 h");
    expect(rel(ago(3 * 1440))).toBe("há 3 d");
  });

  it("greets by the hour", () => {
    vi.setSystemTime(new Date(2026, 9, 26, 8));
    expect(greeting()).toBe("Bom dia");
    vi.setSystemTime(new Date(2026, 9, 26, 15));
    expect(greeting()).toBe("Boa tarde");
    vi.setSystemTime(new Date(2026, 9, 26, 21));
    expect(greeting()).toBe("Boa noite");
  });
});

describe("bytes", () => {
  it("picks KB, MB or GB with a decimal comma", () => {
    expect(bytes(10)).toBe("1 KB");
    expect(bytes(48_000)).toBe("48 KB");
    expect(bytes(2_500_000)).toBe("2,5 MB");
    expect(bytes(500_000_000)).toBe("500,0 MB");
    expect(bytes(1_200_000_000)).toBe("1,2 GB");
  });
});
