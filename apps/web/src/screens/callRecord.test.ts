import type { CallRecord } from "@crewstead/api-client";
import { describe, expect, it } from "vitest";
import { describeCall, formatDuration } from "./callRecord";

const base: CallRecord = {
  id: "c1",
  state: "ended",
  startedBy: "ana@crewstead.test",
  startedAt: "2026-10-26T10:00:00Z",
  participants: ["ana@crewstead.test", "bruno@crewstead.test"],
  answered: true,
  durationSeconds: 754,
};

describe("call record text", () => {
  it("writes durations people can read", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(754)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
  });

  it("summarises an answered call with who took part", () => {
    const summary = describeCall(base, "carla@crewstead.test");
    expect(summary.tone).toBe("done");
    expect(summary.title).toBe("Chamada de 12 min");
    expect(summary.detail).toBe("Ana e Bruno participaram · iniciada por Ana");
    expect(describeCall(base, "ana@crewstead.test").detail).toContain(
      "iniciada por você",
    );
  });

  it("tells a missed call apart from one nobody picked up", () => {
    const missed = { ...base, answered: false, participants: [] };
    expect(describeCall(missed, "bruno@crewstead.test")).toMatchObject({
      tone: "missed",
      title: "Chamada perdida de Ana",
    });
    expect(describeCall(missed, "ana@crewstead.test").title).toBe(
      "Ninguém atendeu",
    );
  });

  it("shows a running call as live", () => {
    const live = { ...base, state: "active" as const, participants: [] };
    expect(describeCall(live, "bruno@crewstead.test")).toMatchObject({
      tone: "live",
      title: "Chamada em andamento",
    });
  });
});
