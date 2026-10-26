import { describe, expect, it } from "vitest";
import { needsMaintenance } from "./steward";

describe("needsMaintenance", () => {
  it("skips domains that have no key yet", () => {
    expect(
      needsMaintenance({ currentGeneration: 0, state: "rotation_required" }),
    ).toBe(false);
  });

  it("skips domains that are in order", () => {
    expect(needsMaintenance({ currentGeneration: 3, state: "ok" })).toBe(false);
  });

  it("picks domains with a key that need a hand-over or a rotation", () => {
    expect(
      needsMaintenance({ currentGeneration: 1, state: "rotation_required" }),
    ).toBe(true);
  });
});
