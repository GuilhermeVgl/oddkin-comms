// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPrefs } from "./prefs";
import { H, W, burst, mountSprite, type PoseName } from "./sprites";

type Draw = { x: number; y: number; w: number; h: number; color: string };

/** A canvas context that records the squares painted on it. */
function fakeContext() {
  const draws: Draw[] = [];
  let fillStyle = "";
  const context = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    clearRect: vi.fn(() => {
      draws.length = 0;
    }),
    fillRect: (x: number, y: number, w: number, h: number) => {
      draws.push({ x, y, w, h, color: fillStyle });
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get fillStyle() {
      return fillStyle;
    },
  };
  return { context, draws };
}

let current = fakeContext();
beforeEach(() => {
  current = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => current.context as unknown as CanvasRenderingContext2D,
  );
  setPrefs({ motion: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const POSES: PoseName[] = [
  "idle",
  "wave",
  "walk",
  "think",
  "cheer",
  "highfive",
  "sit",
  "sleep",
  "oops",
  "load",
];

function mount(who: "capuz" | "tela", pose: PoseName, flip = false) {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  return {
    canvas,
    handle: mountSprite(canvas, { who, scale: 2, pose, flip }),
  };
}

describe("mountSprite", () => {
  it.each(["capuz", "tela"] as const)(
    "paints every pose of %s inside its canvas",
    (who) => {
      for (const pose of POSES) {
        current = fakeContext();
        const { canvas, handle } = mount(who, pose);
        expect(canvas.width).toBe(W * 2);
        expect(canvas.height).toBe(H * 2);
        expect(current.draws.length).toBeGreaterThan(50);
        for (const draw of current.draws) {
          expect(draw.x).toBeGreaterThanOrEqual(0);
          expect(draw.x + draw.w).toBeLessThanOrEqual(W * 2);
          expect(draw.y + draw.h).toBeLessThanOrEqual(H * 2);
        }
        handle.dispose();
      }
    },
  );

  it("mirrors the drawing when flipped", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    current = fakeContext();
    mount("capuz", "idle");
    const normal = current.draws.map((d) => `${d.x},${d.y}`);
    current = fakeContext();
    mount("capuz", "idle", true);
    const flipped = current.draws.map((d) => `${d.x},${d.y}`);
    expect(flipped).not.toEqual(normal);
    expect(flipped).toHaveLength(normal.length);
  });

  it("changes pose and goes back after the hold time", () => {
    vi.useFakeTimers();
    const { handle } = mount("tela", "idle");
    const before = current.draws.map((d) => d.color).join();
    handle.set("cheer", 500);
    const during = current.draws.map((d) => `${d.x},${d.y},${d.color}`).join();
    expect(during).not.toBe(before);
    handle.set("wave", 200);
    handle.set("cheer");
    vi.advanceTimersByTime(600);
    handle.dispose();
  });

  it("animates on the shared ticker and stops after dispose", async () => {
    // The ticker is shared by the whole module, so start from a fresh one.
    vi.useFakeTimers();
    vi.resetModules();
    const fresh = await import("./sprites");
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const handle = fresh.mountSprite(canvas, {
      who: "capuz",
      scale: 2,
      pose: "walk",
    });
    const clears = current.context.clearRect.mock.calls.length;
    vi.advanceTimersByTime(400);
    expect(current.context.clearRect.mock.calls.length).toBeGreaterThan(clears);
    handle.dispose();
    const after = current.context.clearRect.mock.calls.length;
    vi.advanceTimersByTime(400);
    expect(current.context.clearRect.mock.calls.length).toBe(after);
  });

  it("holds still with reduced motion", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const prefs = await import("./prefs");
    prefs.setPrefs({ motion: false });
    const fresh = await import("./sprites");
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const handle = fresh.mountSprite(canvas, {
      who: "capuz",
      scale: 2,
      pose: "walk",
    });
    const clears = current.context.clearRect.mock.calls.length;
    vi.advanceTimersByTime(400);
    expect(current.context.clearRect.mock.calls.length).toBe(clears);
    handle.dispose();
  });

  it("does nothing when the browser has no canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { handle } = mount("capuz", "idle");
    expect(() => {
      handle.set("wave", 10);
      handle.dispose();
    }).not.toThrow();
  });
});

describe("burst", () => {
  it("scatters particles on an overlay canvas and cleans up when they fade", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) =>
      setTimeout(fn, 16),
    );
    expect(burst(100, 100, { count: 12, up: true, colors: ["#fff"] })).toBe(
      true,
    );
    const overlay = document.querySelector("canvas[aria-hidden]");
    expect(overlay).not.toBeNull();
    expect(current.draws.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000);
    expect(document.querySelector("canvas[aria-hidden]")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does nothing with reduced motion", () => {
    setPrefs({ motion: false });
    expect(burst(1, 1)).toBe(false);
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("gives up when there is no canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(burst(1, 1)).toBe(false);
    expect(document.querySelector("canvas")).toBeNull();
  });
});
