import { describe, expect, it } from "vitest";
import { stepSpring, tiltFor } from "./spring";

describe("drag spring", () => {
  it("settles on the target without running away", () => {
    let state = { x: 0, y: 0, vx: 0, vy: 0 };
    let farthest = 0;
    for (let frame = 0; frame < 120; frame++) {
      state = stepSpring(state, 100, -40);
      farthest = Math.max(farthest, Math.abs(state.x));
    }
    expect(state.x).toBeCloseTo(100, 1);
    expect(state.y).toBeCloseTo(-40, 1);
    expect(farthest).toBeLessThan(130);
  });

  it("lags behind a moving target, which is what makes it feel physical", () => {
    const first = stepSpring({ x: 0, y: 0, vx: 0, vy: 0 }, 100, 0);
    expect(first.x).toBeGreaterThan(0);
    expect(first.x).toBeLessThan(100);
  });

  it("leans with the motion and never too far", () => {
    expect(tiltFor(0)).toBe(0);
    expect(tiltFor(8)).toBeGreaterThan(0);
    expect(tiltFor(-8)).toBeLessThan(0);
    expect(tiltFor(500)).toBe(9);
    expect(tiltFor(-500)).toBe(-9);
  });
});
