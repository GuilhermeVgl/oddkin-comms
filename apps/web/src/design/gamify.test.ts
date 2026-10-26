import type { MyStats } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import {
  celebrationSize,
  clockLabel,
  dayLine,
  elapsedMinutes,
  earnedIds,
  milestoneCrossed,
  newlyEarned,
  recapText,
  streakLabel,
} from "./gamify";

const empty: MyStats = {
  completedToday: 0,
  completedTotal: 0,
  currentStreak: 0,
  bestStreak: 0,
  kudosReceived: 0,
  kudosGiven: 0,
  focusMinutes: 0,
  callsJoined: 0,
  commentsWritten: 0,
};

describe("achievements", () => {
  it("earns nothing from an empty scoreboard", () => {
    expect(earnedIds(empty)).toEqual([]);
  });

  it("earns each badge when its goal is reached, not before", () => {
    expect(earnedIds({ ...empty, completedTotal: 9 })).toEqual([
      "first-delivery",
    ]);
    expect(earnedIds({ ...empty, completedTotal: 10 })).toContain(
      "ten-deliveries",
    );
    expect(earnedIds({ ...empty, bestStreak: 7 })).toEqual([
      "streak-3",
      "streak-7",
    ]);
    expect(earnedIds({ ...empty, focusMinutes: 59 })).toEqual([]);
    expect(earnedIds({ ...empty, focusMinutes: 60 })).toEqual(["focus-hour"]);
  });

  it("announces only what is new", () => {
    const stats = { ...empty, completedTotal: 10, callsJoined: 1 };
    expect(newlyEarned(stats, []).map((a) => a.id)).toEqual([
      "first-delivery",
      "ten-deliveries",
      "first-call",
    ]);
    expect(
      newlyEarned(stats, ["first-delivery", "first-call"]).map((a) => a.id),
    ).toEqual(["ten-deliveries"]);
  });
});

describe("sprint milestones", () => {
  it("announces the milestone that was crossed", () => {
    expect(milestoneCrossed(2, 3, 10)).toBe(25);
    expect(milestoneCrossed(4, 5, 10)).toBe(50);
    expect(milestoneCrossed(9, 10, 10)).toBe(100);
  });

  it("announces only the highest one when several are crossed at once", () => {
    expect(milestoneCrossed(0, 8, 10)).toBe(75);
  });

  it("stays quiet between milestones, when going back, and with no work", () => {
    expect(milestoneCrossed(3, 4, 10)).toBeNull();
    expect(milestoneCrossed(6, 4, 10)).toBeNull();
    expect(milestoneCrossed(0, 0, 0)).toBeNull();
  });
});

describe("small texts", () => {
  it("celebrates heavy deliveries bigger", () => {
    expect(celebrationSize("normal", 0)).toBe("normal");
    expect(celebrationSize("urgent", 0)).toBe("big");
    expect(celebrationSize("low", 3)).toBe("big");
  });

  it("writes the streak and the day line in Portuguese", () => {
    expect(streakLabel(0)).toBe("");
    expect(streakLabel(1)).toBe("1 dia seguido");
    expect(streakLabel(4)).toBe("4 dias seguidos");
    expect(dayLine(3, 1)).toBe("1 já foi, faltam 3.");
    expect(dayLine(0, 2)).toContain("2 entregas");
  });

  it("shows a countdown as m:ss", () => {
    expect(clockLabel(25 * 60 * 1000)).toBe("25:00");
    expect(clockLabel(61_500)).toBe("1:02");
    expect(clockLabel(-5)).toBe("0:00");
  });
});

describe("focus time", () => {
  it("counts whole minutes and never more than planned", () => {
    expect(elapsedMinutes(0, 59_000, 25)).toBe(0);
    expect(elapsedMinutes(0, 7 * 60_000 + 30_000, 25)).toBe(7);
    expect(elapsedMinutes(0, 99 * 60_000, 25)).toBe(25);
    expect(elapsedMinutes(10_000, 0, 25)).toBe(0);
  });
});

describe("sprint recap", () => {
  it("summarises the sprint as text for the channel", () => {
    const text = recapText({
      name: "Sprint 12",
      goal: "Entregar o login",
      delivered: 9,
      carried: 2,
      urgent: 1,
      days: 14,
      projects: ["Alfa", "Beta"],
      streak: 4,
    });
    expect(text).toBe(
      [
        "Sprint “Sprint 12” encerrada.",
        "Missão: Entregar o login",
        "Entregas: 9 (1 urgente). Seguiram: 2.",
        "14 dias de sprint · Alfa, Beta.",
        "Maior sequência da equipe agora: 4 dias seguidos.",
      ].join("\n"),
    );
  });

  it("leaves out what does not apply", () => {
    const text = recapText({
      name: "S",
      goal: "",
      delivered: 1,
      carried: 0,
      urgent: 0,
      days: 1,
      projects: [],
      streak: 0,
    });
    expect(text).toBe(
      [
        "Sprint “S” encerrada.",
        "Entregas: 1. Seguiram: 0.",
        "1 dia de sprint.",
      ].join("\n"),
    );
  });
});
